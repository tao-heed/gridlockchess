// @vitest-environment jsdom
// hooks/__tests__/useChessClock.spec.ts — wall-clock correctness for the chess clock.
//
// Fake timers here fake BOTH `Date.now()` and `setInterval`, so `vi.advanceTimersByTime`
// moves wall time and fires the 250ms pump together — exactly the coupling the hook relies on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChessClock, type UseChessClockParams } from '../useChessClock';
import type { TimeControl } from '@/constants/timeControls';

const RAPID_10_0: TimeControl = { baseMs: 600_000, incrementMs: 0 };
const RAPID_10_5: TimeControl = { baseMs: 600_000, incrementMs: 5_000 };
/** Tiny control so a flag can be reached in a few advanced ms. */
const TINY: TimeControl = { baseMs: 1_000, incrementMs: 5_000 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(overrides: Partial<UseChessClockParams> = {}) {
  const onFlag = vi.fn();
  const initialProps: UseChessClockParams = {
    timeControl: RAPID_10_0,
    activeColor: 'white',
    running: true,
    onFlag,
    ...overrides,
  };
  const utils = renderHook((props: UseChessClockParams) => useChessClock(props), {
    initialProps,
  });
  return { onFlag, ...utils };
}

describe('useChessClock — disabled', () => {
  it('is inert with no time control', () => {
    const { result } = setup({ timeControl: null });
    expect(result.current.enabled).toBe(false);
    expect(result.current.whiteMs).toBe(0);
    expect(result.current.blackMs).toBe(0);
  });
});

describe('useChessClock — countdown', () => {
  it('counts down only the active side from Date.now()', () => {
    const { result } = setup();
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.whiteMs).toBe(597_000);
    expect(result.current.blackMs).toBe(600_000);
  });

  it('freezes the clock while paused, then resumes', () => {
    const base: TimeControl = { baseMs: 10_000, incrementMs: 0 };
    const { result, rerender, onFlag } = setup({ timeControl: base });
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current.whiteMs).toBe(8_000);

    // Pause: no interval runs and wall-time advances do not drain the clock.
    rerender({ timeControl: base, activeColor: 'white', running: false, onFlag });
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.whiteMs).toBe(8_000);

    // Resume: counting continues from where it left off.
    rerender({ timeControl: base, activeColor: 'white', running: true, onFlag });
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.whiteMs).toBe(7_000);
  });
});

describe('useChessClock — Fischer increment', () => {
  it('banks elapsed and adds the increment to the side that just moved', () => {
    const { result, rerender, onFlag } = setup({ timeControl: RAPID_10_5 });
    act(() => vi.advanceTimersByTime(4_000));
    // Turn passes to black — white completed a move.
    rerender({ timeControl: RAPID_10_5, activeColor: 'black', running: true, onFlag });

    // white: 600000 - 4000 + 5000 = 601000 (banked, inactive).
    expect(result.current.whiteMs).toBe(601_000);
    // black now runs from a full clock.
    expect(result.current.blackMs).toBe(600_000);

    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current.blackMs).toBe(598_000);
    expect(result.current.whiteMs).toBe(601_000);
  });
});

describe('useChessClock — flagging', () => {
  it('fires onFlag exactly once for the side that ran out', () => {
    const { result, onFlag } = setup({ timeControl: { baseMs: 1_000, incrementMs: 0 } });
    act(() => vi.advanceTimersByTime(1_200));
    expect(onFlag).toHaveBeenCalledTimes(1);
    expect(onFlag).toHaveBeenCalledWith('white');
    expect(result.current.flagged).toBe(true);
    expect(result.current.whiteMs).toBe(0);

    act(() => vi.advanceTimersByTime(2_000));
    expect(onFlag).toHaveBeenCalledTimes(1); // latched — never fires twice
  });

  it('does not award increment to a side that flagged', () => {
    const { result, rerender, onFlag } = setup({ timeControl: TINY });
    act(() => vi.advanceTimersByTime(1_200)); // white flags
    expect(result.current.whiteMs).toBe(0);
    // A turn change after the flag must NOT resurrect white via the increment.
    rerender({ timeControl: TINY, activeColor: 'black', running: true, onFlag });
    expect(result.current.whiteMs).toBe(0);
  });
});

describe('useChessClock — snapshot & reset', () => {
  it('snapshot banks the running segment', () => {
    const base: TimeControl = { baseMs: 10_000, incrementMs: 0 };
    const { result } = setup({ timeControl: base });
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.snapshot()).toEqual({ white: 7_000, black: 10_000 });
  });

  it('reset restores base and clears the flag', () => {
    const { result } = setup({ timeControl: { baseMs: 1_000, incrementMs: 0 } });
    act(() => vi.advanceTimersByTime(1_200));
    expect(result.current.flagged).toBe(true);
    act(() => result.current.reset());
    expect(result.current.flagged).toBe(false);
    expect(result.current.whiteMs).toBe(1_000);
    expect(result.current.blackMs).toBe(1_000);
  });
});

describe('useChessClock — resume', () => {
  it('starts from initialRemaining when provided', () => {
    const { result } = setup({
      timeControl: { baseMs: 600_000, incrementMs: 0 },
      initialRemaining: { white: 300_000, black: 250_000 },
    });
    expect(result.current.whiteMs).toBe(300_000);
    expect(result.current.blackMs).toBe(250_000);
    act(() => vi.advanceTimersByTime(2_000));
    expect(result.current.whiteMs).toBe(298_000);
    expect(result.current.blackMs).toBe(250_000);
  });
});

describe('useChessClock — resetKey', () => {
  it('restores both clocks to base and restarts the segment when resetKey changes', () => {
    const base: TimeControl = { baseMs: 10_000, incrementMs: 0 };
    const onFlag = vi.fn();
    const { result, rerender } = renderHook((props: UseChessClockParams) => useChessClock(props), {
      initialProps: {
        timeControl: base,
        activeColor: 'white',
        running: true,
        onFlag,
        resetKey: 'game-1',
      },
    });
    act(() => vi.advanceTimersByTime(3_000));
    expect(result.current.whiteMs).toBe(7_000);

    // New game: bumping resetKey restores base for both sides and starts a fresh segment.
    act(() =>
      rerender({ timeControl: base, activeColor: 'white', running: true, onFlag, resetKey: 'game-2' }),
    );
    expect(result.current.whiteMs).toBe(10_000);
    expect(result.current.blackMs).toBe(10_000);

    // The restarted segment keeps counting the active side.
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.whiteMs).toBe(9_000);
  });

  it('does not reset on first mount so a resumed clock is preserved', () => {
    const { result } = setup({
      timeControl: { baseMs: 600_000, incrementMs: 0 },
      initialRemaining: { white: 120_000, black: 90_000 },
      resetKey: 'game-1',
    });
    // First mount must not clobber the resumed remaining with base.
    expect(result.current.whiteMs).toBe(120_000);
    expect(result.current.blackMs).toBe(90_000);
  });
});
