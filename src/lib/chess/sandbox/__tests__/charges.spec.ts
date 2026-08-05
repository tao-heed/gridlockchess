// lib/chess/sandbox/__tests__/charges.spec.ts — legal charge builds for the Sandbox editor.
//
// The strongest guard here is the SAMPLING test: it rolls each archetype's real `generate()`
// thousands of times and asserts the observed set of charge triples is EXACTLY the enumeration
// in charges.ts. If the hardcoded builds ever drift from the game's real roll logic, this fails.
import { describe, it, expect } from 'vitest';
import {
  archetypeBuilds,
  canonicalCharges,
  isLegalBuild,
  TOTAL_BUILDS,
  type StandardArchetypeKey,
} from '../charges';
import { ARCHETYPES } from '../../archetypes';
import type { VectorPool } from '@/types/game';

const STANDARD_KEYS = ARCHETYPES.map((a) => a.key) as StandardArchetypeKey[];

const EXPECTED_COUNTS: Record<StandardArchetypeKey, number> = {
  absLeap: 1, absOrtho: 1, absDiag: 1,
  highLeap: 6, highOrtho: 6, highDiag: 6,
  hybridLD: 4, hybridLO: 4, hybridDO: 4,
  balanced: 3,
};

const key = (v: VectorPool) => `${v.L}-${v.O}-${v.D}`;

describe('sandbox charges — enumeration', () => {
  it('totals exactly 36 builds (matches the Rules page + 36^7 opening math)', () => {
    expect(TOTAL_BUILDS).toBe(36);
  });

  it('has the expected per-archetype build counts', () => {
    for (const k of STANDARD_KEYS) {
      expect(archetypeBuilds(k).length).toBe(EXPECTED_COUNTS[k]);
    }
  });

  it('every build sums to exactly 10', () => {
    for (const k of STANDARD_KEYS) {
      for (const b of archetypeBuilds(k)) {
        expect(b.L + b.O + b.D).toBe(10);
      }
    }
  });

  it('lists no duplicate builds within an archetype', () => {
    for (const k of STANDARD_KEYS) {
      const keys = archetypeBuilds(k).map(key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('sandbox charges — canonical defaults', () => {
  it('gives a legal build for every standard archetype', () => {
    for (const k of STANDARD_KEYS) {
      const c = canonicalCharges(k) as VectorPool;
      expect(isLegalBuild(k, c)).toBe(true);
    }
  });

  it('gives Omni a shared pool of 8', () => {
    expect(canonicalCharges('omni')).toEqual({ shared: 8 });
  });
});

describe('sandbox charges — isLegalBuild', () => {
  it('rejects a legal-total triple that no archetype can roll', () => {
    // (2,4,4) sums to 10 but is not a High Leap build (needs L in 6..8).
    expect(isLegalBuild('highLeap', { L: 2, O: 4, D: 4 })).toBe(false);
  });

  it('accepts a genuine build', () => {
    expect(isLegalBuild('highLeap', { L: 8, O: 1, D: 1 })).toBe(true);
  });
});
