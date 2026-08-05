// components/game/panels/PanelDeck.tsx — Swipe-only single-view deck (looping carousel).
//
// Collapses the tall Charge → Coach → Replay stack into ONE compact, board-adjacent surface so
// the board stays in view (no long scroll). Shows exactly one panel at a time and cycles WITH
// WRAP by horizontal SWIPE (touch / mouse-drag) — no visible tab chrome. To stay accessible it's
// also focusable with ← / → arrow keys, and an sr-only live region announces the active panel.
// Reduced-motion aware. Swipe RIGHT advances forward (Charge → Coach → Replay → Charge); swipe
// LEFT steps back.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface DeckPanel {
  /** Stable key + aria id source. */
  id: string;
  /** Short tab label (the panel keeps its own full heading inside). */
  label: string;
  content: ReactNode;
}

/** Horizontal travel (px) needed to count as a page swipe, and how much it must beat vertical. */
const SWIPE_THRESHOLD = 45;

export function PanelDeck({ panels, replayKey, replayFocusSignal }: { panels: DeckPanel[]; replayKey?: number | string; replayFocusSignal?: number }) {
  const count = panels.length;
  const [{ index, dir }, setState] = useState({ index: 0, dir: 0 });
  const reduce = useReducedMotion();
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const paginate = (delta: number) =>
    setState((s) => ({ index: (s.index + delta + count) % count, dir: delta >= 0 ? 1 : -1 }));

  // New game: reset to Charge (index 0) when replayKey (gameId) changes. The ref-guard
  // skips the initial mount so the deck doesn't animate on first render.
  const prevReplayKey = useRef(replayKey);
  useEffect(() => {
    if (prevReplayKey.current === replayKey) return;
    prevReplayKey.current = replayKey;
    setState({ index: 0, dir: -1 });
  }, [replayKey]);

  // Game over / replay import: jump to the Replay panel when the signal bumps.
  // Guarded so it never fires on mount (0).
  useEffect(() => {
    if (!replayFocusSignal) return;
    const i = panels.findIndex((p) => p.id === 'history');
    if (i >= 0) setState({ index: i, dir: 1 });
  }, [replayFocusSignal]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot focus on signal bump

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = swipeStart.current;
    swipeStart.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    // Only a clearly-horizontal drag pages, so vertical scrolls never flip the panel.
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.2) paginate(dx > 0 ? 1 : -1);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); paginate(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); paginate(-1); }
  };

  const active = panels[index];

  // Enter-only slide (no AnimatePresence): keying on the active id remounts a single node, so
  // exactly ONE panel is ever in the DOM — no stale, invisible, click-intercepting overlays.
  const variants = {
    enter: (d: number) => ({ opacity: 0, x: reduce ? 0 : d >= 0 ? 32 : -32 }),
    center: { opacity: 1, x: 0 },
  };

  return (
    // Swipe-only carousel (no visible tabs). Keyboard users can Tab to it and use ← / →; the
    // sr-only live region keeps it screen-reader accessible by announcing the active panel.
    // NOTE: square corners (no rounded) — a corner radius here would clip panel text near the
    // bottom corners under `overflow-hidden`.
    <div
      className="relative overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/40"
      style={{ touchAction: 'pan-y' }}
      role="group"
      aria-roledescription="carousel"
      aria-label="Game panels — swipe left or right to switch"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { swipeStart.current = null; }}
      onKeyDown={onKeyDown}
    >
      <span className="sr-only" aria-live="polite">{active.label}</span>
      {/* Directional swipe affordance + click controls, SPLIT to the deck's two edges so ‹ (left)
          intuitively reads as "back / swipe left" and › (right) as "forward / swipe right". Each
          nudges toward its OWN side a few times at the start of each game (keyed by replayKey/gameId)
          to hint the deck is swipeable, then rests. Both wrappers are pointer-events-none so they
          never block a swipe or the panel beneath; only the chevron buttons are interactive.
          Reduced-motion users get a static — but still clickable — pair. */}
      <div className="pointer-events-none absolute top-1.5 left-0.5 z-10">
        <motion.button
          key={`prev-${replayKey}`}
          type="button"
          aria-label="Previous panel"
          onClick={() => paginate(-1)}
          animate={reduce ? undefined : { x: [0, -2.5, 0] }}
          transition={reduce ? undefined : { duration: 2.6, repeat: 3, ease: 'easeInOut' }}
          className="pointer-events-auto p-1.5 rounded text-gc-text-dim/55 hover:text-gc-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-gc-accent/60 transition-colors"
        >
          <svg width="9" height="13" viewBox="0 0 7 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 1.5 1.5 5 5 8.5" />
          </svg>
        </motion.button>
      </div>
      <div className="pointer-events-none absolute top-1.5 right-0.5 z-10">
        <motion.button
          key={`next-${replayKey}`}
          type="button"
          aria-label="Next panel"
          onClick={() => paginate(1)}
          animate={reduce ? undefined : { x: [0, 2.5, 0] }}
          transition={reduce ? undefined : { duration: 2.6, repeat: 3, ease: 'easeInOut' }}
          className="pointer-events-auto p-1.5 rounded text-gc-text-dim/55 hover:text-gc-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-gc-accent/60 transition-colors"
        >
          <svg width="9" height="13" viewBox="0 0 7 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 1.5 5.5 5 2 8.5" />
          </svg>
        </motion.button>
      </div>
      <motion.div
        key={active.id}
        custom={dir}
        variants={variants}
        initial="enter"
        animate="center"
        transition={{ duration: reduce ? 0 : 0.24, ease: 'easeOut' }}
        role="group"
        aria-label={active.label}
        className="w-full"
      >
        {active.content}
      </motion.div>
    </div>
  );
}

export default PanelDeck;
