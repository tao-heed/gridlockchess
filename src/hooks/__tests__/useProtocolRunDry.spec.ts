// @vitest-environment jsdom
// hooks/useProtocolRunDry.spec.ts — behavioral tests for the Protocol: Run Dry
// progression hook: a 25-level climb (win advances, loss/draw holds, full clear
// celebrates and resets to Tier 1). processGameEnd() de-dupes by gameId, so every call
// below uses a fresh id.
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProtocolRunDry, type RunDryProgress } from '../useProtocolRunDry';

const STORAGE_KEY = 'gridlock:run-dry:v3';

/** Seed persisted progress before the hook mounts (loadProgress reads on first render). */
const seed = (p: Partial<RunDryProgress>) => {
  const full: RunDryProgress = {
    tier: 0,
    bestStreak: 0,
    ...p,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
};

let gid = 0;
/** A checkmate that the human (white) delivers → bot (black) can't move → human won. */
const win = (result: { current: ReturnType<typeof useProtocolRunDry> }) =>
  act(() => { result.current.processGameEnd('checkmate', 'black', ++gid); });
/** A checkmate against the human → white can't move → human lost. */
const loss = (result: { current: ReturnType<typeof useProtocolRunDry> }) =>
  act(() => { result.current.processGameEnd('checkmate', 'white', ++gid); });

beforeEach(() => {
  localStorage.clear();
  gid = 0;
});

describe('useProtocolRunDry — initial state', () => {
  it('starts at Tier 1', () => {
    const { result } = renderHook(() => useProtocolRunDry({}));
    expect(result.current.tier).toBe(0);
    expect(result.current.currentTierDisplay).toBe(1);
    expect(result.current.totalTiers).toBe(25);
  });
});

describe('useProtocolRunDry — the climb', () => {
  it('advances a tier on a win', () => {
    const { result } = renderHook(() => useProtocolRunDry({}));
    win(result);
    expect(result.current.tier).toBe(1);
    expect(result.current.lastResult).toBe('win');
  });

  it('holds the tier on a loss (no regression)', () => {
    seed({ tier: 3 });
    const { result } = renderHook(() => useProtocolRunDry({}));
    loss(result);
    expect(result.current.tier).toBe(3);
    expect(result.current.lastResult).toBe('loss');
  });

  it('clearing all 25 tiers shows completion and resets to Tier 1', () => {
    seed({ tier: 24, bestStreak: 24 });
    const { result } = renderHook(() => useProtocolRunDry({}));
    win(result);
    expect(result.current.showComplete).toBe(true);
    expect(result.current.tier).toBe(0);
    expect(result.current.progress.bestStreak).toBe(25);
  });
});
