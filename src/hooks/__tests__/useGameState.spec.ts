// @vitest-environment jsdom
// hooks/useGameState.spec.ts — behavioral + React-Compiler-stability tests for the
// core game-state hook. These exist because correctness now depends on the React
// Compiler auto-memoizing this hook (manual useMemo/useCallback were removed); the
// last `describe` block guards that the returned callbacks stay referentially stable.
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameState } from '../useGameState';
import type { Board, King, Pawn, Anomaly } from '@/types/game';

// ── Deterministic fixtures (loadState bypasses random generation) ──────────────
const whiteKing = (id = 'wk'): King => ({ id, color: 'white', type: 'king', icon: '♔' });
const blackKing = (id = 'bk'): King => ({ id, color: 'black', type: 'king', icon: '♚' });
const whitePawn = (id = 'wp'): Pawn => ({ id, color: 'white', type: 'pawn', icon: '♙', hasMoved: false });
const blackPawn = (id = 'bp'): Pawn => ({ id, color: 'black', type: 'pawn', icon: '♟', hasMoved: true });
/** A white Leap anomaly (moves like a knight) with a full L pool. */
const whiteLeap = (id = 'wa'): Anomaly =>
  ({ id, color: 'white', type: 'anomaly', archetype: 'absLeap', icon: '♞', vectors: { L: 5, O: 0, D: 0 }, isGridlocked: false });

/** Kings far apart (no check) + a white pawn on its home square ready to advance. */
const pawnBoard = (): Board => ({
  e1: whiteKing(),
  e8: blackKing(),
  e2: whitePawn(),
});

describe('useGameState — initial state', () => {
  it('starts white to move, playing, with a populated board', () => {
    const { result } = renderHook(() => useGameState());
    expect(result.current.turn).toBe('white');
    expect(result.current.status).toBe('playing');
    expect(Object.keys(result.current.board).length).toBeGreaterThan(0);
    expect(result.current.inCheck).toBe(false);
  });
});

describe('useGameState — state transitions', () => {
  it('resign() ends the game as resigned', () => {
    const { result } = renderHook(() => useGameState());
    act(() => result.current.resign());
    expect(result.current.status).toBe('resigned');
  });

  it('resetGame() bumps gameId and returns to a playing state', () => {
    const { result } = renderHook(() => useGameState());
    const firstId = result.current.gameId;
    act(() => result.current.resign());
    act(() => result.current.resetGame());
    expect(result.current.gameId).toBe(firstId + 1);
    expect(result.current.status).toBe('playing');
  });

  it('loadState() installs an externally supplied position verbatim', () => {
    const { result } = renderHook(() => useGameState());
    act(() => result.current.loadState({ board: pawnBoard(), turn: 'white' }));
    expect(result.current.board.e2?.type).toBe('pawn');
    expect(result.current.board.e1?.type).toBe('king');
    expect(result.current.turn).toBe('white');
    expect(result.current.status).toBe('playing');
  });
});

describe('useGameState — select then move', () => {
  it('selecting a pawn surfaces legal moves, and clicking one advances it', () => {
    const { result } = renderHook(() => useGameState());
    act(() => result.current.loadState({ board: pawnBoard(), turn: 'white' }));

    // First click selects the pawn and populates its legal destinations.
    act(() => result.current.handleSquareClick('e2'));
    expect(result.current.selectedSquare).toBe('e2');
    expect(result.current.legalMoves).toContain('e4');

    // Second click on a legal square commits the move.
    act(() => result.current.handleSquareClick('e4'));
    expect(result.current.board.e4?.type).toBe('pawn');
    expect(result.current.board.e2).toBeUndefined();
    expect(result.current.turn).toBe('black');
    expect(result.current.lastMove).toEqual({ from: 'e2', to: 'e4' });
  });
});

// These lock in the makeMove board-transformation behavior (charge spend, capture
// tracking) so the shared move kernel extraction stays behavior-preserving.
describe('useGameState — move kernel behavior', () => {
  it('spending an anomaly charge decrements its pool and reports the spend', () => {
    const { result } = renderHook(() => useGameState());
    act(() => result.current.loadState({ board: { e1: whiteKing(), e8: blackKing(), e4: whiteLeap() }, turn: 'white' }));

    act(() => result.current.handleSquareClick('e4'));
    expect(result.current.legalMoves).toContain('f6'); // knight leap

    act(() => result.current.handleSquareClick('f6'));
    expect(result.current.board.f6?.type).toBe('anomaly');
    expect(result.current.board.e4).toBeUndefined();
    expect((result.current.board.f6 as Anomaly).vectors.L).toBe(4);
    expect(result.current.lastVectorSpend).toEqual({ square: 'f6', vector: 'L', remaining: 4, color: 'white' });
    expect(result.current.turn).toBe('black');
  });

  it('capturing records the piece and surfaces it on lastMoveMeta', () => {
    const { result } = renderHook(() => useGameState());
    act(() => result.current.loadState({ board: { e1: whiteKing(), e8: blackKing(), e4: whiteLeap(), f6: blackPawn() }, turn: 'white' }));

    act(() => result.current.handleSquareClick('e4'));
    act(() => result.current.handleSquareClick('f6'));
    expect(result.current.board.f6?.color).toBe('white');
    expect(result.current.capturedPieces.white).toHaveLength(1);
    expect(result.current.capturedPieces.white[0]?.type).toBe('pawn');
    expect(result.current.lastMoveMeta?.captured?.type).toBe('pawn');
    expect(result.current.lastMoveMeta?.isOverride).toBe(false);
  });
});

describe('useGameState — React Compiler memoization stability', () => {
  // The app wires these callbacks into useEffect dependency arrays. Manual
  // useCallback was removed, so a stable identity now depends entirely on the
  // compiler. A re-render with NO state change must return the same references.
  it('keeps callback identities stable across a no-op re-render', () => {
    const { result, rerender } = renderHook(() => useGameState());
    const before = {
      makeMove: result.current.makeMove,
      resetGame: result.current.resetGame,
      resign: result.current.resign,
      handleSquareClick: result.current.handleSquareClick,
      loadState: result.current.loadState,
    };

    rerender();

    expect(result.current.makeMove).toBe(before.makeMove);
    expect(result.current.resetGame).toBe(before.resetGame);
    expect(result.current.resign).toBe(before.resign);
    expect(result.current.handleSquareClick).toBe(before.handleSquareClick);
    expect(result.current.loadState).toBe(before.loadState);
  });
});
