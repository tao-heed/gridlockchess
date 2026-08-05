// @vitest-environment jsdom
// lib/chess/sandbox/__tests__/savedPositions.spec.ts — the favourite-positions library store.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Board, Piece, PieceColor } from '@/types/game';
import { serializePosition, type GridlockReplay } from '@/lib/chess/format';
import {
  listSavedPositions,
  saveSandboxPosition,
  saveGameplayReplay,
  deleteSavedPosition,
  renameSavedPosition,
  loadSavedBoard,
  MAX_SAVES,
} from '../savedPositions';

const SAVES_KEY = 'gridlock:sandbox-saves:v1';
const king = (color: PieceColor): Piece => ({ id: `k-${color}`, type: 'king', color, icon: color === 'white' ? '♔' : '♚' });
const pawn = (color: PieceColor): Piece => ({ id: `p-${color}`, type: 'pawn', color, icon: color === 'white' ? '♙' : '♟', hasMoved: false });
const board = (): Board => ({ e1: king('white'), e8: king('black') });
/** A one-move game: white pawn a2→a3 (legal), so replayTo can rebuild the final board. */
const gameReplay = (): GridlockReplay => ({
  v: 1,
  meta: {},
  start: serializePosition({ e1: king('white'), e8: king('black'), a2: pawn('white') }, 'white', null, 0, 1),
  moves: [{ from: 'a2', to: 'a3' }],
});

beforeEach(() => localStorage.clear());

describe('savedPositions', () => {
  it('starts empty', () => {
    expect(listSavedPositions()).toEqual([]);
  });

  it('saves and lists newest-first', () => {
    saveSandboxPosition('First', board(), 'white');
    saveSandboxPosition('Second', board(), 'black');
    const list = listSavedPositions();
    expect(list.map((e) => e.name)).toEqual(['Second', 'First']);
  });

  it('auto-names a blank name', () => {
    const res = saveSandboxPosition('   ', board(), 'white');
    expect(res.ok && res.entry.name).toBe('Position 1');
  });

  it('rejects an empty board', () => {
    const res = saveSandboxPosition('Nope', {}, 'white');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('empty');
    expect(listSavedPositions()).toEqual([]);
  });

  it('round-trips board + side-to-move through save → load', () => {
    saveSandboxPosition('RT', board(), 'black');
    const [entry] = listSavedPositions();
    const { board: b, turn } = loadSavedBoard(entry);
    expect(turn).toBe('black');
    expect(b.e1?.type).toBe('king');
    expect(b.e1?.color).toBe('white');
    expect(b.e8?.color).toBe('black');
  });

  it('deletes an entry', () => {
    saveSandboxPosition('Keep', board(), 'white');
    const res = saveSandboxPosition('Drop', board(), 'white');
    const id = res.ok ? res.entry.id : '';
    const after = deleteSavedPosition(id);
    expect(after.map((e) => e.name)).toEqual(['Keep']);
  });

  it('renames an entry (ignores blank)', () => {
    const res = saveSandboxPosition('Old', board(), 'white');
    const id = res.ok ? res.entry.id : '';
    expect(renameSavedPosition(id, 'New')[0].name).toBe('New');
    expect(renameSavedPosition(id, '   ')[0].name).toBe('New'); // blank ignored
  });

  it('drops a corrupt entry on read but keeps valid ones', () => {
    saveSandboxPosition('Good', board(), 'white');
    const arr = JSON.parse(localStorage.getItem(SAVES_KEY)!);
    arr.push({ id: 'bad', name: 'Corrupt', savedAt: Date.now(), position: { not: 'a position' } });
    localStorage.setItem(SAVES_KEY, JSON.stringify(arr));
    const list = listSavedPositions();
    expect(list.map((e) => e.name)).toEqual(['Good']);
  });

  it('enforces the MAX_SAVES cap', () => {
    for (let i = 0; i < MAX_SAVES; i++) saveSandboxPosition(`P${i}`, board(), 'white');
    expect(listSavedPositions()).toHaveLength(MAX_SAVES);
    const res = saveSandboxPosition('overflow', board(), 'white');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('full');
    expect(listSavedPositions()).toHaveLength(MAX_SAVES);
  });
});

describe('savedPositions — recorded gameplay (⏪ replay) entries', () => {
  it('saves a replay with kind=replay + ply, newest-first alongside positions', () => {
    saveSandboxPosition('A position', board(), 'white');
    const res = saveGameplayReplay('My game', gameReplay(), 1);
    expect(res.ok).toBe(true);
    const list = listSavedPositions();
    expect(list[0].kind).toBe('replay');
    expect(list[0].name).toBe('My game');
    expect(list[0].kind === 'replay' && list[0].ply).toBe(1);
    expect(list.map((e) => e.kind)).toEqual(['replay', 'position']);
  });

  it('auto-names a blank recorded game by its move count', () => {
    const res = saveGameplayReplay('  ', gameReplay(), 1);
    expect(res.ok && res.entry.name).toBe('Game (1 move)');
  });

  it('saves a move-less replay as the starting position (auto-named "Game (start)")', () => {
    const res = saveGameplayReplay('  ', { ...gameReplay(), moves: [] }, 0);
    expect(res.ok).toBe(true);
    expect(res.ok && res.entry.kind).toBe('replay');
    expect(res.ok && res.entry.name).toBe('Game (start)');
    expect(res.ok && res.entry.kind === 'replay' && res.entry.ply).toBe(0);
  });

  it('loadSavedBoard rebuilds the FINAL position of a replay (pawn advanced, black to move)', () => {
    saveGameplayReplay('RT game', gameReplay(), 1);
    const [entry] = listSavedPositions();
    const { board: b, turn } = loadSavedBoard(entry);
    expect(turn).toBe('black');
    expect(b.a2).toBeUndefined();
    expect(b.a3?.type).toBe('pawn');
  });

  it('drops a corrupt replay entry on read but keeps valid ones', () => {
    saveGameplayReplay('Good game', gameReplay(), 1);
    const arr = JSON.parse(localStorage.getItem(SAVES_KEY)!);
    arr.push({ id: 'bad', name: 'Corrupt', savedAt: Date.now(), kind: 'replay', replay: { not: 'a replay' } });
    localStorage.setItem(SAVES_KEY, JSON.stringify(arr));
    expect(listSavedPositions().map((e) => e.name)).toEqual(['Good game']);
  });

  it('reads a legacy entry (no `kind`) as a position (backward compatible)', () => {
    const legacy = { id: 'legacy', name: 'Old', savedAt: Date.now(), position: serializePosition(board(), 'white', null, 0, 1) };
    localStorage.setItem(SAVES_KEY, JSON.stringify([legacy]));
    const [entry] = listSavedPositions();
    expect(entry.kind).toBe('position');
    expect(entry.name).toBe('Old');
  });
});
