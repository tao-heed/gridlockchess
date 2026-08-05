// components/docs/OverrideDemo.tsx — Interactive "try it" demo for the Override mechanic.
//
// DESIGN: A 5×5 sandbox that lets the reader see the King board a friendly Anomaly,
// fuse into one royal piece (Piloted Anomaly), and experience Gridlock Death if
// all charges are spent. Uses the same <Piece> component as the live game.

import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { King, Anomaly, VectorType, VectorPool } from '@/types/game';
import { ARCHETYPE_REGISTRY } from '@/lib/chess/archetypes';
import { Piece } from '@/components/pieces/Piece';
import { GhostBattery } from '@/components/pieces/VectorBadge';
import { useGameSound } from '@/hooks/useGameSound';
import { STAGGER } from '@/lib/audio/engine';

// ── Board geometry ─────────────────────────────────────────────────────────────
const SIZE = 5;
const CENTER = 2;

type Cell = { row: number; col: number };
const inBounds = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;
const cellKey = (row: number, col: number) => `${row},${col}`;

// ── Vector legend metadata ─────────────────────────────────────────────────────
const VECTOR_META: Record<VectorType, { label: string; symbol: string; color: string; dot: string }> = {
  L: { label: 'Leap', symbol: 'Leap', color: 'text-gc-leap', dot: 'bg-gc-leap/35' },
  O: { label: 'Orthogonal', symbol: 'Orthogonal', color: 'text-gc-ortho', dot: 'bg-gc-ortho/35' },
  D: { label: 'Diagonal', symbol: 'Diagonal', color: 'text-gc-diag', dot: 'bg-gc-diag/35' },
};

// ── Movement deltas ────────────────────────────────────────────────────────────
const KING_DELTAS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],          [0, 1],
  [1, -1], [1, 0], [1, 1],
] as const;

const KNIGHT_DELTAS = [
  [-2, -1], [-2, 1], [-1, -2], [-1, 2],
  [1, -2], [1, 2], [2, -1], [2, 1],
] as const;

const SLIDE_ORTHO = [[0, 1], [0, -1], [1, 0], [-1, 0]] as const;
const SLIDE_DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

type DemoPhase = 'pre-override' | 'piloted' | 'gridlock-death';

interface LegalMove {
  type: 'king' | 'override' | VectorType;
}

/** Compute King's legal moves (1 square any direction, plus Override onto Anomaly). */
function computeKingMoves(
  kingPos: Cell,
  anomalyPos: Cell,
  anomalyGridlocked: boolean,
): Map<string, LegalMove> {
  const moves = new Map<string, LegalMove>();

  for (const [dr, dc] of KING_DELTAS) {
    const r = kingPos.row + dr;
    const c = kingPos.col + dc;
    if (!inBounds(r, c)) continue;
    const key = cellKey(r, c);

    if (r === anomalyPos.row && c === anomalyPos.col) {
      // A Gridlocked Anomaly is an impassable barrier — you cannot board a dead husk
      // (it has 0 charges; boarding would be instant suicide, so it's not a legal move).
      if (anomalyGridlocked) continue;
      // Override: King steps onto the friendly Anomaly to pilot it.
      moves.set(key, { type: 'override' });
    } else {
      moves.set(key, { type: 'king' });
    }
  }

  return moves;
}

/** Compute Piloted Anomaly's legal moves (uses the Anomaly's vectors). */
function computePilotedMoves(
  pos: Cell,
  vectors: VectorPool,
  blocked?: Cell,
): Map<string, LegalMove> {
  const moves = new Map<string, LegalMove>();
  const isBlocked = (r: number, c: number) => blocked !== undefined && r === blocked.row && c === blocked.col;

  if (vectors.L > 0) {
    for (const [dr, dc] of KNIGHT_DELTAS) {
      const r = pos.row + dr;
      const c = pos.col + dc;
      if (inBounds(r, c) && !isBlocked(r, c)) moves.set(cellKey(r, c), { type: 'L' });
    }
  }

  const slide = (dirs: readonly (readonly [number, number])[], vector: VectorType) => {
    for (const [dr, dc] of dirs) {
      let r = pos.row + dr;
      let c = pos.col + dc;
      while (inBounds(r, c)) {
        if (isBlocked(r, c)) break; // Blocking piece stops the ray and can't be landed on.
        const k = cellKey(r, c);
        if (!moves.has(k)) moves.set(k, { type: vector });
        r += dr;
        c += dc;
      }
    }
  };

  if (vectors.O > 0) slide(SLIDE_ORTHO, 'O');
  if (vectors.D > 0) slide(SLIDE_DIAG, 'D');

  return moves;
}

// ── Initial state ──────────────────────────────────────────────────────────────
const INITIAL_KING_POS: Cell = { row: CENTER, col: CENTER + 1 };  // Right of center
const INITIAL_ANOMALY_POS: Cell = { row: CENTER, col: CENTER };   // Center
const INITIAL_VECTORS: VectorPool = { L: 1, O: 1, D: 1 };

const KING_ID = 'demo-king';
const ANOMALY_ID = 'demo-anomaly';

// ── Draggable King ─────────────────────────────────────────────────────────────
function DraggableKing({
  piece,
  isSelected,
  onClick,
}: {
  piece: King;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: KING_ID });

  return (
    <motion.div
      ref={setNodeRef}
      layout
      layoutId={KING_ID}
      transition={{ type: 'spring', stiffness: 650, damping: 42, mass: 0.9 }}
      className={`absolute inset-0 z-10 flex items-center justify-center touch-none cursor-pointer ${
        isDragging ? 'opacity-30' : ''
      } ${isSelected && !isDragging ? 'ring-2 ring-gc-accent ring-inset rounded-sm' : ''}`}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      <Piece piece={piece} animateMove={false} />
    </motion.div>
  );
}

// ── Draggable Anomaly (movable before AND after Override) ──────────────────────
// Used for both the free-standing Anomaly (pre-override) and the Piloted Anomaly.
// `isTarget` paints the amber boarding-ring when the King is poised to step on.
function DraggableAnomaly({
  piece,
  disabled,
  defeated,
  isSelected,
  isTarget,
  onClick,
}: {
  piece: Anomaly;
  disabled: boolean;
  defeated: boolean;
  isSelected: boolean;
  isTarget: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: ANOMALY_ID,
    disabled,
  });

  return (
    <motion.div
      ref={setNodeRef}
      layout
      layoutId={ANOMALY_ID}
      transition={{ type: 'spring', stiffness: 650, damping: 42, mass: 0.9 }}
      className={`absolute inset-0 z-10 flex items-center justify-center touch-none ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${isDragging ? 'opacity-30' : ''} ${
        isSelected && !isDragging ? 'ring-2 ring-gc-accent ring-inset rounded-sm' : ''
      }`}
      onClick={onClick}
      {...listeners}
      {...attributes}
    >
      {/* Boardable Anomaly target — royal-gold ring + crown ghost, matching the live board (Square.tsx §6.1) */}
      {isTarget && !isDragging && (
        <>
          <div className="absolute inset-[8%] rounded-full ring-2 ring-amber-300/80 shadow-[0_0_14px_rgba(252,211,77,0.55)] animate-pulse-glow pointer-events-none" />
          <span className="absolute top-0 left-1/2 -translate-x-1/2 z-30 text-[23cqw] opacity-80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] pointer-events-none">
            👑
          </span>
        </>
      )}
      <Piece piece={piece} animateMove={false} defeated={defeated} />
    </motion.div>
  );
}

// ── Droppable square ───────────────────────────────────────────────────────────
function DroppableCell({
  row,
  col,
  isLight,
  isLegal,
  moveType,
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
  moveType: LegalMove['type'] | undefined;
  isLastMoveFrom: boolean;
  isLastMoveTo: boolean;
  lastMoveVectorType: VectorType | null;
  ghost: { vectors: VectorPool; spentVector: VectorType | null } | null;
  onClick: () => void;
  children?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell-${row}-${col}`, disabled: !isLegal });

  // Dot color based on move type
  const getDotColor = () => {
    if (!moveType) return '';
    if (moveType === 'king') return 'bg-sky-400/80 ring-1 ring-sky-300/50';
    if (moveType === 'override') return 'bg-amber-400/80 ring-2 ring-amber-300/70';
    return VECTOR_META[moveType as VectorType].dot;
  };

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      className={`relative flex aspect-square w-full [container-type:inline-size] items-center justify-center ${
        isLight ? 'bg-gc-light-sq' : 'bg-gc-dark-sq'
      } ${isLegal ? 'cursor-pointer' : ''}`}
    >
      {/* Last move highlight — vector color for anomaly moves */}
      {isLastMoveFrom && lastMoveVectorType && (
        <div className={`absolute inset-0 ${
          lastMoveVectorType === 'L' ? 'bg-gc-leap/40' :
          lastMoveVectorType === 'O' ? 'bg-gc-ortho/40' :
          'bg-gc-diag/40'
        }`} />
      )}
      {isLastMoveTo && lastMoveVectorType && (
        <div className={`absolute inset-0 ${
          lastMoveVectorType === 'L' ? 'bg-gc-leap/50' :
          lastMoveVectorType === 'O' ? 'bg-gc-ortho/50' :
          'bg-gc-diag/50'
        }`} />
      )}

      {isLegal && isOver && (
        <span className="pointer-events-none absolute inset-0 z-20 ring-2 ring-inset ring-emerald-300/90" />
      )}

      {isLegal && moveType && (
        <span
          className={`pointer-events-none absolute h-[26%] w-[26%] rounded-full ${getDotColor()} transition-transform duration-150 ${
            isOver ? 'scale-150' : ''
          } ${moveType === 'override' ? 'animate-pulse' : ''}`}
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

export function OverrideDemo() {
  const [phase, setPhase] = useState<DemoPhase>('pre-override');
  const [kingPos, setKingPos] = useState<Cell>(INITIAL_KING_POS);
  const [anomalyPos, setAnomalyPos] = useState<Cell>(INITIAL_ANOMALY_POS);
  const [pilotedPos, setPilotedPos] = useState<Cell>(INITIAL_ANOMALY_POS);
  const [vectors, setVectors] = useState<VectorPool>(INITIAL_VECTORS);
  // Which piece is being dragged (null = none) and which is click-selected (null = none).
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastVector, setLastVector] = useState<VectorType | null>(null);
  // Ghost battery — the square the Anomaly moved FROM and its vectors BEFORE the move
  const [lastMoveFrom, setLastMoveFrom] = useState<Cell | null>(null);
  const [lastMoveTo, setLastMoveTo] = useState<Cell | null>(null);
  const [ghostVectors, setGhostVectors] = useState<VectorPool | null>(null);

  // Surface the shared mute state so readers can tell (and fix) why demo audio is silent
  // after muting on the /play screen — it's one global toggle across the whole app.
  const { play, muted, toggleMuted } = useGameSound();

  const dragging = activeId !== null;
  const isGridlocked = vectors.L === 0 && vectors.O === 0 && vectors.D === 0;
  const movesLeft = vectors.L + vectors.O + vectors.D;

  // The piece whose legal moves should be shown: a live drag wins over a click-select.
  const focusedId = activeId ?? selectedId;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  // Pieces
  const king: King = {
    id: KING_ID,
    type: 'king',
    color: 'white',
    icon: '♔',
  };

  const anomaly: Anomaly = {
    id: ANOMALY_ID,
    type: 'anomaly',
    color: 'white',
    archetype: 'balanced',
    icon: ARCHETYPE_REGISTRY.balanced.icon,
    vectors,
    isGridlocked,
  };

  const pilotedAnomaly: Anomaly = {
    id: ANOMALY_ID,
    type: 'anomaly',
    color: 'white',
    archetype: 'balanced',
    icon: ARCHETYPE_REGISTRY.balanced.icon,
    vectors,
    isGridlocked,
    piloted: true,
  };

  // Legal moves depend on phase AND which piece is focused (dragged or selected).
  const legalMoves = (() => {
    if (phase === 'gridlock-death') return new Map<string, LegalMove>();
    if (phase === 'pre-override') {
      if (focusedId === KING_ID) return computeKingMoves(kingPos, anomalyPos, isGridlocked);
      if (focusedId === ANOMALY_ID && !isGridlocked) return computePilotedMoves(anomalyPos, vectors, kingPos);
    }
    if (phase === 'piloted' && focusedId === ANOMALY_ID && !isGridlocked) {
      return computePilotedMoves(pilotedPos, vectors);
    }
    return new Map<string, LegalMove>();
  })();

  // The Anomaly glows amber when the King is the focused piece and can board it.
  const anomalyIsTarget =
    phase === 'pre-override' &&
    focusedId === KING_ID &&
    legalMoves.get(cellKey(anomalyPos.row, anomalyPos.col))?.type === 'override';

  /** Execute King move (or Override). */
  const executeKingMove = (row: number, col: number, move: LegalMove) => {
    if (move.type === 'override') {
      // Fuse into Piloted Anomaly — inherits the Anomaly's current (still > 0) charges.
      // A gridlocked Anomaly can never be boarded (computeKingMoves blocks it), so the
      // pilot always starts with at least one charge to spend.
      setPhase('piloted');
      setPilotedPos({ row, col });
      setSelectedId(null);
      play('override');
    } else {
      // Normal King move
      setKingPos({ row, col });
      setSelectedId(null);
      play('move');
    }
  };

  /** Execute a free-standing Anomaly move (pre-override) — spends a charge, no death. */
  const executeAnomalyMove = (row: number, col: number, vector: VectorType) => {
    // Store ghost data BEFORE updating position — the Anomaly's vectors before this move
    setLastMoveFrom(anomalyPos);
    setLastMoveTo({ row, col });
    setGhostVectors(vectors);

    setAnomalyPos({ row, col });
    const newVectors = { ...vectors, [vector]: vectors[vector] - 1 };
    setVectors(newVectors);
    setLastVector(vector);
    setSelectedId(null);
    play('anomalyMove');

    // Spending the last charge freezes the husk — no King inside yet, so no death,
    // but the Gridlock lock-in still sounds. Boarding it later is instant death.
    const newTotal = newVectors.L + newVectors.O + newVectors.D;
    if (newTotal === 0) {
      play('gridlock', STAGGER.gridlock);
    } else if (newVectors[vector] === 0) {
      // A single vector just ran dry — micro-stagger the steam-hiss cue, like the live game.
      play('vectorExhausted', STAGGER.vectorExhausted);
    }
  };

  /** Execute Piloted Anomaly move. */
  const executePilotedMove = (row: number, col: number, vector: VectorType) => {
    // Store ghost data BEFORE updating position — the Anomaly's vectors before this move
    setLastMoveFrom(pilotedPos);
    setLastMoveTo({ row, col });
    setGhostVectors(vectors);

    setPilotedPos({ row, col });
    const newVectors = { ...vectors, [vector]: vectors[vector] - 1 };
    setVectors(newVectors);
    setLastVector(vector);
    setSelectedId(null);

    play('anomalyMove');

    // Check for Gridlock Death
    const newTotal = newVectors.L + newVectors.O + newVectors.D;
    if (newTotal === 0) {
      // Audio is scheduled sample-accurately on the clock (move → gridlock → gameEnd);
      // the dramatic phase flip is driven by a timeout aligned to the lock-in.
      play('gridlock', STAGGER.gridlock);
      play('gameEnd', STAGGER.gameEnd);
      setTimeout(() => setPhase('gridlock-death'), STAGGER.gridlock * 1000);
    } else if (newVectors[vector] === 0) {
      // A single vector just ran dry — micro-stagger the steam-hiss cue, like the live game.
      play('vectorExhausted', STAGGER.vectorExhausted);
    }
  };

  const handlePieceClick = (id: string) => {
    if (phase === 'gridlock-death') return;
    if (phase === 'piloted' && isGridlocked) return;
    // Clicking the focused Anomaly when it's gridlocked pre-override is a no-op.
    if (phase === 'pre-override' && id === ANOMALY_ID && isGridlocked) return;
    setSelectedId((prev) => (prev === id ? null : id));
  };

  const handleSquareClick = (row: number, col: number) => {
    if (!selectedId) return;
    const move = legalMoves.get(cellKey(row, col));
    if (!move) {
      setSelectedId(null);
      return;
    }
    if (phase === 'pre-override' && selectedId === KING_ID) {
      executeKingMove(row, col, move);
    } else if (phase === 'pre-override' && selectedId === ANOMALY_ID) {
      if (move.type === 'L' || move.type === 'O' || move.type === 'D') {
        executeAnomalyMove(row, col, move.type);
      }
    } else if (phase === 'piloted' && (move.type === 'L' || move.type === 'O' || move.type === 'D')) {
      executePilotedMove(row, col, move.type);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    if (phase === 'gridlock-death') return;
    if (phase === 'piloted' && isGridlocked) return;
    // A gridlocked free-standing Anomaly can't be dragged.
    if (phase === 'pre-override' && event.active.id === ANOMALY_ID && isGridlocked) return;
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const draggedId = activeId;
    setActiveId(null);
    setSelectedId(null);
    const over = event.over;
    if (!over) return;

    const match = /^cell-(\d+)-(\d+)$/.exec(String(over.id));
    if (!match) return;
    const row = Number(match[1]);
    const col = Number(match[2]);

    if (phase === 'pre-override' && draggedId === KING_ID) {
      const move = computeKingMoves(kingPos, anomalyPos, isGridlocked).get(cellKey(row, col));
      if (move) executeKingMove(row, col, move);
    } else if (phase === 'pre-override' && draggedId === ANOMALY_ID) {
      const move = computePilotedMoves(anomalyPos, vectors, kingPos).get(cellKey(row, col));
      if (move && (move.type === 'L' || move.type === 'O' || move.type === 'D')) {
        executeAnomalyMove(row, col, move.type);
      }
    } else if (phase === 'piloted') {
      const move = computePilotedMoves(pilotedPos, vectors).get(cellKey(row, col));
      if (move && (move.type === 'L' || move.type === 'O' || move.type === 'D')) {
        executePilotedMove(row, col, move.type);
      }
    }
  };

  const reset = () => {
    setPhase('pre-override');
    setKingPos(INITIAL_KING_POS);
    setAnomalyPos(INITIAL_ANOMALY_POS);
    setPilotedPos(INITIAL_ANOMALY_POS);
    setVectors(INITIAL_VECTORS);
    setActiveId(null);
    setSelectedId(null);
    setLastVector(null);
    setLastMoveFrom(null);
    setLastMoveTo(null);
    setGhostVectors(null);
  };

  return (
    <div className="not-prose my-8 rounded-2xl border border-white/10 bg-gc-panel/60 p-5 sm:p-6 shadow-panel">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
            <h4 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-400">
              Try It — Override Demo
            </h4>
          </div>
          <p className="mt-1 text-sm text-gc-text-dim">
            {phase === 'pre-override' && (
              <span>Click or drag the <span className="text-amber-400 font-medium">King</span> to step onto the <span className="text-amber-400 font-medium">Anomaly</span> to Override: they fuse <span className="text-gc-text font-medium">permanently</span> into one royal piece.</span>
            )}
            {phase === 'piloted' && !isGridlocked && (
              <span><span className="text-gc-text font-medium">Now move the Piloted Anomaly.</span> It's still your King, but it moves like its host: <span className="text-gc-ortho font-medium">orthogonal (+)</span>, <span className="text-gc-diag font-medium">diagonal (✕)</span>, or <span className="text-gc-leap font-medium">leap (L)</span>. Each move spends one charge of that vector. Drain all three and your King <span className="text-gc-gridlock font-medium">Gridlocks</span> — sealed in place, instant loss.</span>
            )}
            {phase === 'gridlock-death' && (
              <span className="text-red-400 font-medium">Gridlock Death — your King is sealed inside a Gridlocked bunker. Instant loss.</span>
            )}
          </p>
        </div>

        {/* Charge legend — the Anomaly spends charges whether free-standing or piloted.
            `flex-wrap` so the three chips never overflow the card edge on narrow phones —
            a chip drops to the next line instead of clipping past the rounded border. */}
        <div className="flex flex-wrap items-center gap-2">
            {(['O', 'D', 'L'] as const).map((vt) => {
              const meta = VECTOR_META[vt];
              const spent = vectors[vt] === 0;
              return (
                <div
                  key={vt}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition-colors ${
                    spent ? 'border-white/5 bg-black/20 opacity-50' : 'border-white/10 bg-black/30'
                  }`}
                  title={meta.label}
                >
                  <span className={`font-mono text-sm font-bold tabular-nums ${spent ? 'text-gc-gridlock' : 'text-gc-text'}`}>
                    {vectors[vt]}
                  </span>
                  <span className={`text-sm font-bold leading-none ${spent ? 'text-gc-gridlock' : meta.color}`}>
                    {meta.symbol}
                  </span>
                </div>
              );
            })}
          </div>
      </div>

      {/* Board */}
      <div className="flex flex-col items-center">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        >
          <div className="relative mx-auto w-full max-w-[340px]">
            <div className="overflow-hidden rounded-xl ring-1 ring-white/10 shadow-board">
              <div className="grid grid-cols-5">
              {Array.from({ length: SIZE * SIZE }).map((_, i) => {
                const row = Math.floor(i / SIZE);
                const col = i % SIZE;
                const isLight = (row + col) % 2 === 1;
                const move = legalMoves.get(cellKey(row, col));
                const isLegal = move !== undefined;

                // What piece is here?
                const isKingHere = phase === 'pre-override' && kingPos.row === row && kingPos.col === col;
                const isAnomalyHere = phase === 'pre-override' && anomalyPos.row === row && anomalyPos.col === col;
                const isPilotedHere = phase !== 'pre-override' && pilotedPos.row === row && pilotedPos.col === col;
                const hasPiece = isKingHere || isAnomalyHere || isPilotedHere;
                // Last-move highlight state (only for anomaly/piloted moves that spent a charge)
                const isLastMoveFrom = lastMoveFrom !== null && lastMoveFrom.row === row && lastMoveFrom.col === col;
                const isLastMoveTo = lastMoveTo !== null && lastMoveTo.row === row && lastMoveTo.col === col;
                // Ghost battery — show on the vacated square (where the Anomaly moved FROM)
                const ghost = isLastMoveFrom && ghostVectors && !hasPiece
                  ? { vectors: ghostVectors, spentVector: lastVector }
                  : null;

                return (
                  <DroppableCell
                    key={i}
                    row={row}
                    col={col}
                    isLight={isLight}
                    isLegal={isLegal}
                    moveType={move?.type}
                    isLastMoveFrom={isLastMoveFrom}
                    isLastMoveTo={isLastMoveTo}
                    lastMoveVectorType={lastVector}
                    ghost={ghost}
                    onClick={() => handleSquareClick(row, col)}
                  >
                    {isKingHere && (
                      <DraggableKing piece={king} isSelected={selectedId === KING_ID} onClick={() => handlePieceClick(KING_ID)} />
                    )}
                    {isAnomalyHere && (
                      <DraggableAnomaly
                        piece={anomaly}
                        disabled={isGridlocked}
                        defeated={false}
                        isSelected={selectedId === ANOMALY_ID}
                        isTarget={!!anomalyIsTarget}
                        onClick={() => handlePieceClick(ANOMALY_ID)}
                      />
                    )}
                    {isPilotedHere && (
                      <DraggableAnomaly
                        piece={pilotedAnomaly}
                        disabled={isGridlocked}
                        defeated={phase === 'gridlock-death'}
                        isSelected={selectedId === ANOMALY_ID}
                        isTarget={false}
                        onClick={() => handlePieceClick(ANOMALY_ID)}
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
                onClick={reset}
                className="shrink-0 whitespace-nowrap rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs font-medium text-gc-text-dim transition-colors hover:bg-black/50 hover:text-gc-text sm:absolute sm:left-full sm:top-0 sm:ml-3"
              >
                Reset
              </button>
              {/* Shared mute toggle — mirrors the /play speaker so readers know why demo audio
                  is silent (they muted the game) and can unmute right here. */}
              <button
                type="button"
                onClick={toggleMuted}
                aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
                aria-pressed={muted}
                title={muted ? 'Sound is muted — click to unmute' : 'Mute sound effects'}
                className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 text-xs text-gc-text-dim transition-colors hover:bg-black/50 hover:text-gc-text sm:absolute sm:left-full sm:top-9 sm:ml-3"
              >
                {muted ? '🔇' : '🔊'}
              </button>
            </div>
          </div>

          {/* Drag overlay */}
          <DragOverlay dropAnimation={null}>
            {activeId === KING_ID && (
              <div className="flex h-[68px] w-[68px] items-center justify-center cursor-grabbing">
                <Piece piece={king} isDragging />
              </div>
            )}
            {activeId === ANOMALY_ID && (
              <div className="flex h-[68px] w-[68px] items-center justify-center cursor-grabbing">
                <Piece piece={phase === 'pre-override' ? anomaly : pilotedAnomaly} isDragging />
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {/* Status line */}
        <div className="mt-4 flex min-h-[2.25rem] w-full max-w-[340px] items-center justify-center gap-3">
          <AnimatePresence mode="wait">
            {phase === 'gridlock-death' ? (
              <motion.div
                key="death"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex items-center gap-2 text-sm font-semibold text-red-400"
              >
                <span className="text-base">💀</span>
                Gridlock Death — sealed inside, no escape.
              </motion.div>
            ) : phase === 'piloted' ? (
              <motion.div
                key="piloted"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="text-sm text-gc-text-dim"
              >
                {lastVector ? (
                  <span>
                    <span className="text-amber-400 font-medium">👑 Piloted</span>
                    {' · spent '}
                    <span className={`font-semibold ${VECTOR_META[lastVector].color}`}>{VECTOR_META[lastVector].label}</span>
                    {' · '}
                    <span className={movesLeft <= 1 ? 'text-red-400 font-semibold' : 'text-gc-text'}>{movesLeft}</span>
                    {movesLeft === 1 ? ' charge left — danger!' : ' charges left'}
                  </span>
                ) : dragging ? (
                  <span><span className="text-amber-400 font-medium">👑 Piloted</span> — drop to move.</span>
                ) : selectedId === ANOMALY_ID ? (
                  <span><span className="text-amber-400 font-medium">👑 Piloted</span> — click a square to move.</span>
                ) : (
                  <span><span className="text-amber-400 font-medium">👑 Piloted</span> — click or drag to see moves.</span>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="pre"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="text-sm text-gc-text-dim"
              >
                {anomalyIsTarget ? (
                  <span>Step the <span className="text-sky-300 font-medium">King</span> onto the <span className="text-amber-400 font-medium">Anomaly</span> to Override.</span>
                ) : focusedId === KING_ID ? (
                  <span>Moving the <span className="text-sky-300 font-medium">King</span> — land on the Anomaly to board it.</span>
                ) : focusedId === ANOMALY_ID ? (
                  <span>Moving the <span className="text-amber-400 font-medium">Anomaly</span> — each step spends a charge.</span>
                ) : (
                  <span>Sandbox: Both pieces move freely — but only the <span className="text-sky-300 font-medium">King</span> can board the <span className="text-amber-400 font-medium">Anomaly</span> to Override.</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
