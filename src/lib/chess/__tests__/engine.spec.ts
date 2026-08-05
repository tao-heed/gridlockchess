// lib/chess/engine.spec.ts — FEN emission regression guards.
//
// The bug these lock in: boardToFen hardcoded the en passant field to '-', so
// Fairy-Stockfish never saw an available en passant capture and could not play one.
// The fix threads the en passant target square into the FEN's 4th field.

import { describe, it, expect } from 'vitest';
import { boardToFen } from '../engine';
import type { Board, King, Pawn, Anomaly, PieceColor, Square, VectorPool } from '@/types/game';

const king = (color: PieceColor, square: Square): King => ({
  id: `king-${square}`,
  color,
  type: 'king',
  icon: color === 'white' ? '♔' : '♚',
});

const pawn = (color: PieceColor, square: Square): Pawn => ({
  id: `pawn-${square}`,
  color,
  type: 'pawn',
  icon: color === 'white' ? '♙' : '♟',
  hasMoved: true,
});

// A black pawn just double-stepped e7→e5; white to move can capture en passant on e6.
const board: Board = {
  e1: king('white', 'e1'),
  e8: king('black', 'e8'),
  d5: pawn('white', 'd5'),
  e5: pawn('black', 'e5'),
};

describe('boardToFen — en passant field', () => {
  it('emits the en passant target square in the 4th FEN field when supplied', () => {
    const fen = boardToFen(board, 'white', 'e6');
    expect(fen.split(' ')[3]).toBe('e6');
  });

  it("emits '-' when no en passant target is available", () => {
    const fen = boardToFen(board, 'white', null);
    expect(fen.split(' ')[3]).toBe('-');
  });

  it("emits '-' when the en passant argument is omitted (back-compat)", () => {
    const fen = boardToFen(board, 'white');
    expect(fen.split(' ')[3]).toBe('-');
  });
});

// A Piloted Anomaly is royal; boardToFen must emit a custom ROYAL letter matching its CURRENT
// live-vector subset (uppercase for white), so the gridlock-royal engine sees its true reach
// instead of a 1-square king. These lock the subset→letter bijection.
const piloted = (color: PieceColor, square: Square, vectors: VectorPool): Anomaly => ({
  id: `pilot-${square}`,
  color,
  type: 'anomaly',
  archetype: 'balanced',
  icon: '🛸',
  vectors,
  isGridlocked: false,
  piloted: true,
});

/** FEN glyph occupying square `sq` (case preserved), given a lone piloted royal + enemy king. */
const glyphAt = (sq: Square, vectors: VectorPool): string => {
  const b: Board = { [sq]: piloted('white', sq, vectors), a8: king('black', 'a8') };
  const placement = boardToFen(b, 'white').split(' ')[0]!;
  // Decode the placement to find the non-'k' white letter (the royal).
  for (const ch of placement) {
    if (/[A-Za-z]/.test(ch) && ch !== 'k' && ch !== 'K') return ch;
  }
  return '';
};

describe('boardToFen — piloted royal subset → letter', () => {
  const cases: Array<[string, VectorPool, string]> = [
    ['amazon (O+D+L)', { L: 4, O: 3, D: 3 }, 'E'],
    ['archbishop (D+L)', { L: 4, O: 0, D: 3 }, 'F'],
    ['chancellor (O+L)', { L: 4, O: 3, D: 0 }, 'G'],
    ['queen (O+D)', { L: 0, O: 3, D: 3 }, 'H'],
    ['knight (L)', { L: 4, O: 0, D: 0 }, 'I'],
    ['bishop (D)', { L: 0, O: 0, D: 5 }, 'J'],
    ['rook (O)', { L: 0, O: 5, D: 0 }, 'S'],
  ];
  for (const [name, vectors, letter] of cases) {
    it(`emits '${letter}' for a white royal ${name}`, () => {
      expect(glyphAt('d4', vectors)).toBe(letter);
    });
  }

  it('emits a lowercase royal letter for a black piloted royal', () => {
    const b: Board = {
      d4: { ...piloted('black', 'd4', { L: 0, O: 3, D: 3 }), color: 'black' },
      a1: king('white', 'a1'),
    };
    const placement = boardToFen(b, 'black').split(' ')[0]!;
    expect(placement).toContain('h'); // lowercase royal queen
  });
});

