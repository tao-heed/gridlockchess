// Exact-24/23/23 measurement (plan tasks T1–T3), built on the SAME build enumeration
// as docs/dev/scripts/verify_balance.mjs (which is machine-verified against the shipped numbers).
//
// Answers:
//   T1 — Under the REAL live sampler (archetype-uniform, then generate()), what is the
//        per-roll probability that a raw 7-army is EXACTLY a permutation of {24,23,23}
//        AND satisfies rules 1 (≤2 Absolute) & 2 (≤2 duplicates)?  → rejection acceptance.
//   T2 — How many ORDERED valid exact armies exist (uniform-build count)?  → new headline.
//        Distinct positions = ×8 king files.
//   T3 — Effective variety (collision entropy) under (a) uniform sampling over exact armies
//        and (b) the live sampler conditioned on the exact rule; birthday-paradox repeats.
//
// "Exact 24/23/23" = the multiset {24,23,23}; i.e. sorted(L,O,D) === [23,23,24].

// ── Same build enumeration as verify_balance.mjs ──────────────────────────────
function highVec() {
  const builds = [];
  for (let h = 6; h <= 8; h++) {
    const total = 10 - h;
    const n = total - 1;
    for (let a = 1; a <= total - 1; a++) {
      builds.push({ h, a, b: total - a, p: (1 / 3) * (1 / n) });
    }
  }
  return builds;
}

const ARCH = {};
ARCH.highLeap = highVec().map(({ h, a, b, p }) => ({ L: h, D: a, O: b, p }));
ARCH.highDiag = highVec().map(({ h, a, b, p }) => ({ D: h, L: a, O: b, p }));
ARCH.highOrtho = highVec().map(({ h, a, b, p }) => ({ O: h, L: a, D: b, p }));

ARCH.hybridLD = [];
for (let L = 4; L <= 5; L++) for (let O = 0; O <= 1; O++)
  ARCH.hybridLD.push({ L, O, D: 10 - L - O, p: 1 / 4 });
ARCH.hybridLO = [];
for (let L = 4; L <= 5; L++) for (let D = 0; D <= 1; D++)
  ARCH.hybridLO.push({ L, D, O: 10 - L - D, p: 1 / 4 });
ARCH.hybridDO = [];
for (let D = 4; D <= 5; D++) for (let L = 0; L <= 1; L++)
  ARCH.hybridDO.push({ D, L, O: 10 - D - L, p: 1 / 4 });

ARCH.balanced = [
  { L: 4, O: 3, D: 3, p: 1 / 3 },
  { L: 3, O: 4, D: 3, p: 1 / 3 },
  { L: 3, O: 3, D: 4, p: 1 / 3 },
];
ARCH.absLeap  = [{ L: 10, O: 0, D: 0, p: 1 }];
ARCH.absDiag  = [{ L: 0,  O: 0, D: 10, p: 1 }];
ARCH.absOrtho = [{ L: 0,  O: 10, D: 0, p: 1 }];

const ABS = new Set(['absLeap', 'absDiag', 'absOrtho']);
const KEYS = Object.keys(ARCH);

// Sanity: 36 builds, live prob per archetype sums to 1.
let totalBuilds = 0;
for (const k of KEYS) {
  totalBuilds += ARCH[k].length;
  const ps = ARCH[k].reduce((s, b) => s + b.p, 0);
  if (Math.abs(ps - 1) > 1e-9) throw new Error(`archetype ${k} prob sums to ${ps}`);
}
console.log('distinct builds:', totalBuilds, '(expected 36)');

// sorted(L,O,D) === [23,23,24]
const isExact242323 = (L, O, D) => {
  const s = [L, O, D].sort((a, b) => a - b);
  return s[0] === 23 && s[1] === 23 && s[2] === 24;
};

// ── Generic DP over the 10 archetypes, ≤2 copies each. ────────────────────────
// weight per slot: 'count' => 1 ; 'live' => (1/10)*p ; 'coll' => ((1/10)*p)^2
// Returns { total, exactAbsOk } where exactAbsOk applies (abs<=2 AND exact 24/23/23).
function dpRun(weightMode) {
  const w = (b) =>
    weightMode === 'count' ? 1 :
    weightMode === 'live'  ? (1 / 10) * b.p :
                             Math.pow((1 / 10) * b.p, 2); // 'coll'
  const C = (n, k) => (k === 0 ? 1 : k === 1 ? n : (n * (n - 1)) / 2);

  let dp = new Map();
  dp.set('0|0|0|0', 1);

  for (const key of KEYS) {
    const builds = ARCH[key];
    const isAbs = ABS.has(key);
    const opt1 = builds.map((b) => ({ dL: b.L, dO: b.O, dAbs: isAbs ? 1 : 0, wt: w(b) }));
    const opt2 = [];
    for (const b1 of builds) for (const b2 of builds)
      opt2.push({ dL: b1.L + b2.L, dO: b1.O + b2.O, dAbs: isAbs ? 2 : 0, wt: w(b1) * w(b2) });

    const next = new Map();
    const add = (k, val) => next.set(k, (next.get(k) || 0) + val);
    for (const [st, val] of dp) {
      const [slots, L, O, abs] = st.split('|').map(Number);
      const rem = 7 - slots;
      add(st, val);
      if (rem >= 1) for (const o of opt1)
        add(`${slots + 1}|${L + o.dL}|${O + o.dO}|${abs + o.dAbs}`, val * C(rem, 1) * o.wt);
      if (rem >= 2) for (const o of opt2)
        add(`${slots + 2}|${L + o.dL}|${O + o.dO}|${abs + o.dAbs}`, val * C(rem, 2) * o.wt);
    }
    dp = next;
  }

  let total = 0, exactAbsOk = 0;
  for (const [st, val] of dp) {
    const [slots, L, O, abs] = st.split('|').map(Number);
    if (slots !== 7) continue;
    const D = 70 - L - O;
    total += val;
    if (abs <= 2 && isExact242323(L, O, D)) exactAbsOk += val;
  }
  return { total, exactAbsOk };
}

// ── T2: uniform-build ORDERED count of valid exact armies ─────────────────────
const cnt = dpRun('count');
const positions = 8 * cnt.exactAbsOk;
console.log('\n── T2: EXACT 24/23/23 ARMY COUNT (rules 1&2 + exact) ──');
console.log('valid ordered exact armies        :', cnt.exactAbsOk.toLocaleString('en-US'));
console.log('distinct positions (×8 king files):', positions.toLocaleString('en-US'));

// Compare to the retired rejection-sampling Balanced headline (46,467,509,760 armies / ~372B
// positions) — kept for historical context; the exact 24/23/23 sampler is now the only mode.
const CUR_ARMIES = 46467509760;
console.log('vs retired Balanced armies        :', CUR_ARMIES.toLocaleString('en-US'),
  `(exact is ${(cnt.exactAbsOk / CUR_ARMIES * 100).toFixed(4)}% of it)`);

// ── T1: live per-roll acceptance of the exact rule ────────────────────────────
const live = dpRun('live');
const acc = live.exactAbsOk; // P(raw roll: ≤2dup ∧ abs≤2 ∧ exact 24/23/23)
console.log('\n── T1: LIVE PER-ROLL ACCEPTANCE OF THE EXACT RULE ──');
console.log('P(random 7-roll is exact & rules) :', (acc * 100).toFixed(6) + '%');
console.log('expected rolls to hit it          :', acc > 0 ? (1 / acc).toFixed(1) : '∞');
console.log('P(400 consecutive misses)         :', Math.pow(1 - acc, 400).toExponential(3));
console.log('P(fallback ships INVALID army)    :', (Math.pow(1 - acc, 400) * 100).toExponential(3) + '%');

// ── T3: effective variety ─────────────────────────────────────────────────────
// (a) Uniform sampling over the valid exact armies: N_eff = N (every position equiprobable).
const nUniform = positions;
// (b) Live sampler conditioned on the exact rule: N_eff = Z^2 / Σ_valid q²  (× 8 king files).
const coll = dpRun('coll');
const sumQ2 = coll.exactAbsOk;      // Σ q² over valid exact armies (q = Π (1/10)p)
const nEffArmiesLive = (acc * acc) / sumQ2;
const nEffLive = 8 * nEffArmiesLive;

console.log('\n── T3: EFFECTIVE VARIETY & REPEAT HORIZON ──');
console.log('(a) UNIFORM sampling over exact armies:');
console.log('    N_eff positions               :', Math.round(nUniform).toLocaleString('en-US'));
console.log('    ~50% repeat at                 :', Math.round(1.177 * Math.sqrt(nUniform)).toLocaleString('en-US'), 'games');
console.log('(b) LIVE sampler + reject-to-exact:');
console.log('    N_eff positions               :', Math.round(nEffLive).toLocaleString('en-US'));
console.log('    ratio N_eff(live)/N_uniform    :', (nEffLive / nUniform * 100).toFixed(2) + '%');
console.log('    ~50% repeat at                 :', Math.round(1.177 * Math.sqrt(nEffLive)).toLocaleString('en-US'), 'games');
