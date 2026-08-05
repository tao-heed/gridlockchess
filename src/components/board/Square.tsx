// components/board/Square.tsx — A single board square
import type { Square as SquareType, Piece as PieceType, VectorType, VectorPool } from '@/types/game';
import { parseSquare } from '@/types/game';
import { Piece } from '@/components/pieces/Piece';
import { GhostBattery } from '@/components/pieces/VectorBadge';
import { useDraggable, useDroppable } from '@dnd-kit/core';

// Dot color by vector type: L=coral, O=green, D=yellow, null=cyan (default)
// Modern flat style — solid colors, subtle opacity, clean hover transitions
const DOT_COLORS: Record<VectorType | 'default', { bg: string; ring: string }> = {
  L: { bg: 'bg-gc-leap/35', ring: 'ring-gc-leap/50' },
  O: { bg: 'bg-gc-ortho/35', ring: 'ring-gc-ortho/50' },
  D: { bg: 'bg-gc-diag/35', ring: 'ring-gc-diag/50' },
  default: { bg: 'bg-gc-accent/35', ring: 'ring-gc-accent/50' },
};

interface SquareProps {
  square: SquareType;
  piece: PieceType | undefined;
  isSelected: boolean;
  isLegalMove: boolean;
  moveVectorType?: VectorType | null;
  /** Read-only: this square holds the opponent piece currently being inspected. */
  isPreviewSelected?: boolean;
  /** Read-only: this square is a legal destination of the inspected opponent piece. */
  isPreviewMove?: boolean;
  /** Vector the inspected opponent piece would spend to reach this square (for color). */
  previewVectorType?: VectorType | null;
  isLastMoveFrom: boolean;
  isLastMoveTo: boolean;
  /** Vector type used in the last move (for anomaly-specific highlight colors). */
  lastMoveVectorType?: VectorType | null;
  isInCheck: boolean;
  /** Override demo: highlight this square as a boardable Anomaly target (see GridlockChess.md §6.1). */
  isPilotTarget?: boolean;
  /** When true, the piece on this square slides to/from other squares on a move. */
  animateMove?: boolean;
  /** When true, the piece on this square plays the checkmate "death" animation. */
  isDefeated?: boolean;
  /** Faded "before" battery to draw on this (now empty) square — the origin of the last
   *  Anomaly move. Lets players compare the charge before vs after the move. */
  ghost?: { vectors: VectorPool; spentVector: VectorType | null } | null;
  /** Wall-clock ms at which the piece on this square should reach peak float height. */
  floatSettleAt?: number;
  /** True only when the piece here belongs to the side to move AND the human may act now
   *  (not the bot's turn, not scrubbing). Enemy/idle pieces must NOT be draggable, else a
   *  stray touch-hold starts a phantom drag that hides the piece (isDragging) and can stick. */
  isDraggable?: boolean;
  onClick: () => void;
}

export function Square({ 
  square, 
  piece, 
  isSelected, 
  isLegalMove,
  moveVectorType,
  isPreviewSelected = false,
  isPreviewMove = false,
  previewVectorType,
  isLastMoveFrom,
  isLastMoveTo,
  lastMoveVectorType,
  isInCheck,
  isPilotTarget,
  animateMove = true,
  isDefeated = false,
  ghost,
  floatSettleAt,
  isDraggable = false,
  onClick,
}: SquareProps) {
  const { fileIdx, rankIdx } = parseSquare(square);
  const isLight = (fileIdx + rankIdx) % 2 === 1;
  
  // Draggable setup for pieces — enabled ONLY for a draggable piece (side to move + the human
  // may act). Leaving enemy/idle pieces draggable let a touch-hold start a drag that hides them.
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: square,
    disabled: !isDraggable,
    data: { square, piece },
  });
  
  // Droppable setup for the square
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${square}`,
    data: { square },
  });
  
  // Combine refs
  const setRef = (el: HTMLDivElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div
      ref={setRef}
      data-square={square}
      onClick={onClick}
      className={`
        group relative w-full aspect-square [container-type:inline-size]
        flex items-center justify-center
        cursor-pointer transition-colors duration-150
        ${isLight ? 'bg-gc-light-sq' : 'bg-gc-dark-sq'}
        ${isDragging ? 'opacity-40' : ''}
      `}
      {...attributes}
      {...listeners}
    >
      {/* Last move highlight — vector color for anomalies, violet for pawns/kings */}
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

      {/* Selected highlight */}
      {isSelected && (
        <div className="absolute inset-0 bg-gc-accent/25 ring-2 ring-inset ring-gc-accent/80 shadow-[inset_0_0_18px_rgba(34,224,255,0.35)]" />
      )}

      {/* Opponent-preview frame — the enemy piece being inspected (read-only). A distinct
          violet frame, deliberately unlike the cyan "selected" accent, so it never reads as
          an actionable selection. */}
      {isPreviewSelected && (
        <div className="absolute inset-0 bg-gc-violet/20 ring-2 ring-inset ring-gc-violet/80 shadow-[inset_0_0_18px_rgba(139,92,246,0.4)]" />
      )}

      {/* Check highlight */}
      {isInCheck && (
        <div className="absolute inset-0 bg-red-500/25 ring-2 ring-inset ring-red-500/80 shadow-[inset_0_0_22px_rgba(239,68,68,0.5)]" />
      )}

      {/* Override demo: boardable Anomaly target — royal-gold ring + crown ghost */}
      {isPilotTarget && (
        <>
          <div className="absolute inset-[8%] rounded-full ring-2 ring-amber-300/80 shadow-[0_0_14px_rgba(252,211,77,0.55)] animate-pulse-glow pointer-events-none" />
          <span className="absolute top-0 left-1/2 -translate-x-1/2 z-30 text-[23cqw] opacity-80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] pointer-events-none">
            👑
          </span>
        </>
      )}

      {/* Drop hover ring */}
      {isOver && isLegalMove && (
        <div className="absolute inset-0 ring-2 ring-inset ring-emerald-300/90" />
      )}

      {/* Legal move dot (empty square) — modern flat style */}
      {isLegalMove && !piece && (() => {
        const dotStyle = DOT_COLORS[moveVectorType ?? 'default'];
        return (
          <div className={`absolute w-[27%] h-[27%] rounded-full ${dotStyle.bg} group-hover:scale-125 transition-transform duration-150`} />
        );
      })()}

      {/* Capture ring (occupied square) — clean ring, no glow */}
      {isLegalMove && piece && (() => {
        const dotStyle = DOT_COLORS[moveVectorType ?? 'default'];
        return (
          <div className={`absolute inset-[6%] rounded-full ring-[3px] ${dotStyle.ring} group-hover:ring-[4px] transition-all duration-150`} />
        );
      })()}

      {/* Opponent-preview reach — the SAME filled dot / capture ring as your own legal moves,
          color-coded by the vector spent. Consistency is deliberate: the violet frame on the
          inspected enemy piece is the sole "read-only inspection" cue, so destinations keep the
          one visual language you already know. */}
      {isPreviewMove && !isLegalMove && !piece && (() => {
        const dotStyle = DOT_COLORS[previewVectorType ?? 'default'];
        return (
          <div className={`absolute w-[27%] h-[27%] rounded-full ${dotStyle.bg} group-hover:scale-125 transition-transform duration-150`} />
        );
      })()}
      {isPreviewMove && !isLegalMove && piece && (() => {
        const dotStyle = DOT_COLORS[previewVectorType ?? 'default'];
        return (
          <div className={`absolute inset-[6%] rounded-full ring-[3px] ${dotStyle.ring} group-hover:ring-[4px] transition-all duration-150`} />
        );
      })()}

      {/* Piece — keyed by the piece's stable id so a CAPTURE remounts the destination
          piece instead of reusing the victim's component instance. Without this key,
          React reconciles victim→attacker by position, mutating framer's `layoutId` on a
          node that never moved → no origin→dest delta → the attacker teleports. Remounting
          gives framer a clean shared-layout enter, so click AND bot captures slide like any
          quiet move. Inert for drags (source renders no Piece; drop uses a plain div). */}
      {piece && !isDragging && (
        <Piece key={piece.id} piece={piece} animateMove={animateMove} defeated={isDefeated} floatSettleAt={floatSettleAt} />
      )}

      {/* Ghost battery — a faded "before" charge left on the square an Anomaly just left, so
          players can compare it against the live battery now on the destination square. */}
      {ghost && !piece && (
        <GhostBattery vectors={ghost.vectors} spentVector={ghost.spentVector} />
      )}
    </div>
  );
}

export { Square as default };
