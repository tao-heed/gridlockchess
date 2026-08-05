// server.js — Fairy-Stockfish proxy for Gridlock Chess.
//
// Spawns the native Fairy-Stockfish binary, loads the custom "gridlock" variant
// (see variants.ini), and exposes a tiny HTTP API the React app calls to get
// candidate moves. The browser can't spawn a native process, so this proxy is
// required for the .exe engine.
//
// Endpoints:
//   POST /api/evaluate  { fen, depth?, movetime?, multipv?, skill? } -> { moves: [{move, score}] }
//   GET  /api/status                          -> { ready, variant, pool: [...], queued }
//   GET  /health                              -> 200 { status:'ok' } | 503 { status:'starting' }

import { spawn } from 'child_process';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// The royal variant adds depletion-aware royal Piloted Anomaly pieces (see variants.ini).
// engine.ts emits the matching royal letter per turn. Roll back to 'gridlock' to disable.
const VARIANT_NAME = process.env.ENGINE_VARIANT || 'gridlock-royal';
const VARIANT_PATH = join(__dirname, 'variants.ini');

/** Read an integer env var, clamped to [lo, hi], falling back to `dflt`. */
function envInt(name, dflt, lo, hi) {
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

// Engine process pool. On a single-core free host leave POOL_SIZE=1 (pure serialization — the
// queue below still guarantees ONE search at a time, which is REQUIRED for correctness: a
// single engine process cannot safely interleave two searches). On a multi-core box (e.g. an
// Oracle Ampere ARM VM) raise POOL_SIZE for real concurrency and set ENGINE_THREADS so that
// POOL_SIZE * ENGINE_THREADS stays within the core count.
const POOL_SIZE = envInt('ENGINE_POOL_SIZE', 1, 1, 16);
const ENGINE_THREADS = envInt('ENGINE_THREADS', 2, 1, 64);
const ENGINE_HASH = envInt('ENGINE_HASH', 128, 16, 8192);
// Hard ceiling on requests waiting for a free engine — shed load instead of queueing forever.
const MAX_QUEUE = envInt('ENGINE_MAX_QUEUE', 50, 1, 5000);
// How long a request will wait for a free engine before giving up (ms).
const ACQUIRE_TIMEOUT_MS = envInt('ENGINE_ACQUIRE_TIMEOUT_MS', 20000, 1000, 120000);

const ENGINE_CANDIDATES = [
  // An explicit path always wins (set ENGINE_PATH on the host to the exact binary).
  ...(process.env.ENGINE_PATH ? [process.env.ENGINE_PATH] : []),
  // Windows (local dev) — fuel-modified binary takes priority if present.
  join(__dirname, 'bin', 'fairy-stockfish-largeboard_x86-64-fuel-modified.exe'),
  join(__dirname, 'bin', 'fairy-stockfish-largeboard_x86-64.exe'),
  join(__dirname, 'bin', 'fairy-stockfish_x86-64.exe'),
  join(__dirname, 'bin', 'fairy-stockfish.exe'),
  // Linux ARM (Oracle Ampere A1 / other aarch64 hosts).
  join(__dirname, 'bin', 'fairy-stockfish-largeboard_arm64'),
  join(__dirname, 'bin', 'fairy-stockfish-largeboard_armv8'),
  join(__dirname, 'bin', 'fairy-stockfish_arm64'),
  join(__dirname, 'bin', 'fairy-stockfish_armv8'),
  // Linux x86-64 (Koyeb / most container hosts).
  join(__dirname, 'bin', 'fairy-stockfish-largeboard_x86-64'),
  join(__dirname, 'bin', 'fairy-stockfish'),
];

function findEnginePath() {
  for (const p of ENGINE_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

const app = express();

// Behind a reverse proxy (Caddy/nginx on the VM) the client IP is in X-Forwarded-For; tell
// express to trust exactly `TRUST_PROXY` hops so per-IP rate limits key on the real client,
// not the proxy. Leave unset for direct exposure (no proxy in front).
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isFinite(hops) ? hops : 1);
}

// CORS: with ALLOWED_ORIGINS set (comma-separated) only those browser origins are allowed;
// requests with no Origin (native app webview, curl) always pass. Unset = allow all (dev only).
// NOTE: a native app can forge Origin, so CORS is defence-in-depth, not the primary guard —
// the rate limiter below is. Capacitor webview origins look like `https://localhost`.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(ALLOWED_ORIGINS.length ? {
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('origin not allowed'));
  },
} : {}));

// A FEN is well under 100 bytes; a small cap removes oversized-payload abuse with margin.
app.use(express.json({ limit: '16kb' }));

// Per-IP rate limit on the compute endpoint. An unauthenticated move-search API is a free
// compute resource — without this it is an OWASP resource-exhaustion / DoS amplification vector.
const evaluateLimiter = rateLimit({
  windowMs: envInt('RATE_LIMIT_WINDOW_MS', 60_000, 1000, 3_600_000),
  limit: envInt('RATE_LIMIT_MAX', 60, 1, 100_000),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate limit exceeded' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine worker — one native Fairy-Stockfish process
// ─────────────────────────────────────────────────────────────────────────────

class EngineWorker {
  constructor(id, enginePath) {
    this.id = id;
    this.enginePath = enginePath;
    this.proc = null;
    this.ready = false;
    this.busy = false;
    this.buffer = '';
    this.listeners = new Set(); // each: (line) => void
  }

  send(cmd) {
    if (this.proc) this.proc.stdin.write(cmd + '\n');
  }

  /** Resolve when a stdout line matches the predicate. */
  waitFor(predicate, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(fn);
        reject(new Error('engine wait timeout'));
      }, timeoutMs);
      const fn = (line) => {
        if (predicate(line)) {
          clearTimeout(timer);
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  start() {
    console.log(`Starting engine ${this.id}: ${this.enginePath}`);
    this.proc = spawn(this.enginePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout.on('data', (data) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        for (const fn of this.listeners) fn(line);
      }
    });

    this.proc.stderr.on('data', (d) => console.error(`[engine ${this.id} stderr] ${d}`));
    this.proc.on('error', (e) => console.error(`[engine ${this.id}] spawn error:`, e));
    this.proc.on('close', (code) => {
      console.log(`Engine ${this.id} exited (code ${code}) — restarting in 1s`);
      this.ready = false;
      this.busy = false;
      this.proc = null;
      this.listeners.clear();
      setTimeout(() => this.start(), 1000);
    });

    // Initialize: UCI handshake → load variant → ready.
    this.send('uci');
    this.waitFor((l) => l === 'uciok').then(() => {
      this.send(`setoption name VariantPath value ${VARIANT_PATH}`);
      this.send(`setoption name UCI_Variant value ${VARIANT_NAME}`);
      // Search resources. A single-threaded, tiny-hash engine starves even a full-skill (20)
      // search of depth; these unlock the deeper search the top tiers (esp. the Run Dry-only
      // "asi" tier) ask for. Tuned via ENGINE_THREADS / ENGINE_HASH per host.
      this.send(`setoption name Threads value ${ENGINE_THREADS}`);
      this.send(`setoption name Hash value ${ENGINE_HASH}`);
      this.send('isready');
      return this.waitFor((l) => l === 'readyok');
    }).then(() => {
      this.ready = true;
      console.log(`Engine ${this.id} ready (variant: ${VARIANT_NAME}, threads: ${ENGINE_THREADS}, hash: ${ENGINE_HASH})`);
      pump(); // a freshly-ready worker can serve a queued request
    }).catch((e) => console.error(`Engine ${this.id} init failed:`, e));
  }

  /** Run one MultiPV search. Caller MUST hold this worker (busy = true) — one search at a time. */
  getBestMoves(fen, { depth = 12, movetime = 500, multipv = 5, skill, nodes, fuel } = {}) {
    return new Promise((resolve, reject) => {
      const infoByPv = new Map(); // multipv index -> {move, score}
      const timer = setTimeout(() => {
        this.listeners.delete(collector);
        reject(new Error('search timeout'));
      }, nodes ? 120000 : movetime + 15000);

      const collector = (line) => {
        if (line.startsWith('info') && line.includes(' pv ')) {
          const pv = /\bmultipv (\d+)/.exec(line);
          const mv = /\bpv ([a-h][1-8][a-h][1-8][a-z]?)/.exec(line);
          const sc = /\bscore (cp|mate) (-?\d+)/.exec(line);
          if (mv && sc) {
            const idx = pv ? parseInt(pv[1], 10) : 1;
            const val = sc[1] === 'mate'
              ? (parseInt(sc[2], 10) > 0 ? 100000 - parseInt(sc[2], 10) : -100000 - parseInt(sc[2], 10))
              : parseInt(sc[2], 10);
            infoByPv.set(idx, { move: mv[1], score: val });
          }
        } else if (line.startsWith('bestmove')) {
          clearTimeout(timer);
          this.listeners.delete(collector);
          let moves = [...infoByPv.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
          if (moves.length === 0) {
            const m = /bestmove ([a-h][1-8][a-h][1-8][a-z]?)/.exec(line);
            if (m) moves = [{ move: m[1], score: 0 }];
          }
          resolve(moves);
        }
      };

      this.listeners.add(collector);
      this.send(`setoption name MultiPV value ${multipv}`);
      if (skill !== undefined) this.send(`setoption name Skill Level value ${skill}`);
      this.send(`position fen ${fen}`);
      if (fuel) this.send(`fuel ${fuel}`);
      // Fixed-nodes search (benchmark harness) is hardware-independent; else the depth+time cap.
      this.send(nodes ? `go nodes ${nodes}` : `go depth ${depth} movetime ${movetime}`);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pool + queue — one search per worker at a time (correctness), FIFO waiting
// ─────────────────────────────────────────────────────────────────────────────

/** @type {EngineWorker[]} */
const pool = [];
/** Waiters for a free worker: each { resolve, timer }. */
const waiters = [];

function anyReady() {
  return pool.some((w) => w.ready);
}

/** Hand idle-and-ready workers to waiting requests, FIFO. */
function pump() {
  while (waiters.length) {
    const worker = pool.find((w) => w.ready && !w.busy);
    if (!worker) break;
    worker.busy = true;
    const waiter = waiters.shift();
    clearTimeout(waiter.timer);
    waiter.resolve(worker);
  }
}

/** Acquire an exclusive worker, or reject after ACQUIRE_TIMEOUT_MS. */
function acquireWorker() {
  return new Promise((resolve, reject) => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const i = waiters.indexOf(waiter);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error('no engine available'));
    }, ACQUIRE_TIMEOUT_MS);
    waiters.push(waiter);
    pump();
  });
}

function releaseWorker(worker) {
  worker.busy = false;
  pump();
}

function initPool() {
  const enginePath = findEnginePath();
  if (!enginePath) {
    console.error('ERROR: Fairy-Stockfish binary not found in ./bin (or ENGINE_PATH)');
    console.error('Download it from https://github.com/fairy-stockfish/Fairy-Stockfish/releases/latest');
    process.exit(1);
  }
  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = new EngineWorker(i, enginePath);
    pool.push(worker);
    worker.start();
  }
  console.log(`Engine pool: ${POOL_SIZE} worker(s)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

// The FEN travels straight into the engine's stdin as `position fen <FEN>`. A newline (or
// any control char) would let a crafted request inject extra UCI commands into the engine
// process, so we hard-reject anything outside the FEN alphabet. Real FENs — including our
// fairy royal glyphs (e/f/g/h/i/j/s) — only use letters, digits, '/', '-' and spaces.
const FEN_ALLOWED = /^[A-Za-z0-9/\- ]+$/;

/** Coerce to an integer inside [lo, hi]; fall back to `dflt` on non-numeric input. */
function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

app.post('/api/evaluate', evaluateLimiter, async (req, res) => {
  try {
    if (!anyReady()) return res.status(503).json({ error: 'engine not ready' });
    const { fen, depth, movetime, multipv, skill, nodes, fuel } = req.body || {};
    if (typeof fen !== 'string' || fen.length === 0) return res.status(400).json({ error: 'fen required' });
    if (fen.length > 200 || !FEN_ALLOWED.test(fen)) return res.status(400).json({ error: 'invalid fen' });
    // Shed load rather than queue unboundedly when every worker is saturated.
    if (waiters.length >= MAX_QUEUE) return res.status(503).json({ error: 'server busy' });
    // Clamp the search knobs so a caller can't pin the CPU with an unbounded search. Ceilings
    // sit just above the heaviest real preset (asi: depth 24 / movetime 4000; beginner: multipv 15).
    const safe = {
      depth: clampInt(depth, 1, 32, 12),
      movetime: clampInt(movetime, 50, 10000, 500),
      multipv: clampInt(multipv, 1, 20, 5),
      skill: skill === undefined ? undefined : clampInt(skill, 0, 20, 20),
      // Optional fixed-nodes budget (benchmark harness). Undefined unless explicitly requested,
      // so normal play is unaffected; capped so it can't pin a worker indefinitely.
      nodes: nodes === undefined ? undefined : clampInt(nodes, 1000, 50_000_000, undefined),
      fuel: typeof fuel === 'string' && fuel.length > 0 ? fuel : undefined,
    };

    let worker;
    try {
      worker = await acquireWorker();
    } catch {
      return res.status(503).json({ error: 'server busy' });
    }
    try {
      const moves = await worker.getBestMoves(fen, safe);
      res.json({ moves });
    } finally {
      releaseWorker(worker);
    }
  } catch (err) {
    console.error('evaluate error:', err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get('/api/status', (_req, res) => {
  res.json({
    ready: anyReady(),
    variant: VARIANT_NAME,
    pool: pool.map((w) => ({ id: w.id, ready: w.ready, busy: w.busy })),
    queued: waiters.length,
  });
});

// Lightweight liveness/readiness probe for the hosting platform's health checks.
app.get('/health', (_req, res) => {
  res.status(anyReady() ? 200 : 503).json({ status: anyReady() ? 'ok' : 'starting' });
});

const PORT = process.env.PORT || process.env.ENGINE_PORT || 3005;
initPool();

app.listen(PORT, () => {
  console.log(`Fairy-Stockfish proxy on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  for (const worker of pool) worker.send('quit');
  process.exit(0);
});
