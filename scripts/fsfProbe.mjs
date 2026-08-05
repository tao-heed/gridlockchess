// scripts/fsfProbe.mjs — TEMP feasibility probe for Option B (charge-anchored FSF search).
// Verifies Fairy-Stockfish ACCEPTS and EVALUATES re-anchored, depleted-piece FENs (custom
// gridlock-royal glyphs), returns MultiPV lines + a LEGAL bestmove, and measures per-call latency.
// Run: node scripts/fsfProbe.mjs   — then delete this file.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BIN = join(ROOT, 'bin', 'fairy-stockfish-largeboard_x86-64.exe');
const VARIANTS = join(ROOT, 'variants.ini');

const proc = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const listeners = new Set();
proc.stdout.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop() || '';
  for (const raw of lines) {
    const line = raw.trim();
    for (const fn of listeners) fn(line);
  }
});
proc.stderr.on('data', (d) => console.error('[stderr]', d.toString().trim()));

const send = (cmd) => proc.stdin.write(cmd + '\n');
const waitFor = (pred, timeoutMs = 8000) =>
  new Promise((resolve, reject) => {
    const seen = [];
    const to = setTimeout(() => { listeners.delete(fn); reject(new Error('timeout; saw:\n' + seen.join('\n'))); }, timeoutMs);
    const fn = (line) => { seen.push(line); const r = pred(line, seen); if (r) { clearTimeout(to); listeners.delete(fn); resolve({ line, seen }); } };
    listeners.add(fn);
  });

// Collect all info/bestmove lines for one `go`, return {bestmove, multipvCount, scores, illegalNote, ms}.
function search(fen, { movetime = 300, multipv = 5 } = {}) {
  return new Promise(async (resolve) => {
    const seen = [];
    const start = Date.now();
    const fn = (line) => {
      seen.push(line);
      if (line.startsWith('bestmove')) {
        listeners.delete(fn);
        const ms = Date.now() - start;
        const infoPvs = seen.filter((l) => l.startsWith('info') && l.includes(' pv '));
        const multipvIdx = new Set(infoPvs.map((l) => (/\bmultipv (\d+)/.exec(l) || [])[1]).filter(Boolean));
        const scores = infoPvs.slice(-multipv).map((l) => (/\bscore (cp|mate) (-?\d+)/.exec(l) || []).slice(1).join(' '));
        const errs = seen.filter((l) => /error|illegal|unknown|No such|assert/i.test(l));
        const bestmove = (/bestmove (\S+)/.exec(line) || [])[1];
        resolve({ bestmove, multipvCount: multipvIdx.size, scores, errs, ms, sampleInfo: infoPvs.slice(-1)[0] });
      }
    };
    listeners.add(fn);
    send(`setoption name MultiPV value ${multipv}`);
    send(`position fen ${fen}`);
    send(`go movetime ${movetime}`);
  });
}

const TESTS = [
  // 1. Depleted NON-royal pieces: R = rook (drained anomaly), X = dead stone, M = amazon (full).
  { name: 'depleted non-royal (R/X/M + kings)', fen: '2b1k1n1/8/8/8/8/8/8/RX1MK3 w - - 0 1' },
  // 2. WHITE piloted royal rook 'S' (uppercase), NO white king — the post-Override state. e-file
  //    blocked by own pawn e2 so black king isn't in check on white's move.
  { name: 'white piloted royal rook S, no K', fen: '4k3/8/8/8/8/8/4P3/4S3 w - - 0 1' },
  // 3. WHITE piloted royal amazon 'E', no K, e-file blocked by own pawn e3 (else e8 is in check).
  { name: 'white piloted royal amazon E, no K', fen: '4k3/8/8/8/8/4P3/3P4/4E3 w - - 0 1' },
  // 4. BLACK piloted royal amazon 'e', no black king, black to move (mirror of the real case).
  { name: 'black piloted royal amazon e, no k', fen: '4e3/3ppp2/8/8/8/8/4P3/4K3 b - - 0 1' },
  // 5. Mixed depleted midgame: custom a/c + dead x + both kings.
  { name: 'mixed a/c/x + kings', fen: '2k5/8/3a4/8/4c3/8/2X5/4K3 w - - 0 1' },
  // 6. Dense depleted midgame with both kings, expecting cp (not mate) scores.
  { name: 'dense depleted (both kings)', fen: 'r2k1b2/pp3p2/2n5/3M4/4c3/5N2/PP2X1PP/R2K4 w - - 0 1' },
  // 7. Normal start position (control — must work).
  { name: 'start position (control)', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1' },
];

(async () => {
  try {
    send('uci');
    await waitFor((l) => l === 'uciok');
    send(`setoption name VariantPath value ${VARIANTS}`);
    send('setoption name UCI_Variant value gridlock-royal');
    send('isready');
    await waitFor((l) => l === 'readyok');
    console.log('ENGINE READY — variant gridlock-royal loaded\n');

    // Latency sample: 8 sequential short calls on the start FEN.
    const lat = [];
    for (let i = 0; i < 8; i++) {
      const r = await search('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1', { movetime: 300 });
      lat.push(r.ms);
    }
    const avg = lat.reduce((a, b) => a + b, 0) / lat.length;
    console.log(`LATENCY @movetime=300ms, MultiPV=5: samples=[${lat.join(', ')}] avg=${avg.toFixed(0)}ms\n`);

    for (const t of TESTS) {
      const r = await search(t.fen, { movetime: 300, multipv: 5 });
      const ok = r.bestmove && r.bestmove !== '(none)' && r.errs.length === 0;
      console.log(`TEST: ${t.name}`);
      console.log(`  fen        : ${t.fen}`);
      console.log(`  bestmove   : ${r.bestmove}`);
      console.log(`  multipv#   : ${r.multipvCount}`);
      console.log(`  scores     : ${r.scores.join(' | ')}`);
      console.log(`  errors     : ${r.errs.length ? r.errs.join(' / ') : 'none'}`);
      console.log(`  verdict    : ${ok ? 'ACCEPTED + legal bestmove' : '*** PROBLEM ***'}`);
      console.log('');
    }
    send('quit');
    setTimeout(() => process.exit(0), 200);
  } catch (e) {
    console.error('PROBE FAILED:', e.message);
    send('quit');
    setTimeout(() => process.exit(1), 200);
  }
})();
