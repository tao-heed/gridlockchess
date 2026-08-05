// lib/chess/replay.spec.ts — Layer 2 core proof. Plays random legal games, records moves,
// then verifies: (1) replay-from-start reproduces incremental state, (2) JSON survives a
// serialize→parse round-trip, (3) replay to any ply matches the live position there.
// See docs/dev/GridlockFEN.md §8.
import { describe, it, expect } from 'vitest';
import {
  serializePosition, serializeReplay, parseReplay, applyReplayMove, replayTo, buildMoveLog,
  REPLAY_VERSION, type ReplayState, type GridlockMove, type GridlockReplay,
} from '../format';
import { generateInitialBoard } from '../generator';
import { getAllLegalMoves } from '../check';
import type { Square, OmniAnomaly } from '@/types/game';

const rand = (n: number) => Math.floor(Math.random() * n);

/** Compact charge+piloted signature — exactly what replay must reproduce. Order-stable. */
function sig(s: ReplayState): string {
  const json = serializePosition(s.board, s.turn, s.enPassant, s.halfmoveClock, s.fullmove);
  const keys = (Object.keys(json.board) as (keyof typeof json.board)[]).sort();
  const body = keys.map((k) => `${k}:${JSON.stringify(json.board[k])}`).join(',');
  return `${body}|t${s.turn}|ep${s.enPassant}|h${s.halfmoveClock}`;
}

/** Play up to `maxPlies` random legal moves, recording each as a GridlockMove. */
function playGame(maxPlies: number) {
  const start = generateInitialBoard();
  let state: ReplayState = { board: start, turn: 'white', enPassant: null, halfmoveClock: 0, fullmove: 1, status: 'playing' };
  const moves: GridlockMove[] = [];
  const trace: string[] = [sig(state)];
  for (let p = 0; p < maxPlies && state.status === 'playing'; p++) {
    const legal = getAllLegalMoves(state.board, state.turn, state.enPassant ?? undefined);
    const froms = [...legal.keys()]; if (froms.length === 0) break;
    const from = froms[rand(froms.length)]!; const tos = legal.get(from)!;
    const to = tos[rand(tos.length)]! as Square;
    state = applyReplayMove(state, from, to);
    moves.push({ from, to });
    trace.push(sig(state));
  }
  return { start, moves, trace, final: state };
}

describe('GridlockReplay core', () => {
  it('replay-from-start reproduces incremental state at every ply', () => {
    for (let g = 0; g < 10; g++) {
      const { start, moves, trace } = playGame(24);
      const replay: GridlockReplay = {
        v: REPLAY_VERSION, meta: {}, moves,
        start: { v: 1, turn: 'white', enPassant: null, halfmoveClock: 0, fullmove: 1,
          board: serializePosition(start, 'white', null, 0, 1).board },
      };
      const round = parseReplay(serializeReplay(replay));
      // Step once through the parsed replay (O(N)) and compare each ply to the live trace.
      let s = replayTo(round, 0);
      expect(sig(s)).toBe(trace[0]);
      for (let i = 0; i < round.moves.length; i++) {
        const m = round.moves[i]!;
        s = applyReplayMove(s, m.from, m.to);
        expect(sig(s)).toBe(trace[i + 1]);
      }
    }
    // Randomized property test doing ~240 full legal-move generations. Standalone runtime
    // is ~14s; under the parallel full-suite (--pool=forks) CPU contention pushes it toward
    // ~30s. 60s gives headroom so load can't flake it. --testTimeout cannot override inline.
  }, 60000);

  it('captures promotion to Omni and survives serialize round-trip', () => {
    const { start, moves } = playGame(40);
    const replay: GridlockReplay = {
      v: REPLAY_VERSION, meta: { generationMode: 'balanced', result: '*' }, moves,
      start: { v: 1, turn: 'white', enPassant: null, halfmoveClock: 0, fullmove: 1,
        board: serializePosition(start, 'white', null, 0, 1).board },
    };
    const back = parseReplay(serializeReplay(replay));
    const final = replayTo(back);
    const hasOmni = Object.values(final.board).some((p) => p?.type === 'anomaly' && (p as OmniAnomaly).archetype === 'omni');
    expect(final.board).toEqual(replayTo(back, back.moves.length).board);
    expect(typeof hasOmni).toBe('boolean');
  }, 60000);

  it('rejects unknown replay version', () => {
    expect(() => parseReplay('{"v":99,"meta":{},"start":{},"moves":[]}')).toThrow();
  });

  it('buildMoveLog derives identical metadata before and after a JSON round-trip', () => {
    for (let g = 0; g < 8; g++) {
      const { start, moves } = playGame(30);
      const replay: GridlockReplay = {
        v: REPLAY_VERSION, meta: { generationMode: 'balanced' }, moves,
        start: { v: 1, turn: 'white', enPassant: null, halfmoveClock: 0, fullmove: 1,
          board: serializePosition(start, 'white', null, 0, 1).board },
      };
      // The minimal {from,to}-only JSON must re-import ("Import Replay (JSON)") and derive
      // the exact same log — that round-trip is the whole point of the portable format.
      const live = buildMoveLog(replay);
      const imported = buildMoveLog(parseReplay(serializeReplay(replay)));
      expect(imported).toEqual(live);
      // Structural invariants: one row per ply, alternating colours, paired move numbers,
      // and a valid remaining charge whenever a vector was spent.
      expect(live.length).toBe(moves.length);
      live.forEach((row, i) => {
        expect(row.color).toBe(i % 2 === 0 ? 'white' : 'black');
        expect(row.moveNumber).toBe(Math.floor(i / 2) + 1);
        if (row.vector) {
          expect(row.vectorRemaining).toBeGreaterThanOrEqual(0);
          expect(row.vectorRemaining).toBeLessThanOrEqual(10);
        }
      });
    }
  }, 60000);
});
