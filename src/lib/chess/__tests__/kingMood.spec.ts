// lib/chess/__tests__/kingMood.spec.ts — exhaustive coverage of the pure King-mood decision logic
// that drives the board King's emoji face. These are the exact functions LocalGame's two mood
// effects call, so this validates the real code path (not a copy).
import { describe, it, expect } from 'vitest';
import type { MoveHistoryEntry, PieceColor } from '@/types/game';
import { computeLiveKingMoods, computeScrubKingMoods, type LiveMoodInput } from '../kingMood';

/** Minimal move-log entry; only `color` and `isCheck` matter to the mood logic. */
function mv(color: PieceColor, isCheck = false): MoveHistoryEntry {
  return { moveNumber: 1, color, pieceType: 'pawn', from: 'e2', to: 'e4', isCheck: isCheck || undefined };
}

/** Live input with sensible mid-game defaults; override per test. */
function live(over: Partial<LiveMoodInput>): LiveMoodInput {
  return {
    turn: 'white',
    inCheck: false,
    isGameOver: false,
    status: 'playing',
    uplinkResolved: false,
    uplinkResult: null,
    myColor: 'white',
    prevCheckColor: null,
    ...over,
  };
}

describe('computeLiveKingMoods — ongoing play', () => {
  it('side to move is 🤔 thinking, waiting side is 😎 confident', () => {
    expect(computeLiveKingMoods(live({ turn: 'white' })).moods).toEqual({ white: 'thinking', black: 'confident' });
    expect(computeLiveKingMoods(live({ turn: 'black' })).moods).toEqual({ white: 'confident', black: 'thinking' });
  });

  it('the side to move in check is 😮 surprised (overrides thinking); waiting side unaffected', () => {
    expect(computeLiveKingMoods(live({ turn: 'white', inCheck: true })).moods).toEqual({
      white: 'surprised',
      black: 'confident',
    });
    expect(computeLiveKingMoods(live({ turn: 'black', inCheck: true })).moods).toEqual({
      white: 'confident',
      black: 'surprised',
    });
  });

  it('returns checkColor = side to move when in check, else null (for the next call\'s prevCheckColor)', () => {
    expect(computeLiveKingMoods(live({ turn: 'white', inCheck: true })).checkColor).toBe('white');
    expect(computeLiveKingMoods(live({ turn: 'black', inCheck: false })).checkColor).toBeNull();
  });

  it('a king that WAS in check and no longer is shows 😅 relieved for one ply (waiting side)', () => {
    // White was in check last ply; now it is black to move and white is no longer in check.
    expect(computeLiveKingMoods(live({ turn: 'black', inCheck: false, prevCheckColor: 'white' })).moods).toEqual({
      white: 'relieved',
      black: 'thinking',
    });
  });

  it('does NOT show 😅 on the side that is currently in check (surprised wins)', () => {
    // Discovered check: white escaped its own check but the move put black in check.
    expect(computeLiveKingMoods(live({ turn: 'black', inCheck: true, prevCheckColor: 'white' })).moods).toEqual({
      white: 'relieved', // white escaped → confident → relieved
      black: 'surprised', // black now in check
    });
  });

  it('no 😅 when the same side is still in check (prevCheckColor === current checkColor)', () => {
    expect(computeLiveKingMoods(live({ turn: 'white', inCheck: true, prevCheckColor: 'white' })).moods).toEqual({
      white: 'surprised',
      black: 'confident',
    });
  });
});

describe('computeLiveKingMoods — decisive & drawn endings', () => {
  it('checkmate: the mated side to move is 😵 dizzy, the winner 🫡 respect', () => {
    expect(computeLiveKingMoods(live({ turn: 'black', inCheck: true, isGameOver: true, status: 'checkmate' })).moods).toEqual({
      white: 'respect',
      black: 'dizzy',
    });
  });

  it('timeout / resigned: the side to move (turn) loses → 😵', () => {
    expect(computeLiveKingMoods(live({ turn: 'white', isGameOver: true, status: 'timeout' })).moods).toEqual({
      white: 'dizzy',
      black: 'respect',
    });
    expect(computeLiveKingMoods(live({ turn: 'black', isGameOver: true, status: 'resigned' })).moods).toEqual({
      white: 'respect',
      black: 'dizzy',
    });
  });

  it('gridlock-death: the LOSER is other(turn) — the mover spent its piloted royal, turn is the survivor', () => {
    // turn = 'white' is the SURVIVOR here; black moved into gridlock death → black is 😵.
    expect(computeLiveKingMoods(live({ turn: 'white', isGameOver: true, status: 'gridlock-death' })).moods).toEqual({
      white: 'respect',
      black: 'dizzy',
    });
  });

  it('stalemate / draw: both kings 🫡 respect', () => {
    expect(computeLiveKingMoods(live({ isGameOver: true, status: 'stalemate' })).moods).toEqual({
      white: 'respect',
      black: 'respect',
    });
    expect(computeLiveKingMoods(live({ isGameOver: true, status: 'draw' })).moods).toEqual({
      white: 'respect',
      black: 'respect',
    });
  });

  it('game-over always returns checkColor = null (nothing to carry forward)', () => {
    expect(computeLiveKingMoods(live({ turn: 'black', inCheck: true, isGameOver: true, status: 'checkmate' })).checkColor).toBeNull();
  });
});

describe('computeLiveKingMoods — uplink out-of-band results', () => {
  it('uplink win: the opponent of MY seat is 😵, I 🫡 (status still "playing")', () => {
    expect(computeLiveKingMoods(live({ myColor: 'white', uplinkResolved: true, uplinkResult: 'win' })).moods).toEqual({
      white: 'respect',
      black: 'dizzy',
    });
  });

  it('uplink loss: MY seat is 😵', () => {
    expect(computeLiveKingMoods(live({ myColor: 'black', uplinkResolved: true, uplinkResult: 'loss' })).moods).toEqual({
      white: 'respect',
      black: 'dizzy',
    });
  });

  it('uplink resolution takes precedence over the ongoing turn baseline', () => {
    // Would otherwise be white 'thinking'; uplink win flips it to a terminal salute.
    expect(computeLiveKingMoods(live({ turn: 'white', myColor: 'white', uplinkResolved: true, uplinkResult: 'win' })).moods).toEqual({
      white: 'respect',
      black: 'dizzy',
    });
  });
});

describe('computeScrubKingMoods — replaying a reviewed ply', () => {
  it('side to move at the viewed ply is 🤔, the other 😎', () => {
    expect(computeScrubKingMoods({ viewPly: 1, displayTurn: 'black', displayInCheck: false, moveHistory: [mv('white')] })).toEqual({
      white: 'confident',
      black: 'thinking',
    });
  });

  it('the side to move in check at the viewed ply is 😮', () => {
    expect(computeScrubKingMoods({ viewPly: 1, displayTurn: 'white', displayInCheck: true, moveHistory: [mv('black', true)] })).toEqual({
      white: 'surprised',
      black: 'confident',
    });
  });

  it('shows 😅 when the mover of this ply had been in check the ply before (waiting side)', () => {
    // Move 2 (index 1) gave check; move 3 (index 2, white) escaped it. Viewing position 3, black to move.
    const moveHistory = [mv('white'), mv('black', true), mv('white')];
    expect(computeScrubKingMoods({ viewPly: 3, displayTurn: 'black', displayInCheck: false, moveHistory })).toEqual({
      white: 'relieved',
      black: 'thinking',
    });
  });

  it('discovered check while escaping: escaper 😅 AND new side-to-move 😮', () => {
    const moveHistory = [mv('white'), mv('black', true), mv('white', true)];
    expect(computeScrubKingMoods({ viewPly: 3, displayTurn: 'black', displayInCheck: true, moveHistory })).toEqual({
      white: 'relieved',
      black: 'surprised',
    });
  });

  it('no 😅 before ply 2 (not enough history)', () => {
    expect(computeScrubKingMoods({ viewPly: 1, displayTurn: 'black', displayInCheck: false, moveHistory: [mv('white')] })).toEqual({
      white: 'confident',
      black: 'thinking',
    });
  });

  it('no 😅 when the prior ply did not deliver check', () => {
    const moveHistory = [mv('white'), mv('black', false), mv('white')];
    expect(computeScrubKingMoods({ viewPly: 3, displayTurn: 'black', displayInCheck: false, moveHistory })).toEqual({
      white: 'confident',
      black: 'thinking',
    });
  });

  it('viewPly null is inert for the escape (defensive)', () => {
    const moveHistory = [mv('white'), mv('black', true), mv('white')];
    expect(computeScrubKingMoods({ viewPly: null, displayTurn: 'white', displayInCheck: false, moveHistory })).toEqual({
      white: 'thinking',
      black: 'confident',
    });
  });
});
