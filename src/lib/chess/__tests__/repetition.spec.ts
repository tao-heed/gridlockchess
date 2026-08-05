// lib/chess/__tests__/repetition.spec.ts
// Pins the repetition-key contract the threefold-draw rule depends on: positions that
// differ only in en-passant rights or in a single anomaly's remaining charges must key
// DIFFERENTLY, while a truly identical position keys the same.
import { describe, it, expect } from 'vitest';
import { repetitionKey } from '../repetition';
import type { Anomaly, King, Board, PieceColor, Square } from '@/types/game';

const king = (color: PieceColor, id: string): King => ({
  id, color, type: 'king', icon: color === 'white' ? '♔' : '♚',
});

const ortho = (color: PieceColor, o: number): Anomaly => ({
  id: `ortho-${color}-${o}`,
  color, type: 'anomaly', archetype: 'absOrtho', icon: '♜',
  vectors: { L: 0, O: o, D: 0 }, isGridlocked: o === 0,
});

const base = (o = 10): Board => ({
  a1: king('white', 'wk'),
  h8: king('black', 'bk'),
  d4: ortho('white', o),
});

describe('repetitionKey', () => {
  it('is stable for an identical position + side to move + EP', () => {
    expect(repetitionKey(base(), 'white', null)).toBe(repetitionKey(base(), 'white', null));
  });

  it('is independent of insertion order (keys are sorted by square)', () => {
    const b1: Board = { a1: king('white', 'wk'), h8: king('black', 'bk') };
    const b2: Board = { h8: king('black', 'bk'), a1: king('white', 'wk') };
    expect(repetitionKey(b1, 'white', null)).toBe(repetitionKey(b2, 'white', null));
  });

  it('differs when the side to move differs', () => {
    expect(repetitionKey(base(), 'white', null)).not.toBe(repetitionKey(base(), 'black', null));
  });

  it('differs when en-passant rights differ', () => {
    expect(repetitionKey(base(), 'white', null)).not.toBe(
      repetitionKey(base(), 'white', 'e3' as Square),
    );
  });

  it('differs when an anomaly has spent a charge', () => {
    expect(repetitionKey(base(10), 'white', null)).not.toBe(
      repetitionKey(base(9), 'white', null),
    );
  });
});
