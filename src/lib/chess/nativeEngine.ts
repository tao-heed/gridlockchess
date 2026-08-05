// nativeEngine.ts — JS bridge to the bundled native Fairy-Stockfish (Android only).
//
// Pairs with the `Engine` Capacitor plugin (android/.../EnginePlugin.java). On the web this
// plugin has no implementation, so callers must gate on `isNativeEngineAvailable()` first.

import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export interface EngineStartResult {
  enginePath: string;
  engineExists: boolean;
  variantsPath: string;
}

export interface NativeEnginePlugin {
  start(): Promise<EngineStartResult>;
  send(options: { cmd: string }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: 'line',
    listenerFunc: (data: { line: string }) => void,
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

export const NativeEngine = registerPlugin<NativeEnginePlugin>('Engine');

/** True only inside the packaged Android app, where the native engine binary is bundled. */
export function isNativeEngineAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

// ─────────────────────────────────────────────────────────────────────────────
// UCI driver — mirrors server.js getBestMoves, but drives the in-process native engine.
// Every engine stdout line arrives on ONE listener; a single active `collector` consumes it.
// All operations are serialized (one search at a time), so there is never a collector clash.
// ─────────────────────────────────────────────────────────────────────────────

interface RankedMove {
  move: string; // UCI
  score: number; // centipawns (mate encoded as ±100000∓ply)
}

interface EvaluateOptions {
  depth?: number;
  movetime?: number;
  multipv?: number;
  skill?: number;
  /** Fixed node budget. When set, the search is bounded by nodes ALONE (`go nodes N`) so a
   *  position searches identically on every device regardless of CPU speed/thermal. */
  nodes?: number;
  /** Gridlock fuel string — sent via UCI `fuel` command between `position` and `go`. */
  fuel?: string;
}

const VARIANT = 'gridlock-royal';

let ready = false;
let starting: Promise<void> | null = null;
let variantsPath = '';
let listenerAttached = false;
let collector: ((line: string) => void) | null = null;

let queue: Promise<unknown> = Promise.resolve();

// ─────────────────────────────────────────────────────────────────────────────
// Engine move-log (in-memory dev diagnostics for the CURRENT game only).
// One tiny record per bot search: the depth it actually reached + node rate. This is
// how we tell whether a weak move was a shallow (CPU-starved) search or something else.
// It is bounded, NEVER persisted, and cleared when a new game starts (see LocalGame) — so
// it costs a few KB at most and vanishes on app restart. Read reactively via
// useSyncExternalStore (subscribeEngineLog + getEngineLog).
// ─────────────────────────────────────────────────────────────────────────────
export interface EngineLogEntry {
  n: number;            // bot-move number within this game (1-based)
  skill: number | null; // Skill Level used (null = maxed / unset)
  targetDepth: number;  // the `go depth N` cap requested
  reachedDepth: number; // the depth the search actually finished
  nps: number;          // nodes/second (∝ how fast the CPU was running)
  movetimeMs: number;   // the time budget for this move
  at: number;           // Date.now() when the move resolved
  source: 'FSF' | 'Overlay'; // which brain PLAYED: 'FSF' = engine pick; 'Overlay' = charge-aware search overrode
}

const ENGINE_LOG_CAP = 200; // safety ceiling; one game rarely exceeds ~80 bot moves
let engineLog: EngineLogEntry[] = [];
let engineMoveSeq = 0;
const logListeners = new Set<() => void>();

/** Subscribe to engine-log changes (for useSyncExternalStore). Returns an unsubscribe fn. */
export function subscribeEngineLog(onChange: () => void): () => void {
  logListeners.add(onChange);
  return () => { logListeners.delete(onChange); };
}

/** Current engine-log snapshot — a stable reference until the log actually changes. */
export function getEngineLog(): EngineLogEntry[] {
  return engineLog;
}

/** Clear the log — call when a new game starts so it only ever holds the current game. */
export function clearEngineLog(): void {
  if (engineLog.length === 0 && engineMoveSeq === 0) return;
  engineLog = [];
  engineMoveSeq = 0;
  for (const l of logListeners) l();
}

function pushEngineLog(entry: Omit<EngineLogEntry, 'n' | 'source'>): void {
  engineMoveSeq += 1;
  const record: EngineLogEntry = { n: engineMoveSeq, source: 'FSF', ...entry };
  // New array each time (immutable) so useSyncExternalStore sees a fresh snapshot; drop the
  // oldest once the cap is hit so a pathologically long single game can't grow without bound.
  engineLog =
    engineLog.length >= ENGINE_LOG_CAP ? [...engineLog.slice(1), record] : [...engineLog, record];
  for (const l of logListeners) l();
}

/** Tag the MOST-RECENT log entry with which brain's move was actually played. The engine records
 *  its stats first (source defaults to 'FSF'); the charge-aware overlay's override happens later in
 *  `bot.ts`, which calls this to flip the tag to 'Overlay'. No-op if the log is empty (the dev HTTP
 *  path and heuristic fallback record nothing). */
export function annotateLastEngineLogSource(source: EngineLogEntry['source']): void {
  const last = engineLog[engineLog.length - 1];
  if (!last || last.source === source) return;
  engineLog = [...engineLog.slice(0, -1), { ...last, source }];
  for (const l of logListeners) l();
}

/** Run engine tasks strictly one-at-a-time (the engine is a single serial process). */
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.then(
    () => {},
    () => {},
  );
  return next;
}

async function attachListener(): Promise<void> {
  if (listenerAttached) return;
  await NativeEngine.addListener('line', (data) => collector?.(data.line));
  listenerAttached = true;
}

/** Install a line collector and resolve when `onLine` calls `done`; reject on timeout. */
function collectUntil<T>(
  onLine: (line: string, done: (value: T) => void) => void,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      collector = null;
      reject(new Error('native engine timeout'));
    }, timeoutMs);
    collector = (line) =>
      onLine(line, (value) => {
        clearTimeout(timer);
        collector = null;
        resolve(value);
      });
  });
}

/** Spawn + UCI-handshake + load the gridlock variant exactly once. */
async function ensureReady(): Promise<void> {
  if (ready) return;
  if (!starting) {
    starting = (async () => {
      await attachListener();
      const res = await NativeEngine.start();
      variantsPath = res.variantsPath;

      const uciok = collectUntil<void>((line, done) => {
        if (line === 'uciok') done(undefined);
      }, 10000);
      await NativeEngine.send({ cmd: 'uci' });
      await uciok;

      await NativeEngine.send({ cmd: `setoption name VariantPath value ${variantsPath}` });
      await NativeEngine.send({ cmd: `setoption name UCI_Variant value ${VARIANT}` });
      // Give the engine real compute. Strength on mobile is time-limited: in a fixed
      // movetime the depth it reaches — and therefore whether it spots a tactic instead of
      // hanging a piece — scales with how many positions/sec the CPU can search. More
      // threads + a bigger transposition table = deeper, steadier play, and far fewer
      // "cold CPU" blunders at the top tiers. Threads auto-scale to the device's cores
      // (leaving 2 for the UI/OS, clamped 2–6 to avoid thermal throttling on big.LITTLE).
      const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
      const threads = Math.max(2, Math.min(6, cores - 2));
      await NativeEngine.send({ cmd: `setoption name Threads value ${threads}` });
      await NativeEngine.send({ cmd: 'setoption name Hash value 128' });

      const readyok = collectUntil<void>((line, done) => {
        if (line === 'readyok') done(undefined);
      }, 10000);
      await NativeEngine.send({ cmd: 'isready' });
      await readyok;

      ready = true;
    })();
  }
  await starting;
}

/** True once the native engine has booted and loaded the variant. */
export async function nativeIsReady(): Promise<boolean> {
  if (!isNativeEngineAvailable()) return false;
  try {
    await serialize(() => ensureReady());
    return ready;
  } catch {
    return false;
  }
}

/** Run one MultiPV search; returns candidates best-first (same shape as the HTTP engine). */
export async function nativeEvaluate(fen: string, options: EvaluateOptions = {}): Promise<RankedMove[]> {
  const { depth = 12, movetime = 500, multipv = 5, skill, nodes, fuel } = options;
  return serialize(async () => {
    await ensureReady();
    const infoByPv = new Map<number, RankedMove>();
    // Diagnostics: the depth the search actually reached and the node rate. If "dumb"
    // moves correlate with a low reached-depth/nps, that confirms the strength wobble is
    // CPU-speed (thermal/frequency scaling) starving a time-limited search — not a config bug.
    let reachedDepth = 0;
    let lastNps = 0;
    const result = collectUntil<RankedMove[]>((line, done) => {
      if (line.startsWith('info') && line.includes(' pv ')) {
        const dp = /\bdepth (\d+)/.exec(line);
        if (dp) reachedDepth = parseInt(dp[1], 10);
        const np = /\bnps (\d+)/.exec(line);
        if (np) lastNps = parseInt(np[1], 10);
        const pv = /\bmultipv (\d+)/.exec(line);
        const mv = /\bpv ([a-h][1-8][a-h][1-8][a-z]?)/.exec(line);
        const sc = /\bscore (cp|mate) (-?\d+)/.exec(line);
        if (mv && sc) {
          const idx = pv ? parseInt(pv[1], 10) : 1;
          const val =
            sc[1] === 'mate'
              ? parseInt(sc[2], 10) > 0
                ? 100000 - parseInt(sc[2], 10)
                : -100000 - parseInt(sc[2], 10)
              : parseInt(sc[2], 10);
          infoByPv.set(idx, { move: mv[1], score: val });
        }
      } else if (line.startsWith('bestmove')) {
        let moves = [...infoByPv.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
        if (moves.length === 0) {
          const m = /bestmove ([a-h][1-8][a-h][1-8][a-z]?)/.exec(line);
          if (m) moves = [{ move: m[1], score: 0 }];
        }
        console.info(
          `[Engine] skill=${skill ?? 'max'} target-depth=${depth} reached-depth=${reachedDepth} nps=${lastNps} movetime=${movetime}ms`,
        );
        pushEngineLog({
          skill: skill ?? null,
          targetDepth: depth,
          reachedDepth,
          nps: lastNps,
          movetimeMs: movetime,
          at: Date.now(),
        });
        done(moves);
      }
    }, nodes ? 120000 : movetime + 15000);

    await NativeEngine.send({ cmd: `setoption name MultiPV value ${multipv}` });
    if (skill !== undefined) await NativeEngine.send({ cmd: `setoption name Skill Level value ${skill}` });
    await NativeEngine.send({ cmd: `position fen ${fen}` });
    if (fuel) await NativeEngine.send({ cmd: `fuel ${fuel}` });
    // Fixed-nodes search (benchmark) is hardware-independent; else the normal depth+time cap.
    await NativeEngine.send({ cmd: nodes ? `go nodes ${nodes}` : `go depth ${depth} movetime ${movetime}` });
    return result;
  });
}

