// lib/chess/search.ts — charge-aware negamax search for Gridlock Chess.
//
// WHY THIS EXISTS (Stage 2 of the depletion-awareness work — see
// docs/dev/BotDepletionAwareness.md):
//   Fairy-Stockfish plans on a FEN snapshot in which every Anomaly is a FIXED piece. But a
//   Gridlock Anomaly SPENDS a charge every move and CHANGES TYPE (or dies) as it depletes.
//   So the engine's deep line is fiction for this game — the deeper it searches, the more it
//   reuses charges that would have run out. For an Anomaly, only ~1 ply is trustworthy.
//
//   This module is the fix: a shallow-but-TRUE search. Every node steps through the same
//   authoritative kernel the UI uses (applyMoveToBoard in move.ts), so depletion, type-change,
//   gridlock, en-passant, and Gridlock Death are all EXACT at every ply. A true depth-6 beats a
//   fictional depth-20 for depletion tactics.
//
// ARCHITECTURE (matches the "engine as advisor, TS rules as law" pattern used elsewhere):
//   • move.ts applyMoveToBoard = the LAW (produces every child position).
//   • This search = accurate multi-ply judgment on top of that law.
//   • The native engine remains the advisor; preferSearchMove() only overrides its pick when
//     this search proves a materially better move, so quiet/positional play is left to the
//     stronger engine.
//
// SCOPE / HONEST LIMITS:
//   • Realistic depth in JS is ~6-8 ply (branching ~40-60). Time-boxed via iterative deepening.
//   • The evaluation is material-by-charges + a light check term. It is deliberately simple —
//     it exists to find concrete tactics the engine cannot see, not to be a positional oracle.
//   • Overrides (King boarding an Anomaly) are excluded from the tree for BOTH sides, matching
//     the bot's standing "never board, and don't speculate the human will" policy.

import type { Board, Square, PieceColor, Piece, Anomaly, OmniAnomaly, Pawn } from '@/types/game';
import { FILES, RANKS } from '@/types/game';
import { getAllLegalMoves, isInCheck, findKing } from './check';
import { applyMoveToBoard } from './move';
import type { BotMove } from './bot';

export interface SearchOptions {
  /** Maximum search depth in plies. `<= 0` disables the search (callers treat it as "off"). */
  maxDepth: number;
  /** Optional wall-clock budget for iterative deepening; the search returns the last completed
   *  depth's best move when exceeded. Omit for an uncapped fixed-depth search (tests). */
  timeBudgetMs?: number;
  /** Optional override for how much better (centipawns) the search's move must be than the
   *  engine's pick before `preferSearchMove` swaps it in. Defaults to `OVERRIDE_MARGIN` (150),
   *  which protects the engine's stronger positional play in quiet positions. Callers set this to
   *  `0` when the engine is *definitionally* blind to what the search measures — specifically a
   *  self-piloted royal's charge economy (Bug 6): there the depletion-aware search is authoritative,
   *  so any move it ranks at least as high (including a charge-conserving one) should be played. */
  overrideMargin?: number;
}

export interface SearchResult {
  /** Best move found, or null when the side to move has no legal moves. */
  move: BotMove | null;
  /** Score from the moving side's perspective (positive = good for the mover). */
  score: number;
  /** Deepest ply fully completed. */
  depth: number;
  /** Nodes visited (diagnostics). */
  nodes: number;
}

const MATE = 1_000_000;
/** A move must beat the engine's pick by at least this (≈1.5 pawns) to override it. */
const OVERRIDE_MARGIN = 150;
/** Cap on the quiescence CHECK-EXTENSION — how many extra forcing plies quiescence may follow
 *  AFTER the main search hits depth 0. This is NOT a main-search depth and is unrelated to:
 *    • SearchOptions.maxDepth (this TS search's main depth, currently ≤ 8), and
 *    • bot.ts DIFFICULTY_CONFIG.depth (the native Fairy-Stockfish engine's depth, up to 24).
 *  Quiescence only follows captures (self-terminating: each removes a piece) and check-evasions
 *  (NOT self-terminating: a perpetual/repeated-check line never reduces material, so without a
 *  cap it recurses until stack overflow when no time budget is set). 12 is a safety bound, not
 *  a tuned optimum — capture chains never reach it, and 12 forcing plies (6 full moves) is more
 *  than any realistic check sequence needs to resolve. At the cap we return a static eval. */
const QUIESCE_CHECK_EXTENSION_CAP = 12;

const PAWN_VALUE = 100;
const ANOMALY_BASE = 100;
const CHARGE_VALUE = 55;
/** Bug 6 Stage B — a *piloted* royal is worth 0 material (its loss is a terminal, not a capture),
 *  so the base material eval is blind to a slow squeeze of its charges toward 0/0/0 Gridlock
 *  Death. This light per-charge weight lets the search prefer *conserving* its own royal's
 *  charges (and spending the enemy royal's). Kept far below CHARGE_VALUE (a real fighter's charge)
 *  so it never distorts material trades — it only breaks ties between otherwise-equal quiet
 *  lines, exactly the "royal charge reserve is unvalued" seam flagged in §5 of the design doc. */
const ROYAL_RESERVE_VALUE = 8;

const opponentOf = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');
const moveKey = (m: BotMove): string => `${m.from}${m.to}`;

// ── Charge-aware position key (transposition table) ─────────────────────────────────
// Two boards with identical piece PLACEMENT but different charge pools / piloted flags / EP rights
// are DIFFERENT positions for this search (depletion changes both legal moves and eval), so the key
// folds all of that in. Squares are visited in a FIXED order so the key is independent of the
// Record's insertion order (which varies with move order) — required for real transposition hits.
// NOTE (Phase 0 prototype — DeepDepletionEnginePlan.md): this rebuilds the full key per node, not an
// incremental Zobrist. It is correct-but-not-fast; if the A/B proves the deep search pays, Phase 1
// swaps in incremental hashing. Exported for the TT differential test.
const ALL_SQUARES: Square[] = (() => {
  const out: Square[] = [];
  for (const r of RANKS) for (const f of FILES) out.push(`${f}${r}` as Square);
  return out;
})();

const pieceCode = (p: Piece): string => {
  const c = p.color === 'white' ? 'W' : 'b';
  if (p.type === 'king') return `${c}K`;
  if (p.type === 'pawn') return `${c}P${(p as Pawn).hasMoved ? '1' : '0'}`;
  const a = p as Anomaly | OmniAnomaly;
  const pil = (a as Anomaly).piloted ? '*' : '';
  const v = a.vectors;
  const vs = 'shared' in v ? `s${v.shared}` : `${v.L}.${v.O}.${v.D}`;
  return `${c}A${pil}${vs}`;
};

/** Deterministic, charge-aware position identity for the transposition table. */
export const positionKey = (board: Board, color: PieceColor, ep?: Square): string => {
  let key = `${color === 'white' ? 'w' : 'b'}:${ep ?? '-'}`;
  for (const sq of ALL_SQUARES) {
    const p = board[sq];
    if (p) key += `|${sq}${pieceCode(p)}`;
  }
  return key;
};

/** A piece is royal if it is the King or a Piloted Anomaly. Royals contribute 0 to material —
 *  their loss is a terminal (mate / king-capture), handled by the search, not the eval. */
const isRoyal = (p: Piece): boolean =>
  p.type === 'king' || (p.type === 'anomaly' && (p as Anomaly).piloted === true);

const chargeCount = (p: Anomaly | OmniAnomaly): number => {
  const v = p.vectors;
  return 'shared' in v ? v.shared : v.L + v.O + v.D;
};

/** Material worth for the leaf evaluation. Royals = 0 (terminal-handled); a depleted (0-charge)
 *  Anomaly is a dead blocker (0); otherwise value scales with SURVIVING charges — a spent piece
 *  is correctly worth less, which is the whole point of a depletion-aware engine. */
const pieceWorth = (p: Piece): number => {
  if (isRoyal(p)) return 0;
  if (p.type === 'pawn') return PAWN_VALUE;
  const charges = chargeCount(p as Anomaly | OmniAnomaly);
  return charges === 0 ? 0 : ANOMALY_BASE + CHARGE_VALUE * charges;
};

/** Ordering worth — like pieceWorth but ranks capturing an enemy royal highest (so the search
 *  tries king-captures first). Only affects move ordering, never the score. */
const orderWorth = (p: Piece): number => {
  if (p.type === 'king') return 10_000;
  if (p.type === 'anomaly' && (p as Anomaly).piloted) return 10_000;
  if (p.type === 'pawn') return PAWN_VALUE;
  const charges = chargeCount(p as Anomaly | OmniAnomaly);
  return charges === 0 ? 50 : ANOMALY_BASE + CHARGE_VALUE * charges;
};

const hasRoyal = (board: Board, color: PieceColor): boolean => findKing(board, color) !== null;

/** True if `m` is an Override (King stepping onto a friendly non-Omni Anomaly). */
const isOverride = (board: Board, m: BotMove): boolean => {
  const mover = board[m.from];
  const target = board[m.to];
  if (!mover || mover.type !== 'king') return false;
  if (!target || target.type !== 'anomaly' || target.color !== mover.color) return false;
  return target.archetype !== 'omni';
};

const legalMoves = (board: Board, color: PieceColor, ep?: Square): BotMove[] => {
  const out: BotMove[] = [];
  // The bot never boards its own royal (standing policy) — Overrides enter the tree ONLY for the
  // opponent side, and only when the flag is on (models a human choosing to board).
  const allowOverride = includeOppOverrides && color !== searchRootColor;
  for (const [from, tos] of getAllLegalMoves(board, color, ep)) {
    for (const to of tos) {
      const m = { from, to };
      if (allowOverride || !isOverride(board, m)) out.push(m);
    }
  }
  return out;
};

// ── Transposition table (Phase 0 — DeepDepletionEnginePlan.md) ─────────────────────────
type TTFlag = 0 | 1 | 2; // 0 = exact, 1 = lower bound (fail-high), 2 = upper bound (fail-low)
interface TTEntry { depth: number; flag: TTFlag; score: number; move: BotMove | null; }

// ── Per-search mutable state (single-threaded; reset at the top of every public entry) ────────
let nodes = 0;
let deadline = Infinity;
let history: Map<string, number> = new Map();
// Transposition table, keyed by the charge-aware `positionKey`; reset per public search.
let tt: Map<string, TTEntry> = new Map();
// Position keys currently on the search stack — a repeated key = a repetition draw (scored 0).
let pathKeys: Set<string> = new Set();
// Phase 0 flag: include the OPPONENT's Override moves in the tree (model a human boarding). The
// bot's OWN side never boards (standing policy), so overrides enter the tree only when the flag is
// on AND the side to move is the opponent. Default OFF — preserves current behavior; the A/B flips it.
let includeOppOverrides = false;
let searchRootColor: PieceColor = 'white';
/** Enable/disable modeling the opponent's Override moves inside the search (A/B seam). */
export const setSearchOverrides = (on: boolean): void => { includeOppOverrides = on; };
// Test seam: flip off to A/B TT correctness (same best move, fewer nodes). Always true in prod.
let ttEnabled = true;
/** Enable/disable the transposition table (used by the TT differential test). */
export const setTranspositionEnabled = (on: boolean): void => { ttEnabled = on; };

const timeUp = (): boolean => Date.now() >= deadline;

const orderMoves = (board: Board, moves: BotMove[]): BotMove[] =>
  moves
    .map((m) => {
      const mover = board[m.from]!;
      const target = board[m.to];
      let s = history.get(moveKey(m)) ?? 0;
      if (target && target.color !== mover.color) {
        s += 100_000 + 10 * orderWorth(target) - orderWorth(mover); // MVV-LVA
      }
      return { m, s };
    })
    .sort((a, b) => b.s - a.s)
    .map((x) => x.m);

const captureMoves = (board: Board, color: PieceColor, ep?: Square): BotMove[] =>
  legalMoves(board, color, ep).filter((m) => {
    const t = board[m.to];
    if (t && t.color !== color) return true;
    const mover = board[m.from];
    return mover?.type === 'pawn' && ep !== undefined && m.to === ep; // en-passant
  });

/** Leaf evaluation from `color`'s perspective (positive = good for `color`). */
const evaluate = (board: Board, color: PieceColor): number => {
  let score = 0;
  for (const sq of Object.keys(board) as Square[]) {
    const p = board[sq];
    if (!p) continue;
    const w = pieceWorth(p);
    score += p.color === color ? w : -w;
    // Bug 6 Stage B: reward a surviving PILOTED royal's charge reserve (pieceWorth gave it 0), so
    // the search conserves its own royal and drains the enemy's rather than ignoring both.
    if (p.type === 'anomaly' && (p as Anomaly).piloted === true) {
      const reserve = chargeCount(p as Anomaly) * ROYAL_RESERVE_VALUE;
      score += p.color === color ? reserve : -reserve;
    }
  }
  if (isInCheck(board, color)) score -= 25;
  if (isInCheck(board, opponentOf(color))) score += 25;
  return score;
};

/** Score a child produced by `color` playing one move. Centralizes the two terminal shortcuts
 *  (self Gridlock Death = instant loss; capturing the enemy royal = instant win) so negamax and
 *  quiescence agree. Returns null when the move needs ordinary recursion. */
const terminalChildScore = (
  res: ReturnType<typeof applyMoveToBoard>,
  color: PieceColor,
  ply: number,
): number | null => {
  if (!res.valid) return -(MATE - ply); // unreachable for legal moves; keep total
  if (res.gridlockDeath) return -(MATE - ply); // the mover just spent its royal's last charge
  if (!hasRoyal(res.board, opponentOf(color))) return MATE - ply; // captured the enemy royal
  return null;
};

/** Quiescence: extend the search through forcing captures so the leaf isn't evaluated in the
 *  middle of a trade. Under check we cannot stand pat, so we search every evasion instead.
 *  `qRemaining` caps check-extension depth so a perpetual-check line cannot recurse forever. */
const quiesce = (
  board: Board,
  color: PieceColor,
  alpha: number,
  beta: number,
  ep: Square | undefined,
  ply: number,
  qRemaining: number,
): number => {
  nodes++;
  const inCheck = isInCheck(board, color);

  // Depth cap reached: return a bounded static estimate rather than recurse further.
  if (qRemaining <= 0) return evaluate(board, color);

  if (!inCheck) {
    const standPat = evaluate(board, color);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
  }

  const moves = inCheck ? legalMoves(board, color, ep) : captureMoves(board, color, ep);
  if (inCheck && moves.length === 0) return -(MATE - ply); // checkmate
  const ordered = orderMoves(board, moves);

  for (const m of ordered) {
    const res = applyMoveToBoard(board, m.from, m.to, color, ep ?? null);
    const terminal = terminalChildScore(res, color, ply);
    let score: number;
    if (terminal !== null) {
      score = terminal;
    } else {
      const child = res as Extract<typeof res, { valid: true }>;
      score = -quiesce(child.board, opponentOf(color), -beta, -alpha, child.nextEnPassant ?? undefined, ply + 1, qRemaining - 1);
    }
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
    if (timeUp()) break;
  }
  return alpha;
};

const negamax = (
  board: Board,
  color: PieceColor,
  depth: number,
  alpha: number,
  beta: number,
  ep: Square | undefined,
  ply: number,
): number => {
  nodes++;
  const key = positionKey(board, color, ep);              // always: repetition + TT both need it
  if (pathKeys.has(key)) return 0;                        // repetition on the search path → draw
  const alphaOrig = alpha;
  const ttEntry = ttEnabled ? tt.get(key) : undefined;
  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === 0) return ttEntry.score;                           // exact
    if (ttEntry.flag === 1 && ttEntry.score >= beta) return ttEntry.score;   // lower bound ≥ β
    if (ttEntry.flag === 2 && ttEntry.score <= alpha) return ttEntry.score;  // upper bound ≤ α
  }
  const moves = legalMoves(board, color, ep);
  if (moves.length === 0) return isInCheck(board, color) ? -(MATE - ply) : 0; // mate or stalemate
  if (depth === 0) return quiesce(board, color, alpha, beta, ep, ply, QUIESCE_CHECK_EXTENSION_CAP);

  let ordered = orderMoves(board, moves);
  const ttMove = ttEntry?.move;                 // search the cached best move first
  if (ttMove) {
    const mk = moveKey(ttMove);
    ordered = [ttMove, ...ordered.filter((m) => moveKey(m) !== mk)];
  }
  pathKeys.add(key);                            // mark this position on the current path
  let best = -Infinity;
  let bestMove: BotMove | null = null;
  for (const m of ordered) {
    const res = applyMoveToBoard(board, m.from, m.to, color, ep ?? null);
    const terminal = terminalChildScore(res, color, ply);
    let score: number;
    if (terminal !== null) {
      score = terminal;
    } else {
      const child = res as Extract<typeof res, { valid: true }>;
      score = -negamax(child.board, opponentOf(color), depth - 1, -beta, -alpha, child.nextEnPassant ?? undefined, ply + 1);
    }
    if (score > best) { best = score; bestMove = m; }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      history.set(moveKey(m), (history.get(moveKey(m)) ?? 0) + depth * depth); // history heuristic
      break;
    }
    if (timeUp()) break;
  }
  pathKeys.delete(key);                         // pop before returning
  // Store — but NOT mate/terminal scores (ply-relative; caching at one ply and reusing at another
  // corrupts mate distance), and not on a time-cut (incomplete `best`). NOTE (Phase 0): a subtree
  // score contaminated by a repetition-draw can still be cached (graph-history interaction) —
  // tolerated for the prototype.
  if (ttEnabled && Math.abs(best) < MATE - 1000 && !timeUp()) {
    const flag: TTFlag = best <= alphaOrig ? 2 : best >= beta ? 1 : 0;         // upper : lower : exact
    tt.set(key, { depth, flag, score: best, move: bestMove });
  }
  return best;
};

const resetSearchState = (timeBudgetMs?: number): void => {
  nodes = 0;
  history = new Map();
  tt = new Map();
  pathKeys = new Set();
  deadline = timeBudgetMs !== undefined ? Date.now() + timeBudgetMs : Infinity;
};

/** Score a single root move for `color` at a GIVEN depth (used to compare the engine's pick
 *  against the search's best under identical conditions). `depth` is the total ply depth to
 *  match — pass the search's actually-completed depth so the two scores are comparable. */
const scoreRootMove = (
  board: Board,
  color: PieceColor,
  move: BotMove,
  ep: Square | undefined,
  depth: number,
  timeBudgetMs?: number,
): number => {
  resetSearchState(timeBudgetMs);
  searchRootColor = color;
  const res = applyMoveToBoard(board, move.from, move.to, color, ep ?? null);
  const terminal = terminalChildScore(res, color, 0);
  if (terminal !== null) return terminal;
  const child = res as Extract<typeof res, { valid: true }>;
  return -negamax(child.board, opponentOf(color), Math.max(0, depth - 1), -Infinity, Infinity, child.nextEnPassant ?? undefined, 1);
};

/**
 * Charge-aware best-move search with iterative deepening. Deterministic (no randomness).
 * Returns the best move for `color`, or `{ move: null }` when there are no legal moves.
 */
export const searchBestMove = (
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  opts: SearchOptions,
): SearchResult => {
  resetSearchState(opts.timeBudgetMs);
  searchRootColor = color;
  pathKeys.add(positionKey(board, color, enPassantTarget)); // root sits on every path (repetition)
  const rootMoves = legalMoves(board, color, enPassantTarget);
  if (rootMoves.length === 0) {
    return { move: null, score: isInCheck(board, color) ? -MATE : 0, depth: 0, nodes };
  }

  let bestMove: BotMove = rootMoves[0]!;
  let bestScore = -Infinity;
  let completedDepth = 0;

  for (let d = 1; d <= opts.maxDepth; d++) {
    // Search the previous iteration's best move first (principal-variation ordering).
    const ordered = orderMoves(board, rootMoves);
    const pvFirst = [bestMove, ...ordered.filter((m) => moveKey(m) !== moveKey(bestMove))];

    let localBest: BotMove | null = null;
    let localScore = -Infinity;
    let alpha = -Infinity;
    let aborted = false;

    for (const m of pvFirst) {
      const res = applyMoveToBoard(board, m.from, m.to, color, enPassantTarget ?? null);
      const terminal = terminalChildScore(res, color, 0);
      let score: number;
      if (terminal !== null) {
        score = terminal;
      } else {
        const child = res as Extract<typeof res, { valid: true }>;
        score = -negamax(child.board, opponentOf(color), d - 1, -Infinity, -alpha, child.nextEnPassant ?? undefined, 1);
      }
      if (d > 1 && timeUp()) { aborted = true; break; }
      if (score > localScore) { localScore = score; localBest = m; }
      if (localScore > alpha) alpha = localScore;
    }

    if (localBest && !aborted) {
      bestMove = localBest;
      bestScore = localScore;
      completedDepth = d;
    }
    if (aborted) break;
    if (Math.abs(bestScore) >= MATE - 1000) break; // forced mate found — no deeper search needed
    if (timeUp()) break;
  }

  return { move: bestMove, score: bestScore, depth: completedDepth, nodes };
};

/**
 * Non-destructive tactical override. Returns the charge-aware search's move ONLY when it is
 * clearly better (by ≥ the effective margin) than the engine's pick; otherwise returns the
 * engine's pick unchanged. The margin is `opts.overrideMargin ?? OVERRIDE_MARGIN` (150 by
 * default). `maxDepth <= 0` disables the search entirely (the engine decides). This is how the
 * accurate-but-shallow search corrects the engine's depletion blindness without weakening the
 * engine's stronger positional play in quiet positions. Callers pass `overrideMargin: 0` when the
 * engine cannot possibly judge what the search measures (a self-piloted royal's charge economy),
 * making the depletion-aware search authoritative in that state.
 */
export const preferSearchMove = (
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  enginePick: BotMove,
  opts: SearchOptions,
): BotMove => {
  if (opts.maxDepth <= 0) return enginePick;
  const res = searchBestMove(board, color, enPassantTarget, opts);
  if (!res.move || moveKey(res.move) === moveKey(enginePick)) return enginePick;
  // Score the engine's pick at the SAME depth the search actually completed, so the comparison
  // is apples-to-apples even when a time budget cut the search short of opts.maxDepth.
  const engineScore = scoreRootMove(board, color, enginePick, enPassantTarget, res.depth, opts.timeBudgetMs);
  const margin = opts.overrideMargin ?? OVERRIDE_MARGIN;
  return res.score - engineScore >= margin ? res.move : enginePick;
};

/**
 * Forcing-only override. Like `preferSearchMove`, but swaps in the search's move ONLY when that move
 * is a PROVEN forcing win — a mate or forced Gridlock-Death, i.e. `score >= MATE - 1000` (the same
 * mate-window `searchBestMove` uses to stop early) — and NEVER on a mere material margin.
 *
 * WHY (BotDepletionAwareness.md §12 #1 — the L9-only enemy-royal planner): the caller already has a
 * strong 1-ply offensive pick from `scoreVsPilotedKing` (which rewards a sticking check at `+1000`).
 * The search's `evaluate` rates a check at only `±25`, so a margin-based override (`preferSearchMove`)
 * could trade that sticking check for a `+margin` material grab — a regression. Forcing-only means the
 * search can ONLY *add* a multi-move mate / Gridlock-Death squeeze it can actually prove, and
 * otherwise leaves the offensive pick untouched. `maxDepth <= 0` disables it (returns `enginePick`).
 */
export const preferForcingWin = (
  board: Board,
  color: PieceColor,
  enPassantTarget: Square | undefined,
  enginePick: BotMove,
  opts: SearchOptions,
): BotMove => {
  if (opts.maxDepth <= 0) return enginePick;
  const res = searchBestMove(board, color, enPassantTarget, opts);
  if (!res.move || moveKey(res.move) === moveKey(enginePick)) return enginePick;
  return res.score >= MATE - 1000 ? res.move : enginePick;
};
