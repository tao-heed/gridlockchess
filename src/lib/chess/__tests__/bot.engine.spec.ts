// lib/chess/bot.engine.spec.ts — Bug 6 Stage A: the ENGINE-PATH wiring.
//
// bot.spec.ts covers the heuristic fallback (engine down). It can NEVER reach getEngineMove,
// because getEngineMove bails at `isEngineReady()` — there is no engine server under vitest.
// So the self-piloted force-enable + `overrideMargin: 0` handoff to the charge-aware search were
// previously UNTESTED. This file mocks './engine' to report ready and to return a scripted
// candidate list, driving the real getEngineMove → preferSearchMove path end to end.
//
// vi.mock is per-file and hoisted, so this MUST live in its own spec: bot.spec.ts deliberately
// relies on the engine being DOWN. We keep the REAL boardToFen / parseUciMove (getEngineMove uses
// both) and override ONLY isEngineReady and evaluatePosition.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Anomaly, King, Pawn, Board, VectorPool, PieceColor, Square } from '@/types/game';

vi.mock('../engine', async (importActual) => {
  const actual = await importActual<typeof import('../engine')>();
  return {
    ...actual,
    isEngineReady: vi.fn(async () => true),
    evaluatePosition: vi.fn(async () => [] as import('../engine').EngineMove[]),
  };
});

import { chooseBotMove } from '../bot';
import { evaluatePosition } from '../engine';

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
  hasMoved: false,
});

beforeEach(() => {
  vi.mocked(evaluatePosition).mockReset();
});

describe('getEngineMove — self-piloted royal, engine path (Bug 6 Stage A)', () => {
  it('CLIFF: refuses the engine\'s self-Gridlock-Death move even when it is the only candidate', async () => {
    // White royal at a1 on its LAST charge (O:1). Any royal move spends it → 0/0/0 → Gridlock
    // Death. A harmless pawn push exists that touches nothing. The native engine is depletion-
    // blind, so it happily "recommends" the royal move a1a2. On the intermediate_2 tier,
    // overlayBudget.maxDepth is 2 — Stage A forces it to Math.max(2,3)=3 and terminalChildScore refuses
    // the suicide, so chooseBotMove must NOT play a royal move.
    const board: Board = {
      a1: royal('white', 'a1', { L: 0, O: 1, D: 0 }),
      c2: pawn('white', 'c2'),
      h8: king('black', 'h8'),
    };
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'a1a2', score: 0 }]);

    const move = await chooseBotMove(board, 'white', undefined, 'intermediate_2');
    expect(move).not.toBeNull();
    expect(move!.from).not.toBe('a1');   // never touches the last-charge royal
    expect(move!.from).toBe('c2');       // plays the safe pawn instead
  });

  it('SLOW SQUEEZE: conserves a royal charge the engine would needlessly spend', async () => {
    // Royal at a1 with FOUR charges (no cliff — every royal move is legal and non-fatal). The
    // engine recommends a pointless royal shuffle a1a2 (spends 1 of 4). A pawn push conserves the
    // royal. The reserve delta is only ~8cp — far below the default 150cp OVERRIDE_MARGIN, so
    // WITHOUT the self-piloted `overrideMargin: 0` this conservation would stay inert and the bot
    // would echo the engine's a1a2. With the fix, the charge-aware search's conserving move binds.
    const board: Board = {
      a1: royal('white', 'a1', { L: 0, O: 4, D: 0 }),
      c2: pawn('white', 'c2'),
      h8: king('black', 'h8'),
    };
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'a1a2', score: 0 }]);

    const move = await chooseBotMove(board, 'white', undefined, 'intermediate_2');
    expect(move).not.toBeNull();
    expect(move!.from).toBe('c2');       // conserves the royal, spends the pawn tempo instead
  });

  it('NO REGRESSION: with a plain King, the engine\'s pick is returned untouched', async () => {
    // Same shape but the royal is a plain King (nothing to conserve, no charge economy). The
    // self-piloted branch is skipped entirely, so the engine's legal recommendation stands.
    const board: Board = {
      a1: king('white', 'a1'),
      c2: pawn('white', 'c2'),
      h8: king('black', 'h8'),
    };
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'a1b1', score: 0 }]);

    const move = await chooseBotMove(board, 'white', undefined, 'intermediate_2');
    expect(move).toEqual({ from: 'a1', to: 'b1' });
  });

  it('BOTH ROYALS PILOTED: still refuses the engine\'s self-Gridlock-Death via the opponent branch', async () => {
    // Root cause #3: when BOTH royals are piloted, `getEngineMove` takes the opponent-piloted
    // branch and would `return best` (a pure OFFENSIVE pick from scoreVsPilotedKing that ignores
    // our own royal's depletion) BEFORE the search runs. The `if (selfPiloted) return
    // preferSearchMove(...)` line routes that offensive pick through the force-enabled search so a
    // self-Gridlock-Death is still refused. Here white's royal (a1, O:1) is on its last charge, so
    // every royal move self-kills; the engine (depletion-blind) offers exactly that move, and the
    // black royal (h5) makes `hasPilotedKing(opponent)` true so the opponent branch is taken.
    const board: Board = {
      a1: royal('white', 'a1', { L: 0, O: 1, D: 0 }),
      c2: pawn('white', 'c2'),
      h5: royal('black', 'h5', { L: 1, O: 1, D: 1 }),
    };
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'a1a2', score: 0 }]);

    const move = await chooseBotMove(board, 'white', undefined, 'intermediate_2');
    expect(move).not.toBeNull();
    expect(move!.from).not.toBe('a1'); // never spends the last-charge royal → no self-Gridlock-Death
    expect(move!.from).toBe('c2');     // the only safe alternative
  });
});

describe('getEngineMove — enemy-only piloted royal, master_5 forcing-win override (§12 #1)', () => {
  // A plain (non-royal) Anomaly builder — the white attacker that delivers the forcing check.
  const anomaly = (color: PieceColor, square: Square, vectors: VectorPool): Anomaly => ({
    id: `anom-${square}`, color, type: 'anomaly', archetype: 'absOrtho', icon: '🛸',
    vectors, isGridlocked: vectors.L + vectors.O + vectors.D === 0,
  });

  // Only the OPPONENT is piloted: the black royal a8 is on its LAST charge (O:1) — any royal move
  // spends it → 0/0/0 Gridlock Death. Black also has a pawn (b7), so it is NOT auto-doomed: it could
  // push the pawn and survive UNLESS forced to move the royal. White's rook-like anomaly (h1) can
  // deliver a check on a8 (h1→a1 up file a, or h1→h8 across rank 8) that the pawn can neither block
  // nor capture → black must move the royal → Gridlock Death. That is a forced win in 2 plies which
  // the 1-ply `scoreVsPilotedKing` cannot see (the checking move is not itself mate), but the
  // charge-aware forcing search can. The engine is mocked to recommend ONLY a harmless king step
  // (e1e2), so charge-blind levels (intermediate and below) MISS the win while fuel-aware levels
  // (advanced+) route through preferForcingWin and FIND it. The fuel boundary is at L11 (advanced_1).
  const board: Board = {
    a8: royal('black', 'a8', { L: 0, O: 1, D: 0 }),
    b7: pawn('black', 'b7'),
    h1: anomaly('white', 'h1', { L: 0, O: 8, D: 0 }),
    e1: king('white', 'e1'),
  };

  it('master_5 (L25) finds the forced Gridlock-Death win the engine pick misses', async () => {
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'e1e2', score: 0 }]);
    const move = await chooseBotMove(board, 'white', undefined, 'master_5');
    expect(move).not.toBeNull();
    expect(move!.from).toBe('h1');                       // the anomaly delivers the forcing check
    expect(move).not.toEqual({ from: 'e1', to: 'e2' });  // NOT the engine's non-winning pick
  });

  it('master_4 (L24, fuel-aware) also finds the forced win via fuel path', async () => {
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'e1e2', score: 0 }]);
    const move = await chooseBotMove(board, 'white', undefined, 'master_4');
    expect(move).not.toBeNull();
    expect(move!.from).toBe('h1'); // fuel path + preferForcingWin finds the forcing check
  });

  it('intermediate_5 (L10, charge-blind) keeps the 1-ply engine pick — proves the fuel boundary', async () => {
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'e1e2', score: 0 }]);
    const move = await chooseBotMove(board, 'white', undefined, 'intermediate_5');
    expect(move).toEqual({ from: 'e1', to: 'e2' });
  });
});

describe('fuel boundary — verify fuel is sent for L11-L25 and NOT for L1-L10', () => {
  // Simple board: white king + white anomaly vs black king. No piloted royals (avoids the
  // scoreVsPilotedKing branch). The anomaly has charges so boardToFuelString produces output.
  const anomaly = (color: PieceColor, square: Square, vectors: VectorPool): Anomaly => ({
    id: `anom-${square}`, color, type: 'anomaly', archetype: 'absOrtho', icon: '🛸',
    vectors, isGridlocked: false,
  });

  const board: Board = {
    e1: king('white', 'e1'),
    d1: anomaly('white', 'd1', { L: 3, O: 3, D: 3 }),
    e8: king('black', 'e8'),
  };

  beforeEach(() => {
    vi.mocked(evaluatePosition).mockReset();
    vi.mocked(evaluatePosition).mockResolvedValue([{ move: 'e1e2', score: 0 }]);
  });

  // Charge-blind levels (basic + intermediate): evaluatePosition should be called WITHOUT a fuel property
  for (const level of ['basic_1', 'basic_5', 'intermediate_1', 'intermediate_5'] as const) {
    it(`${level} does NOT send fuel`, async () => {
      await chooseBotMove(board, 'white', undefined, level);
      const calls = vi.mocked(evaluatePosition).mock.calls;
      // At least one call should have been made (the generic path)
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // None of the calls should have a fuel property
      for (const [, opts] of calls) {
        expect(opts).not.toHaveProperty('fuel');
      }
    });
  }

  // Fuel-aware levels (advanced + expert + master): the FIRST evaluatePosition call includes a fuel string
  for (const level of ['advanced_1', 'advanced_5', 'expert_5', 'master_4'] as const) {
    it(`${level} sends fuel`, async () => {
      await chooseBotMove(board, 'white', undefined, level);
      const calls = vi.mocked(evaluatePosition).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      // The first call (fuel path) should have a fuel string
      const firstOpts = calls[0]![1] as Record<string, unknown>;
      expect(firstOpts).toHaveProperty('fuel');
      expect(typeof firstOpts.fuel).toBe('string');
      expect((firstOpts.fuel as string).length).toBeGreaterThan(0);
    });
  }
});
