// components/docs/VectorChargesDemo.tsx — Interactive archetype explorer for the Rules page.
//
// DESIGN: A self-contained 5×5 sandbox that lets the reader cycle through all 11
// archetypes (‹ ›) — each loaded with its real 10-charge split — and move it to feel the
// core mechanic first-hand: every move spends one charge from the vector used, and when
// the pool empties the piece Gridlocks, exactly like the live game.
//
// The piece is rendered with the SAME <Piece> component used on the real board, so the
// glyph, side-disc and stacked vector badges are pixel-identical to the actual game
// (the on-board glyph is driven by `archetype`; Omni shows a shared-pool ★ badge).
// Movement is computed locally (5×5, no other pieces) to keep the demo fully isolated
// from the 8×8 engine. Splits are rolled by the engine's own generate() on every archetype
// switch, so ranged archetypes show real, varying values — exactly like a fresh game.

import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { Anomaly, OmniAnomaly, ArchetypeKey, VectorType, VectorPool } from '@/types/game';
import { ARCHETYPES, OMNI_ARCHETYPE, ARCHETYPE_DEFS_IN_ORDER } from '@/lib/chess/archetypes';
import { ARCHETYPE_SPECIALTY } from '@/components/docs/archetypeMeta';
import { Piece } from '@/components/pieces/Piece';
import { GhostBattery } from '@/components/pieces/VectorBadge';
import { useGameSound } from '@/hooks/useGameSound';
import { STAGGER } from '@/lib/audio/engine';

// ── Board geometry ─────────────────────────────────────────────────────────────
const SIZE = 5;              // 5×5 board
const CENTER = 2;            // middle square (row 2, col 2)

type Cell = { row: number; col: number };
const inBounds = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;

// ── Vector legend metadata (matches the live VectorBadge colors) ────────────────
const VECTOR_META: Record<VectorType, { label: string; symbol: string; color: string; dot: string }> = {
  L: { label: 'Leap', symbol: 'Leap', color: 'text-gc-leap', dot: 'bg-gc-leap/35' },
  O: { label: 'Orthogonal', symbol: 'Orthogonal', color: 'text-gc-ortho', dot: 'bg-gc-ortho/35' },
  D: { label: 'Diagonal', symbol: 'Diagonal', color: 'text-gc-diag', dot: 'bg-gc-diag/35' },
};

const KNIGHT_DELTAS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
] as const;

const SLIDE_ORTHO = [[0, 1], [0, -1], [1, 0], [-1, 0]] as const;
const SLIDE_DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/**
 * Compute every reachable square (and the vector that reaches it) from a position,
 * gated by the remaining charges. On a 5×5 board with no other pieces, Leap /
 * Orthogonal / Diagonal targets never overlap, so each square maps to one vector.
 */
function computeMoves(pos: Cell, vectors: VectorPool): Map<string, VectorType> {
  const moves = new Map<string, VectorType>();

  if (vectors.L > 0) {
    for (const [dr, dc] of KNIGHT_DELTAS) {
      const r = pos.row + dr;
      const c = pos.col + dc;
      if (inBounds(r, c)) moves.set(`${r},${c}`, 'L');
    }
  }

  const slide = (dirs: readonly (readonly [number, number])[], vector: VectorType) => {
    for (const [dr, dc] of dirs) {
      let r = pos.row + dr;
      let c = pos.col + dc;
      while (inBounds(r, c)) {
        const k = `${r},${c}`;
        if (!moves.has(k)) moves.set(k, vector);
        r += dr;
        c += dc;
      }
    }
  };

  if (vectors.O > 0) slide(SLIDE_ORTHO, 'O');
  if (vectors.D > 0) slide(SLIDE_DIAG, 'D');

  return moves;
}

const INITIAL_POS: Cell = { row: CENTER, col: CENTER };

const PIECE_ID = 'demo-piece';

// Omni / Terminator shared-pool size (matches OMNI_ARCHETYPE.sharedPool).
const OMNI_SHARED = OMNI_ARCHETYPE.sharedPool;

// Icons sourced from the engine so the selector can never drift from the real pieces.
const ICON_BY_KEY: Record<ArchetypeKey, string> = (() => {
  const map = { omni: OMNI_ARCHETYPE.icon } as Record<ArchetypeKey, string>;
  for (const a of ARCHETYPES) map[a.key] = a.icon;
  return map;
})();

// Type names (e.g. 'High Leap') sourced from the engine — used to prefix the demo's
// specialty line. NOT baked into the shared blurb, because the Archetype table already
// renders the name in its own column and would otherwise duplicate it.
const NAME_BY_KEY: Record<ArchetypeKey, string> = (() => {
  const map = { omni: OMNI_ARCHETYPE.name } as Record<ArchetypeKey, string>;
  for (const a of ARCHETYPES) map[a.key] = a.name;
  return map;
})();

// Roll functions sourced from the engine so the demo's splits are produced EXACTLY like the
// live game — every archetype switch (and the first load) rolls a fresh split within that
// archetype's real ranges. Absolutes have fixed generate() output, so they stay constant;
// the High / Hybrid / Balanced archetypes vary on each visit.
const GENERATE_BY_KEY: Record<Exclude<ArchetypeKey, 'omni'>, () => VectorPool> = (() => {
  const map = {} as Record<Exclude<ArchetypeKey, 'omni'>, () => VectorPool>;
  // ARCHETYPES never contains Omni (promotion-only), so the key is safe to narrow here.
  for (const a of ARCHETYPES) map[a.key as Exclude<ArchetypeKey, 'omni'>] = () => a.generate();
  return map;
})();

// ── Archetype explorer data ─────────────────────────────────────────────
// The 11 archetypes the reader can cycle through, in the SAME order as the on-page
// Archetype Guide (Absolute → High → Hybrid → Balanced → Omni). Both the order and each
// callsign are derived from the single source of truth (ARCHETYPE_REGISTRY, via
// ARCHETYPE_DEFS_IN_ORDER) so they can never drift from the reference table. The L/O/D
// split is NOT stored here — it's rolled live by the engine's generate() each time you
// land on an archetype (see GENERATE_BY_KEY / seedPool). Omni has no split; it carries one
// shared pool spendable on any vector.
type DemoArchetype =
  | { kind: 'split'; key: Exclude<ArchetypeKey, 'omni'>; callsign: string }
  | { kind: 'omni'; key: 'omni'; callsign: string };

const DEMO_ARCHETYPES: DemoArchetype[] = ARCHETYPE_DEFS_IN_ORDER.map((d) =>
  d.key === 'omni'
    ? { kind: 'omni', key: 'omni', callsign: d.alias }
    : { kind: 'split', key: d.key as Exclude<ArchetypeKey, 'omni'>, callsign: d.alias },
);

// ── Charge-pool state ───────────────────────────────────────────────
type DemoPool =
  | { kind: 'split'; v: VectorPool }
  | { kind: 'omni'; shared: number };

const seedPool = (a: DemoArchetype): DemoPool =>
  a.kind === 'omni'
    ? { kind: 'omni', shared: OMNI_SHARED }
    : { kind: 'split', v: GENERATE_BY_KEY[a.key]() };

// ── Draggable piece ─────────────────────────────────────────────────────────────
function DraggablePiece({
  piece,
  disabled,
  isSelected,
  onClick,
}: {
  piece: Anomaly | OmniAnomaly;
  disabled: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: PIECE_ID,
    disabled,
  });

  return (
    <motion.div
      ref={setNodeRef}
      layout
      layoutId={PIECE_ID}
      transition={{ type: 'spring', stiffness: 650, damping: 42, mass: 0.9 }}
      className={`absolute inset-0 z-10 flex items-center justify-center touch-none ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${isDragging ? 'opacity-30' : ''} ${isSelected && !isDragging ? 'ring-2 ring-gc-accent ring-inset rounded-sm' : ''}`}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <Piece piece={piece} animateMove={false} />
    </motion.div>
  );
}

// ── Droppable square ────────────────────────────────────────────────────────────
function DroppableCell({
  row,
  col,
  isLight,
  isLegal,
  moveVector,
  isLastMoveFrom,
  isLastMoveTo,
  lastMoveVectorType,
  ghost,
  onClick,
  children,
}: {
  row: number;
  col: number;
  isLight: boolean;
  isLegal: boolean;
  moveVector: VectorType | undefined;
  isLastMoveFrom: boolean;
  isLastMoveTo: boolean;
  lastMoveVectorType: VectorType | null;
  ghost: { vectors: VectorPool; spentVector: VectorType | null } | null;
  onClick: () => void;
  children?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${row}-${col}`, disabled: !isLegal });

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`relative flex aspect-square w-full [container-type:inline-size] items-center justify-center ${
        isLight ? 'bg-gc-light-sq' : 'bg-gc-dark-sq'
      } ${isLegal ? 'cursor-pointer' : ''}`}
    >
      {/* Last move highlight — vector color for anomaly moves */}
      {isLastMoveFrom && (
        <div className={`absolute inset-0 ${
          lastMoveVectorType === 'L' ? 'bg-gc-leap/40' :
          lastMoveVectorType === 'O' ? 'bg-gc-ortho/40' :
          lastMoveVectorType === 'D' ? 'bg-gc-diag/40' :
          'bg-gc-violet/40'
        }`} />
      )}
      {isLastMoveTo && (
        <div className={`absolute inset-0 ${
          lastMoveVectorType === 'L' ? 'bg-gc-leap/50' :
          lastMoveVectorType === 'O' ? 'bg-gc-ortho/50' :
          lastMoveVectorType === 'D' ? 'bg-gc-diag/50' :
          'bg-gc-violet/50'
        }`} />
      )}

      {/* Drop-hover ring on a legal target */}
      {isLegal && isOver && (
        <span className="pointer-events-none absolute inset-0 z-20 ring-2 ring-inset ring-emerald-300/90" />
      )}

      {/* Legal-move dot, colored by vector */}
      {isLegal && moveVector && (
        <span
          className={`pointer-events-none absolute h-[26%] w-[26%] rounded-full ${VECTOR_META[moveVector].dot} transition-transform duration-150 ${
            isOver ? 'scale-150' : ''
          }`}
        />
      )}

      {children}

      {/* Ghost battery — faded "before" charge on the square the Anomaly just vacated */}
      {ghost && !children && (
        <GhostBattery vectors={ghost.vectors} spentVector={ghost.spentVector} />
      )}
    </div>
  );
}

export function VectorChargesDemo() {
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<Cell>(INITIAL_POS);
  // `seed` is the full roll for the CURRENT archetype visit; `pool` is what's left after
  // moves. Switching archetypes re-rolls both (fresh random split); Reset restores `pool`
  // to `seed` (same roll), so Reset stays predictable while cycling shows the real variance.
  const [seed, setSeed] = useState<DemoPool>(() => seedPool(DEMO_ARCHETYPES[0]!));
  const [pool, setPool] = useState<DemoPool>(seed);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState(false);
  const [lastVector, setLastVector] = useState<VectorType | null>(null);
  // Ghost battery — the square the piece moved FROM and its vectors BEFORE the move
  const [lastMoveFrom, setLastMoveFrom] = useState<Cell | null>(null);
  const [ghostVectors, setGhostVectors] = useState<VectorPool | null>(null);

  // Reuse the live game's audio engine so the demo sounds identical to a real move.
  // Surface the shared mute state so readers can tell (and fix) why demo audio is silent
  // after muting on the /play screen — it's one global toggle across the whole app.
  const { play, muted, toggleMuted } = useGameSound();

  const current = DEMO_ARCHETYPES[index]!;
  const movesLeft = pool.kind === 'omni' ? pool.shared : pool.v.L + pool.v.O + pool.v.D;
  const isGridlocked = movesLeft === 0;

  // For move-gen, Omni exposes all three vectors while its shared pool lasts.
  const moveVectors: VectorPool =
    pool.kind === 'omni' ? { L: pool.shared, O: pool.shared, D: pool.shared } : pool.v;

  // DnD sensors — small activation distance so a tap doesn't start a drag, and a short
  // press-delay on touch so the page can still scroll past the demo on mobile.
  // (React Compiler memoizes these; no manual useMemo/useCallback per dev-standards.)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  // The piece — built per-type so <Piece> renders the right badges (L/O/D vs shared ★)
  // and the right on-board glyph (driven by `archetype`). Rendered with the real <Piece>.
  const piece: Anomaly | OmniAnomaly =
    pool.kind === 'omni'
      ? {
          id: PIECE_ID,
          type: 'anomaly',
          color: 'white',
          archetype: 'omni',
          icon: ICON_BY_KEY.omni as OmniAnomaly['icon'],
          vectors: { shared: pool.shared },
          isGridlocked,
        }
      : {
          id: PIECE_ID,
          type: 'anomaly',
          color: 'white',
          archetype: current.kind === 'split' ? current.key : 'balanced',
          icon: ICON_BY_KEY[current.key],
          vectors: pool.v,
          isGridlocked,
        };

  // Legal targets are shown while dragging OR when piece is selected (click-to-move).
  const legalMoves =
    (dragging || selected) && !isGridlocked ? computeMoves(pos, moveVectors) : new Map<string, VectorType>();

  /** Execute a move to the given cell, spending a charge (per-vector, or shared for Omni). */
  const executeMove = (row: number, col: number, vector: VectorType) => {
    // Store ghost data BEFORE updating position — the piece's vectors before this move
    setLastMoveFrom(pos);
    if (pool.kind === 'omni') {
      // For Omni, ghost shows same value on all vectors (the shared pool before deduction)
      setGhostVectors({ L: pool.shared, O: pool.shared, D: pool.shared });
    } else {
      setGhostVectors(pool.v);
    }

    setPos({ row, col });
    setLastVector(vector);
    setSelected(false);
    play('anomalyMove');

    if (pool.kind === 'omni') {
      // Omni drains one SHARED charge — there is no per-vector "ran dry" cue, only the
      // final Gridlock lock-in when the pool empties.
      const nextShared = pool.shared - 1;
      setPool({ kind: 'omni', shared: nextShared });
      if (nextShared === 0) play('gridlock', STAGGER.gridlock);
      return;
    }

    const nextV: VectorPool = { ...pool.v, [vector]: pool.v[vector] - 1 };
    setPool({ kind: 'split', v: nextV });
    const totalLeft = nextV.L + nextV.O + nextV.D;
    if (totalLeft === 0) {
      // Last charge — full Gridlock lock-in (the dry click-off is folded into this).
      play('gridlock', STAGGER.gridlock);
    } else if (nextV[vector] === 0) {
      // A single vector just ran dry — micro-stagger the steam-hiss cue, like the live game.
      play('vectorExhausted', STAGGER.vectorExhausted);
    }
  };

  /** Handle click on the piece — toggle selection for click-to-move. */
  const handlePieceClick = () => {
    if (isGridlocked) return;
    setSelected((s) => !s);
  };

  /** Handle click on a square — if legal and selected, move there. */
  const handleSquareClick = (row: number, col: number) => {
    if (!selected) return;
    const vector = legalMoves.get(`${row},${col}`);
    if (vector) {
      executeMove(row, col, vector);
    } else {
      // Clicked non-legal square — deselect
      setSelected(false);
    }
  };

  const handleDragStart = (_event: DragStartEvent) => {
    if (isGridlocked) return;
    setDragging(true);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(false);
    setSelected(false);
    const over = event.over;
    if (!over) return;

    // Drop target id is "cell-<row>-<col>".
    const match = /^cell-(\d+)-(\d+)$/.exec(String(over.id));
    if (!match) return;
    const row = Number(match[1]);
    const col = Number(match[2]);

    const vector = computeMoves(pos, moveVectors).get(`${row},${col}`);
    if (!vector) return;

    executeMove(row, col, vector);
  };

  /** Jump to an archetype by index (looping), re-seeding its full charge pool. */
  const goTo = (next: number) => {
    const len = DEMO_ARCHETYPES.length;
    const wrapped = ((next % len) + len) % len;
    setIndex(wrapped);
    const fresh = seedPool(DEMO_ARCHETYPES[wrapped]!);
    setSeed(fresh);
    setPool(fresh);
    setPos(INITIAL_POS);
    setDragging(false);
    setSelected(false);
    setLastVector(null);
    setLastMoveFrom(null);
    setGhostVectors(null);
  };
  const goPrev = () => goTo(index - 1);
  const goNext = () => goTo(index + 1);

  /** Reset restores the current archetype's roll (no re-roll — cycling does that). */
  const reset = () => {
    setPool(seed);
    setPos(INITIAL_POS);
    setDragging(false);
    setSelected(false);
    setLastVector(null);
    setLastMoveFrom(null);
    setGhostVectors(null);
  };

  return (
    <div className="not-prose my-8 rounded-2xl border border-white/10 bg-gc-panel/60 p-5 sm:p-6 shadow-panel">
      {/* Header */}
      <div className="mb-4">
        {/* Title + description */}
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-gc-accent shadow-[0_0_8px_rgba(34,224,255,0.8)]" />
          <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-gc-accent">
            Try It — Live Demo
          </h4>
        </div>
        <p className="mt-1 text-sm text-gc-text-dim">
          <span className="text-gc-text font-medium">Click or drag the Anomaly</span> to move it —{' '}
          <span className="text-gc-ortho font-medium">orthogonal</span>,{' '}
          <span className="text-gc-diag font-medium">diagonal</span>, or{' '}
          <span className="text-gc-leap font-medium">leap</span>. Each move spends that
          vector's charge — drain the whole pool to watch it Gridlock (freeze).
        </p>

        {/* Controls row — charge legend (left) · archetype selector (right) */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          {/* Charge legend — per-archetype: 3 vectors (Omni shows shared value on all three) */}
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              // For Omni, show the shared value on all three vectors (like the actual game piece)
              const displayVectors: VectorPool =
                pool.kind === 'omni'
                  ? { O: pool.shared, D: pool.shared, L: pool.shared }
                  : pool.v;
              return (['O', 'D', 'L'] as const).map((vt) => {
                const meta = VECTOR_META[vt];
                const remaining = displayVectors[vt];
                const spent = remaining === 0;
                return (
                  <div
                    key={vt}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors ${
                      spent ? 'border-white/5 bg-black/20 opacity-50' : 'border-white/10 bg-black/30'
                    }`}
                    title={meta.label}
                  >
                    <span className={`font-mono text-sm font-bold tabular-nums ${spent ? 'text-gc-gridlock' : 'text-gc-text'}`}>
                      {remaining}
                    </span>
                    <span className={`text-sm font-bold leading-none ${spent ? 'text-gc-gridlock' : meta.color}`}>
                      {meta.symbol}
                    </span>
                  </div>
                );
              });
            })()}
          </div>

          {/* Archetype selector — cycle all 11 archetypes (‹ ›) */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous archetype"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-lg leading-none text-gc-text-dim transition-colors hover:border-gc-accent/40 hover:text-gc-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent"
            >
              ‹
            </button>
            <div className="min-w-[10.5rem] text-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-semibold text-gc-text"
                >
                  <span className="text-lg leading-none">{ICON_BY_KEY[current.key]}</span>
                  {current.callsign}
                  <span className="text-[11px] font-medium tabular-nums text-gc-text-dim">
                    #{index + 1} / {DEMO_ARCHETYPES.length}
                  </span>
                </motion.div>
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next archetype"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/30 text-lg leading-none text-gc-text-dim transition-colors hover:border-gc-accent/40 hover:text-gc-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent"
            >
              ›
            </button>
          </div>
        </div>

        {/* Specialty — type name + what this archetype actually does. The blurb is shared
            with the Archetype table; the type-name prefix is demo-only (the table has its
            own Name column, so prefixing there would duplicate it). */}
        <p className="mt-2 text-sm leading-snug text-gc-text-dim">
          <span className="font-semibold">{NAME_BY_KEY[current.key]}:</span>{' '}
          {ARCHETYPE_SPECIALTY[current.key]}
        </p>
      </div>

      {/* Board */}
      <div className="flex flex-col items-center">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="relative mx-auto w-full max-w-[340px]">
            <div className="overflow-hidden rounded-xl ring-1 ring-white/10 shadow-board">
              <div className="grid grid-cols-5">
              {Array.from({ length: SIZE * SIZE }).map((_, i) => {
                const row = Math.floor(i / SIZE);
                const col = i % SIZE;
                const isLight = (row + col) % 2 === 1;
                const isPiece = pos.row === row && pos.col === col;
                const moveVector = legalMoves.get(`${row},${col}`);
                const isLegal = moveVector !== undefined;
                // Last-move highlight state
                const isLastMoveFrom = lastMoveFrom !== null && lastMoveFrom.row === row && lastMoveFrom.col === col;
                const isLastMoveTo = lastMoveFrom !== null && pos.row === row && pos.col === col;
                // Ghost battery — show on the vacated square (where the piece moved FROM)
                const ghost = isLastMoveFrom && ghostVectors
                  ? { vectors: ghostVectors, spentVector: pool.kind === 'omni' ? null : lastVector }
                  : null;

                return (
                  <DroppableCell
                    key={i}
                    row={row}
                    col={col}
                    isLight={isLight}
                    isLegal={isLegal}
                    moveVector={moveVector}
                    isLastMoveFrom={isLastMoveFrom}
                    isLastMoveTo={isLastMoveTo}
                    lastMoveVectorType={lastVector}
                    ghost={ghost}
                    onClick={() => handleSquareClick(row, col)}
                  >
                    {isPiece && (
                      <DraggablePiece
                        piece={piece}
                        disabled={isGridlocked}
                        isSelected={selected}
                        onClick={handlePieceClick}
                      />
                    )}
                  </DroppableCell>
                );
              })}
              </div>
            </div>
            {/* Controls: stacked BELOW the board on mobile so they never push the page wide;
                on sm+ `sm:contents` collapses this wrapper so the buttons resume hanging off
                the board's right edge via their sm:absolute placement. */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:contents">
              <button
                type="button"
                onClick={reset}
                className="shrink-0 whitespace-nowrap rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-medium text-gc-text-dim transition-colors hover:border-gc-accent/40 hover:text-gc-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent sm:absolute sm:left-full sm:top-0 sm:ml-3"
              >
                ↺ Reset
              </button>
              {/* Shared mute toggle — mirrors the /play speaker so readers know why demo audio
                  is silent (they muted the game) and can unmute right here. */}
              <button
                type="button"
                onClick={toggleMuted}
                aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
                aria-pressed={muted}
                title={muted ? 'Sound is muted — click to unmute' : 'Mute sound effects'}
                className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-xs text-gc-text-dim transition-colors hover:border-gc-accent/40 hover:text-gc-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent sm:absolute sm:left-full sm:top-9 sm:ml-3"
              >
                {muted ? '🔇' : '🔊'}
              </button>
            </div>
          </div>

          {/* Drag overlay — the lifted piece follows the cursor 1:1 */}
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <div className="flex h-[68px] w-[68px] items-center justify-center cursor-grabbing">
                <Piece piece={piece} isDragging />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Status line */}
        <div className="mt-4 flex min-h-[2.25rem] w-full max-w-[340px] items-center justify-center gap-3">
          <AnimatePresence mode="wait">
            {isGridlocked ? (
              <motion.div
                key="gridlocked"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-2 text-sm font-semibold text-gc-gridlock"
              >
                <span className="text-base">🔒</span>
                Gridlocked — 0 charges left. It can no longer move.
              </motion.div>
            ) : (
              <motion.div
                key="status"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="text-sm text-gc-text-dim"
              >
                {lastVector ? (
                  <span>
                    Spent <span className={`font-semibold ${VECTOR_META[lastVector].color}`}>{VECTOR_META[lastVector].label}</span>
                    {' · '}
                    <span className="text-gc-text">{movesLeft}</span> {movesLeft === 1 ? 'charge' : 'charges'} remaining
                  </span>
                ) : dragging ? (
                  <span>Drop onto a glowing square to move.</span>
                ) : selected ? (
                  <span>Click a glowing square to move, or click elsewhere to cancel.</span>
                ) : (
                  <span>Sandbox: Click or drag the piece to see its moves.</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}

export { VectorChargesDemo as default };
