// lib/chess/bot.ts — Fairy-Stockfish-powered opponent for Gridlock Chess.
//
// FLOW:
//   1. Ask Fairy-Stockfish (via the proxy) for ranked candidate moves on the
//      "gridlock" variant, which natively understands Amazon/Archbishop/Chancellor.
//   2. Re-filter every suggestion through getAllLegalMoves — the real authority on
//      charge/gridlock rules (the engine can't see depleting vector pools).
//   3. Play the highest-ranked move that is actually legal.
//
// FALLBACK: if the engine proxy is down or returns nothing legal, fall back to a
// lightweight heuristic so the bot always moves.
//
// DIFFICULTY: 25 levels across 5 tiers (basic → intermediate → advanced → expert → master, L1-L25).
// basic+intermediate (L1-10) are charge-blind; advanced+expert+master (L11-25) send fuel to the
// fuel-modified FSF. master_5 (L25) is the Run Dry final boss — single fuel-aware FSF call at
// maximum depth (D24 / 4000ms). basic_1 is near-random play; master_5 is superhuman.

import type { Board, Square, PieceColor, Piece, Anomaly, OmniAnomaly } from '@/types/game';
import { getAllLegalMoves, applyMove, isInCheck, isCheckmate, isSquareAttacked, findKing } from './check';
import { applyMoveToBoard } from './move';
import { preferSearchMove, preferForcingWin, type SearchOptions } from './search';
import { boardToFen, boardToFuelString, evaluatePosition, parseUciMove, isEngineReady } from './engine';
import { annotateLastEngineLogSource } from './nativeEngine';

export type BotTier = 'basic' | 'intermediate' | 'advanced' | 'expert' | 'master';
type SubLevel = '1' | '2' | '3' | '4' | '5';
/** 25 difficulty levels: 5 named tiers × 5 sub-levels.
 *  master_5 (L25) is the Run Dry final boss only — hidden from PlaySettings/Sandbox. */
export type BotDifficulty = `${BotTier}_${SubLevel}`;

const SUB_LEVELS = ['1','2','3','4','5'] as const;
export const BOT_TIERS: BotTier[] = ['basic','intermediate','advanced','expert','master'];
export const ALL_DIFFICULTIES: BotDifficulty[] = BOT_TIERS.flatMap(t => SUB_LEVELS.map(s => `${t}_${s}` as BotDifficulty));
export const tierOf = (d: BotDifficulty): BotTier => d.split('_')[0] as BotTier;
export const subLevelOf = (d: BotDifficulty): number => +d.split('_')[1]!;
/** 0-24: tier × 5 + sub-level - 1. basic_1 = 0, master_5 = 24. */
export const levelIndex = (d: BotDifficulty): number => BOT_TIERS.indexOf(tierOf(d)) * 5 + subLevelOf(d) - 1;

export interface BotMove {
  from: Square;
  to: Square;
}

/** Optional benchmark/experiment overrides for the bot's engine call and charge-aware overlay.
 *  Undefined in all normal play (LocalGame/tests) — only the self-play harness passes these:
 *  - `engineNodes`: fixed node budget → `go nodes N` (hardware-independent, replaces depth/movetime).
 *  - `searchMaxDepth`: override the `search.ts` overlay depth (e.g. 0 to A/B the overlay OFF).
 *  See docs/dev/BotStrengthEnhancementPlan.md §9 #1/#2. */
export interface BotOverrides {
  engineNodes?: number;
  searchMaxDepth?: number;
}

const opponentOf = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');

/** Tag the current move's engine-log entry as an 'Overlay' override when the charge-aware search's
 *  chosen move differs from the engine's pick. On-device only — `annotateLastEngineLogSource` no-ops
 *  when the log is empty (the dev HTTP proxy and heuristic fallback record nothing). Returns
 *  `finalMove` so it can wrap a return expression. */
const markSource = (enginePick: BotMove, finalMove: BotMove): BotMove => {
  if (finalMove.from !== enginePick.from || finalMove.to !== enginePick.to) {
    annotateLastEngineLogSource('Overlay');
  }
  return finalMove;
};

/** Board AFTER a move with the REAL rules applied (move.ts kernel): charges are spent, a
 *  depleted vector is dropped, the piece may change type, EP victims are removed. This is the
 *  Stage-1 fix for depletion-blindness — every 1-ply judgment (check / safety) must see the
 *  mover as it ACTUALLY becomes, not its pre-move shape, so a "check" that a piece cancels by
 *  spending its last charge (the police-car fizzle) is correctly seen as no check. Falls back
 *  to the non-depleting sim only if the kernel rejects the move (shouldn't happen for a legal
 *  move — keeps the helper total). */
const applyReal = (board: Board, color: PieceColor, m: BotMove, enPassantTarget?: Square): Board => {
  const res = applyMoveToBoard(board, m.from, m.to, color, enPassantTarget ?? null);
  return res.valid ? res.board : applyMove(board, m.from, m.to);
};

/** True if `color` playing `m` spends its OWN piloted royal's last charge → Gridlock Death
 *  (instant self-loss). Bug 6 Stage A: used to filter the heuristic fallback so a forced-boarded
 *  bot never volunteers to kill its own royal. `move.ts` sets `gridlockDeath` only on a move that
 *  leaves a *piloted* royal at 0/0/0, so this is inert for a plain King. */
const selfGridlockDeath = (board: Board, color: PieceColor, m: BotMove, enPassantTarget?: Square): boolean => {
  const res = applyMoveToBoard(board, m.from, m.to, color, enPassantTarget ?? null);
  return res.valid && res.gridlockDeath === true;
};

/** True if `color`'s royal piece is a Piloted Anomaly (King boarded it via Override).
 *  The engine receives the correct royal piece type for its current vector set (via the
 *  gridlock-royal variant), but its *evaluation* of that king's depletion trajectory is wrong —
 *  it cannot model charges ticking down, so we correct for that on our side. */
const hasPilotedKing = (board: Board, color: PieceColor): boolean => {
  const sq = findKing(board, color);
  const p = sq ? board[sq] : undefined;
  return !!p && p.type === 'anomaly';
};

/** Rough capture value of a piece, used only by the piloted-king heuristic to weigh "what
 *  I take" against "what I hang". An Anomaly is worth its REMAINING charges (its real,
 *  depletion-aware power), a Pawn one point, an Omni its shared pool, a King effectively
 *  infinite. Deliberately simple — it exists to stop obviously-losing trades, not to be a
 *  full evaluation. */
const pieceCaptureValue = (p: Piece | undefined): number => {
  if (!p) return 0;
  if (p.type === 'pawn') return 1;
  if (p.type === 'king') return 1000;
  const v = (p as Anomaly | OmniAnomaly).vectors;
  return 'shared' in v ? v.shared : v.L + v.O + v.D;
};

/** Accurate score for a candidate move when the OPPONENT has a Piloted Anomaly king.
 *  Uses OUR rules (which know the king's true, depletion-aware mobility) to rank engine
 *  candidates — Fairy-Stockfish sees only a 1-square king and hangs its checkers next to a
 *  royal that actually eats them. `isSquareAttacked` reads the piloted king's real current
 *  vectors (movement.ts), so a depleted vector correctly leaves a check standing.
 *
 *  Scoring is VALUE-AWARE so the bot never feeds a 10-charge Anomaly to a king to grab a
 *  pawn: when the mover hangs (the royal can recapture), the move is scored by net material
 *  (what we take minus what we lose), which dominates any check bonus because that check
 *  does not stick. Only a check whose checker is SAFE earns the sticking-check reward. */
export const scoreVsPilotedKing = (board: Board, color: PieceColor, m: BotMove, enPassantTarget?: Square): number => {
  const after = applyReal(board, color, m, enPassantTarget);
  const opp = opponentOf(color);
  if (isCheckmate(after, opp)) return 1_000_000;          // real mate of the piloted king
  const moverSafe = !isSquareAttacked(after, m.to, opp);  // can the piloted side recapture?
  const target = board[m.to];
  const captured = target && target.color !== color ? pieceCaptureValue(target) : 0;

  if (moverSafe) {
    // The mover survives. A sticking check is decisive-adjacent; a safe capture is pure gain.
    let score = captured * 10;
    if (isInCheck(after, opp)) score += 1_000;
    return score;
  }
  // The piloted royal can recapture the mover: the check (if any) does NOT stick, and we
  // trade the mover for whatever we captured. Net material decides — feeding an Anomaly to
  // win a pawn is a heavy loss and must read well below any safe quiet move (which is 0).
  return (captured - pieceCaptureValue(board[m.from])) * 10;
};

/** True if a move is an Override (King stepping onto a friendly Anomaly). The bot never
 *  boards — it is a one-way, life-or-death human decision; random boarding would be
 *  self-destructive. The bot still faces a human's Piloted Anomaly normally. */
const isOverrideMove = (board: Board, m: BotMove): boolean => {
  const mover = board[m.from];
  const target = board[m.to];
  return (
    !!mover && mover.type === 'king' &&
    !!target && target.type === 'anomaly' &&
    target.color === mover.color && target.archetype !== 'omni'
  );
};

/** Strip Override moves from a legal-move map so the bot never boards. */
const withoutOverrides = (board: Board, map: Map<Square, Square[]>): Map<Square, Square[]> => {
  const out = new Map<Square, Square[]>();
  for (const [from, tos] of map) {
    const kept = tos.filter((to) => !isOverrideMove(board, { from, to }));
    if (kept.length) out.set(from, kept);
  }
  return out;
};

/** The inverse of `withoutOverrides`: collect ONLY the legal Override moves from a legal-move
 *  map. Used solely by the forced-Override fallback in `chooseBotMove` — when Override is the
 *  bot's only legal reply, the standing "never board" policy would otherwise softlock the game. */
const legalOverrides = (board: Board, map: Map<Square, Square[]>): BotMove[] => {
  const out: BotMove[] = [];
  for (const [from, tos] of map) {
    for (const to of tos) {
      if (isOverrideMove(board, { from, to })) out.push({ from, to });
    }
  }
  return out;
};

const flatten = (map: Map<Square, Square[]>): BotMove[] => {
  const out: BotMove[] = [];
  for (const [from, tos] of map) for (const to of tos) out.push({ from, to });
  return out;
};

const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/** King-safety profile of boarding ONE host, used to rank hosts when the bot is FORCED to
 *  Override and ≥2 boards are legal (Bug 5 — see docs/dev/BotDepletionAwareness.md §7). Every
 *  key is depletion-aware, and they are read in lexicographic priority (coverage ▸ runway ▸
 *  safeMobility). Exported for direct unit testing. */
export interface HostSurvivability {
  /** Adjacent-escape geometry from the fairy lattice (FairyCounterparts.md): a piloted royal
   *  can sidestep a check only along a vector it still owns. O covers the 4 orthogonal adjacent
   *  squares, D the 4 diagonal ones; L (knight) covers ZERO adjacent squares, so a Knight-royal
   *  is structurally the most mate-prone host. This is the dominant survival signal. */
  coverage: number;
  /** Total surviving charges (L+O+D): moves before the piloted royal is squeezed toward 0/0/0,
   *  which while piloted is Gridlock Death — an instant loss (§6.1). */
  runway: number;
  /** The piloted royal's count of NON-SUICIDAL legal escape squares on THIS board — a
   *  board-specific tiebreak once coverage and runway are equal. `getAllLegalMoves` already
   *  drops destinations that leave the royal in check (its `wouldBeInCheck` filter finds the
   *  piloted royal via `findKing`), so the ONLY thing left to reject is a move that spends the
   *  royal's last charge → Gridlock Death, read from the REAL depleting kernel (Bug 3). */
  safeMobility: number;
}

/** Compute the king-safety profile of boarding the host at `mv.to`. Coverage and runway come
 *  straight from the host's vector pool (the boarded royal keeps the host's vectors unchanged —
 *  move.ts spreads `...host`), so they need no simulation; safeMobility replays the real
 *  Override and probes the piloted royal's real reach. Exported for direct unit testing. */
export const hostSurvivability = (
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  mv: BotMove,
): HostSurvivability => {
  // The host is a non-omni Anomaly by construction (only such squares survive isOverrideMove).
  const host = board[mv.to] as Anomaly | undefined;
  const L = host?.vectors.L ?? 0;
  const O = host?.vectors.O ?? 0;
  const D = host?.vectors.D ?? 0;
  const coverage = (O > 0 ? 4 : 0) + (D > 0 ? 4 : 0);
  const runway = L + O + D;

  // safeMobility = the piloted royal's non-suicidal legal escape squares here. Every square
  // `getAllLegalMoves` returns is already check-safe, so we re-apply through the real depleting
  // kernel ONLY to read the `gridlockDeath` flag and drop a move that spends the royal's last
  // charge. (A second `isSquareAttacked` pass would be redundant: opponent reach to a square is
  // independent of the royal's own vector pool, so the depleting and non-depleting boards agree
  // on it exactly — the check-filter has already excluded every attacked destination.)
  let safeMobility = 0;
  const boarded = applyMoveToBoard(board, mv.from, mv.to, color, enPassantTarget ?? null);
  if (boarded.valid) {
    const royalMoves = getAllLegalMoves(boarded.board, color, undefined).get(mv.to) ?? [];
    for (const to of royalMoves) {
      const r = applyMoveToBoard(boarded.board, mv.to, to, color, null);
      if (r.valid && !r.gridlockDeath) safeMobility++;    // a suicidal escape is not "safe"
    }
  }
  return { coverage, runway, safeMobility };
};

/** Choose WHICH friendly Anomaly to board when the bot is forced to Override and ≥2 hosts are
 *  legal (Bug 5 — see docs/dev/BotDepletionAwareness.md §7). A single host is boarded outright;
 *  otherwise hosts are ranked by king-safety — coverage (adjacent-escape geometry) ▸ runway
 *  (charges before Gridlock Death) ▸ safeMobility (real safe squares here) — and only an exact
 *  three-way tie falls back to random, so the bot never coin-flips a rich host against a
 *  near-depleted one.
 *
 *  Why NOT rank hosts with the charge-aware negamax: search.ts scores a piloted royal at 0
 *  material (pieceWorth / isRoyal), so between two boarded boards its evaluation prefers the one
 *  that KEEPS the richer Anomaly as a non-royal fighter — i.e. it would systematically board the
 *  WEAKEST host to bank the strongest as material, the exact inverse of royal survival. The
 *  search's terminal terms (mate / Gridlock Death) are sound, but its quiet-line material signal
 *  is corrupted for THIS choice, so host selection uses the uncorrupted, depletion-aware
 *  king-safety keys above instead. (Playing the royal well AFTER boarding is a separate concern.)
 *  Exported for direct unit testing. */
export const chooseOverrideHost = (
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  overrides: BotMove[],
): BotMove => {
  if (overrides.length === 1) return overrides[0]!;
  const scored = overrides.map((mv) => ({ mv, s: hostSurvivability(board, color, enPassantTarget, mv) }));
  scored.sort(
    (a, b) =>
      b.s.coverage - a.s.coverage ||
      b.s.runway - a.s.runway ||
      b.s.safeMobility - a.s.safeMobility,
  );
  const top = scored[0]!.s;
  const tied = scored.filter(
    (x) =>
      x.s.coverage === top.coverage &&
      x.s.runway === top.runway &&
      x.s.safeMobility === top.safeMobility,
  );
  return pickRandom(tied).mv;
};

// ─────────────────────────────────────────────────────────────────────────────
// Engine configuration — 5 tiers × 5 sub-levels = 25 difficulty levels.
// basic (L1-5) + intermediate (L6-10) are charge-blind.
// advanced (L11-15) + expert (L16-20) + master (L21-25) send fuel to the engine.
// master_5 (L25) is the Run Dry final boss only (never in the dropdown).
// ─────────────────────────────────────────────────────────────────────────────

interface DifficultyConfig {
  depth: number;
  movetime: number;
  multipv: number;
  skill: number; // Fairy-Stockfish Skill Level 0-20
}

interface TierSpec {
  skillRange:             [number, number];
  depthRange:             [number, number];
  movetimeRange:          [number, number];
  multipvRange:           [number, number];
  overlayMaxD:            [number, number];
  overlayTimeBudgetRange: [number, number];
  fuel:                   boolean;
}

//                                  Skill      Depth      Movetime        MultiPV    OverlayD    OverlayMs         Fuel
const TIER_SPECS: Record<BotTier, TierSpec> = {
  basic:        { skillRange:[0,7],   depthRange:[1,5],   movetimeRange:[100,280],   multipvRange:[15,10], overlayMaxD:[0,1],   overlayTimeBudgetRange:[100,180],   fuel: false },
  intermediate: { skillRange:[9,13],  depthRange:[6,11],  movetimeRange:[320,750],   multipvRange:[9,6],   overlayMaxD:[2,4],   overlayTimeBudgetRange:[200,450],   fuel: false },
  advanced:     { skillRange:[14,16], depthRange:[12,15], movetimeRange:[800,1400],  multipvRange:[6,4],   overlayMaxD:[4,6],   overlayTimeBudgetRange:[500,900],   fuel: true  },
  expert:       { skillRange:[17,20], depthRange:[17,21], movetimeRange:[1600,3000], multipvRange:[4,3],   overlayMaxD:[6,8],   overlayTimeBudgetRange:[1000,2500], fuel: true  },
  master:       { skillRange:[20,20], depthRange:[22,24], movetimeRange:[3200,4000], multipvRange:[5,5],   overlayMaxD:[8,8],   overlayTimeBudgetRange:[2600,3500], fuel: true  },
};

/** Linear interpolation, integer-rounded. `t` is 0..1 across the 5 sub-levels of one tier. */
const lerp = (a: number, b: number, t: number): number => Math.round(a + (b - a) * t);

const botConfig = (d: BotDifficulty): DifficultyConfig => {
  const t = (subLevelOf(d) - 1) / 4;
  const spec = TIER_SPECS[tierOf(d)];
  return {
    skill:    lerp(spec.skillRange[0],    spec.skillRange[1],    t),
    depth:    lerp(spec.depthRange[0],    spec.depthRange[1],    t),
    movetime: lerp(spec.movetimeRange[0], spec.movetimeRange[1], t),
    multipv:  lerp(spec.multipvRange[0],  spec.multipvRange[1],  t),
  };
};

// Charge-aware search overlay budget per level. Runs AFTER the native engine and only OVERRIDES
// its pick when a strictly better move exists under the real depletion rules. maxDepth scales 0→8
// across all 25 levels; timeBudgetMs bounds the synchronous main-thread search.
const overlayBudget = (d: BotDifficulty): SearchOptions => {
  const t = (subLevelOf(d) - 1) / 4;
  const spec = TIER_SPECS[tierOf(d)];
  return {
    maxDepth:     lerp(spec.overlayMaxD[0],            spec.overlayMaxD[1],            t),
    timeBudgetMs: lerp(spec.overlayTimeBudgetRange[0], spec.overlayTimeBudgetRange[1], t),
  };
};

/** True if this level sends per-piece charge state (fuel) to the engine. */
const isFuelEnabled = (d: BotDifficulty): boolean => TIER_SPECS[tierOf(d)].fuel;


// The native engine boots lazily on its FIRST op (ensureReady → NativeEngine.start), and that
// boot path has no internal timeout — if it stalls (seen when the bot must move FIRST, right at
// game load, before the bridge is warm), an unbounded await hangs the bot "thinking forever".
// These ceilings bound both engine awaits so a stall degrades to a heuristic move, not a freeze.
// They sit ABOVE the engine's own internal handshake/search waits so a merely-slow boot still wins.
const ENGINE_READY_TIMEOUT_MS = 12_000;
const ENGINE_EVAL_TIMEOUT_MS = 25_000;

/** Resolve with `fallback` if `promise` neither settles within `ms`; a rejection also yields
 *  `fallback`. This is the safety net that makes an unresponsive engine non-fatal to the bot. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (v: T) => { if (!settled) { settled = true; resolve(v); } };
    const timer = setTimeout(() => finish(fallback), ms);
    promise.then(
      (v) => { clearTimeout(timer); finish(v); },
      () => { clearTimeout(timer); finish(fallback); },
    );
  });
}

/** Ask the engine, return the best move that is legal under our rules, or null. */
async function getEngineMove(
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  difficulty: BotDifficulty,
  overrides?: BotOverrides,
): Promise<BotMove | null> {
  const legal = withoutOverrides(board, getAllLegalMoves(board, color, enPassantTarget));
  const legalSet = new Set<string>();
  for (const [from, tos] of legal) for (const to of tos) legalSet.add(`${from}${to}`);
  if (legalSet.size === 0) return null;

  if (!(await withTimeout(isEngineReady(), ENGINE_READY_TIMEOUT_MS, false))) {
    console.warn('[Bot] engine not ready (or timed out) — using heuristic fallback');
    return null;
  }

  try {
    // Fuel-aware path: advanced/expert/master (L11-L25) send per-piece charge state to the
    // fuel-modified FSF via the UCI `fuel` command — no more treating O=1 and O=8 as identical.
    // Falls through to single-shot → heuristic if this path fails.
    if (isFuelEnabled(difficulty) && !overrides) {
      try {
        const fen = boardToFen(board, color, enPassantTarget);
        const fuel = boardToFuelString(board);
        const fuelMoves = await withTimeout(
          evaluatePosition(fen, { ...botConfig(difficulty), fuel }),
          ENGINE_EVAL_TIMEOUT_MS,
          [],
        );
        for (const em of fuelMoves) {
          const { from, to } = parseUciMove(em.move);
          if (legalSet.has(`${from}${to}`)) {
            const pick = { from, to };
            return markSource(pick, preferForcingWin(board, color, enPassantTarget, pick, overlayBudget(difficulty)));
          }
        }
        console.warn('[Bot] fuel-FSF returned no legal move — falling back');
      } catch (err) {
        console.warn('[Bot] fuel-FSF failed — falling back:', err);
      }
    }
    const fen = boardToFen(board, color, enPassantTarget);
    // `engineNodes` (benchmark only) makes the engine search a FIXED node count (`go nodes N`),
    // independent of CPU speed/thermal; undefined in normal play, leaving depth/movetime as-is.
    const engineCfg = { ...botConfig(difficulty), nodes: overrides?.engineNodes };
    const moves = await withTimeout(evaluatePosition(fen, engineCfg), ENGINE_EVAL_TIMEOUT_MS, []);
    // Engine candidates that are legal under our charge rules, in engine-ranked order.
    const candidates: BotMove[] = [];
    for (const em of moves) {
      const { from, to } = parseUciMove(em.move);
      if (legalSet.has(`${from}${to}`)) candidates.push({ from, to });
    }
    if (candidates.length === 0) {
      console.warn('[Bot] no engine move was legal under charge rules — fallback');
      return null;
    }
    // Bug 6 Stage A — when the bot is riding its OWN Piloted Anomaly royal, the native engine is
    // depletion-blind on that royal (it cannot see charges tick toward 0/0/0 Gridlock Death), and
    // the easy tiers run maxDepth 0 so the charge-aware search is normally OFF. Force it on with a
    // small budget whenever self-piloted, on every tier: the search's color-agnostic
    // `terminalChildScore` refuses the final self-Gridlock-Death step (the cliff) and its
    // ROYAL_RESERVE term rewards keeping charges in the tank (the slow squeeze). `overrideMargin: 0`
    // is the second half of the fix: the default 150cp gate would swallow the ~8cp-per-charge
    // reserve signal, leaving conservation inert; but the engine is DEFINITIONALLY blind to the
    // royal's charge economy when self-piloted, so the depletion-aware search is authoritative here
    // — any move it ranks at least as high (including a conserving one) is played. When not
    // self-piloted, the effective budget is exactly the tier's own — all existing behavior unchanged.
    const selfPiloted = hasPilotedKing(board, color);
    const tierBudget: SearchOptions =
      overrides?.searchMaxDepth !== undefined
        ? { ...overlayBudget(difficulty), maxDepth: overrides.searchMaxDepth }
        : overlayBudget(difficulty);
    const budget: SearchOptions = selfPiloted
      ? {
          maxDepth: Math.max(tierBudget.maxDepth, 3),
          timeBudgetMs: tierBudget.timeBudgetMs ?? 400,
          overrideMargin: 0,
        }
      : tierBudget;
    // When the opponent is riding a Piloted Anomaly, the engine's evaluation of that king's
    // depletion trajectory is wrong (it cannot model charges ticking down). Re-rank candidates
    // with our accurate model so the bot actually lands real checks/mates instead of phantom
    // ones against a king that may outlive the engine's expectations.
    if (hasPilotedKing(board, opponentOf(color))) {
      let best = candidates[0]!;
      let bestScore = scoreVsPilotedKing(board, color, best, enPassantTarget);
      for (let i = 1; i < candidates.length; i++) {
        const s = scoreVsPilotedKing(board, color, candidates[i]!, enPassantTarget);
        if (s > bestScore) { bestScore = s; best = candidates[i]!; }
      }
      // If EVERY engine candidate loses material into the piloted royal (negative score),
      // the shortlist is poisoned — the engine misjudged the royal's real reach. Widen the
      // search to the whole legal move set and take the safest move instead of the least-bad
      // sacrifice. Only runs in this rare piloted-king-and-all-candidates-hang case.
      if (bestScore < 0) {
        for (const mv of flatten(legal)) {
          const s = scoreVsPilotedKing(board, color, mv, enPassantTarget);
          if (s > bestScore) { bestScore = s; best = mv; }
        }
      }
      // BOTH royals piloted (Bug 6, root cause #3): the offensive pick above optimizes attack
      // with zero regard for OUR royal's depletion, and this branch would otherwise `return`
      // before the search ever runs. Route the offensive pick through the (force-enabled) search
      // so it still refuses a self-Gridlock-Death. When only the OPPONENT is piloted, keep the
      // pure offensive pick unchanged (self royal is a plain King — nothing to conserve).
      if (selfPiloted) return markSource(best, preferSearchMove(board, color, enPassantTarget, best, budget));
      // Generic-path forcing-win override for master_5 (BotDepletionAwareness.md §12 #1): when ONLY
      // the opponent is piloted, give master_5 a FORCING-ONLY override so the charge-aware search
      // can plan a multi-move mate / Gridlock-Death squeeze that the 1-ply `scoreVsPilotedKing` cannot.
      // NOTE: fuel-aware levels (L11-L25, advanced+) already get preferForcingWin through the fuel
      // path above and typically never reach this point. This fallback fires only if
      // the fuel path failed for master_5 AND the opponent is piloted — a rare edge case.
      if (difficulty === 'master_5') return markSource(best, preferForcingWin(board, color, enPassantTarget, best, budget));
      return best;
    }
    // Conservative fizzle guard (non-piloted case). The engine judges an anomaly by its
    // CURRENT shape and cannot see that moving it spends a charge and may drop a vector — so a
    // move it valued as a CHECK can arrive FIZZLED (the police-car case: it spends its last
    // orthogonal charge and stops checking along the file the instant it lands). We act ONLY on
    // that proven, depletion-specific defect: if the top candidate checks on the stale
    // (non-depleting) board but NOT on the real depleted board, prefer the highest-ranked
    // candidate that genuinely checks on the real board. If none does, keep the engine's pick —
    // we never override without a concrete, strictly-better replacement, so normal play (where
    // the engine is far stronger than this heuristic) is left untouched.
    const opp = opponentOf(color);
    const top = candidates[0]!;
    const staleCheck = (mv: BotMove) => isInCheck(applyMove(board, mv.from, mv.to), opp);
    const realCheck = (mv: BotMove) => isInCheck(applyReal(board, color, mv, enPassantTarget), opp);
    let choice = top;
    if (staleCheck(top) && !realCheck(top)) {
      const genuine = candidates.find((mv) => realCheck(mv));
      if (genuine) choice = genuine;
    }
    // Stage 2: give the engine's pick one accurate, multi-ply sanity check. preferSearchMove
    // runs the charge-aware search (which steps through the real depleting kernel) and only
    // swaps in its move when that move is materially better than `choice` under the true rules —
    // otherwise the engine's (positionally stronger) pick stands. Off for easy tiers UNLESS the
    // bot is self-piloted, in which case `budget` force-enables it (Bug 6 Stage A) so the search
    // guards our own royal against Gridlock Death on every tier.
    return markSource(choice, preferSearchMove(board, color, enPassantTarget, choice, budget));
  } catch (err) {
    console.error('[Bot] engine error — fallback:', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic fallback
// ─────────────────────────────────────────────────────────────────────────────

const isCapture = (board: Board, color: PieceColor, m: BotMove, enPassantTarget?: Square): boolean => {
  const t = board[m.to];
  if (t && t.color !== color) return true;
  // En passant: a pawn moving onto the (empty) en-passant target square captures the
  // pawn beside it. The destination is empty, so the plain occupancy check above misses it.
  const mover = board[m.from];
  return mover?.type === 'pawn' && enPassantTarget !== undefined && m.to === enPassantTarget;
};
/** Charge-aware (Stage 1): judges the check on the REAL post-move board, so a check a piece
 *  cancels by spending its last charge (the police-car fizzle) is correctly reported false.
 *  Exported for regression testing. */
export const givesCheck = (board: Board, color: PieceColor, m: BotMove, enPassantTarget?: Square): boolean =>
  isInCheck(applyReal(board, color, m, enPassantTarget), opponentOf(color));
const isSafe = (board: Board, color: PieceColor, m: BotMove, enPassantTarget?: Square): boolean =>
  !isSquareAttacked(applyReal(board, color, m, enPassantTarget), m.to, opponentOf(color));
/** True if an (unsafe) capture at least trades evenly by material — used so the heuristic
 *  takes a losing-square capture only when it actually wins material, instead of feeding
 *  pieces (most punishingly, into a Piloted Anomaly king that simply recaptures). */
const capturesMaterial = (board: Board, m: BotMove): boolean =>
  pieceCaptureValue(board[m.to]) >= pieceCaptureValue(board[m.from]);

function heuristicMove(
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  difficulty: BotDifficulty,
): BotMove | null {
  const moves = flatten(withoutOverrides(board, getAllLegalMoves(board, color, enPassantTarget)));
  if (moves.length === 0) return null;
  // Bug 6 Stage A — if the bot is riding its own Piloted Anomaly royal, drop any move that spends
  // the royal's last charge (self-Gridlock-Death = instant loss) before every tier's selection,
  // including `basic_1`'s pickRandom. Inert for a plain King (gridlockDeath is only ever set on a
  // piloted-royal move), so non-piloted play — determinism and tier-gating — is untouched. If
  // EVERY move self-kills (a truly lost position), keep them all rather than return null.
  let pool = moves;
  if (hasPilotedKing(board, color)) {
    const survivable = moves.filter((m) => !selfGridlockDeath(board, color, m, enPassantTarget));
    if (survivable.length) pool = survivable;
  }
  const idx = levelIndex(difficulty);
  if (idx === 0) return pickRandom(pool);

  const captures = pool.filter((m) => isCapture(board, color, m, enPassantTarget));
  const checks = pool.filter((m) => givesCheck(board, color, m, enPassantTarget));

  if (idx <= 3) {
    // Prefer safe captures (basic_2..basic_4); take an unsafe capture only when it wins material
    // (never feed a Piloted Anomaly king a piece just to grab a pawn). Then safe checks, then safe.
    const safeCaptures = captures.filter((m) => isSafe(board, color, m, enPassantTarget));
    if (safeCaptures.length) return pickRandom(safeCaptures);
    const winningCaptures = captures.filter((m) => capturesMaterial(board, m));
    if (winningCaptures.length) return pickRandom(winningCaptures);
    const safeChecks = checks.filter((m) => isSafe(board, color, m, enPassantTarget)); // don't feed a piloted king
    if (safeChecks.length) return pickRandom(safeChecks);
    const safe = pool.filter((m) => isSafe(board, color, m, enPassantTarget));
    if (safe.length) return pickRandom(safe);
    return pickRandom(pool);
  }

  // hard
  const safeCaptures = captures.filter((m) => isSafe(board, color, m, enPassantTarget));
  if (safeCaptures.length) return pickRandom(safeCaptures);
  // Only take an unsafe capture if it wins material — otherwise it's feeding the enemy
  // (most punishingly, a Piloted Anomaly king that just recaptures the hung piece).
  const winningCaptures = captures.filter((m) => capturesMaterial(board, m));
  if (winningCaptures.length) return pickRandom(winningCaptures);
  const safeChecks = checks.filter((m) => isSafe(board, color, m, enPassantTarget));
  if (safeChecks.length) return pickRandom(safeChecks);
  const safe = pool.filter((m) => isSafe(board, color, m, enPassantTarget));
  if (safe.length) return pickRandom(safe);
  return pickRandom(pool);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/** Choose a move (engine first, heuristic fallback, forced-Override last resort). null = no
 *  legal moves at all. */
export const chooseBotMove = async (
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  difficulty: BotDifficulty,
  botOverrides?: BotOverrides,
): Promise<BotMove | null> => {
  const engineMove = await getEngineMove(board, color, enPassantTarget, difficulty, botOverrides);
  if (engineMove) return engineMove;
  const heuristic = heuristicMove(board, color, enPassantTarget, difficulty);
  if (heuristic) return heuristic;

  // Forced-Override fallback (Bug 4 — see docs/dev/BotDepletionAwareness.md §6). Both paths
  // above strip Override via `withoutOverrides` to honour the bot's "never board" policy, so
  // when a human traps the King such that an Override is its ONLY legal move, both return null.
  // The rules layer still counts that Override as a legal escape (`getKingMoves` emits it,
  // `isCheckmate` is false, status stays 'playing'), so returning null here would hang the game
  // forever. Last resort: if any legal Override exists, board — but board the BEST host, not a
  // random one (Bug 5, §7): `chooseOverrideHost` ranks hosts by king-safety (coverage ▸ runway ▸
  // safeMobility) so the bot never coin-flips a rich host against a near-depleted one. Every
  // Override in `getAllLegalMoves` is already check-safe (it passed the `wouldBeInCheck` filter)
  // and can never self-Gridlock-Death (`getKingMoves` offers only non-gridlocked hosts; `move.ts`
  // returns `gridlockDeath: false` for the Override branch), so a forced board is always safe
  // and strictly beats a softlock. A genuine zero-legal-move position is already resolved to
  // checkmate/stalemate upstream and never reaches the bot, so `null` here is correct.
  const overrides = legalOverrides(board, getAllLegalMoves(board, color, enPassantTarget));
  if (overrides.length) return chooseOverrideHost(board, color, enPassantTarget, overrides);
  return null;
};
