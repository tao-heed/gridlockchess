// lib/chess/sandbox/__tests__/setupValidation.spec.ts
import { describe, it, expect } from 'vitest';
import { validateSetup, placementViolation, type SetupError } from '../setupValidation';
import type { Board, PieceColor, Square, King, Pawn, Anomaly, OmniAnomaly, VectorPool } from '@/types/game';

let seq = 0;
const uid = () => `p${seq++}`;

const king = (color: PieceColor): King => ({ id: uid(), color, type: 'king', icon: color === 'white' ? '♔' : '♚' });
const pawn = (color: PieceColor): Pawn => ({ id: uid(), color, type: 'pawn', icon: color === 'white' ? '♙' : '♟', hasMoved: false });
const anomaly = (color: PieceColor, archetype: Anomaly['archetype'], vectors: VectorPool, piloted = false): Anomaly =>
  ({ id: uid(), color, type: 'anomaly', archetype, icon: '🚗', vectors, isGridlocked: false, piloted });
const omni = (color: PieceColor, shared = 8): OmniAnomaly =>
  ({ id: uid(), color, type: 'anomaly', archetype: 'omni', icon: '🤖', vectors: { shared }, isGridlocked: false });

const board = (entries: [Square, Board[Square]][]): Board => Object.fromEntries(entries) as Board;
const codes = (errs: SetupError[]) => errs.map((e) => e.code);

describe('validateSetup — kings', () => {
  it('accepts a legal minimal position (one king each, no one in check)', () => {
    const b = board([['a1', king('white')], ['h8', king('black')]]);
    expect(validateSetup(b, 'white').ok).toBe(true);
  });

  it('rejects a missing king', () => {
    const b = board([['h8', king('black')]]);
    const r = validateSetup(b, 'white');
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('no-king');
  });

  it('rejects two kings of the same color', () => {
    const b = board([['a1', king('white')], ['b1', king('white')], ['h8', king('black')]]);
    expect(codes(validateSetup(b, 'white').errors)).toContain('multiple-kings');
  });
});

describe('validateSetup — pawns on the back rank', () => {
  it('rejects a pawn on rank 1 or rank 8', () => {
    const b1 = board([['a1', king('white')], ['h8', king('black')], ['b1', pawn('white')]]);
    expect(codes(validateSetup(b1, 'white').errors)).toContain('pawn-on-back-rank');
    const b8 = board([['a1', king('white')], ['h8', king('black')], ['b8', pawn('black')]]);
    expect(codes(validateSetup(b8, 'white').errors)).toContain('pawn-on-back-rank');
  });

  it('allows a pawn on a non-back rank', () => {
    const b = board([['a1', king('white')], ['h8', king('black')], ['b2', pawn('white')]]);
    expect(validateSetup(b, 'white').ok).toBe(true);
  });
});

describe('validateSetup — anomaly charges', () => {
  it('rejects charges that no archetype can roll', () => {
    // (2,4,4) sums to 10 but is not a High Leap build.
    const b = board([['a1', king('white')], ['h8', king('black')], ['d4', anomaly('white', 'highLeap', { L: 2, O: 4, D: 4 })]]);
    expect(codes(validateSetup(b, 'white').errors)).toContain('illegal-charges');
  });

  it('accepts a genuine build', () => {
    // Black piece + White to move → it can't check the idle (black) king, isolating the charge check.
    const b = board([['a1', king('white')], ['h8', king('black')], ['d4', anomaly('black', 'highLeap', { L: 8, O: 1, D: 1 })]]);
    expect(validateSetup(b, 'white').ok).toBe(true);
  });

  it('accepts a DEPLETED charge state (charges spent mid-game / loaded from a replay)', () => {
    // highDiag starts diagonal-heavy (e.g. 1/1/8); a real game can spend its ortho down to 1/0/8.
    // That is NOT a pristine build but IS reachable by depletion, so the Sandbox must accept it.
    const b = board([['a1', king('white')], ['h8', king('black')], ['e5', anomaly('black', 'highDiag', { L: 1, O: 0, D: 8 })]]);
    expect(validateSetup(b, 'white').ok).toBe(true);
  });

  it('rejects charges no build could ever reach (component exceeds every build)', () => {
    // 2/4/4: no highLeap build has both O≥4 and D≥4, so it is unreachable by depletion.
    const b = board([['a1', king('white')], ['h8', king('black')], ['d4', anomaly('white', 'highLeap', { L: 2, O: 4, D: 4 })]]);
    expect(codes(validateSetup(b, 'white').errors)).toContain('illegal-charges');
  });

  it('accepts a depleted Omni (0..8) but rejects an impossible pool (>8)', () => {
    const depleted = board([['a1', king('white')], ['h8', king('black')], ['d4', omni('black', 3)]]);
    expect(validateSetup(depleted, 'white').ok).toBe(true);
    const bad = board([['a1', king('white')], ['h8', king('black')], ['d4', omni('white', 9)]]);
    expect(codes(validateSetup(bad, 'white').errors)).toContain('illegal-charges');
  });
});

describe('validateSetup — piloted anomalies (royals)', () => {
  it('a piloted anomaly counts as the side’s royal (no separate King needed)', () => {
    const b = board([
      ['a1', anomaly('white', 'absOrtho', { L: 0, O: 10, D: 0 }, true)], // white's royal is the Piloted Anomaly
      ['h8', king('black')],
    ]);
    expect(validateSetup(b, 'white').ok).toBe(true);
  });

  it('rejects a King AND a piloted anomaly on the same side (two royals)', () => {
    const b = board([
      ['a1', king('white')],
      ['b1', anomaly('white', 'absOrtho', { L: 0, O: 10, D: 0 }, true)],
      ['h8', king('black')],
    ]);
    expect(codes(validateSetup(b, 'white').errors)).toContain('multiple-kings');
  });

  it('a non-piloted anomaly is NOT a royal (side still needs a King)', () => {
    const b = board([
      ['a1', anomaly('white', 'absOrtho', { L: 0, O: 10, D: 0 }, false)],
      ['h8', king('black')],
    ]);
    expect(codes(validateSetup(b, 'white').errors)).toContain('no-king');
  });
});

describe('validateSetup — check rules', () => {
  it('rejects a position where the side NOT to move is already in check', () => {
    // White to move; a white Absolute-Ortho on e1 checks the black king on e8 down the empty e-file.
    const b = board([
      ['a1', king('white')],
      ['e8', king('black')],
      ['e1', anomaly('white', 'absOrtho', { L: 0, O: 10, D: 0 })],
    ]);
    const r = validateSetup(b, 'white');
    expect(r.ok).toBe(false);
    expect(codes(r.errors)).toContain('idle-side-in-check');
  });

  it('ALLOWS the side to move to be in check (their turn to escape)', () => {
    // White to move and white king on e1 is checked by a black Absolute-Ortho on e8 — this is legal.
    const b = board([
      ['e1', king('white')],
      ['a8', king('black')],
      ['e8', anomaly('black', 'absOrtho', { L: 0, O: 10, D: 0 })],
    ]);
    expect(validateSetup(b, 'white').ok).toBe(true);
  });
});

describe('placementViolation — reject illegal placements up front', () => {
  it('rejects a pawn on the back rank (both ranks)', () => {
    const b = board([['e1', king('white')], ['h8', king('black')]]);
    expect(placementViolation(b, pawn('white'), 'b1', 'white')).toBe("Pawns can't go on the back rank (rank 1).");
    expect(placementViolation(b, pawn('black'), 'b8', 'white')).toBe("Pawns can't go on the back rank (rank 8).");
  });

  it('allows a pawn on a normal rank', () => {
    const b = board([['e1', king('white')], ['h8', king('black')]]);
    expect(placementViolation(b, pawn('white'), 'b2', 'white')).toBeNull();
  });

  it('rejects a second King of the same colour, allows the first', () => {
    const withWhiteKing = board([['a1', king('white')], ['h8', king('black')]]);
    expect(placementViolation(withWhiteKing, king('white'), 'e1', 'white')).toBe('Only one royal per side (King or Piloted Anomaly).');
    const noWhiteKing = board([['h8', king('black')]]);
    expect(placementViolation(noWhiteKing, king('white'), 'e1', 'white')).toBeNull();
  });

  it('rejects placing a King when the side already has a Piloted Anomaly royal', () => {
    const b = board([['a1', anomaly('white', 'absOrtho', { L: 0, O: 10, D: 0 }, true)], ['h8', king('black')]]);
    expect(placementViolation(b, king('white'), 'e1', 'white')).toBe('Only one royal per side (King or Piloted Anomaly).');
  });

  it('rejects a placement that puts the side NOT to move in check', () => {
    // White to move; a white Absolute-Ortho on e1 checks the black king on e8 down the empty file.
    const b = board([['a1', king('white')], ['e8', king('black')]]);
    const msg = placementViolation(b, anomaly('white', 'absOrtho', { L: 0, O: 10, D: 0 }), 'e1', 'white');
    expect(msg).toBe("That would put Black in check — but it's not their move.");
  });

  it('allows a placement that checks the MOVER (their turn to escape)', () => {
    // White to move; a black Absolute-Ortho on e8 checks the white king on e1 — legal.
    const b = board([['e1', king('white')], ['a8', king('black')]]);
    expect(placementViolation(b, anomaly('black', 'absOrtho', { L: 0, O: 10, D: 0 }), 'e8', 'white')).toBeNull();
  });

  it('allows an ordinary anomaly placement', () => {
    const b = board([['a1', king('white')], ['h8', king('black')]]);
    expect(placementViolation(b, anomaly('black', 'highLeap', { L: 8, O: 1, D: 1 }), 'd4', 'white')).toBeNull();
  });
});
