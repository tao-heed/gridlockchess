// hooks/useProtocolRunDry.ts — Protocol: Run Dry progression system hook
//
// Modular, DRY implementation of the 25-level (5-tier × 5 sub-level) ladder mode. Handles:
// • State management (current tier, best streak, completion modal)
// • LocalStorage persistence (v3; v1→v2→v3 migration on first load)
// • Game-end progression logic
// • Audio cues via provided playSound callback
//
// One bot ladder, one direction: a win advances a tier; a loss or draw holds (no
// regression). Clearing all 25 levels shows the completion celebration and resets the
// ladder to Level 1 for a fresh run. Best streak persists across runs.

import { useState, useRef } from 'react';
import type { PieceColor } from '@/types/game';
import type { BotDifficulty, BotTier } from '@/lib/chess/bot';
import { ALL_DIFFICULTIES, tierOf, subLevelOf, levelIndex } from '@/lib/chess/bot';
import { readJSON, writeJSON } from '@/lib/storage';

// ── Constants ────────────────────────────────────────────────────────────────

/** Full 25-level ladder: basic_1 … master_5. */
export const RUN_DRY_TIERS: BotDifficulty[] = ALL_DIFFICULTIES;

const TIER_DISPLAY_NAMES: Record<BotTier, string> = {
  basic: 'Basic', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert', master: 'Master',
};
const makeTierLabel = (d: BotDifficulty) => ({
  callsign: `Level ${levelIndex(d) + 1}`,
  name: `${TIER_DISPLAY_NAMES[tierOf(d)]} ${subLevelOf(d)}`,
});
export const RUN_DRY_TIER_LABELS: Record<BotDifficulty, { callsign: string; name: string }> =
  Object.fromEntries(ALL_DIFFICULTIES.map(d => [d, makeTierLabel(d)])) as Record<BotDifficulty, { callsign: string; name: string }>;

// v1 storage used old-style difficulty strings (9 tiers); v2 uses the 45-level system.
// v3 (current) uses the 25-level system.
// V1→V2: converts v1 tier INDEX (0-8) to v2 tier INDEX (0-44).
const V1_TIER_TO_V2: readonly number[] = [0, 3, 6, 10, 18, 24, 30, 34, 44];
// Likewise for bestStreak (a 1-based count 0-9 in v1; 0 means nothing cleared).
const V1_STREAK_TO_V2: readonly number[] = [0, 1, 4, 7, 11, 19, 25, 31, 35, 45];
// V2→V3: proportional mapping from 45-level indices to 25-level indices.
const migrateV2Tier = (t: number): number => Math.min(24, Math.round(t * 24 / 44));
const migrateV2Streak = (s: number): number => Math.min(25, Math.round(s * 25 / 45));

const STORAGE_KEY_V1 = 'gridlock:run-dry:v1';
const STORAGE_KEY_V2 = 'gridlock:run-dry:v2';
const STORAGE_KEY = 'gridlock:run-dry:v3';

// ── Types ────────────────────────────────────────────────────────────────────
export interface RunDryProgress {
  tier: number;              // 0-24 (index into RUN_DRY_TIERS) — ladder position
  bestStreak: number;        // highest tier reached in any run (0-25)
}

export type GameStatus = 'playing' | 'waiting' | 'checkmate' | 'stalemate' | 'resigned' | 'draw' | 'gridlock-death' | 'timeout';

export interface UseProtocolRunDryOptions {
  /** Human player's color (default: 'white') */
  humanColor?: PieceColor;
}

export interface UseProtocolRunDryReturn {
  /** Current progress state */
  progress: RunDryProgress;
  /** Active tier index (0-24) */
  tier: number;
  /** Best tier reached in any run */
  bestStreak: number;
  /** Whether completion modal should show */
  showComplete: boolean;
  /** Last game result for custom button rendering ('win' | 'loss' | null) */
  lastResult: 'win' | 'loss' | null;
  /** Current tier's bot difficulty */
  currentDifficulty: BotDifficulty;
  /** Current level number (1-25 for display) */
  currentTierDisplay: number;
  /** Total number of tiers */
  totalTiers: number;
  /** Current tier label info */
  currentTierLabel: { callsign: string; name: string };
  /** Bot levels unlocked via Run Dry — ALL_DIFFICULTIES.slice(0, bestStreak). */
  unlockedBots: BotDifficulty[];
  /** Dismiss the completion modal */
  dismissComplete: () => void;
  /** Clear last result (call when starting a new game) */
  clearLastResult: () => void;
  /** Process game end and update progress. Returns true if level changed. */
  processGameEnd: (status: GameStatus, turn: PieceColor, gameId: number) => boolean;
  /** Reset progress to tier 0 (for "New Run") */
  resetProgress: () => void;
}

// ── Persistence ──────────────────────────────────────────────────────────────
const clampTier = (t: number): number =>
  Math.max(0, Math.min(t, RUN_DRY_TIERS.length - 1));

const loadProgress = (): RunDryProgress => {
  // Check for v3 data first (current schema).
  const parsed = readJSON<Partial<RunDryProgress>>(STORAGE_KEY);
  if (parsed) {
    return {
      tier: clampTier(parsed.tier ?? 0),
      bestStreak: Math.max(1, parsed.bestStreak ?? 1),
    };
  }
  // Migrate v2 data (45-level system) to v3 (25-level system).
  const v2 = readJSON<Partial<RunDryProgress>>(STORAGE_KEY_V2);
  if (v2) {
    const migrated: RunDryProgress = {
      tier: migrateV2Tier(v2.tier ?? 0),
      bestStreak: Math.max(1, migrateV2Streak(v2.bestStreak ?? 0)),
    };
    writeJSON(STORAGE_KEY, migrated);
    localStorage.removeItem(STORAGE_KEY_V2);
    return migrated;
  }
  // Migrate v1 data (old 9-tier system) to v3 (via v2 mapping then v3 mapping).
  const v1 = readJSON<{ tier?: number; bestStreak?: number }>(STORAGE_KEY_V1);
  if (v1) {
    const oldTier = Math.max(0, Math.min(v1.tier ?? 0, 8));
    const oldStreak = Math.max(0, Math.min(v1.bestStreak ?? 0, 9));
    const migrated: RunDryProgress = {
      tier: migrateV2Tier(V1_TIER_TO_V2[oldTier] ?? 0),
      bestStreak: Math.max(1, migrateV2Streak(V1_STREAK_TO_V2[oldStreak] ?? 0)),
    };
    writeJSON(STORAGE_KEY, migrated);
    localStorage.removeItem(STORAGE_KEY_V1);
    return migrated;
  }
  return { tier: 0, bestStreak: 1 };
};

const saveProgress = (p: RunDryProgress): void => {
  writeJSON(STORAGE_KEY, p);
};

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useProtocolRunDry({
  humanColor = 'white',
}: UseProtocolRunDryOptions): UseProtocolRunDryReturn {
  const [progress, setProgress] = useState<RunDryProgress>(loadProgress);
  const [showComplete, setShowComplete] = useState(false);
  const [lastResult, setLastResult] = useState<'win' | 'loss' | null>(null);

  // Prevent double-processing the same game
  const processedGameId = useRef<number | null>(null);

  const currentDifficulty = RUN_DRY_TIERS[progress.tier] ?? 'master_5';
  const currentTierLabel = RUN_DRY_TIER_LABELS[currentDifficulty];
  const unlockedBots = ALL_DIFFICULTIES.slice(0, Math.max(1, progress.bestStreak));

  const dismissComplete = () => {
    setShowComplete(false);
  };

  const resetProgress = () => {
    // "New Run" restarts the climb at Tier 1, preserving the best streak.
    const updated: RunDryProgress = { ...progress, tier: 0 };
    setProgress(updated);
    saveProgress(updated);
    setLastResult(null);
  };

  const clearLastResult = () => {
    setLastResult(null);
  };

  const processGameEnd = (
    status: GameStatus,
    turn: PieceColor,
    gameId: number,
  ): boolean => {
    const botColor = humanColor === 'white' ? 'black' : 'white';

    // Prevent double-processing
    if (processedGameId.current === gameId) return false;

    const isTerminal =
      status === 'checkmate' ||
      status === 'gridlock-death' ||
      status === 'stalemate' ||
      status === 'draw' ||
      status === 'timeout' ||
      status === 'resigned';

    if (!isTerminal) return false;

    processedGameId.current = gameId;

    // Determine the decisive result. Draws (stalemate / draw) are neither.
    // • checkmate: turn is the side that CAN'T move (loser). bot can't move → human won.
    // • gridlock-death: the pilot already passed turn; `turn` is the WINNER.
    // • resigned: turn is the side that resigned.
    // • timeout: a clock only runs for the side to move, so `turn` is the flagged loser.
    const humanWon =
      (status === 'checkmate' && turn === botColor) ||
      (status === 'gridlock-death' && turn === humanColor) ||
      (status === 'timeout' && turn === botColor) ||
      (status === 'resigned' && turn === botColor);

    // The climb: a win advances a tier; a loss or draw holds (no regression).
    if (humanWon) {
      setLastResult('win');
      const newTier = progress.tier + 1;
      const newStreak = newTier;

      if (newTier >= RUN_DRY_TIERS.length) {
        // Completed every tier! 🏆 Celebrate, then reset the ladder to Tier 1 for a fresh run.
        setShowComplete(true);
        const updated: RunDryProgress = {
          ...progress,
          tier: 0,
          bestStreak: Math.max(progress.bestStreak, newStreak),
        };
        setProgress(updated);
        saveProgress(updated);
        return true;
      }
      // Level up!
      const updated: RunDryProgress = {
        ...progress,
        tier: newTier,
        bestStreak: Math.max(progress.bestStreak, newStreak),
      };
      setProgress(updated);
      saveProgress(updated);
      return true;
    }

    // On loss or draw: stay at current level (no regression)
    setLastResult('loss');
    return false;
  };

  return {
    progress,
    tier: progress.tier,
    bestStreak: progress.bestStreak,
    showComplete,
    lastResult,
    currentDifficulty,
    currentTierDisplay: progress.tier + 1,
    totalTiers: RUN_DRY_TIERS.length,
    currentTierLabel,
    unlockedBots,
    dismissComplete,
    clearLastResult,
    processGameEnd,
    resetProgress,
  };
}
