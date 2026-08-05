// lib/chess/bot.heuristic.spec.ts — tests for the HEURISTIC fallback's self-Gridlock-Death guard
// (Bug 6 Stage A).
//
// IMPORTANT: under vitest the native Fairy-Stockfish proxy actually loads, so `isEngineReady()`
// returns true and `chooseBotMove` runs the ENGINE → `preferSearchMove` path — the heuristic
// fallback is never reached. (This is exactly why the earlier "Stage A" tests in bot.spec.ts did
// NOT bind on the guard: they silently exercised the search path instead.) To test the heuristic
// guard itself we must force the engine OFF, so `getEngineMove` returns null and `chooseBotMove`
// falls through to `heuristicMove`. This file mocks the engine unavailable for that purpose.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../engine', async (importActual) => {
  const actual = await importActual<typeof import('../engine')>();
  return {
    ...actual,
    isEngineReady: vi.fn(async () => false),
    evaluatePosition: vi.fn(async () => []),
  };
});

import { chooseBotMove } from '../bot';
import type { Anomaly, King, Pawn, Board, VectorPool, PieceColor, Square } from '@/types/game';

const royal = (color: PieceColor, square: Square, vectors: VectorPool): Anomaly => ({
  id: `royal-${square}`,
  color,
  type: 'anomaly',
  archetype: 'balanced',
  icon: '🛸',
  vectors,
  isGridlocked: false,
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

describe('heuristic fallback — self-piloted royal never suicides (Bug 6 Stage A)', () => {
  it('drops a WINNING capture that spends the royal’s last charge and plays a safe pawn instead', async () => {
    // White's royal is a Piloted Anomaly on c3 with a SINGLE orthogonal charge. An UNDEFENDED black
    // pawn sits on c4: the capture c3→c4 is a winning capture the "hard" heuristic ranks ABOVE any
    // quiet move — but it spends the royal's last charge → self-Gridlock-Death (instant loss). Every
    // royal move here is orthogonal-only and thus fatal, so the guard must drop them ALL and fall
    // through to the one safe pawn push (a2→a3).
    //
    // MUTATION-VERIFIED: with the guard disabled (`if (survivable.length) pool = survivable;`
    // removed) the heuristic returns { from: 'c3', to: 'c4' } — the self-Gridlock-Death capture —
    // so this assertion genuinely binds on the guard.
    const board: Board = {
      c3: royal('white', 'c3', { L: 0, O: 1, D: 0 }),
      c4: pawn('black', 'c4'),
      a2: pawn('white', 'a2'),
      h8: king('black', 'h8'),
    };
    const move = await chooseBotMove(board, 'white', undefined, 'intermediate_2');
    expect(move).toEqual({ from: 'a2', to: 'a3' });
  });

  it('no-regression: with a plain King the guard is inert and a safe winning capture still stands', async () => {
    // No piloted royal here (plain White King), so the self-Gridlock-Death filter is inert and the
    // ordinary heuristic pipeline is unchanged: the White rook-anomaly has one safe capture
    // (b2xb7 up the open b-file, undefended by the distant black king) and must take it.
    const board: Board = {
      e1: king('white', 'e1'),
      b2: rook('white', 'b2'),
      b7: pawn('black', 'b7'),
      h8: king('black', 'h8'),
    };
    const move = await chooseBotMove(board, 'white', undefined, 'intermediate_2');
    expect(move).toEqual({ from: 'b2', to: 'b7' });
  });
});
