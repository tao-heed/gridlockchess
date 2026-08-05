// lib/chess/check.spec.ts — checkmate detection for a Piloted Anomaly (Override) king.
//
// Reproduces the user-reported position: a White King has Overridden a pure-Diagonal
// Anomaly (Absolute Bishop, D:10) on e1, and a Black orthogonal slider on a1 gives
// check along rank 1. The question: does isCheckmate correctly fire for the piloted
// royal?
//
// The verdict hinges entirely on the two squares diagonally adjacent to e1 (d2 / f2),
// the ONLY squares a bishop on e1 can step to:
//   - BOTH friendly  → both diagonals blocked, no escape → real checkmate.
//   - one is a capturable, undefended enemy → e1×f2 escapes → NOT checkmate.

import { describe, it, expect } from 'vitest';
import { isCheckmate, isInCheck } from '../check';
import type { Anomaly, King, Board, PieceColor, Square } from '@/types/game';

const pilotedBishop = (color: PieceColor, square: Square, d: number): Anomaly => ({
  id: `pbishop-${square}`,
  color,
  type: 'anomaly',
  archetype: 'absDiag',
  icon: '♝',
  vectors: { L: 0, O: 0, D: d },
  isGridlocked: d === 0,
  piloted: true,
});

const rook = (color: PieceColor, square: Square): Anomaly => ({
  id: `rook-${square}`,
  color,
  type: 'anomaly',
  archetype: 'absOrtho',
  icon: '♜',
  vectors: { L: 0, O: 10, D: 0 },
  isGridlocked: false,
});

const pawn = (color: PieceColor, square: Square): import('@/types/game').Pawn => ({
  id: `pawn-${square}`,
  color,
  type: 'pawn',
  icon: color === 'white' ? '♙' : '♟',
  hasMoved: true,
});

const king = (color: PieceColor): King => ({
  id: `king-${color}`,
  color,
  type: 'king',
  icon: color === 'white' ? '♔' : '♚',
});

describe('isCheckmate — Piloted Anomaly bishop king', () => {
  it('DETECTS checkmate when both bishop diagonals are blocked by friendly pieces', () => {
    // White piloted bishop on e1 (D:10), checked along rank 1 by a Black rook on a1.
    // Its only steps — d2 and f2 — are both occupied by friendly White pawns, so the
    // royal cannot move, cannot block (a bishop can't reach b1/c1/d1), and cannot
    // capture the checker. The pawns' forward pushes don't resolve the check. → mate.
    const board: Board = {
      e1: pilotedBishop('white', 'e1', 10),
      d2: pawn('white', 'd2'),
      f2: pawn('white', 'f2'),
      a1: rook('black', 'a1'),
      a8: king('black'),
    };
    expect(isInCheck(board, 'white')).toBe(true);
    expect(isCheckmate(board, 'white')).toBe(true);
  });

  it('is NOT checkmate when a bishop diagonal holds a capturable, undefended enemy', () => {
    // Identical, except f2 is now a Black piece. e1×f2 captures it and escapes the
    // rank-1 check (the a1 rook does not cover f2), so the royal has a legal move.
    const board: Board = {
      e1: pilotedBishop('white', 'e1', 10),
      d2: pawn('white', 'd2'),
      f2: rook('black', 'f2'),
      a1: rook('black', 'a1'),
      a8: king('black'),
    };
    expect(isInCheck(board, 'white')).toBe(true);
    expect(isCheckmate(board, 'white')).toBe(false);
  });
});
