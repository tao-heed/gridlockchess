// lib/chess/replay-paths.spec.ts — targeted Layer 2 coverage for the two paths random
// self-play rarely reaches: Override (boarding → piloted) and gridlock-death.
import { describe, it, expect } from 'vitest';
import { parseReplay, replayTo, applyReplayMove, REPLAY_VERSION, MAX_REPLAY_MOVES, type GridlockReplay, type ReplayState } from '../format';
import { positionToBoard } from '../format';
import type { Anomaly, OmniAnomaly } from '@/types/game';

const pos = (board: Record<string, unknown>, turn: 'white' | 'black') => ({
  v: 1 as const, turn, enPassant: null, halfmoveClock: 0, fullmove: 1, board,
});
const stateFrom = (board: Record<string, unknown>, turn: 'white' | 'black'): ReplayState => ({
  board: positionToBoard(pos(board, turn) as never), turn, enPassant: null, halfmoveClock: 0, fullmove: 1, status: 'playing',
});

describe('override path', () => {
  it('King boarding a friendly anomaly produces a piloted anomaly, no capture, no charge spent', () => {
    const board = { e1: { t: 'king', c: 'white' }, e2: { t: 'anomaly', c: 'white', a: 'absLeap', v: { L: 5, O: 0, D: 0 } }, a8: { t: 'king', c: 'black' } };
    const s = applyReplayMove(stateFrom(board, 'white'), 'e1', 'e2');
    const host = s.board.e2 as Anomaly;
    expect(host.type).toBe('anomaly');
    expect(host.piloted).toBe(true);
    expect(host.vectors.L).toBe(5);       // no charge spent on boarding
    expect(s.board.e1).toBeUndefined();    // king consumed
    expect(s.turn).toBe('black');
  });
});

describe('gridlock-death path', () => {
  it('a piloted anomaly spending its last charge ends in gridlock-death', () => {
    const board = { e2: { t: 'anomaly', c: 'white', a: 'absLeap', v: { L: 1, O: 0, D: 0 }, piloted: true }, a8: { t: 'king', c: 'black' } };
    const s = applyReplayMove(stateFrom(board, 'white'), 'e2', 'c3');
    const piece = s.board.c3 as Anomaly;
    expect(piece.vectors.L).toBe(0);
    expect(piece.isGridlocked).toBe(true);
    expect(s.status).toBe('gridlock-death');
  });
});

describe('override survives JSON round-trip in a replay', () => {
  it('replays board with override flag identically', () => {
    const replay: GridlockReplay = {
      v: REPLAY_VERSION, meta: {},
      start: pos({ e1: { t: 'king', c: 'white' }, e2: { t: 'anomaly', c: 'white', a: 'absLeap', v: { L: 5, O: 0, D: 0 } }, a8: { t: 'king', c: 'black' } }, 'white') as never,
      // Override is DERIVED from re-applying the move (king boarding its own anomaly), not
      // stored on the minimal on-disk move — so the move is just { from, to }.
      moves: [{ from: 'e1', to: 'e2' }],
    };
    const back = parseReplay(JSON.stringify(replay));
    const final = replayTo(back);
    expect((final.board.e2 as OmniAnomaly | Anomaly).type).toBe('anomaly');
    expect((final.board.e2 as Anomaly).piloted).toBe(true);
  });
});

describe('replay move-count cap (client-side DoS guard)', () => {
  it('rejects a replay whose move list exceeds MAX_REPLAY_MOVES', () => {
    const start = pos({ e1: { t: 'king', c: 'white' }, a8: { t: 'king', c: 'black' } }, 'white');
    const oversized = {
      v: REPLAY_VERSION, meta: {}, start,
      moves: Array.from({ length: MAX_REPLAY_MOVES + 1 }, () => ({ from: 'e1', to: 'e2' })),
    };
    expect(() => parseReplay(JSON.stringify(oversized))).toThrow();
  });

  it('accepts a replay exactly at the cap (boundary)', () => {
    const start = pos({ e1: { t: 'king', c: 'white' }, a8: { t: 'king', c: 'black' } }, 'white');
    const atCap = {
      v: REPLAY_VERSION, meta: {}, start,
      moves: Array.from({ length: MAX_REPLAY_MOVES }, () => ({ from: 'e1', to: 'e2' })),
    };
    // Schema validation must pass at the boundary (we don't replay the nonsense moves here).
    expect(() => parseReplay(JSON.stringify(atCap))).not.toThrow();
  });
});
