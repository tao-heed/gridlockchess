// lib/chess/__tests__/generator.spec.ts
// Pins the back-rank PLACEMENT rules of generateInitialBoard — in particular the
// opposite-color bishop-pair rule: when a Balanced army rolls the rare pair of pure diagonal
// Absolutes (absDiag, the only genuinely color-locked piece), the two must be placed on
// opposite square colors so each side fields a real light+dark bishop pair.
//
// We mock the army roller so the rare 2×absDiag case is forced deterministically, then assert
// the invariant holds across MANY independent back-rank shuffles (real Math.random) — the rule
// must hold for every King placement, not just a lucky one.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArchetypeKey, Square, Anomaly, Piece, Archetype } from '@/types/game';
import { ARCHETYPES, type GeneratedAnomaly } from '../archetypes';

// Replace only generateBalancedArmy; keep the rest of the module intact.
vi.mock('../balancedArmy', async (importActual) => {
  const actual = await importActual<typeof import('../balancedArmy')>();
  return { ...actual, generateBalancedArmy: vi.fn() };
});

import { generateInitialBoard } from '../generator';
import { generateBalancedArmy } from '../balancedArmy';

const arch = (key: ArchetypeKey): Archetype => {
  const found = ARCHETYPES.find((a) => a.key === key);
  if (!found) throw new Error(`no archetype ${key}`);
  return found;
};

/** Square color parity on any rank: file letter index parity (a=0,b=1,…). Opposite parity
 *  ⇔ opposite square color. */
const fileParity = (sq: Square): number => (sq.charCodeAt(0) - 97) % 2;

/** Build a 7-piece army with `absDiagCount` pure-diagonal Absolutes, padded with harmless
 *  distinct non-absolute archetypes. Fresh objects per call (generator reads by reference). */
const armyWith = (absDiagCount: number): GeneratedAnomaly[] => {
  const filler: ArchetypeKey[] = ['highLeap', 'highOrtho', 'hybridLO', 'balanced', 'hybridLD', 'highDiag', 'hybridDO'];
  const out: GeneratedAnomaly[] = [];
  for (let i = 0; i < absDiagCount; i++) out.push({ archetype: arch('absDiag'), vectors: { L: 0, O: 0, D: 10 } });
  for (let i = 0; out.length < 7; i++) out.push({ archetype: arch(filler[i]!), vectors: { L: 4, O: 3, D: 3 } });
  return out;
};

const absDiagSquares = (): Square[] => {
  const board = generateInitialBoard();
  return (Object.entries(board) as [Square, Piece][])
    .filter(([sq, p]) => sq.endsWith('1') && p.type === 'anomaly' && (p as Anomaly).archetype === 'absDiag')
    .map(([sq]) => sq);
};

beforeEach(() => {
  vi.mocked(generateBalancedArmy).mockReset();
});

describe('generator — opposite-color bishop-pair rule (2× absDiag)', () => {
  it('places the two absDiag pieces on opposite square colors across 500 independent shuffles', () => {
    vi.mocked(generateBalancedArmy).mockImplementation(() => armyWith(2));
    for (let n = 0; n < 500; n++) {
      const sqs = absDiagSquares();
      expect(sqs).toHaveLength(2);
      expect(fileParity(sqs[0]!)).not.toBe(fileParity(sqs[1]!));
    }
  });

  it('never leaves an absDiag unplaced or duplicated (7 anomalies, exactly 2 absDiag) over 500 draws', () => {
    vi.mocked(generateBalancedArmy).mockImplementation(() => armyWith(2));
    for (let n = 0; n < 500; n++) {
      const board = generateInitialBoard();
      const rank1 = (Object.entries(board) as [Square, Piece][]).filter(([sq]) => sq.endsWith('1'));
      const anomalies = rank1.filter(([, p]) => p.type === 'anomaly');
      const kings = rank1.filter(([, p]) => p.type === 'king');
      expect(anomalies).toHaveLength(7);
      expect(kings).toHaveLength(1);
      expect(absDiagSquares()).toHaveLength(2);
    }
  });
});

describe('generator — rule does not disturb the 0/1 absDiag cases', () => {
  it('a single absDiag is placed exactly once and the board is well-formed (500 draws)', () => {
    vi.mocked(generateBalancedArmy).mockImplementation(() => armyWith(1));
    for (let n = 0; n < 500; n++) {
      expect(absDiagSquares()).toHaveLength(1);
    }
  });

  it('zero absDiag → board still has 7 anomalies + 1 king per rank (500 draws)', () => {
    vi.mocked(generateBalancedArmy).mockImplementation(() => armyWith(0));
    for (let n = 0; n < 500; n++) {
      expect(absDiagSquares()).toHaveLength(0);
      const board = generateInitialBoard();
      const rank1 = (Object.entries(board) as [Square, Piece][]).filter(([sq]) => sq.endsWith('1'));
      expect(rank1).toHaveLength(8);
    }
  });
});
