import { describe, it, expect } from 'vitest';
import { searchBestMove, preferSearchMove, preferForcingWin, positionKey, setTranspositionEnabled } from '../search';
import type { Anomaly, King, Pawn, Board, VectorPool, PieceColor, Square } from '@/types/game';

// ── Piece builders ────────────────────────────────────────────────────────────
const king = (color: PieceColor, sq: Square): King => ({
  id: `king-${sq}`,
  color,
  type: 'king',
  icon: color === 'white' ? '♔' : '♚',
});

const pawn = (color: PieceColor, sq: Square): Pawn => ({
  id: `pawn-${sq}`,
  color,
  type: 'pawn',
  icon: color === 'white' ? '♙' : '♟',
  hasMoved: false,
});

/** A plain (non-royal) Anomaly with the given vectors. */
const anomaly = (color: PieceColor, sq: Square, vectors: VectorPool, archetype: Anomaly['archetype'] = 'balanced'): Anomaly => ({
  id: `anom-${sq}`,
  color,
  type: 'anomaly',
  archetype,
  icon: '🛸',
  vectors,
  isGridlocked: vectors.L + vectors.O + vectors.D === 0,
});

/** A Piloted (royal) Anomaly — the King boarded it, so it IS the royal piece. */
const royal = (color: PieceColor, sq: Square, vectors: VectorPool): Anomaly => ({
  ...anomaly(color, sq, vectors),
  id: `royal-${sq}`,
  piloted: true,
});

describe('searchBestMove — charge-aware negamax (Stage 2)', () => {
  it('wins a free hanging piece it can reach (finds the material capture)', () => {
    // White orthogonal anomaly a1 can slide up the open a-file and capture the undefended
    // black orthogonal anomaly on a8. Black has only its king (h8), which cannot defend a8.
    const board: Board = {
      a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }, 'absOrtho'),
      a8: anomaly('black', 'a8', { L: 0, O: 10, D: 0 }, 'absOrtho'),
      h1: king('white', 'h1'),
      h8: king('black', 'h8'),
    };
    const res = searchBestMove(board, 'white', undefined, { maxDepth: 3 });
    expect(res.move).toEqual({ from: 'a1', to: 'a8' });
    expect(res.score).toBeGreaterThan(300); // won a whole ~10-charge anomaly, undefended
  }, 30_000);

  it('never plays a move that gridlock-deaths its own royal when a safe move exists', () => {
    // The white royal is a Piloted Anomaly at e4 with a SINGLE orthogonal charge — any move it
    // makes spends that last charge → Gridlock Death (instant loss). A safe pawn move exists,
    // so the search must choose the pawn and never suicide the royal.
    const board: Board = {
      e4: royal('white', 'e4', { L: 0, O: 1, D: 0 }),
      a2: pawn('white', 'a2'),
      h8: king('black', 'h8'),
    };
    const res = searchBestMove(board, 'white', undefined, { maxDepth: 3 });
    expect(res.move?.from).toBe('a2'); // the pawn, not the royal
    expect(res.score).toBeGreaterThan(-1000); // not a losing (gridlock-death) line
  }, 30_000);

  it('never returns an Override (King boarding a friendly Anomaly)', () => {
    // e1 King is adjacent to a friendly Anomaly on e2. Boarding (e1→e2) is a legal move but the
    // bot must never do it; the search excludes Overrides from its tree entirely. The anomaly is
    // a low-mobility leaper (L:1) purely to keep this invariant test cheap — its vectors are
    // irrelevant to the Override rule (any non-omni, non-gridlocked friendly anomaly qualifies).
    const board: Board = {
      e1: king('white', 'e1'),
      e2: anomaly('white', 'e2', { L: 1, O: 0, D: 0 }),
      a8: king('black', 'a8'),
      a7: pawn('black', 'a7'),
    };
    const res = searchBestMove(board, 'white', undefined, { maxDepth: 3 });
    expect(res.move).not.toBeNull();
    expect(res.move).not.toEqual({ from: 'e1', to: 'e2' });
  }, 30_000);

  it('is deterministic — the same position yields the same move', () => {
    const board: Board = {
      a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }, 'absOrtho'),
      a8: anomaly('black', 'a8', { L: 0, O: 10, D: 0 }, 'absOrtho'),
      h1: king('white', 'h1'),
      h8: king('black', 'h8'),
    };
    const a = searchBestMove(board, 'white', undefined, { maxDepth: 3 });
    const b = searchBestMove(board, 'white', undefined, { maxDepth: 3 });
    expect(a.move).toEqual(b.move);
  }, 30_000);
});

describe('searchBestMove — royal charge-reserve conservation (Bug 6 Stage B)', () => {
  it('conserves its own piloted royal by moving a spare piece instead of spending a charge', () => {
    // White's royal is a Piloted Anomaly on a1 with ONLY orthogonal charges (O:4), so its whole
    // reach is file-a and rank-1 — it can never reach or check the black king on h8, and moving
    // it always spends 1 of its 4 charges (reserve 32 → 24 under the Stage B term). A spare white
    // pawn on c2 can push with NO cost to the royal. Material is identical either way, so the only
    // signal is the royal charge-reserve term: the search must move the pawn (conserve) not the
    // royal (squeeze it one charge closer to 0/0/0 Gridlock Death). No captures/checks exist, so
    // the leaf eval difference is exactly the 8-per-charge reserve delta.
    const board: Board = {
      a1: royal('white', 'a1', { L: 0, O: 4, D: 0 }),
      c2: pawn('white', 'c2'),
      h8: king('black', 'h8'),
    };
    const res = searchBestMove(board, 'white', undefined, { maxDepth: 2 });
    expect(res.move?.from).toBe('c2'); // the spare pawn — royal charges preserved
  }, 30_000);
});

describe('preferSearchMove — non-destructive tactical override', () => {
  const blunderBoard: Board = {
    a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }, 'absOrtho'),
    a8: anomaly('black', 'a8', { L: 0, O: 10, D: 0 }, 'absOrtho'),
    h1: king('white', 'h1'),
    h8: king('black', 'h8'),
  };

  it('overrides an engine pick that misses a winning capture', () => {
    // Engine "wants" a pointless king shuffle; the search sees the free anomaly on a8.
    const chosen = preferSearchMove(blunderBoard, 'white', undefined, { from: 'h1', to: 'g1' }, { maxDepth: 3 });
    expect(chosen).toEqual({ from: 'a1', to: 'a8' });
  }, 30_000);

  it('keeps the engine pick when it is already best', () => {
    const chosen = preferSearchMove(blunderBoard, 'white', undefined, { from: 'a1', to: 'a8' }, { maxDepth: 3 });
    expect(chosen).toEqual({ from: 'a1', to: 'a8' });
  }, 30_000);

  it('is disabled at maxDepth 0 (engine decides) — returns the engine pick untouched', () => {
    const chosen = preferSearchMove(blunderBoard, 'white', undefined, { from: 'h1', to: 'g1' }, { maxDepth: 0 });
    expect(chosen).toEqual({ from: 'h1', to: 'g1' });
  });
});

describe('preferForcingWin — forcing-only override (§12 #1, enemy-royal planner)', () => {
  // White queen-like anomaly c7 (O+D) mates by c7→a7: a7 checks the black king a8 up the a-file,
  // covers b8 (diagonal) and b7 (rank 7), and is defended by the white king b6 — no escape, no
  // capture, no block. A clean forced mate-in-1 the charge-aware search must find.
  const mateBoard: Board = {
    a8: king('black', 'a8'),
    c7: anomaly('white', 'c7', { L: 0, O: 6, D: 6 }),
    b6: king('white', 'b6'),
  };

  // A FREE anomaly capture (a1→a8) exists but there is NO forced mate — pure material.
  const materialBoard: Board = {
    a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }, 'absOrtho'),
    a8: anomaly('black', 'a8', { L: 0, O: 10, D: 0 }, 'absOrtho'),
    h1: king('white', 'h1'),
    h8: king('black', 'h8'),
  };

  it('overrides the engine pick when the search proves a forced mate', () => {
    const opts = { maxDepth: 3 };
    const sr = searchBestMove(mateBoard, 'white', undefined, opts);
    expect(sr.score).toBeGreaterThan(900_000); // a genuine forced win exists
    const passive: { from: Square; to: Square } = { from: 'b6', to: 'b5' }; // legal, non-mating engine pick
    expect(preferForcingWin(mateBoard, 'white', undefined, passive, opts)).toEqual(sr.move);
  }, 30_000);

  it('does NOT override for a mere material win — keeps the offensive pick (the key guard)', () => {
    // preferSearchMove WOULD grab the free a8 anomaly here; preferForcingWin must NOT — it only acts
    // on a proven forcing win, so it never trades the caller's sticking-check pick for material.
    const passive: { from: Square; to: Square } = { from: 'h1', to: 'g1' };
    expect(preferForcingWin(materialBoard, 'white', undefined, passive, { maxDepth: 3 })).toEqual(passive);
  }, 30_000);
});

describe('positionKey — charge-aware, order-independent', () => {
  it('is identical for the same position regardless of Record insertion order', () => {
    const a: Board = {
      a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }),
      h8: king('black', 'h8'),
      h1: king('white', 'h1'),
    };
    const b: Board = {
      h1: king('white', 'h1'),
      h8: king('black', 'h8'),
      a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }),
    };
    expect(positionKey(a, 'white')).toBe(positionKey(b, 'white'));
  });

  it('differs when charges differ at the same placement', () => {
    const base: Board = { a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }), h8: king('black', 'h8') };
    const drained: Board = { a1: anomaly('white', 'a1', { L: 0, O: 4, D: 0 }), h8: king('black', 'h8') };
    expect(positionKey(base, 'white')).not.toBe(positionKey(drained, 'white'));
  });

  it('differs by side-to-move and by en-passant target', () => {
    const bd: Board = { a1: anomaly('white', 'a1', { L: 0, O: 5, D: 0 }), h8: king('black', 'h8') };
    expect(positionKey(bd, 'white')).not.toBe(positionKey(bd, 'black'));
    expect(positionKey(bd, 'white')).not.toBe(positionKey(bd, 'white', 'e3'));
  });
});

describe('transposition table — correctness (TT on ≡ TT off)', () => {
  // Enough branching (two independent white sliders + kings) to create transpositions, but a
  // uniquely-best capture (a1→a8 wins an undefended ~5-charge anomaly) so there is no tie to flap.
  const board: Board = {
    a1: anomaly('white', 'a1', { L: 0, O: 10, D: 0 }, 'absOrtho'),
    a8: anomaly('black', 'a8', { L: 0, O: 5, D: 0 }, 'absOrtho'),
    c1: anomaly('white', 'c1', { L: 0, O: 0, D: 5 }, 'absDiag'),
    h1: king('white', 'h1'),
    h8: king('black', 'h8'),
  };

  it('returns the same best move + score with the TT off vs on, and never more nodes with it on', () => {
    try {
      setTranspositionEnabled(false);
      const off = searchBestMove(board, 'white', undefined, { maxDepth: 4 });
      setTranspositionEnabled(true);
      const on = searchBestMove(board, 'white', undefined, { maxDepth: 4 });
      expect(on.move).toEqual(off.move);
      expect(on.score).toBe(off.score);
      expect(on.nodes).toBeLessThanOrEqual(off.nodes);
    } finally {
      setTranspositionEnabled(true); // never leak the disabled flag to other tests
    }
  }, 30_000);
});
