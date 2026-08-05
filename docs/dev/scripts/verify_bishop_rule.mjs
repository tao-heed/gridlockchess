// docs/dev/scripts/verify_bishop_rule.mjs
// Computes the EXACT distinct-position count for Exact 24/23/23 mode AFTER the
// opposite-color bishop-pair placement rule (generator.ts).
//
// The rule: when an army has EXACTLY 2 absDiag pieces (pure D=10 bishops — the only
// color-locked archetype), they must be placed on opposite-color back-rank squares.
// This makes every "two bishops on the same square color" board UNREACHABLE.
//
// Army COUNT is unchanged (743,855,490 ordered exact armies). Only PLACEMENTS shrink.
//
// Math model (validated against generator.ts):
//   • A position = King on 1 of 8 files + 7 anomalies on the other 7 files.
//   • positions_before = 8 × 743,855,490 = 5,950,843,920.
//   • Only exactly-2-absDiag armies are affected. For such an army the 5 non-bishop pieces
//     are all NON-absolute (rule 1 caps total absolutes at 2, both already spent on bishops)
//     and the two bishops contribute (L,O,D) = (0,0,20). So the 5 others must total one of:
//         (L,O,D) ∈ { (23,23,4), (24,23,3), (23,24,3) }   [sum 50; +bishops ⇒ perm of 24/23/23]
//   • Placement factor: over all 8 king files, the number of ways to seat 2 IDENTICAL
//     bishops on SAME-color files is Σ_kingfile [C(e,2)+C(o,2)] = 72, versus 168 total
//     (= 8×C(7,2)). So exactly 72/168 = 3/7 of each affected army's placements are removed.
//   • removed_positions = 72 × oc5, where oc5 = # ordered 5-piece non-absolute armies
//     (≤2 copies each) whose totals hit the target set above.
//
// Reuses the SAME machine-verified build enumeration as verify_exact_balance.mjs.

// ── Build enumeration (identical to verify_exact_balance.mjs) ──────────────────
function highVec() {
  const builds = [];
  for (let h = 6; h <= 8; h++) {
    const total = 10 - h;
    const n = total - 1;
    for (let a = 1; a <= total - 1; a++) builds.push({ h, a, b: total - a });
  }
  return builds;
}

const ARCH = {};
ARCH.highLeap = highVec().map(({ h, a, b }) => ({ L: h, D: a, O: b }));
ARCH.highDiag = highVec().map(({ h, a, b }) => ({ D: h, L: a, O: b }));
ARCH.highOrtho = highVec().map(({ h, a, b }) => ({ O: h, L: a, D: b }));
ARCH.hybridLD = [];
for (let L = 4; L <= 5; L++) for (let O = 0; O <= 1; O++) ARCH.hybridLD.push({ L, O, D: 10 - L - O });
ARCH.hybridLO = [];
for (let L = 4; L <= 5; L++) for (let D = 0; D <= 1; D++) ARCH.hybridLO.push({ L, D, O: 10 - L - D });
ARCH.hybridDO = [];
for (let D = 4; D <= 5; D++) for (let L = 0; L <= 1; L++) ARCH.hybridDO.push({ D, L, O: 10 - D - L });
ARCH.balanced = [
  { L: 4, O: 3, D: 3 },
  { L: 3, O: 4, D: 3 },
  { L: 3, O: 3, D: 4 },
];
ARCH.absLeap = [{ L: 10, O: 0, D: 0 }];
ARCH.absDiag = [{ L: 0, O: 0, D: 10 }];
ARCH.absOrtho = [{ L: 0, O: 10, D: 0 }];

const ABS = new Set(['absLeap', 'absDiag', 'absOrtho']);
const NON_ABS = Object.keys(ARCH).filter((k) => !ABS.has(k));
const C = (n, k) => (k === 0 ? 1 : k === 1 ? n : (n * (n - 1)) / 2);

const isExact242323 = (L, O, D) => {
  const s = [L, O, D].sort((a, b) => a - b);
  return s[0] === 23 && s[1] === 23 && s[2] === 24;
};

// ── Generic ordered-army DP over a chosen archetype set, k slots, ≤2 copies each.
// Tracks (slots, L, O); D is recovered as (10*slots - L - O). Counts DISTINCT ordered
// arrangements, treating identical pieces as indistinguishable (same convention as
// verify_exact_balance.mjs: opt2 enumerates ordered build pairs × C(rem,2) unordered slots).
function dpCount(keys, nSlots) {
  let dp = new Map([['0|0|0', 1]]);
  for (const key of keys) {
    const builds = ARCH[key];
    const opt1 = builds.map((b) => ({ dL: b.L, dO: b.O }));
    const opt2 = [];
    for (const b1 of builds) for (const b2 of builds) opt2.push({ dL: b1.L + b2.L, dO: b1.O + b2.O });
    const next = new Map();
    const add = (k, v) => next.set(k, (next.get(k) || 0) + v);
    for (const [st, val] of dp) {
      const [slots, L, O] = st.split('|').map(Number);
      const rem = nSlots - slots;
      add(st, val);
      if (rem >= 1) for (const o of opt1) add(`${slots + 1}|${L + o.dL}|${O + o.dO}`, val * C(rem, 1));
      if (rem >= 2) for (const o of opt2) add(`${slots + 2}|${L + o.dL}|${O + o.dO}`, val * C(rem, 2));
    }
    dp = next;
  }
  return dp;
}

// ── oc5: ordered 5-piece NON-ABSOLUTE armies whose totals land in the target set ──
const TARGETS = new Set(['23,23,4', '24,23,3', '23,24,3']);
const dp5 = dpCount(NON_ABS, 5);
let oc5 = 0;
for (const [st, val] of dp5) {
  const [slots, L, O] = st.split('|').map(Number);
  if (slots !== 5) continue;
  const D = 50 - L - O;
  if (TARGETS.has(`${L},${O},${D}`)) oc5 += val;
}

// ── Cross-check: full 7-slot exact count, and exactly-2-absDiag subset ─────────
// (a) Re-derive the headline 743,855,490 to prove this script's enumeration matches.
function dpFullExact() {
  // DP over all 10 archetypes tracking (slots,L,O,abs, absDiag) so we can also split out
  // the exactly-2-absDiag subset. abs = total absolutes; ad = absDiag count.
  let dp = new Map([['0|0|0|0|0', 1]]);
  for (const key of Object.keys(ARCH)) {
    const builds = ARCH[key];
    const isAbs = ABS.has(key) ? 1 : 0;
    const isAD = key === 'absDiag' ? 1 : 0;
    const opt1 = builds.map((b) => ({ dL: b.L, dO: b.O, da: isAbs, dad: isAD }));
    const opt2 = [];
    for (const b1 of builds) for (const b2 of builds)
      opt2.push({ dL: b1.L + b2.L, dO: b1.O + b2.O, da: isAbs * 2, dad: isAD * 2 });
    const next = new Map();
    const add = (k, v) => next.set(k, (next.get(k) || 0) + v);
    for (const [st, val] of dp) {
      const [slots, L, O, abs, ad] = st.split('|').map(Number);
      const rem = 7 - slots;
      add(st, val);
      if (rem >= 1) for (const o of opt1)
        add(`${slots + 1}|${L + o.dL}|${O + o.dO}|${abs + o.da}|${ad + o.dad}`, val * C(rem, 1));
      if (rem >= 2) for (const o of opt2)
        add(`${slots + 2}|${L + o.dL}|${O + o.dO}|${abs + o.da}|${ad + o.dad}`, val * C(rem, 2));
    }
    dp = next;
  }
  let full = 0, exactly2AD = 0;
  for (const [st, val] of dp) {
    const [slots, L, O, abs, ad] = st.split('|').map(Number);
    if (slots !== 7) continue;
    const D = 70 - L - O;
    if (abs <= 2 && isExact242323(L, O, D)) {
      full += val;
      if (ad === 2) exactly2AD += val;
    }
  }
  return { full, exactly2AD };
}
const { full, exactly2AD } = dpFullExact();

// ── Results ───────────────────────────────────────────────────────────────────
const ARMIES = 743_855_490;
const POS_BEFORE = 8 * ARMIES;
const removed = 72 * oc5;
const posAfter = POS_BEFORE - removed;

console.log('── SELF-CHECKS ──');
console.log('full exact ordered armies (want 743,855,490):', full.toLocaleString('en-US'),
  full === ARMIES ? '✓' : '✗ MISMATCH');
console.log('exactly-2-absDiag armies  == 21 × oc5        :',
  exactly2AD.toLocaleString('en-US'), '==', (21 * oc5).toLocaleString('en-US'),
  exactly2AD === 21 * oc5 ? '✓' : '✗ MISMATCH');

console.log('\n── BISHOP-RULE POSITION IMPACT ──');
console.log('oc5 (ordered 5-armies hitting target totals):', oc5.toLocaleString('en-US'));
console.log('affected (exactly-2-absDiag) ordered armies :', exactly2AD.toLocaleString('en-US'),
  `(${(exactly2AD / ARMIES * 100).toFixed(4)}% of all armies)`);
console.log('positions BEFORE rule (× 8 king files)      :', POS_BEFORE.toLocaleString('en-US'));
console.log('positions REMOVED (same-color bishop pairs) :', removed.toLocaleString('en-US'));
console.log('positions AFTER rule                        :', posAfter.toLocaleString('en-US'));
console.log('reduction                                   :',
  (removed / POS_BEFORE * 100).toFixed(4) + '%');
