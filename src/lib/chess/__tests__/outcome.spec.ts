// lib/chess/outcome.spec.ts — gameOutcome maps terminal state → PGN-style result/endReason.
import { describe, it, expect } from 'vitest';
import { gameOutcome } from '../format';
describe('gameOutcome', () => {
  it('checkmate: side to move loses', () => {
    expect(gameOutcome('checkmate', null, 'black')).toEqual({ result: '1-0', endReason: 'checkmate' });
    expect(gameOutcome('checkmate', null, 'white')).toEqual({ result: '0-1', endReason: 'checkmate' });
  });
  it('resigned: side to move loses', () => {
    expect(gameOutcome('resigned', null, 'white')).toEqual({ result: '0-1', endReason: 'resigned' });
  });
  it('timeout: the side to move (flagged) loses', () => {
    expect(gameOutcome('timeout', null, 'white')).toEqual({ result: '0-1', endReason: 'timeout' });
    expect(gameOutcome('timeout', null, 'black')).toEqual({ result: '1-0', endReason: 'timeout' });
  });
  it('gridlock-death: the side to move is the SURVIVOR and WINS (the doomed pilot already passed the turn)', () => {
    expect(gameOutcome('gridlock-death', null, 'black')).toEqual({ result: '0-1', endReason: 'gridlock-death' });
    expect(gameOutcome('gridlock-death', null, 'white')).toEqual({ result: '1-0', endReason: 'gridlock-death' });
  });
  it('stalemate is a draw', () => {
    expect(gameOutcome('stalemate', null, 'white')).toEqual({ result: '1/2-1/2', endReason: 'stalemate' });
  });
  it('draw carries its draw reason', () => {
    expect(gameOutcome('draw', 'fifty-move', 'white')).toEqual({ result: '1/2-1/2', endReason: 'fifty-move' });
    expect(gameOutcome('draw', 'gridlock', 'black')).toEqual({ result: '1/2-1/2', endReason: 'gridlock' });
    expect(gameOutcome('draw', null, 'white')).toEqual({ result: '1/2-1/2', endReason: 'repetition' });
  });
  it('playing/waiting stays open-ended', () => {
    expect(gameOutcome('playing', null, 'white')).toEqual({});
    expect(gameOutcome('waiting', null, 'black')).toEqual({});
  });
});
