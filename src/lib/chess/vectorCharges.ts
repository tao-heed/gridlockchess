// lib/chess/vectorCharges.ts — Pure vector battery computations.
// Extracted from LocalGame.tsx render function (Phase 1A + 1B of LocalGame_Modular_Extraction_Plan.md).

import type { Board, PieceColor, Square, VectorPool, OmniPool, VectorType, MoveHistoryEntry } from '@/types/game';

/** Summed remaining charges per side across all non-Omni Anomalies on `board`.
 *  `you` marks which side gets the accent indicator in the VectorLegend. */
export function computeVectorCharges(
  board: Board,
  youColor: PieceColor,
): { white: VectorPool; black: VectorPool; you: PieceColor } {
  const sums = { white: { L: 0, O: 0, D: 0 }, black: { L: 0, O: 0, D: 0 } };
  for (const piece of Object.values(board)) {
    if (piece && piece.type === 'anomaly' && piece.archetype !== 'omni') {
      const side = sums[piece.color];
      side.L += piece.vectors.L;
      side.O += piece.vectors.O;
      side.D += piece.vectors.D;
    }
  }
  return { ...sums, you: youColor };
}

export interface MoveGhost {
  square: Square;
  vectors: VectorPool;
  spentVector: VectorType | null;
}

/** Ghost battery overlay — the pre-spend charge pool of the Anomaly that just moved,
 *  shown faded on the square it vacated. Works both live and while scrubbing. */
export function computeMoveGhost(params: {
  isScrubbing: boolean;
  viewPly: number | null;
  moveHistory: MoveHistoryEntry[];
  displayBoard: Board;
  lastMove: { from: Square; to: Square } | null;
  lastVectorSpend: { vector: VectorType } | null;
  board: Board;
}): MoveGhost | null {
  const { isScrubbing, viewPly, moveHistory, displayBoard, lastMove, lastVectorSpend, board } = params;

  let from: Square;
  let to: Square;
  let spent: VectorType;
  let srcBoard: Board;

  if (isScrubbing) {
    if (viewPly === null || viewPly <= 0) return null;
    const entry = moveHistory[viewPly - 1];
    if (!entry || !entry.vector) return null;
    from = entry.from;
    to = entry.to;
    spent = entry.vector;
    srcBoard = displayBoard;
  } else {
    if (!lastMove || !lastVectorSpend) return null;
    from = lastMove.from;
    to = lastMove.to;
    spent = lastVectorSpend.vector;
    srcBoard = board;
  }

  const moved = srcBoard[to];
  if (!moved || moved.type !== 'anomaly') return null;
  if (moved.archetype === 'omni') {
    const before = (moved.vectors as OmniPool).shared + 1;
    return { square: from, vectors: { O: before, D: before, L: before }, spentVector: null };
  }
  const v = moved.vectors as VectorPool;
  return { square: from, vectors: { ...v, [spent]: v[spent] + 1 }, spentVector: spent };
}
