// lib/chess/format.spec.ts — Round-trip property test for Layer 1 (GridlockPosition).
// Proves serialize → parse → rebuild preserves charges + piloted (the fields the internal
// repetition hash drops), turn, en passant, and clocks. See docs/dev/GridlockFEN.md §8.
import { describe, it, expect } from 'vitest';
import { serializePosition, parsePosition, positionToBoard, renderPositionText } from '../format';
import { generateInitialBoard } from '../generator';
import { ARCHETYPE_REGISTRY } from '../archetypes';
import type { Anomaly, Board, Square, PieceColor, VectorPool, OmniPool } from '@/types/game';

const rand = (n: number) => Math.floor(Math.random() * n);

/** Randomly deplete charges + pilot one anomaly so each board exercises mid-game state. */
function mutate(board: Board): Board {
  for (const sq of Object.keys(board) as Square[]) {
    const p = board[sq];
    if (p?.type === 'anomaly') {
      if (p.archetype === 'omni') (p.vectors as OmniPool).shared = rand(9);
      else {
        const v = p.vectors as VectorPool; v.L = rand(11); v.O = rand(11); v.D = rand(11);
      }
      p.isGridlocked = false;
    }
  }
  return board;
}

/** Charge + piloted signature — exactly what the format must NOT lose. */
function sig(board: Board): string {
  return (Object.keys(board) as Square[]).sort().map((sq) => {
    const p = board[sq]!;
    if (p.type === 'anomaly' && p.archetype === 'omni') return `${sq}:o${(p.vectors as OmniPool).shared}`;
    if (p.type === 'anomaly') { const a = p as Anomaly; const v = a.vectors as VectorPool; return `${sq}:${a.archetype}.${v.L}.${v.O}.${v.D}${a.piloted ? '*' : ''}`; }
    return `${sq}:${p.color[0]}${p.type[0]}`;
  }).join('|');
}

describe('GridlockPosition round-trip', () => {
  it('preserves charges, piloted, turn, EP and clocks across serialize→parse→rebuild', () => {
    for (let i = 0; i < 100; i++) {
      const start = mutate(generateInitialBoard());
      const turn: PieceColor = i % 2 ? 'black' : 'white';
      const ep: Square | null = i % 3 ? null : 'c6';
      const json = JSON.stringify(serializePosition(start, turn, ep, 7, 14));
      const back = positionToBoard(parsePosition(json));
      expect(sig(back)).toBe(sig(start));
    }
  });

  it('rejects unknown version', () => {
    expect(() => parsePosition('{"v":99,"turn":"white","enPassant":null,"halfmoveClock":0,"fullmove":1,"board":{}}')).toThrow();
  });
});

describe('renderPositionText', () => {
  it('renders an 8x8 board, file labels, anomaly legend, and side to move', () => {
    const pos = serializePosition(generateInitialBoard(), 'white', null, 0, 1);
    const txt = renderPositionText(pos);
    expect(txt).toContain('Start position:');
    expect(txt).toContain('a b c d e f g h');
    expect(txt.split('\n').filter((l) => /^[1-8] /.test(l))).toHaveLength(8);
    expect(txt).toContain('Anomalies:');
    expect(txt).toContain('White to move');
  });
  it('shows each anomaly split L/O/D charges (Omni shows shared total)', () => {
    const pos = {
      v: 1 as const, turn: 'white' as const, enPassant: null, halfmoveClock: 0, fullmove: 1,
      board: {
        e1: { t: 'anomaly' as const, c: 'white' as const, a: 'balanced' as const, v: { L: 3, O: 2, D: 5 } },
        e8: { t: 'anomaly' as const, c: 'black' as const, a: 'omni' as const, v: { shared: 8 } },
      },
    };
    const txt = renderPositionText(pos);
    expect(txt).toContain(`e1 W ${ARCHETYPE_REGISTRY.balanced.alias} (L3 O2 D5)`);
    expect(txt).toContain(`e8 B ${ARCHETYPE_REGISTRY.omni.alias} (8)`);
  });
});
