// hooks/useGamePersistence.ts — Resume-on-refresh save/restore + Sandbox handoff.
// Extracted from LocalGame.tsx (Phase 2B of LocalGame_Modular_Extraction_Plan.md).
//
// IMPORTANT: the mount effect handles TWO concerns behind one didRestoreRef guard:
// 1. Sandbox handoff (location.state.loadSandbox) — board loaded from the Sandbox editor
// 2. RESUME_KEY restore — resume an in-progress single-player game from localStorage
// Both paths must be co-located to preserve the ordering guard that prevents the persist
// effect from overwriting a just-loaded game.

import { useRef, useEffect } from 'react';
import type { RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { PieceColor, Piece } from '@/types/game';
import type { OpponentMode } from '@/components/game/panels';
import type { GenerationMode } from '@/lib/chess/generator';
import type { TimeControlId, ClockRemaining } from '@/constants/timeControls';
import type { GridlockMove, GridlockReplay, ReplayState, GridlockPosition } from '@/lib/chess/format';
import { parseReplay, replayTo, REPLAY_VERSION } from '@/lib/chess/format';
import { readString } from '@/lib/storage';
import { TIME_CONTROL_OPTIONS } from '@/constants/timeControls';
import type { BoardAngle } from '@/components/board/boardOrientation';

// ── Constants ─────────────────────────────────────────────────────────────────

export const RESUME_KEY = 'gridlock:resume:v1';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Snapshot persisted to resume an in-progress game across a page refresh. */
export interface ResumeSnapshot {
  v: 1;
  replay: GridlockReplay;
  opponentMode: OpponentMode;
  humanColor: PieceColor;
  generationMode: GenerationMode;
  capturedPieces: { white: Piece[]; black: Piece[] };
  // Clock fields are OPTIONAL on v:1 so older saves (and no-clock games) keep resuming; a
  // missing pair is simply treated as "no clock" (ClockTimerPlan.md §6.2–6.3, Option B).
  timeControlId?: TimeControlId;
  clock?: ClockRemaining;
}

/** Shape of location.state written by the Sandbox editor's "Play this position" button. */
export interface SandboxHandoff {
  loadSandbox?: GridlockReplay;
  sandboxOpponent?: OpponentMode;
  sandboxColor?: PieceColor;
  sandboxReplayMode?: boolean;
  sandboxBothBots?: boolean;
  sandboxBoardAngle?: BoardAngle;
}

// ── readResumeClock ────────────────────────────────────────────────────────────

/**
 * Synchronously read (at mount) just the clock-relevant fields of a saved game, so the clock
 * hook can seed its `initialRemaining` before the async restore effect runs. Does NOT validate
 * the replay (that's the restore effect's job) — a corrupt replay self-heals on the next game.
 */
export function readResumeClock(): { timeControlId: TimeControlId | null; clock: ClockRemaining | null } {
  const raw = readString(RESUME_KEY);
  if (!raw) return { timeControlId: null, clock: null };
  try {
    const saved = JSON.parse(raw) as ResumeSnapshot;
    if (saved?.v !== 1 || saved.opponentMode === 'uplink') return { timeControlId: null, clock: null };
    const id = TIME_CONTROL_OPTIONS.some((o) => o.id === saved.timeControlId) ? saved.timeControlId! : null;
    const clock =
      saved.clock && typeof saved.clock.white === 'number' && typeof saved.clock.black === 'number'
        ? saved.clock
        : null;
    return { timeControlId: id, clock };
  } catch {
    return { timeControlId: null, clock: null };
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGamePersistence(params: {
  isUplink: boolean;
  engineStatus: string;
  opponentMode: OpponentMode;
  humanColor: PieceColor;
  generationMode: GenerationMode;
  capturedPieces: { white: Piece[]; black: Piece[] };
  timeControlId: TimeControlId;
  replayMoves: GridlockMove[];
  gameId: number;
  startPosRef: RefObject<GridlockPosition | null>;
  pendingImportLoadRef: RefObject<GridlockReplay | null>;
  /** Called each render; read through a ref in the persist effect so it never sits in the
   *  dep array (same pattern as the original clockPersistRef). */
  clockSnapshot: () => ClockRemaining | null;
  /** Called by the mount effect's RESUME_KEY path after parsing + migration succeeds. */
  onRestore: (snapshot: ResumeSnapshot, replay: GridlockReplay, final: ReplayState) => void;
  /** Called by the mount effect's Sandbox handoff path after parsing succeeds. */
  onSandboxLoad: (replay: GridlockReplay, final: ReplayState, handoff: SandboxHandoff) => void;
}): void {
  const {
    isUplink, engineStatus, opponentMode, humanColor, generationMode,
    capturedPieces, timeControlId, replayMoves, gameId,
    startPosRef, pendingImportLoadRef, clockSnapshot, onRestore, onSandboxLoad,
  } = params;

  const location = useLocation();
  const navigate = useNavigate();

  // Stable ref so the persist effect can read the latest clock snapshot without
  // adding the function to the dep array (mirrors the original clockPersistRef pattern).
  const clockSnapshotRef = useRef(clockSnapshot);
  clockSnapshotRef.current = clockSnapshot;

  // ── Restore / Sandbox handoff (mount-only) ────────────────────────────────
  // didRestoreRef is the ordering guard that prevents the persist effect from
  // overwriting a just-loaded game. It covers BOTH paths below — they must stay
  // co-located for the guard to be self-contained.
  const didRestoreRef = useRef(false);
  useEffect(() => {
    if (didRestoreRef.current) return;
    didRestoreRef.current = true;

    // Sandbox handoff (from the /sandbox "Play this position" button) takes precedence over any
    // resume snapshot. The replay is zero-move, so this mirrors the resume load below: seed the
    // start position + apply the opponent/side, then clear the router state so a refresh doesn't
    // re-trigger it. A malformed payload silently falls through to a normal fresh/resumed board.
    const handoff = location.state as SandboxHandoff | null;
    if (handoff?.loadSandbox) {
      try {
        const r = parseReplay(handoff.loadSandbox);
        const final = replayTo(r);
        onSandboxLoad(r, final, handoff);
      } catch {
        /* malformed handoff — ignore and let the normal fresh/resume path run on next mount */
      }
      navigate(location.pathname, { replace: true, state: null });
      return;
    }

    let raw: string | null = null;
    try { raw = localStorage.getItem(RESUME_KEY); } catch { return; }
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as ResumeSnapshot;
      if (saved?.v !== 1 || saved.opponentMode === 'uplink') {
        localStorage.removeItem(RESUME_KEY);
        return;
      }
      const r = parseReplay(saved.replay); // validates every move re-applies cleanly
      const final = replayTo(r);
      onRestore(saved, r, final);
    } catch {
      try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist (after every committed change) ────────────────────────────────
  // Declared after the restore effect so on first mount restore reads the saved game
  // before this can overwrite it. Uplink is excluded; a finished game clears the key
  // so the next visit starts fresh.
  useEffect(() => {
    if (!didRestoreRef.current) return; // wait until the mount-restore has had its read
    if (pendingImportLoadRef.current) return; // a restore/import load is mid-flight — let it land first
    const start = startPosRef.current;
    if (isUplink || !start) return;
    if (engineStatus !== 'playing') {
      try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
      return;
    }
    const clock = clockSnapshotRef.current();
    const snapshot: ResumeSnapshot = {
      v: 1,
      replay: { v: REPLAY_VERSION, meta: { generationMode }, start, moves: replayMoves },
      opponentMode,
      humanColor,
      generationMode,
      capturedPieces,
      timeControlId,
      // Option B (pause-on-refresh): persist each side's remaining at every move-commit.
      ...(clock !== null ? { clock } : {}),
    };
    try { localStorage.setItem(RESUME_KEY, JSON.stringify(snapshot)); } catch { /* quota / private mode */ }
  }, [replayMoves, engineStatus, opponentMode, humanColor, generationMode, capturedPieces, gameId, isUplink, timeControlId]); // eslint-disable-line react-hooks/exhaustive-deps -- refs are stable objects; .current reads are intentionally non-reactive
}
