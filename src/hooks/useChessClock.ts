// hooks/useChessClock.ts — Wall-clock chess clock (Rapid, Fischer increment).
//
// CORRECTNESS: this clock is WALL-CLOCK based, never a tick-accumulator. Browsers throttle
// background-tab `setInterval` (to >=1s, then >=1min after ~5min hidden) and pause
// `requestAnimationFrame`. A clock that subtracted "ticks" from a running total would freeze
// while the tab is hidden — both wrong and trivially exploitable (hide tab to stop your clock).
// Instead we bank each side's remaining time and, for the side to move, derive the live value
// from `Date.now()`. The 250ms interval only forces a re-render + flag check; it is NEVER the
// source of truth.
//
// TURN-EDGE MODEL: in this game every committed move (promotion included) flips `turn` exactly
// once, and a clock only runs for the side to move. So an `activeColor` change while running
// means the previous side completed a move → bank its elapsed time and add the Fischer
// increment. A side can therefore only ever flag on its OWN turn.
import { useEffect, useRef, useState } from 'react';
import type { PieceColor } from '@/types/game';
import type { TimeControl, ClockRemaining } from '@/constants/timeControls';

export interface UseChessClockParams {
  /** `null` disables the clock entirely — the hook becomes inert and reports `enabled: false`. */
  timeControl: TimeControl | null;
  /** The side whose clock is currently running (the game's `turn`). */
  activeColor: PieceColor;
  /** True while the game is live. When false, both clocks freeze (terminal status, awaiting init). */
  running: boolean;
  /** Fired exactly once, with the flagged side, when a running clock reaches 0. */
  onFlag: (flagged: PieceColor) => void;
  /**
   * Optional starting remaining, used to RESUME a saved game (Option B pause-on-refresh).
   * When omitted, both sides start at `timeControl.baseMs`. Read once on mount.
   */
  initialRemaining?: ClockRemaining | null;
  /**
   * Bump this to reset both clocks to `baseMs` (e.g. pass the game id). Changing it starts a
   * fresh clock for a new game even when the time control is unchanged. Ignored on first mount
   * so a resumed `initialRemaining` is preserved.
   */
  resetKey?: unknown;
}

export interface ChessClock {
  /** True when a time control is active. */
  enabled: boolean;
  /** Live remaining ms for white (derived from Date.now() when white is to move). */
  whiteMs: number;
  /** Live remaining ms for black (derived from Date.now() when black is to move). */
  blackMs: number;
  /** True once a side has flagged; the clock is stopped. */
  flagged: boolean;
  /** Reset both sides to `baseMs` (or a supplied control) and clear the flag. Call on new game. */
  reset: (nextControl?: TimeControl | null) => void;
  /**
   * Overwrite both sides' banked remaining with an authoritative snapshot (e.g. from a peer's
   * move in Online PvP) and restart the running segment from now. If both values are > 0 the
   * flag latch is cleared, so a premature local flag (our estimate ran ahead of the opponent's
   * real clock by network latency) recovers cleanly when their move actually arrives.
   */
  adopt: (remaining: ClockRemaining) => void;
  /** Settled snapshot of remaining ms for persistence (banks the running segment). */
  snapshot: () => ClockRemaining;
}

function baseState(tc: TimeControl | null): ClockRemaining {
  const ms = tc?.baseMs ?? 0;
  return { white: ms, black: ms };
}

export function useChessClock({
  timeControl,
  activeColor,
  running,
  onFlag,
  initialRemaining,
  resetKey,
}: UseChessClockParams): ChessClock {
  // Banked remaining, NOT counting the currently-running segment.
  const bankedRef = useRef<ClockRemaining>(initialRemaining ?? baseState(timeControl));
  // Date.now() when the active side's current segment began; null while paused/stopped.
  const segmentStartRef = useRef<number | null>(null);
  // The color whose segment is (or was) running — the settle target on the next edge.
  const activeRef = useRef<PieceColor>(activeColor);
  // True once a flag has fired; latches the clock off until reset().
  const flaggedRef = useRef(false);
  // Live control, so reset(nextControl) can change base without a prop round-trip.
  const controlRef = useRef<TimeControl | null>(timeControl);
  controlRef.current = timeControl;
  // Stable onFlag access without re-subscribing the interval.
  const onFlagRef = useRef(onFlag);
  onFlagRef.current = onFlag;

  // Re-render pump. The value is meaningless; bumping it recomputes derived remaining.
  const [, tick] = useState(0);
  const rerender = () => tick((n) => n + 1);

  const enabled = timeControl != null;

  /** Live remaining for a color, deriving the running segment from Date.now(). */
  function remainingOf(color: PieceColor): number {
    const banked = bankedRef.current[color];
    if (color === activeRef.current && segmentStartRef.current != null) {
      return Math.max(0, banked - (Date.now() - segmentStartRef.current));
    }
    return banked;
  }

  /** Fire onFlag once when the running side hits 0. */
  function checkFlag() {
    if (flaggedRef.current || segmentStartRef.current == null) return;
    const active = activeRef.current;
    const remaining = remainingOf(active);
    if (remaining <= 0) {
      flaggedRef.current = true;
      bankedRef.current = { ...bankedRef.current, [active]: 0 };
      segmentStartRef.current = null;
      rerender();
      onFlagRef.current(active);
    }
  }

  // Stable indirection for the interval + new-game-reset effects below. `rerender`/`checkFlag`
  // are redefined every render but read ONLY refs, and `activeColor`/`running` are reactive
  // values those effects must read WITHOUT depending on (the interval must not re-subscribe
  // each render; the reset must fire only on `resetKey`). Routing through refs lets each effect
  // depend solely on its true inputs and satisfy exhaustive-deps honestly. Same render-time
  // ref-write pattern already used above for controlRef/onFlagRef.
  const rerenderRef = useRef(rerender);
  rerenderRef.current = rerender;
  const checkFlagRef = useRef(checkFlag);
  checkFlagRef.current = checkFlag;
  const activeColorRef = useRef(activeColor);
  activeColorRef.current = activeColor;
  const runningRef = useRef(running);
  runningRef.current = running;

  // Turn-edge + running transitions. Settles the outgoing segment, applies Fischer increment on
  // an actual turn change, then starts the new segment when running.
  useEffect(() => {
    const tc = controlRef.current;
    if (!tc) {
      segmentStartRef.current = null;
      return;
    }
    const now = Date.now();
    const prevActive = activeRef.current;
    const wasRunning = segmentStartRef.current != null;

    // Bank whatever the previously-active side spent in its running segment.
    if (wasRunning) {
      const elapsed = now - segmentStartRef.current!;
      bankedRef.current = {
        ...bankedRef.current,
        [prevActive]: Math.max(0, bankedRef.current[prevActive] - elapsed),
      };
      segmentStartRef.current = null;

      // A real turn change (not a mere pause) means the previous side completed a move.
      // Award the Fischer increment — but never resurrect a side that already flagged.
      if (prevActive !== activeColor && bankedRef.current[prevActive] > 0) {
        bankedRef.current = {
          ...bankedRef.current,
          [prevActive]: bankedRef.current[prevActive] + tc.incrementMs,
        };
      }
    }

    activeRef.current = activeColor;

    if (running && !flaggedRef.current) {
      segmentStartRef.current = now;
    }
    rerender();
    // controlRef/onFlagRef are refs; only the true inputs belong here.
  }, [activeColor, running, timeControl]);

  // Re-render pump + flag check while running. 250ms is plenty for a display clock, and the
  // wall-clock derivation stays accurate even if the browser throttles this interval.
  useEffect(() => {
    if (!enabled || !running) return;
    const id = window.setInterval(() => {
      rerenderRef.current();
      checkFlagRef.current();
    }, 250);
    const onVisibility = () => {
      // Recompute immediately on tab focus — if the side already ran out while hidden, flag now.
      rerenderRef.current();
      checkFlagRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, running]);

  function reset(nextControl?: TimeControl | null) {
    const tc = nextControl === undefined ? controlRef.current : nextControl;
    controlRef.current = tc;
    bankedRef.current = baseState(tc);
    segmentStartRef.current = null;
    flaggedRef.current = false;
    // The next turn-edge effect run will start a fresh segment if the game is running.
    rerender();
  }

  // New-game reset. Skips the first mount so a resumed `initialRemaining` is not clobbered.
  // Declared LAST so it runs after the turn-edge effect on any commit where both fire,
  // making the reset authoritative. Restarts the running segment itself (the turn-edge
  // effect may not re-run if `activeColor` happens to be unchanged across the new game).
  const didMountResetRef = useRef(false);
  useEffect(() => {
    if (!didMountResetRef.current) {
      didMountResetRef.current = true;
      return;
    }
    const tc = controlRef.current;
    bankedRef.current = baseState(tc);
    flaggedRef.current = false;
    activeRef.current = activeColorRef.current;
    segmentStartRef.current = tc && runningRef.current ? Date.now() : null;
    rerenderRef.current();
  }, [resetKey]);

  function snapshot(): ClockRemaining {
    return { white: remainingOf('white'), black: remainingOf('black') };
  }

  function adopt(remaining: ClockRemaining) {
    if (!controlRef.current) return; // untimed match — nothing to sync
    bankedRef.current = { white: remaining.white, black: remaining.black };
    // Recover from a premature local flag: if the authoritative values both have time left,
    // the side we flagged had not really run out, so unlatch the clock.
    if (flaggedRef.current && remaining.white > 0 && remaining.black > 0) {
      flaggedRef.current = false;
    }
    // Restart the active side's running segment from the freshly adopted base.
    segmentStartRef.current = running && !flaggedRef.current ? Date.now() : null;
    rerender();
  }

  return {
    enabled,
    whiteMs: remainingOf('white'),
    blackMs: remainingOf('black'),
    flagged: flaggedRef.current,
    reset,
    adopt,
    snapshot,
  };
}
