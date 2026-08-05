// hooks/useBoardDnD.ts — Drag-and-drop wiring for the board (sensors + handlers).
//
// Owns the pointer/touch sensors, drag handlers, the transient dragged-piece overlay
// state, and the one-frame "place instantly" animation toggle. Kept self-contained so
// LocalGame just renders <DndContext {...dnd}> and feeds the Board its props.
import { useEffect, useState } from 'react';
import {
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Board, Square as SquareType, PieceColor } from '@/types/game';

interface UseBoardDnDParams {
  board: Board;
  turn: PieceColor;
  legalMoves: SquareType[];
  humanCanInteract: boolean;
  viewPly: number | null;
  handleSquareClick: (square: SquareType) => void;
  makeMove: (from: SquareType, to: SquareType) => void;
  previewOpponent: (square: SquareType) => void;
  clearPreview: () => void;
}

export function useBoardDnD({
  board,
  turn,
  legalMoves,
  humanCanInteract,
  viewPly,
  handleSquareClick,
  makeMove,
  previewOpponent,
  clearPreview,
}: UseBoardDnDParams) {
  const [draggedPiece, setDraggedPiece] = useState<{ square: SquareType } | null>(null);

  // Slide animation toggle: pieces tween between squares on click/bot moves, but a
  // drag-drop places instantly. handleDragEnd flips this off for one commit; this
  // effect flips it back on the next frame (after the instant placement renders).
  const [animateMoves, setAnimateMoves] = useState(true);
  useEffect(() => {
    if (animateMoves) return;
    const id = requestAnimationFrame(() => setAnimateMoves(true));
    return () => cancelAnimationFrame(id);
  }, [animateMoves]);

  // DnD sensors — a small activation distance distinguishes a *click* (select/capture)
  // from a *drag*. Without it, dnd-kit starts a drag on pointer-down and swallows the
  // native click on draggable squares (i.e. enemy pieces), breaking click-to-capture.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (!humanCanInteract || viewPly !== null) return;
    const square = event.active.id as SquareType;
    const piece = board[square];

    if (piece && piece.color === turn) {
      setDraggedPiece({ square });
      handleSquareClick(square); // Select the piece to show legal moves
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggedPiece(null);

    if (!event.over) return;
    if (!humanCanInteract || viewPly !== null) return;

    const from = event.active.id as SquareType;
    const to = event.over.id.toString().replace('drop-', '') as SquareType;

    if (legalMoves.includes(to)) {
      // A drag is manual placement — skip the slide for this one commit so the piece
      // lands instantly under the cursor (click/bot moves still tween). Re-enabled
      // on the next frame by the effect above.
      setAnimateMoves(false);
      makeMove(from, to);
    }
  };

  // Route a click. A read-only opponent-piece *preview* is allowed on ANY turn (it can
  // never move a piece); an actionable select/move stays gated to when the human may act.
  const onSquareClick = (square: SquareType) => {
    const piece = board[square];
    const isOpponentPiece = !!piece && piece.color !== turn;
    // Clicking an enemy piece that ISN'T a legal capture target → inspect its reach.
    // (If it IS a legal target of your selected piece, fall through so the capture fires.)
    if (viewPly === null && isOpponentPiece && !legalMoves.includes(square)) {
      previewOpponent(square);
      return;
    }
    if (!humanCanInteract) return;
    clearPreview();
    handleSquareClick(square);
  };

  return { sensors, draggedPiece, animateMoves, handleDragStart, handleDragEnd, onSquareClick };
}
