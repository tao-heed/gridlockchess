// components/game/modals/ProtocolRunDryModal.tsx — Protocol: Run Dry completion celebration modal
//
// Displayed when the player conquers all tiers. Features:
// • Grand entrance animation (scale + glow)
// • Trophy icon with spin-in effect
// • Stats display (tiers cleared, best streak)
// • A single dismiss action — the player savors the final board.

import { motion, AnimatePresence } from 'framer-motion';
import { BOT_TIERS } from '@/lib/chess/bot';
import { RUN_DRY_TIERS, type RunDryProgress } from '@/hooks/useProtocolRunDry';

// Each tier spans 5 sub-levels; 5 tiers × 5 = 25 total. The progress bar shows 5 tier segments
// instead of 25 tiny individual segments (which would be ~4% wide each, unreadable).
const TIER_SIZE = 5; // sub-levels per tier

export interface ProtocolRunDryModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Current progress (for stats display) */
  progress: RunDryProgress;
  /** Called when the user dismisses the modal to view the final board */
  onClose: () => void;
}

export function ProtocolRunDryModal({
  isOpen,
  progress,
  onClose,
}: ProtocolRunDryModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 bg-black/90 backdrop-blur-lg flex items-center justify-center z-[60] p-4"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0, y: 40 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="relative overflow-hidden bg-gc-panel/95 backdrop-blur-xl border border-gc-accent/30 rounded-3xl max-w-md w-full p-8 text-center shadow-[0_0_80px_rgba(34,224,255,0.3)]"
          >
            {/* Decorative glow ring */}
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-gc-accent/20 via-transparent to-gc-violet/20 pointer-events-none" />
            
            {/* Trophy icon */}
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
              className="text-7xl mb-4 drop-shadow-[0_0_30px_rgba(34,224,255,0.6)]"
            >
              🏆
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-3xl font-black bg-gradient-to-r from-gc-accent via-gc-violet to-gc-accent bg-clip-text text-transparent mb-2"
            >
              PROTOCOL COMPLETE
            </motion.h2>
            
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-gc-text-dim text-sm mb-6"
            >
              You've conquered all {RUN_DRY_TIERS.length} levels of Protocol: Run Dry. The machine concedes to your tactical supremacy.
            </motion.p>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="flex justify-center gap-8 mb-8"
            >
              <div className="text-center">
                <div className="text-3xl font-bold text-gc-accent">{RUN_DRY_TIERS.length}</div>
                <div className="text-[10px] text-gc-text-dim uppercase tracking-wider">Levels Cleared</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-gc-violet">{progress.bestStreak}</div>
                <div className="text-[10px] text-gc-text-dim uppercase tracking-wider">Best Streak</div>
              </div>
            </motion.div>

            {/* Action — a single, non-destructive dismiss so the player can savor the final board. */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="flex flex-col gap-3"
            >
              <button
                onClick={onClose}
                className="w-full py-3 px-6 rounded-xl bg-gc-panel-2 ring-1 ring-white/10 text-gc-text font-medium hover:bg-gc-grid hover:ring-white/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <span>🔍</span> View Final Board
              </button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Protocol: Run Dry Progress Panel ──────────────────────────────────────────
// Inline progress indicator shown in the opponent selector when Protocol: Run Dry is active

export interface ProtocolRunDryPanelProps {
  /** Current tier index (0-24) */
  tier: number;
  /** Best streak achieved */
  bestStreak: number;
  /** Current difficulty name */
  difficultyName: string;
  /** Total number of tiers */
  totalTiers: number;
  /** Called when the user requests to restart the run (resets to Tier 1). */
  onRestart?: () => void;
}

export function ProtocolRunDryPanel({
  tier,
  bestStreak,
  difficultyName,
  totalTiers,
  onRestart,
}: ProtocolRunDryPanelProps) {
  // 5-segment progress bar: each segment represents one tier (5 sub-levels).
  // The current tier's segment fills proportionally based on the sub-level.
  const currentTierIdx = Math.floor(tier / TIER_SIZE);       // 0-4
  const subWithinTier = tier % TIER_SIZE;                     // 0-4
  const TIER_NAMES = BOT_TIERS.map((t) => t.charAt(0).toUpperCase() + t.slice(1));

  return (
    <div className="relative mt-2 p-3 rounded-xl border bg-gradient-to-br from-gc-accent/10 via-gc-violet/10 to-gc-accent/5 border-gc-accent/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gc-accent">
          {TIER_NAMES[currentTierIdx]} {subWithinTier + 1}/{TIER_SIZE} · Level {tier + 1}/{totalTiers}
        </span>
        <span className="text-[10px] text-gc-text-dim">Best: {bestStreak}</span>
      </div>

      {/* 5-tier progress bar — each segment fills fully (done), partially (active), or empty */}
      <div className="flex gap-1">
        {BOT_TIERS.map((_, i) => {
          const done = i < currentTierIdx;
          const active = i === currentTierIdx;
          const fillPct = active ? Math.round(((subWithinTier + 1) / TIER_SIZE) * 100) : 0;
          return (
            <div key={i} className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
              {(done || active) && (
                <div
                  className={`h-full rounded-full transition-all ${done ? 'bg-gc-accent' : 'bg-gc-accent/60 animate-pulse'}`}
                  style={{ width: done ? '100%' : `${fillPct}%` }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Difficulty label + restart button. */}
      <div className="flex items-center justify-between gap-2 mt-2">
        <p className="text-[10px] text-gc-text-dim">
          <span className="text-gc-text">{difficultyName}</span>
        </p>
        {onRestart && (
          <motion.button
            type="button"
            onClick={onRestart}
            whileHover={{ rotate: -90 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            aria-label="Restart run"
            title="Restart run"
            className="shrink-0 grid place-items-center w-5 h-5 rounded-lg text-gc-text-dim hover:text-gc-accent bg-white/5 hover:bg-gc-accent/15 ring-1 ring-white/10 hover:ring-gc-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-3 h-3"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </motion.button>
        )}
      </div>
    </div>
  );
}
