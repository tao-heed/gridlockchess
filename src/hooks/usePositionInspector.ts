// hooks/usePositionInspector.ts — Read-only piece inspector for post-game review and replay scrubbing.
//
// Computes highlights (selected square + move dots) for any board position without touching
// game state or triggering moves. Uses the SAME legal-move filter as live play: getLegalMoves
// filtered by wouldBeInCheck. This means:
//   - Checkmate: the checkmated side's pieces all have 0 legal moves → no highlights.
//     The winning side's pieces still have legal moves and highlight normally.
//   - Check (not mate): only pieces that can block or the King's escape squares highlight.
//   - Normal position: full legal moves shown for both sides.
//
// Differences vs live selectSquare (both intentional):
//   1. No turn restriction — either side's pieces can be inspected.
//   2. 0 legal moves → clear (no selection highlight). Live play still selects the piece
//      with an empty move list; review mode treats that as "nothing to show."
import { useState } from 'react';
import type { Board, Square, VectorType } from '@/types/game';
import { getLegalMoves, getAnomalyMoves } from '@/lib/chess/movement';
import { wouldBeInCheck } from '@/lib/chess/check';

export interface PositionInspectorState {
  /** The currently inspected square (null = nothing selected). */
  square: Square | null;
  /** Legal move destinations (same wouldBeInCheck filter as live play). */
  moves: Square[];
  /** Vector type per destination (null for King/Pawn — no vector spent). */
  vectorMap: Map<Square, VectorType | null>;
}

const EMPTY: PositionInspectorState = { square: null, moves: [], vectorMap: new Map() };

export function usePositionInspector() {
  const [state, setState] = useState<PositionInspectorState>(EMPTY);

  // React Compiler auto-memoizes — no useCallback needed (DevStandards.md).
  const clear = () => setState(EMPTY);

  /**
   * Inspect `sq` on `board`: compute its legal moves and highlight them.
   * Clicking an empty square or a piece with 0 legal moves deselects instead.
   */
  const inspect = (sq: Square, board: Board, enPassant: Square | null) => {
    const piece = board[sq];
    if (!piece) { clear(); return; }

    // Same move filter as selectSquare: geometric reach → wouldBeInCheck.
    // (See header for the two intentional differences: no turn gate, 0-moves = clear.)
    const rawMoves = getLegalMoves(piece, sq, board, enPassant ?? undefined);
    const moves = rawMoves.filter(to => !wouldBeInCheck(board, sq, to, piece.color));

    // 0 legal moves → don't select. No selection highlight with zero destinations.
    if (moves.length === 0) { clear(); return; }

    const vmap = new Map<Square, VectorType | null>();
    if (piece.type === 'anomaly') {
      const amap = getAnomalyMoves(piece, sq, board);
      for (const m of moves) vmap.set(m, amap.get(m) ?? null);
    } else {
      for (const m of moves) vmap.set(m, null);
    }

    setState({ square: sq, moves, vectorMap: vmap });
  };

  return { ...state, inspect, clear };
}
