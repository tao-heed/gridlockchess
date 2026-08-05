/// <reference types="node" />
/**
 * docs/dev/scripts/selfplay.ts — Engine-vs-engine self-play benchmark harness.
 *
 * This is the measurement gate from docs/dev/BotStrengthEnhancementPlan.md §9 #1: NO strength
 * claim is trustworthy without a self-play number behind it. It plays two bot configurations
 * against each other over many games (colors swapped each game to cancel first-move advantage),
 * tallies win/draw/loss, and converts the score to an ELO delta with a margin of error.
 *
 * It drives the REAL bot (`chooseBotMove`) and the REAL native Fairy-Stockfish via the local
 * proxy (server.js), applying every move through the authoritative rules kernel (`applyMoveToBoard`)
 * — exactly the same law the app uses — so the games are faithful, not a re-implementation.
 *
 * ── Prerequisites ────────────────────────────────────────────────────────────────────────────
 *   1. The Fairy-Stockfish binary in ./bin (already present for local dev).
 *   2. The engine proxy running:   npm run dev:server      (server.js on :3005)
 *
 * ── Run ──────────────────────────────────────────────────────────────────────────────────────
 *   npm run selfplay                       # defaults: asi vs grandmaster, 20 games
 *   GC_A=asi GC_B=grandmaster GC_GAMES=40 npm run selfplay
 *   GC_A=asi GC_B=asi GC_B_MAXDEPTH=0 GC_GAMES=30 npm run selfplay   # overlay ON vs OFF (§9 #2)
 *   GC_NODES=200000 GC_GAMES=40 npm run selfplay                     # hardware-independent fixed-nodes
 *
 * ── Env knobs ────────────────────────────────────────────────────────────────────────────────
 *   GC_A / GC_B          BotDifficulty for each side           (default asi / grandmaster)
 *   GC_GAMES             number of games (even → equal colors) (default 20)
 *   GC_NODES             fixed engine node budget for BOTH     (default: unset → time-based)
 *   GC_A_MAXDEPTH        override A's charge-aware overlay depth (e.g. 0 = overlay OFF)
 *   GC_B_MAXDEPTH        override B's charge-aware overlay depth
 *   GC_MAX_PLIES         per-game safety cap                   (default 400)
 */

import { generateInitialBoard } from '../../../src/lib/chess/generator';
import { chooseBotMove, type BotDifficulty, type BotOverrides } from '../../../src/lib/chess/bot';
import { applyMoveToBoard } from '../../../src/lib/chess/move';
import { evaluateOutcome } from '../../../src/lib/chess/outcome';
import { repetitionKey } from '../../../src/lib/chess/repetition';
import { isEngineReady, evaluatePosition, boardToFen } from '../../../src/lib/chess/engine';
import type { Board, PieceColor, Square, GameStatus } from '../../../src/types/game';
import { appendFileSync } from 'node:fs';

/** Optional file that each output line is flushed to immediately (via fs), so a long background
 *  run is observable live and never lost to PowerShell/stdout buffering. Set with GC_PROGRESS. */
const PROGRESS_FILE = process.env.GC_PROGRESS;
function emit(line = ''): void {
  console.log(line);
  if (PROGRESS_FILE) { try { appendFileSync(PROGRESS_FILE, line + '\n'); } catch { /* best effort */ } }
}

const DIFFICULTIES: readonly BotDifficulty[] = [
  'beginner', 'novice', 'casual', 'club', 'skilled', 'expert', 'master', 'grandmaster', 'asi',
];

const opp = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');

interface Contestant {
  name: string;
  difficulty: BotDifficulty;
  overrides?: BotOverrides;
}

type GameResult = 'white' | 'black' | 'draw';

interface GameReport {
  result: GameResult;
  plies: number;
  status: GameStatus;
}

/** Play one full game. Returns which COLOR won (or a draw), the ply count, and terminal status. */
async function playGame(white: Contestant, black: Contestant, maxPlies: number): Promise<GameReport> {
  let board: Board = generateInitialBoard();
  let turn: PieceColor = 'white'; // Gridlock, like chess, is White to move first
  let ep: Square | null = null;
  let positionCounts: Record<string, number> = {};
  let halfmoveClock = 0;

  for (let plies = 0; plies < maxPlies; plies++) {
    const c = turn === 'white' ? white : black;
    const move = await chooseBotMove(board, turn, ep ?? undefined, c.difficulty, c.overrides);

    // No legal, non-terminal reply → the side to move is checkmated or stalemated. (chooseBotMove
    // already exhausts the forced-Override fallback, so a null here is a genuine game end.)
    if (!move) {
      const o = evaluateOutcome(board, turn, 'playing');
      if (o.status === 'checkmate') return { result: opp(turn), plies, status: 'checkmate' };
      return { result: 'draw', plies, status: o.status === 'playing' ? 'stalemate' : o.status };
    }

    const applied = applyMoveToBoard(board, move.from, move.to, turn, ep);
    if (!applied.valid) {
      throw new Error(`Bot proposed an illegal move ${move.from}${move.to} for ${turn} (${applied.error ?? 'no reason'})`);
    }

    board = applied.board;
    const nextTurn = opp(turn);
    ep = applied.nextEnPassant;

    // Repetition + fifty-move bookkeeping — mirrors useGameState.makeMove exactly.
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
      status = evaluateOutcome(board, nextTurn, 'playing', {
        posCount,
        halfmoveClock,
        gridlockDeath: applied.gridlockDeath,
      }).status;
    }

    // Terminal? Resolve the winner from the MOVER's perspective (mover = `turn`, pre-advance):
    //   • checkmate      → the side to move next is mated → the MOVER wins.
    //   • gridlock-death → the mover spent its own royal's last charge → the mover LOSES.
    //   • stalemate/draw → draw.
    if (status === 'checkmate') return { result: turn, plies: plies + 1, status };
    if (status === 'gridlock-death') return { result: nextTurn, plies: plies + 1, status };
    if (status === 'stalemate' || status === 'draw') return { result: 'draw', plies: plies + 1, status };

    turn = nextTurn;
  }

  return { result: 'draw', plies: maxPlies, status: 'draw' }; // hit the safety cap
}

/** Score → ELO delta (of A relative to B). Returns null if the score is a shutout (infinite). */
function eloDelta(scoreA: number, games: number): number | null {
  const p = scoreA / games;
  if (p <= 0 || p >= 1) return null;
  return -400 * Math.log10(1 / p - 1);
}

/** Standard error of the ELO estimate (rough, from the score-fraction variance). */
function eloMargin(scoreA: number, games: number): number | null {
  const p = scoreA / games;
  if (p <= 0 || p >= 1) return null;
  const sePct = Math.sqrt((p * (1 - p)) / games); // SE of the mean score fraction
  // dELO/dp = 400 / (ln10 · p · (1−p)); 95% CI ≈ ±1.96·SE·dELO/dp
  const dEloDp = 400 / (Math.LN10 * p * (1 - p));
  return 1.96 * sePct * dEloDp;
}

async function main(): Promise<void> {
  const env = (k: string) => process.env[k];
  const parseDiff = (v: string | undefined, dflt: BotDifficulty): BotDifficulty => {
    if (v && (DIFFICULTIES as readonly string[]).includes(v)) return v as BotDifficulty;
    if (v) throw new Error(`Unknown difficulty "${v}". Valid: ${DIFFICULTIES.join(', ')}`);
    return dflt;
  };

  const games = Math.max(2, Number(env('GC_GAMES') ?? 20) | 0);
  const maxPlies = Math.max(20, Number(env('GC_MAX_PLIES') ?? 400) | 0);
  const nodes = env('GC_NODES') ? Number(env('GC_NODES')) : undefined;
  const aMaxDepth = env('GC_A_MAXDEPTH') !== undefined ? Number(env('GC_A_MAXDEPTH')) : undefined;
  const bMaxDepth = env('GC_B_MAXDEPTH') !== undefined ? Number(env('GC_B_MAXDEPTH')) : undefined;

  const mkOverrides = (maxDepth: number | undefined): BotOverrides | undefined => {
    const o: BotOverrides = {};
    if (nodes !== undefined) o.engineNodes = nodes;
    if (maxDepth !== undefined) o.searchMaxDepth = maxDepth;
    return Object.keys(o).length ? o : undefined;
  };

  const A: Contestant = { name: `A:${parseDiff(env('GC_A'), 'asi')}`, difficulty: parseDiff(env('GC_A'), 'asi'), overrides: mkOverrides(aMaxDepth) };
  const B: Contestant = { name: `B:${parseDiff(env('GC_B'), 'grandmaster')}`, difficulty: parseDiff(env('GC_B'), 'grandmaster'), overrides: mkOverrides(bMaxDepth) };

  emit('── Gridlock self-play benchmark ─────────────────────────────');
  emit(`  A = ${A.name}${A.overrides ? '  ' + JSON.stringify(A.overrides) : ''}`);
  emit(`  B = ${B.name}${B.overrides ? '  ' + JSON.stringify(B.overrides) : ''}`);
  emit(`  games = ${games}, maxPlies = ${maxPlies}${nodes ? `, fixed-nodes = ${nodes}` : ', time-based'}`);
  emit('─────────────────────────────────────────────────────────────');

  if (!(await isEngineReady())) {
    console.error('\nEngine not ready. Start the proxy first:\n    npm run dev:server\n(and make sure the Fairy-Stockfish binary is in ./bin)\n');
    process.exit(1);
  }

  // isEngineReady() only reads a status FLAG — a stale/half-up proxy can report ready yet fail EVERY
  // move, silently falling back to the heuristic (→ meaningless "benchmark" data; this is exactly the
  // trap that produced a garbage run on 2026-07-21). Demand a REAL engine round-trip before trusting
  // anything: evaluate the start position and require an actual move back.
  const probe = await evaluatePosition(boardToFen(generateInitialBoard(), 'white'), { depth: 6, movetime: 500, multipv: 1 });
  if (probe.length === 0) {
    console.error('\nEngine probe FAILED — the proxy reports ready but returned NO move for the start position.\nBenchmark ABORTED (it would otherwise silently fall back to the heuristic → meaningless data).\nStart a CLEAN proxy and retry:  npm run dev:server   (watch for "Engine pool: N worker(s)" and no EADDRINUSE).\n');
    process.exit(1);
  }

  // Safety net for an engine that dies MID-run: chooseBotMove logs a "[Bot] … fallback" message and
  // silently plays a HEURISTIC move whenever the engine is unreachable. Count those so a run that did
  // not actually use the engine/overlay is stamped INVALID rather than reported as a real ELO number.
  let engineFallbacks = 0;
  const origWarn = console.warn;
  const origError = console.error;
  const sniff = (args: unknown[]): void => {
    const msg = args.map((a) => String(a)).join(' ');
    if (msg.includes('[Bot]') && (msg.includes('fallback') || msg.includes('not ready'))) engineFallbacks++;
  };
  console.warn = (...args: unknown[]): void => { sniff(args); origWarn(...args); };
  console.error = (...args: unknown[]): void => { sniff(args); origError(...args); };

  let winsA = 0, winsB = 0, draws = 0, totalPlies = 0;
  const t0 = Date.now();

  for (let g = 0; g < games; g++) {
    const aIsWhite = g % 2 === 0;              // alternate colors to cancel the first-move edge
    const white = aIsWhite ? A : B;
    const black = aIsWhite ? B : A;
    const rep = await playGame(white, black, maxPlies);

    let winnerLabel: string;
    if (rep.result === 'draw') { draws++; winnerLabel = 'draw'; }
    else {
      const winnerIsA = (rep.result === 'white') === aIsWhite;
      if (winnerIsA) { winsA++; winnerLabel = 'A'; } else { winsB++; winnerLabel = 'B'; }
    }
    totalPlies += rep.plies;
    emit(`  game ${String(g + 1).padStart(3)}: ${winnerLabel.padEnd(4)} (${rep.status}, ${rep.plies} plies, A ${aIsWhite ? 'white' : 'black'})`);
  }

  console.warn = origWarn;
  console.error = origError;

  const scoreA = winsA + draws * 0.5;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const delta = eloDelta(scoreA, games);
  const margin = eloMargin(scoreA, games);

  emit('─────────────────────────────────────────────────────────────');
  emit(`  A: ${winsA}W  B: ${winsB}W  draws: ${draws}   (score A = ${scoreA}/${games} = ${(scoreA / games * 100).toFixed(1)}%)`);
  emit(`  avg game length: ${(totalPlies / games).toFixed(1)} plies   total time: ${secs}s`);
  if (delta === null) {
    emit(`  ELO Δ(A−B): shutout (${scoreA === games ? '+∞' : '−∞'}) — run more games / closer configs for a finite estimate`);
  } else {
    emit(`  ELO Δ(A−B): ${delta >= 0 ? '+' : ''}${delta.toFixed(0)}  ±${margin!.toFixed(0)} (95% CI)`);
    if (margin !== null && Math.abs(delta) <= margin) {
      emit('  ⚠️  The error bar includes 0 — NOT statistically significant. Run more games.');
    }
  }
  emit('─────────────────────────────────────────────────────────────');
  // The loud-fail guard: if ANY move fell back to the heuristic, the engine/overlay was not actually
  // exercised — the numbers above are meaningless. Say so unmissably (and exit non-zero).
  if (engineFallbacks > 0) {
    emit(`  ⛔ INVALID RESULT — the bot fell back to the HEURISTIC ${engineFallbacks} time(s): the engine/`);
    emit('     overlay was NOT used, so the ELO number above is MEANINGLESS. Fix the proxy (npm run');
    emit('     dev:server, no EADDRINUSE) and re-run.');
    emit('──────────────────────────────────────────────────────────────');
    process.exitCode = 1;
  }}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
