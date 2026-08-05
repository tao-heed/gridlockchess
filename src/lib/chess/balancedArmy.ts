// lib/chess/balancedArmy.ts — Balanced (exact 24/23/23) macro-balanced army generator.
//
// BALANCED GENERATION RULES (the single source of truth — the old rejection-sampling
// "Wild"/curated modes with maxAbsolute/maxDuplicates/minVectorTotal/maxTries are GONE):
//   Rule 1 — EXACT VECTOR SUM: the 7 Anomalies' combined charges must equal a permutation
//            of {24, 23, 23} over Leap/Orthogonal/Diagonal. Enforced by isExact242323().
//            This is the governing rule; both armies are mirrored, so both share this budget.
//   Rule 2 — ≤ 2 ABSOLUTES: at most two single-vector pieces (all 10 charges in one vector:
//            absLeap/absOrtho/absDiag). Enforced by `if (abs > 2) return 0` in completions().
//   Rule 3 — ≤ 2 DUPLICATES: at most two copies of any one archetype. Enforced structurally —
//            the DP only ever enumerates 0/1/2 copies per archetype (choose(rem, k), k ≤ 2).
//   (Old rule "each vector total ≥ 8" is now automatic, since every total is 23 or 24 ≥ 8.)
//   Placement rule (opposite-color bishop pair) lives in generator.ts, applied AFTER sampling.
//
// WHAT & WHY
// ----------
// The old "Wild" mode rolled every Anomaly independently, so a board could come out
// lopsided. This module replaces it with a generator that guarantees every army's charges
// sum to EXACTLY a permutation of {24, 23, 23} across the three vectors (Leap / Orthogonal /
// Diagonal), while still honouring the two structural curation rules:
//   1. ≤ 2 Absolute pieces (single-vector archetypes).
//   2. ≤ 2 copies of any one archetype.
// (The old rule 3 — each vector total ≥ 8 — is automatically satisfied, since 23 ≥ 8.)
//
// HOW (uniform, no rejection)
// ---------------------------
// Rejection sampling is non-viable here: a raw 7-roll hits the exact target only ~0.44% of
// the time (see docs/dev/scripts/verify_exact_balance.mjs, plan task T1), so ~1 in 6 games would fall
// back to an INVALID army. Instead we sample UNIFORMLY over the exact-valid army space via a
// dynamic-programming count table (the same enumeration proved correct in
// docs/dev/scripts/verify_exact_balance.mjs). We:
//   1. Memoise `completions(i, slots, L, O, abs)` = the number of ordered ways to fill the
//      remaining slots to an exact-valid army using archetypes i..N.
//   2. Walk that table forward, choosing each archetype's copy-count and builds with
//      probability proportional to the completions they lead to.
//   3. Emit the 7 rolled pieces; the caller's file shuffle (generateBackRank) turns this
//      into a uniformly random ordered position.
// This yields an exact, uniform, fallback-free army in O(archetypes × builds) per draw after
// a one-time table build.
//
// SYMMETRY NOTE: the archetype set is invariant under permuting L/O/D, so uniform sampling
// gives each vector an equal 1/3 chance of being the "24" — no special weighting needed. And
// because both armies are mirrored (generator.ts), fairness holds regardless of which vector
// leads.
import type { ArchetypeKey, VectorPool } from '@/types/game';
import { ARCHETYPES, getArchetype, type GeneratedAnomaly } from './archetypes';

const SLOTS = 7;
const ABSOLUTE_KEYS: ReadonlySet<ArchetypeKey> = new Set<ArchetypeKey>([
  'absLeap',
  'absDiag',
  'absOrtho',
]);

/** Every concrete VectorPool a starting archetype can roll. Mirrors each archetype's
 *  `generate()` support in archetypes.ts (guarded against drift by balancedArmy.spec.ts). */
export const enumerateBuilds = (key: ArchetypeKey): VectorPool[] => {
  switch (key) {
    case 'absLeap':
      return [{ L: 10, O: 0, D: 0 }];
    case 'absDiag':
      return [{ L: 0, O: 0, D: 10 }];
    case 'absOrtho':
      return [{ L: 0, O: 10, D: 0 }];
    case 'highLeap': {
      const out: VectorPool[] = [];
      for (let L = 6; L <= 8; L++)
        for (let D = 1; D <= 10 - L - 1; D++) out.push({ L, O: 10 - L - D, D });
      return out;
    }
    case 'highDiag': {
      const out: VectorPool[] = [];
      for (let D = 6; D <= 8; D++)
        for (let L = 1; L <= 10 - D - 1; L++) out.push({ L, O: 10 - D - L, D });
      return out;
    }
    case 'highOrtho': {
      const out: VectorPool[] = [];
      for (let O = 6; O <= 8; O++)
        for (let L = 1; L <= 10 - O - 1; L++) out.push({ L, O, D: 10 - O - L });
      return out;
    }
    case 'hybridLD': {
      const out: VectorPool[] = [];
      for (let L = 4; L <= 5; L++)
        for (let O = 0; O <= 1; O++) out.push({ L, O, D: 10 - L - O });
      return out;
    }
    case 'hybridLO': {
      const out: VectorPool[] = [];
      for (let L = 4; L <= 5; L++)
        for (let D = 0; D <= 1; D++) out.push({ L, O: 10 - L - D, D });
      return out;
    }
    case 'hybridDO': {
      const out: VectorPool[] = [];
      for (let D = 4; D <= 5; D++)
        for (let L = 0; L <= 1; L++) out.push({ L, O: 10 - D - L, D });
      return out;
    }
    case 'balanced':
      return [
        { L: 4, O: 3, D: 3 },
        { L: 3, O: 4, D: 3 },
        { L: 3, O: 3, D: 4 },
      ];
    default:
      return []; // 'omni' is promotion-only and never on the starting rank.
  }
};

/** Starting archetype keys in registry order (Omni excluded — promotion only). */
const KEYS: readonly ArchetypeKey[] = ARCHETYPES.map((a) => a.key);
const BUILDS: readonly VectorPool[][] = KEYS.map((k) => enumerateBuilds(k));

/** sorted(L,O,D) === [23,23,24] — the exact 24/23/23 multiset. */
const isExact242323 = (L: number, O: number, D: number): boolean => {
  const s = [L, O, D].sort((a, b) => a - b);
  return s[0] === 23 && s[1] === 23 && s[2] === 24;
};

/** n-choose-k for k ∈ {0,1,2} (all we ever need for ≤2 copies). */
const choose = (n: number, k: number): number =>
  k <= 0 ? 1 : k === 1 ? n : (n * (n - 1)) / 2;

// ── Memoised completion counts ────────────────────────────────────────────────
// completions(i, slots, L, O, abs) = number of ordered ways to fill the remaining
// (7 - slots) slots into an exact-valid army, using archetypes KEYS[i..].
const memo = new Map<string, number>();

const completions = (
  i: number,
  slots: number,
  L: number,
  O: number,
  abs: number,
): number => {
  if (abs > 2) return 0;
  if (i === KEYS.length) {
    return slots === SLOTS && isExact242323(L, O, 70 - L - O) ? 1 : 0;
  }
  const cacheKey = `${i}|${slots}|${L}|${O}|${abs}`;
  const cached = memo.get(cacheKey);
  if (cached !== undefined) return cached;

  const builds = BUILDS[i]!;
  const isAbs = ABSOLUTE_KEYS.has(KEYS[i]!) ? 1 : 0;
  const rem = SLOTS - slots;

  // 0 copies of this archetype.
  let total = completions(i + 1, slots, L, O, abs);

  // 1 copy.
  if (rem >= 1) {
    const c1 = choose(rem, 1);
    for (const b of builds) {
      total += c1 * completions(i + 1, slots + 1, L + b.L, O + b.O, abs + isAbs);
    }
  }

  // 2 copies (ordered build pairs, so distinct-build multisets get their true weight).
  if (rem >= 2) {
    const c2 = choose(rem, 2);
    for (const b1 of builds) {
      for (const b2 of builds) {
        total +=
          c2 *
          completions(i + 1, slots + 2, L + b1.L + b2.L, O + b1.O + b2.O, abs + 2 * isAbs);
      }
    }
  }

  memo.set(cacheKey, total);
  return total;
};

/** Total number of ordered exact-valid armies (should equal 743,855,490 — plan T2). */
export const balancedArmyCount = (): number => completions(0, 0, 0, 0, 0);

// ── Uniform sampler ───────────────────────────────────────────────────────────
type Choice = { pieces: VectorPool[]; dSlots: number; dL: number; dO: number; dAbs: number };

/** Enumerate every copy-choice for archetype i at the current remaining-slot budget,
 *  paired with the completion count it leads to (its sampling weight). */
const weightedChoices = (
  i: number,
  slots: number,
  L: number,
  O: number,
  abs: number,
): { choice: Choice; weight: number }[] => {
  const builds = BUILDS[i]!;
  const isAbs = ABSOLUTE_KEYS.has(KEYS[i]!) ? 1 : 0;
  const rem = SLOTS - slots;
  const out: { choice: Choice; weight: number }[] = [];

  const push = (choice: Choice, local: number) => {
    const w =
      local *
      completions(i + 1, slots + choice.dSlots, L + choice.dL, O + choice.dO, abs + choice.dAbs);
    if (w > 0) out.push({ choice, weight: w });
  };

  push({ pieces: [], dSlots: 0, dL: 0, dO: 0, dAbs: 0 }, 1);

  if (rem >= 1) {
    const c1 = choose(rem, 1);
    for (const b of builds) {
      push({ pieces: [b], dSlots: 1, dL: b.L, dO: b.O, dAbs: isAbs }, c1);
    }
  }

  if (rem >= 2) {
    const c2 = choose(rem, 2);
    for (const b1 of builds) {
      for (const b2 of builds) {
        push(
          {
            pieces: [b1, b2],
            dSlots: 2,
            dL: b1.L + b2.L,
            dO: b1.O + b2.O,
            dAbs: 2 * isAbs,
          },
          c2,
        );
      }
    }
  }

  return out;
};

/** Pick one weighted choice proportional to its weight (all weights are positive ints). */
const pickWeighted = (choices: { choice: Choice; weight: number }[]): Choice => {
  let sum = 0;
  for (const c of choices) sum += c.weight;
  let r = Math.random() * sum;
  for (const c of choices) {
    r -= c.weight;
    if (r < 0) return c.choice;
  }
  return choices[choices.length - 1]!.choice; // float-rounding safety net
};

/**
 * Generate an army of `count` anomalies whose charges sum to EXACTLY a permutation of
 * {24, 23, 23}, sampled uniformly over all such armies that also satisfy rules 1 & 2.
 * `count` must be 7 (the Gridlock back-rank size the DP is built for).
 */
export const generateBalancedArmy = (count: number): GeneratedAnomaly[] => {
  if (count !== SLOTS) {
    throw new Error(`generateBalancedArmy expects count=${SLOTS}, got ${count}`);
  }
  // Warm the table (and assert the space is non-empty) before sampling.
  if (completions(0, 0, 0, 0, 0) === 0) {
    throw new Error('balancedArmy: no valid 24/23/23 armies — enumeration is broken');
  }

  const builds: { key: ArchetypeKey; vectors: VectorPool }[] = [];
  let slots = 0;
  let L = 0;
  let O = 0;
  let abs = 0;

  for (let i = 0; i < KEYS.length; i++) {
    const choice = pickWeighted(weightedChoices(i, slots, L, O, abs));
    for (const v of choice.pieces) builds.push({ key: KEYS[i]!, vectors: v });
    slots += choice.dSlots;
    L += choice.dL;
    O += choice.dO;
    abs += choice.dAbs;
  }

  return builds.map(({ key, vectors }) => {
    const archetype = getArchetype(key);
    if (!archetype || archetype.key === 'omni') {
      throw new Error(`balancedArmy: unexpected archetype ${key}`);
    }
    // Clone the pooled build so callers (charge depletion, tests) never mutate the
    // shared module-level BUILDS table that the DP memo is computed against.
    return { archetype, vectors: { ...vectors } };
  });
};
