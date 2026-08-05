// lib/chess/__tests__/balancedArmy.spec.ts
// Pins the Balanced (exact 24/23/23) generator's guarantees and its agreement with the
// machine-verified enumeration in docs/dev/scripts/verify_exact_balance.mjs (plan tasks T1–T3):
//   • the uniform DP counts exactly 743,855,490 ordered valid armies (T2);
//   • every generated army sums to a permutation of {24,23,23} and obeys rules 1 & 2;
//   • the per-archetype build enumeration never drifts from each archetype's live generate().
import { describe, it, expect, afterEach } from 'vitest';
import { generateBalancedArmy, balancedArmyCount, enumerateBuilds } from '../balancedArmy';
import { ARCHETYPES } from '../archetypes';
import type { ArchetypeKey } from '@/types/game';

const ABSOLUTE: ReadonlySet<ArchetypeKey> = new Set(['absLeap', 'absDiag', 'absOrtho']);
const vecKey = (v: { L: number; O: number; D: number }) => `${v.L},${v.O},${v.D}`;

/** Deterministic 32-bit PRNG (mulberry32) — lets us seed Math.random so the statistical
 *  uniformity test is exactly reproducible and can never flake. */
const mulberry32 = (seed: number) => (): number => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('balancedArmy — enumeration', () => {
  it('counts exactly 743,855,490 ordered valid armies (matches verify_exact_balance.mjs T2)', () => {
    expect(balancedArmyCount()).toBe(743_855_490);
  });
});

describe('balancedArmy — build enumeration matches live generate() (drift guard)', () => {
  for (const arch of ARCHETYPES) {
    it(`${arch.key}: every generate() output is an enumerated build, and every build is reachable`, () => {
      const enumerated = new Set(enumerateBuilds(arch.key).map(vecKey));
      expect(enumerated.size).toBeGreaterThan(0);

      const seen = new Set<string>();
      for (let i = 0; i < 4000; i++) {
        const v = arch.generate();
        const k = vecKey(v);
        expect(v.L + v.O + v.D).toBe(10); // every archetype rolls exactly 10 charges
        expect(enumerated.has(k)).toBe(true); // no output outside the enumeration
        seen.add(k);
      }
      // With 4000 samples every enumerated build should have appeared (supports are small).
      expect(seen.size).toBe(enumerated.size);
    });
  }
});

describe('balancedArmy — generated armies always satisfy the exact rule + curation rules', () => {
  it('1000 armies each sum to a permutation of {24,23,23} with ≤2 absolutes and ≤2 duplicates', () => {
    for (let n = 0; n < 1000; n++) {
      const army = generateBalancedArmy(7);
      expect(army).toHaveLength(7);

      let L = 0;
      let O = 0;
      let D = 0;
      let absolutes = 0;
      const counts = new Map<ArchetypeKey, number>();

      for (const { archetype, vectors } of army) {
        expect(vectors.L + vectors.O + vectors.D).toBe(10);
        L += vectors.L;
        O += vectors.O;
        D += vectors.D;
        if (ABSOLUTE.has(archetype.key)) absolutes++;
        counts.set(archetype.key, (counts.get(archetype.key) ?? 0) + 1);
      }

      expect(L + O + D).toBe(70);
      expect([L, O, D].sort((a, b) => a - b)).toEqual([23, 23, 24]);
      expect(absolutes).toBeLessThanOrEqual(2);
      for (const c of counts.values()) expect(c).toBeLessThanOrEqual(2);
    }
  });

  it('rejects a non-7 count', () => {
    expect(() => generateBalancedArmy(6)).toThrow();
  });

  it('over many draws, each of the three vectors takes the "24" (symmetric sampling)', () => {
    const leads = { L: 0, O: 0, D: 0 };
    for (let n = 0; n < 600; n++) {
      const army = generateBalancedArmy(7);
      let L = 0;
      let O = 0;
      let D = 0;
      for (const { vectors } of army) {
        L += vectors.L;
        O += vectors.O;
        D += vectors.D;
      }
      if (L === 24) leads.L++;
      else if (O === 24) leads.O++;
      else leads.D++;
    }
    expect(leads.L).toBeGreaterThan(0);
    expect(leads.O).toBeGreaterThan(0);
    expect(leads.D).toBeGreaterThan(0);
  });
});

describe('balancedArmy — symmetric lead distribution (deterministic χ²)', () => {
  const realRandom = Math.random;
  afterEach(() => {
    Math.random = realRandom;
  });

  it(
    'makes each vector the "24" with equal 1/3 frequency (χ² below the 0.1% critical value)',
    () => {
      // By symmetry of the archetype set under permuting L/O/D, the valid-army count splits
      // EXACTLY into thirds — so a correct sampler makes each vector the "24" with probability
      // 1/3. (743,855,490 / 3 = 247,951,830 armies per leading vector.)
      // NOTE: this checks only the MARGINAL "which vector leads" distribution — a necessary
      // (not sufficient) condition for full uniformity. True per-army uniformity rests on the
      // proportional-to-completions sampling proof + the count matching verify_exact_balance.mjs.
      expect(balancedArmyCount() % 3).toBe(0);

      // Deterministic (fixed seed) → the χ² statistic is a single reproducible number, so the
      // pass/fail result NEVER flakes. 9,000 draws keeps it fast while giving ample power to
      // catch gross bias (one vector favoured drives χ² into the hundreds).
      Math.random = mulberry32(0x9e3779b9);
      const N = 9_000;
      const leads = { L: 0, O: 0, D: 0 };
      for (let n = 0; n < N; n++) {
        let L = 0;
        let O = 0;
        let D = 0;
        for (const { vectors } of generateBalancedArmy(7)) {
          L += vectors.L;
          O += vectors.O;
          D += vectors.D;
        }
        if (L === 24) leads.L++;
        else if (O === 24) leads.O++;
        else leads.D++;
      }

      const expected = N / 3;
      const chi = (['L', 'O', 'D'] as const).reduce(
        (s, k) => s + (leads[k] - expected) ** 2 / expected,
        0,
      );
      // χ² with df=2 has a 0.1%-significance critical value of 13.816. A correct sampler sits
      // far below it; a biased one blows past it into the hundreds.
      expect(chi).toBeLessThan(13.816);
    },
    30_000, // generous timeout: deterministic work, but shielded from CI/machine-load stalls
  );
});

describe('balancedArmy — mutating a returned army must not corrupt future draws (shared-ref regression)', () => {
  it('depleting a returned army\'s charges leaves every later draw valid (crashed before the clone fix)', () => {
    const sum = (army: ReturnType<typeof generateBalancedArmy>) =>
      army.reduce(
        (s, { vectors }) => ({ L: s.L + vectors.L, O: s.O + vectors.O, D: s.D + vectors.D }),
        { L: 0, O: 0, D: 0 },
      );

    // First draw is a valid 24/23/23 army…
    const first = generateBalancedArmy(7);
    {
      const { L, O, D } = sum(first);
      expect([L, O, D].sort((a, b) => a - b)).toEqual([23, 23, 24]);
    }

    // …now DESTROY its vectors in place, exactly as charge depletion / board mutation would.
    // Before the fix these objects were shared with the module-level BUILDS table, so this
    // desynced BUILDS from the memoised DP counts → the sampler hit an empty choice set and
    // threw. After the fix each returned vector is a private clone, so BUILDS is untouched.
    for (const { vectors } of first) {
      vectors.L = 99;
      vectors.O = 99;
      vectors.D = 99;
    }

    for (let n = 0; n < 300; n++) {
      const { L, O, D } = sum(generateBalancedArmy(7));
      expect(L + O + D).toBe(70);
      expect([L, O, D].sort((a, b) => a - b)).toEqual([23, 23, 24]);
    }
  });
});
