// lib/chess/bot.spec.ts — regression tests for the Piloted-Anomaly suicidal-check fix.
//
// The bug: scoreVsPilotedKing rewarded ANY check, so the bot fed pieces into a
// piloted king that simply recaptured the checker. The fix: a check only earns the
// bonus when the checking piece cannot be immediately recaptured (`moverSafe`).
//
// These two boards are geometrically IDENTICAL (a rook lands on g2, one square above
// the piloted royal at g1). The ONLY difference is the royal's remaining vectors:
//   - Test 1: full Amazon (O > 0) CAN recapture g2  → suicidal check → penalised.
//   - Test 2: depleted royal (O = 0, D only) CANNOT reach g2 → check STICKS → rewarded.
// That contrast is the exact heart of the bug.

import { describe, it, expect, vi } from 'vitest';
import { scoreVsPilotedKing, givesCheck, chooseBotMove, chooseOverrideHost, hostSurvivability } from '../bot';
import type { BotMove } from '../bot';
import type { Anomaly, King, Pawn, Board, VectorPool, PieceColor, Square } from '@/types/game';

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

const rook = (color: PieceColor, square: Square): Anomaly => ({
  id: `rook-${square}`,
  color,
  type: 'anomaly',
  archetype: 'absOrtho',
  icon: '♜',
  vectors: { L: 0, O: 10, D: 0 },
  isGridlocked: false,
});

const bishop = (color: PieceColor, square: Square): Anomaly => ({
  id: `bishop-${square}`,
  color,
  type: 'anomaly',
  archetype: 'absDiag',
  icon: '♝',
  vectors: { L: 0, O: 0, D: 10 },
  isGridlocked: false,
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
  hasMoved: true,
});

/** A non-royal Anomaly with arbitrary vectors (the "police car" in the depletion tests). */
const police = (color: PieceColor, square: Square, vectors: VectorPool): Anomaly => ({
  id: `police-${square}`,
  color,
  type: 'anomaly',
  archetype: 'balanced',
  icon: '🚓',
  vectors,
  isGridlocked: false,
});

describe('scoreVsPilotedKing — suicidal-check fix', () => {
  it('PENALISES a check the piloted king can immediately recapture (full Amazon)', () => {
    // Black royal Amazon at g1 with its Orthogonal vector intact → it can take g2.
    const board: Board = {
      g1: royal('black', 'g1', { L: 4, O: 3, D: 3 }),
      g5: rook('white', 'g5'),
      a8: king('white', 'a8'),
    };
    const score = scoreVsPilotedKing(board, 'white', { from: 'g5', to: 'g2' });
    // Old code scored this +1000 and played it (feeding the rook). Now it must be <= 0.
    expect(score).toBeLessThanOrEqual(0);
  });

  it('REWARDS the same check when the royal cannot recapture (Orthogonal depleted)', () => {
    // Identical geometry, but the royal has spent L and O — only Diagonal remains,
    // so it CANNOT capture the orthogonally-adjacent g2. The check sticks.
    const board: Board = {
      g1: royal('black', 'g1', { L: 0, O: 0, D: 5 }),
      g5: rook('white', 'g5'),
      a8: king('white', 'a8'),
    };
    const score = scoreVsPilotedKing(board, 'white', { from: 'g5', to: 'g2' });
    expect(score).toBeGreaterThanOrEqual(1000);
  });

  it('ranks a sticking check above a recapturable one', () => {
    const recapturable: Board = {
      g1: royal('black', 'g1', { L: 4, O: 3, D: 3 }),
      g5: rook('white', 'g5'),
      a8: king('white', 'a8'),
    };
    const sticks: Board = {
      g1: royal('black', 'g1', { L: 0, O: 0, D: 5 }),
      g5: rook('white', 'g5'),
      a8: king('white', 'a8'),
    };
    const move = { from: 'g5' as Square, to: 'g2' as Square };
    expect(scoreVsPilotedKing(sticks, 'white', move)).toBeGreaterThan(
      scoreVsPilotedKing(recapturable, 'white', move),
    );
  });

  it('scores a quiet, non-checking, safe move at 0 — below a sticking check', () => {
    // Rook slides to a5: off the royal's file (no check) and off its diagonal
    // (the D-only royal at g1 covers f2/e3/d4/c5/b6/a7/h2 — not a5), so it's safe.
    const board: Board = {
      g1: royal('black', 'g1', { L: 0, O: 0, D: 5 }),
      g5: rook('white', 'g5'),
      a8: king('white', 'a8'),
    };
    const quiet = scoreVsPilotedKing(board, 'white', { from: 'g5', to: 'a5' });
    const stickingCheck = scoreVsPilotedKing(board, 'white', { from: 'g5', to: 'g2' });
    expect(quiet).toBe(0);
    expect(stickingCheck).toBeGreaterThan(quiet);
  });

  it('PENALISES a capture-check that hangs the mover into the piloted royal (value-aware)', () => {
    // The exploit: a rook (10-charge Ortho anomaly) grabs a pawn on g2 WITH check, but the
    // full royal Amazon at g1 just recaptures it. Trading a 10-charge piece for a 1-point
    // pawn into a king that eats it must score negative — below a safe quiet move (0) — so
    // the bot never volunteers material to a piloted king the way a human opponent can exploit.
    const board: Board = {
      g1: royal('black', 'g1', { L: 4, O: 3, D: 3 }),
      g2: pawn('black', 'g2'),
      g5: rook('white', 'g5'),
      a8: king('white', 'a8'),
    };
    const captureCheck = scoreVsPilotedKing(board, 'white', { from: 'g5', to: 'g2' });
    const quiet = scoreVsPilotedKing(board, 'white', { from: 'g5', to: 'a5' });
    expect(captureCheck).toBeLessThan(0);
    expect(captureCheck).toBeLessThan(quiet);
  });

  it('REWARDS a hanging capture that still WINS material (pawn takes Anomaly)', () => {
    // Not every unsafe capture is bad: a white pawn on e1 takes a black Anomaly on f2, and
    // the royal Amazon at g1 recaptures diagonally (D intact). But pawn-for-Anomaly is a
    // winning trade, so it must score positive — proving the fix penalises by NET material
    // rather than blindly avoiding every hang. (Positions here are constructed, not legal.)
    const board: Board = {
      g1: royal('black', 'g1', { L: 4, O: 3, D: 3 }),
      f2: rook('black', 'f2'),
      e1: pawn('white', 'e1'),
      a8: king('white', 'a8'),
    };
    const winningHang = scoreVsPilotedKing(board, 'white', { from: 'e1', to: 'f2' });
    expect(winningHang).toBeGreaterThan(0);
  });
});

// Stage 1 — charge-aware 1-ply judgment. A non-royal Anomaly changes movement type as it
// depletes, so a "check" delivered by a vector the move EMPTIES evaporates the instant the
// piece lands. givesCheck now judges on the REAL depleted board, so the bot no longer values
// these fizzled checks. This is the non-royal counterpart to the piloted-king depletion fix.
describe('givesCheck — charge-aware police-car fizzle (Stage 1)', () => {
  it('reports NO check when the move spends the last orthogonal charge (police car O:1)', () => {
    // White police car b1 = O:1 / D:2 / L:5. b1→b5 slides ORTHOGONALLY up the file, spending
    // its last O charge → on b5 it is O:0 / D:2 / L:5 and can no longer attack along the file,
    // so the "check" on the black king at b8 fizzles the moment it arrives.
    const board: Board = {
      b1: police('white', 'b1', { L: 5, O: 1, D: 2 }),
      b8: king('black', 'b8'),
      h1: king('white', 'h1'),
    };
    expect(givesCheck(board, 'white', { from: 'b1', to: 'b5' })).toBe(false);
  });

  it('reports a REAL check when the checking vector survives depletion (police car O:2)', () => {
    // Same geometry, but O:2 → after moving orthogonally O:1 remains, so the file attack on
    // b8 still stands. Proves the predicate distinguishes a genuine check from a fizzled one.
    const board: Board = {
      b1: police('white', 'b1', { L: 5, O: 2, D: 2 }),
      b8: king('black', 'b8'),
      h1: king('white', 'h1'),
    };
    expect(givesCheck(board, 'white', { from: 'b1', to: 'b5' })).toBe(true);
  });

  it('the non-depleting view WOULD have seen the fizzled check (documents the old bug)', () => {
    // Sanity anchor: with O:1, the pre-move shape still has orthogonal reach, so a charge-blind
    // check test sees a (false) check on b8. This is exactly what the bot used to be fooled by.
    const board: Board = {
      b1: police('white', 'b1', { L: 5, O: 1, D: 2 }),
      b8: king('black', 'b8'),
      h1: king('white', 'h1'),
    };
    // givesCheck (charge-aware) says false; the raw pre-move geometry says the file is covered.
    expect(givesCheck(board, 'white', { from: 'b1', to: 'b5' })).toBe(false);
    const before = board.b1 as Anomaly;
    expect(before.vectors.O).toBeGreaterThan(0); // pre-move: orthogonal present → looked like check
  });
});

// Bug 4 — the forced-Override fallback (softlock cure). See docs/dev/BotDepletionAwareness.md §6.
// The bot's standing policy is "never board" (withoutOverrides strips Override in BOTH the engine
// and heuristic paths). But the rules layer counts Override as a legal escape, so a human can
// trap the bot's King into a position where an Override is its ONLY legal move. Before the fix
// chooseBotMove returned null there and the driver hung the game forever; now it must board.
describe('chooseBotMove — forced-Override fallback (Bug 4 softlock cure)', () => {
  it('boards (Overrides) when an Override is the ONLY legal move, instead of returning null', async () => {
    // Black (bot) King trapped in the corner at a8, in DOUBLE check:
    //   • white Rook-anomaly a1 covers the a-file (attacks a8 and the a7 escape),
    //   • white Bishop-anomaly c6 covers the c6–a8 diagonal (attacks a8 and the b7 escape).
    // Both king steps (a7, b7) stay in check; no black piece can block/capture both checkers,
    // so every non-king move is illegal too. The one legal reply is boarding the friendly
    // Anomaly on b8 (Override), which is off both attack lines. Engine is unavailable in tests
    // (getEngineMove short-circuits on the empty non-Override set), and heuristicMove also sees
    // no non-Override move → the fallback must fire.
    const board: Board = {
      a8: king('black', 'a8'),
      b8: police('black', 'b8', { L: 0, O: 0, D: 3 }), // Override host (non-omni, non-gridlocked)
      a1: rook('white', 'a1'),                          // a-file check (O intact)
      c6: bishop('white', 'c6'),                        // c6–b7–a8 diagonal check (D intact)
      h1: king('white', 'h1'),
    };
    const move = await chooseBotMove(board, 'black', undefined, 'intermediate_2');
    expect(move).not.toBeNull();
    expect(move).toEqual({ from: 'a8', to: 'b8' }); // the King boards b8 rather than hanging
  });

  it('does NOT board when a normal legal move exists (fallback stays inert)', async () => {
    // Same friendly Override host on b8, but the King is NOT in check and has quiet moves
    // (a7/b7) plus a pawn push — so heuristicMove returns a real move and the fallback never
    // runs. The result must be some legal NON-Override move, never the a8→b8 board.
    const board: Board = {
      a8: king('black', 'a8'),
      b8: police('black', 'b8', { L: 0, O: 0, D: 3 }),
      h7: pawn('black', 'h7'),
      h1: king('white', 'h1'),
    };
    const move = await chooseBotMove(board, 'black', undefined, 'intermediate_2');
    expect(move).not.toBeNull();
    expect(move).not.toEqual({ from: 'a8', to: 'b8' }); // Override is never chosen when others exist
  });
});

// Bug 5 — the forced-Override HOST choice (host coin-flip cure). See docs/dev/BotDepletionAwareness.md §7.
// Bug 4 stopped the softlock but boarded a RANDOM host. When ≥2 Overrides are legal, boarding a
// near-depleted host (short charge runway / no adjacent-escape geometry) instead of a rich one can
// hand the game away. chooseOverrideHost now ranks hosts by king-safety: coverage (adjacent-escape
// geometry from the fairy lattice) ▸ runway (charges before Gridlock Death) ▸ safeMobility (real safe
// squares here). All boards below trap the black King in DOUBLE check so that boarding is its ONLY
// legal reply and neither host can interpose/capture (a double check can't be blocked), leaving
// exactly the two Overrides for the fallback to choose between.
describe('chooseBotMove — forced-Override host selection (Bug 5)', () => {
  // Shared geometry: black King a5 in DOUBLE check —
  //   • white Rook a1 covers the a-file (attacks a5, and a4/a6 collapse into check on any step),
  //   • white Bishop e1 covers the e1–b4–a5 diagonal (attacks a5, and b4 on any step).
  // Every non-Override reply stays in check, so the two friendly Anomalies on the safe squares
  // b5 and b6 are the ONLY legal moves — both pure Overrides. Neither b5 nor b6 is attacked, so
  // both boards are legal; the bot must pick the safer host.
  const doubleCheckBase = (): Board => ({
    a5: king('black', 'a5'),
    a1: rook('white', 'a1'),   // a-file check (O intact)
    e1: bishop('white', 'e1'), // e1–d2–c3–b4–a5 diagonal check (D intact)
    h1: king('white', 'h1'),
  });

  it('boards the higher-coverage host (Amazon over a Knight) rather than coin-flipping', async () => {
    // b5 host = full Amazon (O and D present) → coverage 8: it can sidestep a check in any of the
    // 8 adjacent directions. b6 host = pure Knight (L only) → coverage 0: a Knight-royal cannot
    // step to ANY adjacent square, the most mate-prone host. The bot must board b5.
    const board: Board = {
      ...doubleCheckBase(),
      b5: police('black', 'b5', { L: 4, O: 3, D: 3 }), // Amazon-shaped host → coverage 8
      b6: police('black', 'b6', { L: 5, O: 0, D: 0 }), // Knight-shaped host → coverage 0
    };
    const move = await chooseBotMove(board, 'black', undefined, 'intermediate_2');
    expect(move).toEqual({ from: 'a5', to: 'b5' });
  });

  it('breaks a coverage tie by runway (more charges before Gridlock Death)', async () => {
    // Both hosts are Queen-shaped (O and D present) → coverage 8 each, so the king-safety geometry
    // ties. The tiebreak is runway = L+O+D: b6 (27 charges) far outlasts b5 (3 charges) before the
    // piloted royal is squeezed toward 0/0/0 Gridlock Death, so the bot must board b6.
    const board: Board = {
      ...doubleCheckBase(),
      b5: police('black', 'b5', { L: 1, O: 1, D: 1 }), // coverage 8, runway 3
      b6: police('black', 'b6', { L: 9, O: 9, D: 9 }), // coverage 8, runway 27
    };
    const move = await chooseBotMove(board, 'black', undefined, 'intermediate_2');
    expect(move).toEqual({ from: 'a5', to: 'b6' });
  });
});

// Bug 5 (continued) — the 3rd key and the tie path, unit-tested directly. The two board-trap
// tests above resolve at coverage / runway, so these exercise `chooseOverrideHost` and
// `hostSurvivability` head-on (both exported for testing, matching scoreVsPilotedKing/givesCheck)
// to cover safeMobility and the exact-tie random fallback that the end-to-end tests never reach.
describe('chooseOverrideHost — safeMobility tiebreak (Bug 5)', () => {
  // Both hosts are balanced 3/3/3 → identical coverage (8) and runway (9), so the decision must
  // fall through to safeMobility: the count of the piloted royal's non-suicidal legal escape
  // squares on THIS board. The open host on b2 outmoves the cornered host on a1 (the a1 royal's
  // whole NE diagonal is blocked by the b2 host, and two edges hem the rest), so the bot boards b2.
  const board: Board = {
    b1: king('black', 'b1'),
    b2: police('black', 'b2', { L: 3, O: 3, D: 3 }), // open host
    a1: police('black', 'a1', { L: 3, O: 3, D: 3 }), // cornered host
    h8: king('white', 'h8'),                          // far away — keeps the board calm
  };
  const overrides: BotMove[] = [
    { from: 'b1', to: 'b2' },
    { from: 'b1', to: 'a1' },
  ];

  it('coverage and runway tie, and safeMobility strictly favours the open host', () => {
    const open = hostSurvivability(board, 'black', undefined, overrides[0]!);
    const corner = hostSurvivability(board, 'black', undefined, overrides[1]!);
    expect(open.coverage).toBe(corner.coverage); // 8 === 8
    expect(open.runway).toBe(corner.runway);     // 9 === 9
    expect(open.safeMobility).toBeGreaterThan(corner.safeMobility);
  });

  it('boards the higher-safeMobility (open) host', () => {
    expect(chooseOverrideHost(board, 'black', undefined, overrides)).toEqual(overrides[0]);
  });
});

describe('chooseOverrideHost — exact three-key tie falls back to random (Bug 5)', () => {
  // Two KNIGHT-only hosts (L-only). Knights don't slide, so their move count depends only on
  // distance to the board edges — no far-board asymmetry leaks in the way a rook/bishop's rank
  // would. a3 and c1 are both adjacent to the king on b2 and each has exactly 4 knight moves on
  // an otherwise empty board (a3→{b1,b5,c2,c4}, c1→{a2,b3,d3,e2}), so the hosts tie on ALL three
  // keys — coverage (0), runway (3), AND safeMobility (4) — leaving only the random tiebreak.
  const board: Board = {
    b2: king('black', 'b2'),
    a3: police('black', 'a3', { L: 3, O: 0, D: 0 }),
    c1: police('black', 'c1', { L: 3, O: 0, D: 0 }),
    h8: king('white', 'h8'),
  };
  const overrides: BotMove[] = [
    { from: 'b2', to: 'a3' },
    { from: 'b2', to: 'c1' },
  ];

  it('the two hosts are an exact three-key tie', () => {
    const a = hostSurvivability(board, 'black', undefined, overrides[0]!);
    const c = hostSurvivability(board, 'black', undefined, overrides[1]!);
    expect(a).toEqual(c);
  });

  it('random index 0 boards the first tied host, ~1 the second (both reachable)', () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(chooseOverrideHost(board, 'black', undefined, overrides)).toEqual(overrides[0]);
    spy.mockReturnValue(0.999);
    expect(chooseOverrideHost(board, 'black', undefined, overrides)).toEqual(overrides[1]);
    spy.mockRestore();
  });
});
