// constants/timeControls.ts — Chess clock time-control options (Bullet → Classical).
//
// The full speed ladder is offered so players can FEEL how time pressure reshapes Gridlock: Bullet
// and Blitz are deliberately chaotic — the charge/vector math can't be computed at speed, so they're
// fast, intuitive, high-variance fun — while Rapid and Classical reward the calculation the game is
// built on. Fischer model: each side starts with `baseMs` and gains `incrementMs` on every move.

import type { PieceColor } from '@/types/game';

/** A single clock configuration. "No clock" is represented by a `null` control, not here. */
export interface TimeControl {
  /** Starting time per side, in milliseconds. */
  baseMs: number;
  /** Fischer increment added to a side's clock on each completed move, in ms. */
  incrementMs: number;
}

/** Live remaining time for both sides, in milliseconds. */
export interface ClockRemaining {
  white: number;
  black: number;
}

/** Stable identifier for a menu option, including the clock-less default. */
export type TimeControlId = 'none' | '1+0' | '3+2' | '10+0' | '10+5' | '15+10' | '30+20';

export interface TimeControlOption {
  id: TimeControlId;
  /** Short menu label. */
  label: string;
  /** `null` → play with no clock. */
  control: TimeControl | null;
  /** Display category shown next to the clock label; omitted for "No clock". */
  category?: 'Bullet' | 'Blitz' | 'Rapid' | 'Classical';
  /** Marks the newcomer-friendly sweet spot, highlighted in the menu. */
  recommended?: boolean;
}

/** The menu options, fastest → slowest (after "No clock"). "No clock" is the default. */
export const TIME_CONTROL_OPTIONS: readonly TimeControlOption[] = [
  { id: 'none', label: 'No clock', control: null },
  { id: '1+0', label: '1 + 0', control: { baseMs: 60_000, incrementMs: 0 }, category: 'Bullet' },
  { id: '3+2', label: '3 + 2', control: { baseMs: 180_000, incrementMs: 2_000 }, category: 'Blitz' },
  { id: '10+0', label: '10 + 0', control: { baseMs: 600_000, incrementMs: 0 }, category: 'Rapid' },
  { id: '10+5', label: '10 + 5', control: { baseMs: 600_000, incrementMs: 5_000 }, category: 'Rapid', recommended: true },
  { id: '15+10', label: '15 + 10', control: { baseMs: 900_000, incrementMs: 10_000 }, category: 'Rapid' },
  { id: '30+20', label: '30 + 20', control: { baseMs: 1_800_000, incrementMs: 20_000 }, category: 'Classical' },
] as const;

/** Quick Match always runs this clock — optimised for deliberate charge reasoning. */
export const QUICK_MATCH_TIME_CONTROL: TimeControlId = '10+5';

/** Look up an option by id; falls back to "No clock" for an unknown id. */
export function getTimeControlOption(id: TimeControlId): TimeControlOption {
  return TIME_CONTROL_OPTIONS.find((o) => o.id === id) ?? TIME_CONTROL_OPTIONS[0];
}

/** The other color — small shared helper so clock code needn't re-derive it. */
export function opposite(color: PieceColor): PieceColor {
  return color === 'white' ? 'black' : 'white';
}

/**
 * Format a remaining-time value for the clock face.
 * - >= 10s: `M:SS` (e.g. `10:00`, `1:05`, `0:34`).
 * - <  10s: one decimal of tenths (e.g. `9.4`, `0.3`) — standard for a Rapid finish.
 * Negative inputs clamp to 0.
 */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped < 10_000) {
    return (clamped / 1000).toFixed(1);
  }
  const totalSec = Math.floor(clamped / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
