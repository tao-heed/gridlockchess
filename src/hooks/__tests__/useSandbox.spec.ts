// @vitest-environment jsdom
// hooks/__tests__/useSandbox.spec.ts — the pure Sandbox reducer + piece factory + persistence.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  sandboxReducer,
  initialSandboxState,
  createSandboxPiece,
  samePaletteItem,
  loadPersistedSandbox,
  persistSandbox,
  type SandboxState,
  type PaletteItem,
} from '../useSandbox';
import { serializePosition } from '@/lib/chess/format';
import type { Anomaly, OmniAnomaly, Board } from '@/types/game';

const wKing: PaletteItem = { kind: 'king', color: 'white' };
const bChopper: PaletteItem = { kind: 'anomaly', color: 'black', archetype: 'balanced' };

describe('createSandboxPiece', () => {
  it('builds a King / Pawn with the right icon', () => {
    expect(createSandboxPiece({ kind: 'king', color: 'white' }).icon).toBe('♔');
    expect(createSandboxPiece({ kind: 'pawn', color: 'black' }).icon).toBe('♟');
  });

  it('gives an anomaly its archetype canonical charges (summing to 10)', () => {
    const p = createSandboxPiece(bChopper) as Anomaly;
    expect(p.type).toBe('anomaly');
    expect(p.archetype).toBe('balanced');
    expect(p.vectors.L + p.vectors.O + p.vectors.D).toBe(10);
  });

  it('builds Omni with a shared pool of 8', () => {
    const p = createSandboxPiece({ kind: 'anomaly', color: 'white', archetype: 'omni' }) as OmniAnomaly;
    expect(p.vectors).toEqual({ shared: 8 });
  });
});

describe('samePaletteItem', () => {
  it('matches identical items and distinguishes archetype/color/kind', () => {
    expect(samePaletteItem(wKing, { kind: 'king', color: 'white' })).toBe(true);
    expect(samePaletteItem(wKing, { kind: 'king', color: 'black' })).toBe(false);
    expect(samePaletteItem(bChopper, { kind: 'anomaly', color: 'black', archetype: 'absLeap' })).toBe(false);
    expect(samePaletteItem(null, wKing)).toBe(false);
  });
});

describe('sandboxReducer', () => {
  const place = (state: SandboxState, square: string, item: PaletteItem) =>
    sandboxReducer(state, { type: 'place', square: square as never, piece: createSandboxPiece(item) });

  it('arms and places a piece', () => {
    let s = sandboxReducer(initialSandboxState, { type: 'arm', item: wKing });
    expect(s.armed).toEqual(wKing);
    s = place(s, 'e1', wKing);
    expect(s.board.e1?.type).toBe('king');
  });

  it('removes a piece and clears selection of that square', () => {
    let s = place(initialSandboxState, 'e1', wKing);
    s = sandboxReducer(s, { type: 'select', square: 'e1' });
    s = sandboxReducer(s, { type: 'remove', square: 'e1' });
    expect(s.board.e1).toBeUndefined();
    expect(s.selected).toBeNull();
  });

  it('moves a piece, and is a no-op from an empty or same square', () => {
    let s = place(initialSandboxState, 'e1', wKing);
    s = sandboxReducer(s, { type: 'move', from: 'e1', to: 'e2' });
    expect(s.board.e1).toBeUndefined();
    expect(s.board.e2?.type).toBe('king');
    const same = sandboxReducer(s, { type: 'move', from: 'e2', to: 'e2' });
    expect(same).toBe(s); // no-op returns same reference
    const empty = sandboxReducer(s, { type: 'move', from: 'a1', to: 'a2' });
    expect(empty.board.a2).toBeUndefined();
  });

  it('setCharges updates an anomaly and no-ops on a non-anomaly', () => {
    let s = place(initialSandboxState, 'd4', bChopper);
    s = sandboxReducer(s, { type: 'setCharges', square: 'd4', vectors: { L: 8, O: 1, D: 1 } });
    expect((s.board.d4 as Anomaly).vectors).toEqual({ L: 8, O: 1, D: 1 });
    const kingSquare = place(s, 'e1', wKing);
    const after = sandboxReducer(kingSquare, { type: 'setCharges', square: 'e1', vectors: { L: 1, O: 1, D: 8 } });
    expect(after).toBe(kingSquare); // king is not an anomaly → unchanged reference
  });

  it('setPiloted toggles the piloted flag on a non-omni anomaly, and no-ops otherwise', () => {
    let s = place(initialSandboxState, 'd4', bChopper);
    s = sandboxReducer(s, { type: 'setPiloted', square: 'd4', piloted: true });
    expect((s.board.d4 as Anomaly).piloted).toBe(true);
    // toggling off drops the flag entirely (not just false)
    s = sandboxReducer(s, { type: 'setPiloted', square: 'd4', piloted: false });
    expect((s.board.d4 as Anomaly).piloted).toBeUndefined();
    // no-op when the flag already matches → same reference
    expect(sandboxReducer(s, { type: 'setPiloted', square: 'd4', piloted: false })).toBe(s);
    // no-op on a King (not an anomaly)
    const withKing = place(s, 'e1', wKing);
    expect(sandboxReducer(withKing, { type: 'setPiloted', square: 'e1', piloted: true })).toBe(withKing);
    // no-op on an Omni (can't be piloted)
    const withOmni = place(initialSandboxState, 'c3', { kind: 'anomaly', color: 'white', archetype: 'omni' });
    expect(sandboxReducer(withOmni, { type: 'setPiloted', square: 'c3', piloted: true })).toBe(withOmni);
  });

  it('setCharges/setPiloted mirror the twin square in ONE history entry (Mirror mode)', () => {
    const wChopper: PaletteItem = { kind: 'anomaly', color: 'white', archetype: 'balanced' };
    const bTwin: PaletteItem = { kind: 'anomaly', color: 'black', archetype: 'balanced' };
    let s = place(initialSandboxState, 'a2', wChopper);
    s = place(s, 'a7', bTwin);
    const depth = s.past.length;

    // Charge build mirrors to the twin, as a SINGLE atomic undo step.
    s = sandboxReducer(s, { type: 'setCharges', square: 'a2', vectors: { L: 0, O: 6, D: 4 }, mirror: 'a7' });
    expect((s.board.a2 as Anomaly).vectors).toEqual({ L: 0, O: 6, D: 4 });
    expect((s.board.a7 as Anomaly).vectors).toEqual({ L: 0, O: 6, D: 4 });
    expect(s.past.length).toBe(depth + 1); // one history entry for the whole pair

    // Gridlock (0/0/0) mirrors AND derives isGridlocked on both twins.
    s = sandboxReducer(s, { type: 'setCharges', square: 'a2', vectors: { L: 0, O: 0, D: 0 }, mirror: 'a7' });
    expect((s.board.a2 as Anomaly).isGridlocked).toBe(true);
    expect((s.board.a7 as Anomaly).isGridlocked).toBe(true);

    // Piloting mirrors to the twin too.
    s = sandboxReducer(s, { type: 'setPiloted', square: 'a2', piloted: true, mirror: 'a7' });
    expect((s.board.a2 as Anomaly).piloted).toBe(true);
    expect((s.board.a7 as Anomaly).piloted).toBe(true);
  });

  it('movePair moves a piece and its mirror twin together in ONE history entry', () => {
    const wChopper: PaletteItem = { kind: 'anomaly', color: 'white', archetype: 'balanced' };
    const bTwin: PaletteItem = { kind: 'anomaly', color: 'black', archetype: 'balanced' };
    let s = place(initialSandboxState, 'a2', wChopper);
    s = place(s, 'a7', bTwin);
    const depth = s.past.length;

    s = sandboxReducer(s, { type: 'movePair', moves: [{ from: 'a2', to: 'b2' }, { from: 'a7', to: 'b7' }] });
    expect(s.board.a2).toBeUndefined();
    expect(s.board.a7).toBeUndefined();
    expect((s.board.b2 as Anomaly).color).toBe('white');
    expect((s.board.b7 as Anomaly).color).toBe('black');
    expect(s.past.length).toBe(depth + 1); // one atomic history entry for the pair

    // No-op when nothing actually moves (empty sources) → same reference, no history entry.
    expect(sandboxReducer(s, { type: 'movePair', moves: [{ from: 'h1', to: 'h2' }] })).toBe(s);
  });

  it('setTurn and clear', () => {
    let s = sandboxReducer(initialSandboxState, { type: 'setTurn', turn: 'black' });
    expect(s.turn).toBe('black');
    s = place(s, 'e1', wKing);
    s = sandboxReducer(s, { type: 'clear' });
    expect(s.board).toEqual({});
    expect(s.turn).toBe('white');
    expect(s.armed).toBeNull();
    expect(s.selected).toBeNull();
  });

  it('load replaces the whole board + turn (undoable, clears transient state)', () => {
    let s = place(initialSandboxState, 'a1', wKing);
    s = sandboxReducer(s, { type: 'arm', item: wKing });
    const loaded: Board = { h8: createSandboxPiece({ kind: 'king', color: 'black' }) };
    s = sandboxReducer(s, { type: 'load', board: loaded, turn: 'black' });
    expect(Object.keys(s.board)).toEqual(['h8']);
    expect(s.turn).toBe('black');
    expect(s.armed).toBeNull();
    expect(s.selected).toBeNull();
    // Undo restores the pre-load board.
    s = sandboxReducer(s, { type: 'undo' });
    expect(Object.keys(s.board)).toEqual(['a1']);
  });

  it('undo restores the board before the last edit, and no-ops when empty', () => {
    let s = place(initialSandboxState, 'e1', wKing);
    s = place(s, 'd4', bChopper);
    expect(Object.keys(s.board).sort()).toEqual(['d4', 'e1']);
    s = sandboxReducer(s, { type: 'undo' }); // undo the d4 placement
    expect(Object.keys(s.board)).toEqual(['e1']);
    s = sandboxReducer(s, { type: 'undo' }); // undo the e1 placement
    expect(s.board).toEqual({});
    expect(sandboxReducer(s, { type: 'undo' })).toBe(s); // nothing left → same reference
  });

  it('undo can restore a cleared board (Clear is undoable)', () => {
    let s = place(initialSandboxState, 'e1', wKing);
    s = sandboxReducer(s, { type: 'clear' });
    expect(s.board).toEqual({});
    s = sandboxReducer(s, { type: 'undo' });
    expect(Object.keys(s.board)).toEqual(['e1']);
  });

  it('undo reverses a removal', () => {
    let s = place(initialSandboxState, 'e1', wKing);
    s = sandboxReducer(s, { type: 'remove', square: 'e1' });
    expect(s.board.e1).toBeUndefined();
    s = sandboxReducer(s, { type: 'undo' });
    expect(s.board.e1?.type).toBe('king');
  });
});

describe('sandbox persistence', () => {
  beforeEach(() => localStorage.clear());

  const sampleBoard = (): Board => ({
    e1: createSandboxPiece(wKing),
    d4: createSandboxPiece(bChopper),
  });

  it('round-trips board + turn through localStorage (id-independent)', () => {
    const board = sampleBoard();
    persistSandbox(board, 'black');
    const restored = loadPersistedSandbox();
    expect(restored.turn).toBe('black');
    expect(restored.armed).toBeNull();
    expect(restored.selected).toBeNull();
    expect(serializePosition(restored.board, 'black', null, 0, 1))
      .toEqual(serializePosition(board, 'black', null, 0, 1));
  });

  it('clears the saved key when the board becomes empty', () => {
    persistSandbox(sampleBoard(), 'white');
    expect(localStorage.getItem('gridlock:sandbox:v1')).not.toBeNull();
    persistSandbox({}, 'white');
    expect(localStorage.getItem('gridlock:sandbox:v1')).toBeNull();
  });

  it('falls back to the empty editor on corrupt data', () => {
    localStorage.setItem('gridlock:sandbox:v1', 'not-json{');
    expect(loadPersistedSandbox()).toEqual(initialSandboxState);
  });

  it('returns the empty editor when nothing is saved', () => {
    expect(loadPersistedSandbox()).toEqual(initialSandboxState);
  });
});
