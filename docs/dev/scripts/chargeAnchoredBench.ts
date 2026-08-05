/// <reference types="node" />
// RETIRED 2026-07-26: chargeAnchoredSearch.ts was deleted when CAF was retired (FairyStockfishFuelMod.md Step 24).
// This script will not run. Kept as a historical record of the +338 ELO benchmark that proved charge awareness.
/**
 * docs/dev/scripts/chargeAnchoredBench.ts — Option B strength benchmark (BotPvDepletionAuditPlan §10.8 Step 14).
 *
 * Plays **Option B (charge-anchored, fuel-AWARE)** vs **plain Fairy-Stockfish (fuel-BLIND, one call
 * per move)** over N full games, colors swapped each game, and tallies win/draw/loss → ELO delta.
 * This is THE test of the core hypothesis: does draining charges between engine calls actually beat
 * the raw engine? If Option B does NOT clearly beat plain FSF here, it is not worth shipping.
 *
 * Reuses the SAME authoritative rules kernel + terminal detection as the app and the difficulty
 * harness (applyMoveToBoard / evaluateOutcome / repetitionKey) — faithful games, not a re-impl.
 *
 * ── Prerequisites ─── the engine proxy must be up:  npm run dev:server   (server.js on :3005)
 * ── Run ─────────────  npm run bench:optionb
 *                       GC_GAMES=50 GC_K=3 GC_D=3 npm run bench:optionb
 *
 * ── Env knobs ───────────────────────────────────────────────────────────────────────────────
 *   GC_GAMES         games (even → equal colors)               default 2  (smoke; use ≥100 for real)
 *   GC_K             MultiPV width per node                     default 3
 *   GC_D             search depth (plies)                       default 3
 *   GC_MOVETIME      internal-node engine movetime (ms)         default 250
 *   GC_LEAF_MOVETIME leaf-node engine movetime (ms)             default = GC_MOVETIME
 *   GC_ENGINE_DEPTH  per-call engine depth cap                  default 10
 *   GC_TIME_BUDGET   per-move wall-clock cap (ms, iter-deep)    default 60000
 *   GC_WEIGHT        hybrid charge-material weight (0 = raw)    default 12
 *   GC_HYBRID        1 = hybrid leaf eval on, 0 = raw FSF leaf  default 1
 *   GC_PLAIN_MOVETIME  plain-FSF opponent movetime (ms)         default 400
 *   GC_PLAIN_DEPTH     plain-FSF opponent depth                 default 16
 *   GC_OPPONENT      'plain' (fuel-blind FSF) | 'overlay'       default plain
 *                    'overlay' = the SHIPPED bot: chooseBotMove (FSF + charge-aware overlay)
 *   GC_OVERLAY_DIFFICULTY  tier for the overlay opponent        default grandmaster
 *   GC_MAX_PLIES     per-game safety cap                        default 200
 *   GC_PROGRESS      file to also flush each line to (live)     default unset
 */
import { generateInitialBoard } from '../../../src/lib/chess/generator';
import { applyMoveToBoard } from '../../../src/lib/chess/move';
import { evaluateOutcome } from '../../../src/lib/chess/outcome';
import { repetitionKey } from '../../../src/lib/chess/repetition';
import { isEngineReady, evaluatePosition, boardToFen } from '../../../src/lib/chess/engine';
import {
  chargeAnchoredSearch,
  filterLegalCandidates,
  makeChargeMaterialLeafEval,
  type AskEngine,
  type ChargeAnchoredOptions,
} from '../../../src/lib/chess/chargeAnchoredSearch';
import { chooseBotMove, type BotDifficulty } from '../../../src/lib/chess/bot';
import type { Board, PieceColor, Square, GameStatus } from '../../../src/types/game';
import { appendFileSync } from 'node:fs';

const PROGRESS_FILE = process.env.GC_PROGRESS;
function emit(line = ''): void {
  console.log(line);
  if (PROGRESS_FILE) { try { appendFileSync(PROGRESS_FILE, line + '\n'); } catch { /* best effort */ } }
}

const num = (k: string, d: number): number => (process.env[k] !== undefined ? Number(process.env[k]) : d);
const opp = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');
const VERBOSE = process.env.GC_VERBOSE === '1'; // per-move timing lines for Option B

const K = num('GC_K', 3) | 0;
const D = num('GC_D', 3) | 0;
const MOVETIME = num('GC_MOVETIME', 250) | 0;
const LEAF_MOVETIME = num('GC_LEAF_MOVETIME', MOVETIME) | 0;
const ENGINE_DEPTH = num('GC_ENGINE_DEPTH', 10) | 0;
const TIME_BUDGET = num('GC_TIME_BUDGET', 60000) | 0;
const WEIGHT = num('GC_WEIGHT', 12);
const HYBRID = num('GC_HYBRID', 1) !== 0;
const PLAIN_MOVETIME = num('GC_PLAIN_MOVETIME', 400) | 0;
const PLAIN_DEPTH = num('GC_PLAIN_DEPTH', 16) | 0;
const OPPONENT = (process.env.GC_OPPONENT ?? 'plain').toLowerCase(); // 'plain' | 'overlay'
const OVERLAY_DIFFICULTY = (process.env.GC_OVERLAY_DIFFICULTY ?? 'grandmaster') as BotDifficulty;

/** A move chooser: given a position, return the move to play (or null = no legal move). */
type ChooseMove = (board: Board, color: PieceColor, ep: Square | null) => Promise<{ from: Square; to: Square } | null>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Retry a flaky engine call. `server.js` auto-respawns a crashed worker, but the in-flight fetch
 *  gets `ECONNRESET`/`fetch failed`; without a retry that single blip aborts an entire long run. Up
 *  to `tries` attempts with a short backoff so a transient reset self-heals instead of killing hours
 *  of games. Re-throws only if EVERY attempt fails (a real, persistent engine outage). */
async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = 400 * (i + 1);
      emit(`  ⚠️  engine call failed (${label}, attempt ${i + 1}/${tries}) — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** The injected engine for Option B — wraps the real Fairy-Stockfish proxy (with crash-retry). */
const ask: AskEngine = (fen, k, movetimeMs) =>
  withRetry(() => evaluatePosition(fen, { multipv: k, movetime: movetimeMs, depth: ENGINE_DEPTH }), 'optionB');

const optionBOpts: ChargeAnchoredOptions = {
  k: K,
  depth: D,
  internalMovetimeMs: MOVETIME,
  leafMovetimeMs: LEAF_MOVETIME,
  timeBudgetMs: TIME_BUDGET,
  hybridLeafEval: HYBRID ? makeChargeMaterialLeafEval(WEIGHT) : undefined,
};

/** Bot A — Option B: charge-anchored search (fuel-aware). Tracks per-move wall time + engine calls
 *  so the harness can report Option B's true cost at full strength. */
let optBTotalMs = 0;
let optBMoves = 0;
let optBTotalCalls = 0;
const chooseOptionB: ChooseMove = async (board, color, ep) => {
  const t = Date.now();
  const res = await chargeAnchoredSearch(board, color, ep ?? undefined, ask, optionBOpts);
  const dt = Date.now() - t;
  optBTotalMs += dt;
  optBMoves += 1;
  optBTotalCalls += res.engineCalls;
  if (VERBOSE) emit(`    · A move ${optBMoves}: ${(dt / 1000).toFixed(1)}s, ${res.engineCalls} calls, depth ${res.depthReached}`);
  return res.move;
};

/** Bot B — plain Fairy-Stockfish (fuel-BLIND): one call, play its top charge-legal move, no overlay,
 *  no re-anchoring. This is the baseline Option B must beat. */
const choosePlainFSF: ChooseMove = async (board, color, ep) => {
  const raw = await withRetry(() => evaluatePosition(boardToFen(board, color, ep ?? null), {
    multipv: K,
    movetime: PLAIN_MOVETIME,
    depth: PLAIN_DEPTH,
  }), 'plainFSF');
  const cands = filterLegalCandidates(board, color, ep ?? undefined, raw, K);
  return cands.length ? { from: cands[0]!.from, to: cands[0]!.to } : null;
};

/** Bot B (overlay mode) — the SHIPPED production bot: FSF engine pick re-ranked by the charge-aware
 *  overlay (preferSearchMove / preferForcingWin / piloted-king correction). This is the real
 *  `chooseBotMove` used in-app at the chosen difficulty tier — the honest "is Option B better than
 *  what we already ship?" baseline. Its think-time comes from the tier's own DIFFICULTY_CONFIG. */
const chooseOverlayBot: ChooseMove = async (board, color, ep) =>
  chooseBotMove(board, color, ep ?? undefined, OVERLAY_DIFFICULTY);

interface Contestant { name: string; choose: ChooseMove }
type GameResult = 'white' | 'black' | 'draw';
interface GameReport { result: GameResult; plies: number; status: GameStatus }

/** Play one full game (mirrors the difficulty harness's tested terminal logic exactly). */
async function playGame(white: Contestant, black: Contestant, maxPlies: number): Promise<GameReport> {
  let board: Board = generateInitialBoard();
  let turn: PieceColor = 'white';
  let ep: Square | null = null;
  let positionCounts: Record<string, number> = {};
  let halfmoveClock = 0;

  for (let plies = 0; plies < maxPlies; plies++) {
    const c = turn === 'white' ? white : black;
    const move = await c.choose(board, turn, ep);
    if (!move) {
      const o = evaluateOutcome(board, turn, 'playing');
      if (o.status === 'checkmate') return { result: opp(turn), plies, status: 'checkmate' };
      return { result: 'draw', plies, status: o.status === 'playing' ? 'stalemate' : o.status };
    }

    const applied = applyMoveToBoard(board, move.from, move.to, turn, ep);
    if (!applied.valid) {
      throw new Error(`${c.name} proposed an illegal move ${move.from}${move.to} for ${turn} (${applied.error ?? 'no reason'})`);
    }
    board = applied.board;
    const nextTurn = opp(turn);
    ep = applied.nextEnPassant;

    let status: GameStatus;
    if (applied.isOverride) {
      positionCounts = { [repetitionKey(board, nextTurn, null)]: 1 };
      halfmoveClock = 0;
      status = evaluateOutcome(board, nextTurn, 'playing').status;
    } else {
      if (applied.irreversible) positionCounts = {};
      const posKey = repetitionKey(board, nextTurn, ep);
      const posCount = (positionCounts[posKey] ?? 0) + 1;
      positionCounts[posKey] = posCount;
      halfmoveClock = applied.irreversible ? 0 : halfmoveClock + 1;
      status = evaluateOutcome(board, nextTurn, 'playing', { posCount, halfmoveClock, gridlockDeath: applied.gridlockDeath }).status;
    }

    if (status === 'checkmate') return { result: turn, plies: plies + 1, status };
    if (status === 'gridlock-death') return { result: nextTurn, plies: plies + 1, status };
    if (status === 'stalemate' || status === 'draw') return { result: 'draw', plies: plies + 1, status };
    turn = nextTurn;
  }
  return { result: 'draw', plies: maxPlies, status: 'draw' };
}

function eloDelta(scoreA: number, games: number): number | null {
  const p = scoreA / games;
  if (p <= 0 || p >= 1) return null;
  return -400 * Math.log10(1 / p - 1);
}
function eloMargin(scoreA: number, games: number): number | null {
  const p = scoreA / games;
  if (p <= 0 || p >= 1) return null;
  const sePct = Math.sqrt((p * (1 - p)) / games);
  return 1.96 * sePct * (400 / (Math.LN10 * p * (1 - p)));
}

async function main(): Promise<void> {
  const games = Math.max(2, num('GC_GAMES', 2) | 0);
  const maxPlies = Math.max(20, num('GC_MAX_PLIES', 200) | 0);
  const overlayMode = OPPONENT === 'overlay';
  const bName = overlayMode ? `B(overlay:${OVERLAY_DIFFICULTY})` : 'B(plainFSF)';

  emit('── Option B benchmark: charge-anchored (A) vs plain Fairy-Stockfish (B) ──');
  emit(`  A = Option B   K=${K} D=${D} internalMT=${MOVETIME}ms leafMT=${LEAF_MOVETIME}ms engDepth=${ENGINE_DEPTH} budget=${TIME_BUDGET}ms hybrid=${HYBRID ? `on(w=${WEIGHT})` : 'off'}`);
  if (overlayMode) emit(`  B = FSF+Overlay (shipped chooseBotMove)  tier=${OVERLAY_DIFFICULTY}`);
  else emit(`  B = plain FSF  multipv=${K} movetime=${PLAIN_MOVETIME}ms depth=${PLAIN_DEPTH}`);
  emit(`  games=${games} maxPlies=${maxPlies}`);
  emit('─────────────────────────────────────────────────────────────');

  if (!(await isEngineReady())) {
    console.error('\nEngine not ready. Start the proxy first:  npm run dev:server\n');
    process.exit(1);
  }
  const probe = await evaluatePosition(boardToFen(generateInitialBoard(), 'white'), { depth: 6, movetime: 500, multipv: 1 });
  if (probe.length === 0) {
    console.error('\nEngine probe FAILED — proxy up but returned no move. ABORT (would yield meaningless data).\n');
    process.exit(1);
  }

  const A: Contestant = { name: 'A(OptionB)', choose: chooseOptionB };
  const B: Contestant = { name: bName, choose: overlayMode ? chooseOverlayBot : choosePlainFSF };

  let winsA = 0, winsB = 0, draws = 0, totalPlies = 0;
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const aIsWhite = g % 2 === 0;
    const white = aIsWhite ? A : B;
    const black = aIsWhite ? B : A;
    const gs = Date.now();
    const rep = await playGame(white, black, maxPlies);
    let label: string;
    if (rep.result === 'draw') { draws++; label = 'draw'; }
    else { const winnerIsA = (rep.result === 'white') === aIsWhite; if (winnerIsA) { winsA++; label = 'A'; } else { winsB++; label = 'B'; } }
    totalPlies += rep.plies;
    const avgMv = optBMoves ? (optBTotalMs / optBMoves / 1000).toFixed(1) : '—';
    const avgCalls = optBMoves ? (optBTotalCalls / optBMoves).toFixed(0) : '—';
    emit(`  game ${String(g + 1).padStart(3)}: ${label.padEnd(4)} (${rep.status}, ${rep.plies} plies, A ${aIsWhite ? 'white' : 'black'}, ${((Date.now() - gs) / 1000).toFixed(0)}s)  [A: ${avgMv}s/mv, ${avgCalls} calls/mv avg]`);
  }

  const scoreA = winsA + draws * 0.5;
  const delta = eloDelta(scoreA, games);
  const margin = eloMargin(scoreA, games);
  emit('─────────────────────────────────────────────────────────────');
  emit(`  A(OptionB): ${winsA}W   ${bName}: ${winsB}W   draws: ${draws}   score A = ${scoreA}/${games} = ${(scoreA / games * 100).toFixed(1)}%`);
  emit(`  avg length: ${(totalPlies / games).toFixed(1)} plies   total: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (optBMoves) emit(`  Option B cost: ${(optBTotalMs / optBMoves / 1000).toFixed(1)}s/move avg over ${optBMoves} moves  (${(optBTotalCalls / optBMoves).toFixed(1)} engine calls/move)`);
  if (delta === null) emit(`  ELO Δ(A−B): shutout — run more games for a finite estimate`);
  else {
    emit(`  ELO Δ(A−B): ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}  ±${margin!.toFixed(0)} (95% CI)`);
    if (margin !== null && Math.abs(delta) <= margin) emit('  ⚠️  Error bar includes 0 — NOT significant. Run more games.');
  }
  emit('─────────────────────────────────────────────────────────────');
}

main().catch((err) => { console.error(err); process.exit(1); });
