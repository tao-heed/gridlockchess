// ⚠️ SUPERSEDED (historical). This script verifies the RETIRED rejection-sampling "Balanced"
// generator (CURATION / isValidArmy / generateCuratedArmy — removed from the codebase). The
// numbers it prints (46,467,509,760 armies, ~372B positions, 59.3%/48.15%, 74.5B effective)
// are correct for that OLD design only. The shipping generator is the exact 24/23/23 uniform
// sampler — verify it with docs/dev/scripts/verify_exact_balance.mjs and docs/dev/scripts/verify_bishop_rule.mjs.
//
// Exact verification of:
//   (1) the valid-army count 46,467,509,760 (uniform-build state space)
//   (2) the TRUE live acceptance rate of the actual rejection sampler
//
// Builds are derived directly from the generate() logic in archetypes.ts.
// No magic numbers trusted; everything is enumerated from first principles.

// ── Enumerate every (L,O,D) build each archetype can roll, with LIVE probability ──
// Each entry: { L, O, D, p } where p = P(this build | archetype chosen).
function highVec() {
  // hi in {6,7,8} on one axis (prob 1/3 each), remainder split via splitTwo (min 1).
  const builds = [];
  for (let h = 6; h <= 8; h++) {
    const total = 10 - h;            // remainder
    const n = total - 1;             // splitTwo: a in [1, total-1]
    for (let a = 1; a <= total - 1; a++) {
      builds.push({ h, a, b: total - a, p: (1 / 3) * (1 / n) });
    }
  }
  return builds;
}

const ARCH = {};

// highLeap: L=hi; [D,O]=split  -> vector {L:h, D:a, O:b}
ARCH.highLeap = highVec().map(({ h, a, b, p }) => ({ L: h, D: a, O: b, p }));
// highDiag: D=hi; [L,O]=split  -> {D:h, L:a, O:b}
ARCH.highDiag = highVec().map(({ h, a, b, p }) => ({ D: h, L: a, O: b, p }));
// highOrtho: O=hi; [L,D]=split -> {O:h, L:a, D:b}
ARCH.highOrtho = highVec().map(({ h, a, b, p }) => ({ O: h, L: a, D: b, p }));

// hybridLD: L=rand(4,5), O=rand(0,1), D=10-L-O   (each combo p=1/4)
ARCH.hybridLD = [];
for (let L = 4; L <= 5; L++) for (let O = 0; O <= 1; O++)
  ARCH.hybridLD.push({ L, O, D: 10 - L - O, p: 1 / 4 });

// hybridLO: L=rand(4,5), D=rand(0,1), O=10-L-D
ARCH.hybridLO = [];
for (let L = 4; L <= 5; L++) for (let D = 0; D <= 1; D++)
  ARCH.hybridLO.push({ L, D, O: 10 - L - D, p: 1 / 4 });

// hybridDO: D=rand(4,5), L=rand(0,1), O=10-D-L
ARCH.hybridDO = [];
for (let D = 4; D <= 5; D++) for (let L = 0; L <= 1; L++)
  ARCH.hybridDO.push({ D, L, O: 10 - D - L, p: 1 / 4 });

// balanced: shuffle([4,3,3]) -> 3 distinct outcomes, each p=1/3
ARCH.balanced = [
  { L: 4, O: 3, D: 3, p: 1 / 3 },
  { L: 3, O: 4, D: 3, p: 1 / 3 },
  { L: 3, O: 3, D: 4, p: 1 / 3 },
];

// absolutes: single build, p=1
ARCH.absLeap  = [{ L: 10, O: 0, D: 0, p: 1 }];
ARCH.absDiag  = [{ L: 0,  O: 0, D: 10, p: 1 }];
ARCH.absOrtho = [{ L: 0,  O: 10, D: 0, p: 1 }];

const ABS = new Set(['absLeap', 'absDiag', 'absOrtho']);
const KEYS = Object.keys(ARCH);

// Sanity: total distinct builds (should be 36) and live prob sums to 1 per archetype.
let totalBuilds = 0;
for (const k of KEYS) {
  totalBuilds += ARCH[k].length;
  const ps = ARCH[k].reduce((s, b) => s + b.p, 0);
  if (Math.abs(ps - 1) > 1e-9) throw new Error(`archetype ${k} prob sums to ${ps}`);
}
console.log('distinct builds:', totalBuilds, '(expected 36)');

// ── DP over the 10 archetypes. State key: slots|L|O|abs  (D = 10*slots - L - O) ──
// weightMode 'count' => each build weight 1 (uniform-build space).
// weightMode 'live'  => each build weight = (1/10)*p  (real sampler).
function run(weightMode) {
  const archWeight = weightMode === 'live' ? 1 / 10 : 1; // 1/10 archetype pick for live
  const w = (b) => (weightMode === 'live' ? archWeight * b.p : 1);

  // C(n,k) for n<=7
  const C = (n, k) => (k === 0 ? 1 : k === 1 ? n : (n * (n - 1)) / 2);

  let dp = new Map();
  dp.set('0|0|0|0', 1);

  for (const key of KEYS) {
    const builds = ARCH[key];
    const isAbs = ABS.has(key);

    // Precompute k=1 and k=2 (ordered pairs) contribution lists.
    const opt1 = builds.map((b) => ({ dL: b.L, dO: b.O, dAbs: isAbs ? 1 : 0, wt: w(b) }));
    const opt2 = [];
    for (const b1 of builds) for (const b2 of builds)
      opt2.push({ dL: b1.L + b2.L, dO: b1.O + b2.O, dAbs: isAbs ? 2 : 0, wt: w(b1) * w(b2) });

    const next = new Map();
    const add = (k, val) => next.set(k, (next.get(k) || 0) + val);

    for (const [st, val] of dp) {
      const [slots, L, O, abs] = st.split('|').map(Number);
      const rem = 7 - slots;
      // k=0
      add(st, val);
      // k=1
      if (rem >= 1) for (const o of opt1)
        add(`${slots + 1}|${L + o.dL}|${O + o.dO}|${abs + o.dAbs}`, val * C(rem, 1) * o.wt);
      // k=2
      if (rem >= 2) for (const o of opt2)
        add(`${slots + 2}|${L + o.dL}|${O + o.dO}|${abs + o.dAbs}`, val * C(rem, 2) * o.wt);
    }
    dp = next;
  }

  let total = 0, valid = 0;
  for (const [st, val] of dp) {
    const [slots, L, O, abs] = st.split('|').map(Number);
    if (slots !== 7) continue;
    const D = 70 - L - O;
    total += val;
    if (abs <= 2 && L >= 8 && O >= 8 && D >= 8) valid += val;
  }
  return { total, valid };
}

const cnt = run('count');
const FULL = 36 ** 7; // true uniform-build state space (incl. 3+ duplicates)
console.log('\n── UNIFORM-BUILD STATE SPACE ──');
console.log('full space 36^7            :', FULL.toLocaleString('en-US'));
console.log('(DP total = ≤2-dup subset) :', cnt.total.toLocaleString('en-US'));
console.log('valid ordered armies       :', cnt.valid.toLocaleString('en-US'), '(claimed 46,467,509,760)');
console.log('match claimed integer      :', cnt.valid === 46467509760);
console.log('validity vs FULL 36^7      :', ((cnt.valid / FULL) * 100).toFixed(4) + '%  (code comment: 59.31%)');

const live = run('live');
console.log('\n── LIVE REJECTION SAMPLER (exact per-roll acceptance) ──');
console.log('P(≤2 dup, diagnostic)     :', live.total.toFixed(6));
console.log('EXACT live acceptance     :', (live.valid * 100).toFixed(4) + '%');

// ── EFFECTIVE VARIETY (collision entropy) ─────────────────────────────────────
// "Never play the same board twice" is a DISTRIBUTION claim, not a count claim.
// The live sampler is non-uniform, so the effective number of positions — the count
// that governs birthday-paradox repeats — is the inverse collision probability:
//   N_eff = 1 / Σ p_i²   (a.k.a. participation ratio / exp of Rényi-2 entropy)
//
// Each board = (king file, ordered 7-build tuple). King file is uniform over 8 and
// independent. The army distribution is iid-per-slot CONDITIONED on validity:
//   p(army) = q(army)/Z,  q = Π s(bᵢ),  s(b) = (1/10)·p_b,  Z = live acceptance.
// So Σ_armies p² = (Σ_valid q²)/Z².  Run the SAME DP with weight s(b)² to get Σ_valid q².
function runCollision() {
  const s2 = (b) => Math.pow((1 / 10) * b.p, 2); // s(b)² per slot
  const C = (n, k) => (k === 0 ? 1 : k === 1 ? n : (n * (n - 1)) / 2);
  let dp = new Map();
  dp.set('0|0|0|0', 1);
  for (const key of KEYS) {
    const builds = ARCH[key];
    const isAbs = ABS.has(key);
    const opt1 = builds.map((b) => ({ dL: b.L, dO: b.O, dAbs: isAbs ? 1 : 0, wt: s2(b) }));
    const opt2 = [];
    for (const b1 of builds) for (const b2 of builds)
      opt2.push({ dL: b1.L + b2.L, dO: b1.O + b2.O, dAbs: isAbs ? 2 : 0, wt: s2(b1) * s2(b2) });
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
  let sumQ2 = 0;
  for (const [st, val] of dp) {
    const [slots, L, O, abs] = st.split('|').map(Number);
    if (slots !== 7) continue;
    const D = 70 - L - O;
    if (abs <= 2 && L >= 8 && O >= 8 && D >= 8) sumQ2 += val;
  }
  return sumQ2;
}

const Z = live.valid;                 // live acceptance probability
const sumQ2 = runCollision();         // Σ_valid q²
const sumP2army = sumQ2 / (Z * Z);    // Σ p² over armies
const nEffArmies = 1 / sumP2army;     // effective # of distinct armies
const nEffTotal = 8 * nEffArmies;     // × 8 independent king files

console.log('\n── EFFECTIVE VARIETY (collision entropy, exact) ──');
console.log('distinct valid positions :', (8 * 46467509760).toLocaleString('en-US'), '(the "372 billion")');
console.log('EFFECTIVE positions N_eff :', Math.round(nEffTotal).toLocaleString('en-US'));
console.log('ratio N_eff / 372B        :', (nEffTotal / (8 * 46467509760) * 100).toFixed(2) + '%');
console.log('~50% chance of a repeat at :', Math.round(1.177 * Math.sqrt(nEffTotal)).toLocaleString('en-US'), 'games');
