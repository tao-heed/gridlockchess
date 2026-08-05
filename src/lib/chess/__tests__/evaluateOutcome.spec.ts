// lib/chess/__tests__/evaluateOutcome.spec.ts
// Characterizes the outcome-resolution ladder extracted from useGameState. The board
// predicates (isCheckmate/isStalemate/isTotalGridlock) are covered by their own specs;
// these tests pin the *precedence* and the *signal gating* that the hook relies on.
import { describe, it, expect } from 'vitest';
import { evaluateOutcome, isTotalGridlock, FIFTY_MOVE_HALFMOVES } from '../outcome';
import type { Anomaly, King, Board, PieceColor } from '@/types/game';

const king = (color: PieceColor, id: string): King => ({
  id, color, type: 'king', icon: color === 'white' ? '♔' : '♚',
});

const ortho = (color: PieceColor, o: number): Anomaly => ({
  id: `ortho-${color}-${o}`,
  color, type: 'anomaly', archetype: 'absOrtho', icon: '♜',
  vectors: { L: 0, O: o, D: 0 }, isGridlocked: o === 0,
});

/** Two kings + a still-charged anomaly: nobody in check, side to move has moves,
 *  and at least one anomaly is mobile → NOT total gridlock. A genuinely live board. */
const liveBoard = (): Board => ({
  a1: king('white', 'wk'),
  h8: king('black', 'bk'),
  d4: ortho('white', 10),
});

/** Two bare kings, far apart: no anomalies and no pawns → total gridlock by definition. */
const bareKings = (): Board => ({
  a1: king('white', 'wk'),
  h8: king('black', 'bk'),
});

describe('isTotalGridlock', () => {
  it('is true for a board with no anomalies and no pawns (bare kings)', () => {
    expect(isTotalGridlock(bareKings())).toBe(true);
  });
  it('is false while any anomaly still has charges', () => {
    expect(isTotalGridlock(liveBoard())).toBe(false);
  });
});

describe('evaluateOutcome', () => {
  it('returns the prior status unchanged for a live position', () => {
    expect(evaluateOutcome(liveBoard(), 'black', 'playing')).toEqual({
      status: 'playing', drawReason: null,
    });
  });

  it('gridlock-death short-circuits every other check', () => {
    // Even on a bare-kings board (which would otherwise be a gridlock draw), the
    // piloted-last-charge death takes precedence.
    expect(evaluateOutcome(bareKings(), 'black', 'playing', { gridlockDeath: true })).toEqual({
      status: 'gridlock-death', drawReason: null,
    });
  });

  it('flags threefold repetition once posCount reaches 3', () => {
    expect(evaluateOutcome(liveBoard(), 'black', 'playing', { posCount: 3 })).toEqual({
      status: 'draw', drawReason: 'repetition',
    });
  });

  it('does not flag repetition below 3, nor when posCount is omitted', () => {
    expect(evaluateOutcome(liveBoard(), 'black', 'playing', { posCount: 2 })).toEqual({
      status: 'playing', drawReason: null,
    });
    expect(evaluateOutcome(liveBoard(), 'black', 'playing')).toEqual({
      status: 'playing', drawReason: null,
    });
  });

  it('flags the fifty-move draw only at the threshold', () => {
    expect(
      evaluateOutcome(liveBoard(), 'black', 'playing', { halfmoveClock: FIFTY_MOVE_HALFMOVES - 1 }),
    ).toEqual({ status: 'playing', drawReason: null });
    expect(
      evaluateOutcome(liveBoard(), 'black', 'playing', { halfmoveClock: FIFTY_MOVE_HALFMOVES }),
    ).toEqual({ status: 'draw', drawReason: 'fifty-move' });
  });

  it('reports a total-gridlock draw for a frozen position', () => {
    expect(evaluateOutcome(bareKings(), 'black', 'playing')).toEqual({
      status: 'draw', drawReason: 'gridlock',
    });
  });

  it('ranks repetition above total-gridlock above fifty-move', () => {
    // All three draw signals apply at once on a frozen board; repetition wins.
    expect(
      evaluateOutcome(bareKings(), 'black', 'playing', {
        posCount: 3,
        halfmoveClock: FIFTY_MOVE_HALFMOVES,
      }),
    ).toEqual({ status: 'draw', drawReason: 'repetition' });
    // Without repetition, total-gridlock outranks the fifty-move clock.
    expect(
      evaluateOutcome(bareKings(), 'black', 'playing', { halfmoveClock: FIFTY_MOVE_HALFMOVES }),
    ).toEqual({ status: 'draw', drawReason: 'gridlock' });
  });
});
