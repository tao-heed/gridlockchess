// components/game/modals/GameEndModal.tsx — Modular game-end overlay (checkmate, stalemate, resignation, draw)
import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';
import { gcGradientGlow } from '@/constants/ui';

/** Supported game-end scenarios — extend as needed */
export type GameEndType = 'checkmate' | 'stalemate' | 'resigned' | 'timeout' | 'draw';

export interface GameEndAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  icon?: string;
}

export interface GameStats {
  totalMoves: number;
}

export interface GameEndModalProps {
  /** The type of game end — controls icon, title, and default messaging */
  type: GameEndType;
  /** Winner's name/label (e.g., "Black", "White", "You", "Opponent"). Null for draws. */
  winner: string | null;
  /** Optional custom subtitle. If omitted, a sensible default is used. */
  subtitle?: string;
  /** Whether to show the modal */
  isOpen: boolean;
  /** Action buttons (e.g., "Play Again", "Review Board", "Main Menu") */
  actions: GameEndAction[];
  /** Optional game statistics to display */
  stats?: GameStats;
  /** Optional children for custom content below the title/subtitle */
  children?: ReactNode;
}

/** Visual config per game-end type */
const TYPE_CONFIG: Record<GameEndType, {
  icon: string;
  defaultTitle: (winner: string | null) => string;
  defaultSubtitle: string;
  accentGradient: string;
  iconGlow: string;
}> = {
  checkmate: {
    icon: '👑',
    defaultTitle: (winner) => winner ? `${winner} Wins!` : 'Checkmate!',
    defaultSubtitle: 'The king has fallen. No escape.',
    accentGradient: 'from-gc-accent/20 via-gc-violet/15 to-gc-accent/20',
    iconGlow: 'shadow-[0_0_40px_rgba(34,224,255,0.5)]',
  },
  stalemate: {
    icon: '🤝',
    defaultTitle: () => 'Stalemate',
    defaultSubtitle: 'No legal moves remain. The battle ends in a draw.',
    accentGradient: 'from-amber-500/15 via-orange-400/10 to-amber-500/15',
    iconGlow: 'shadow-[0_0_40px_rgba(251,191,36,0.4)]',
  },
  resigned: {
    icon: '🏳️',
    defaultTitle: (winner) => winner ? `${winner} Wins!` : 'Resignation',
    defaultSubtitle: 'A commander has surrendered.',
    accentGradient: 'from-slate-400/15 via-slate-500/10 to-slate-400/15',
    iconGlow: 'shadow-[0_0_40px_rgba(148,163,184,0.4)]',
  },
  timeout: {
    icon: '🚩',
    defaultTitle: (winner) => winner ? `${winner} Wins!` : 'Flag Fall',
    defaultSubtitle: 'The clock ran out.',
    accentGradient: 'from-rose-500/15 via-red-400/10 to-rose-500/15',
    iconGlow: 'shadow-[0_0_40px_rgba(244,63,94,0.4)]',
  },
  draw: {
    icon: '⚖️',
    defaultTitle: () => 'Draw',
    defaultSubtitle: 'The battle ends without a victor.',
    accentGradient: 'from-emerald-500/15 via-teal-400/10 to-emerald-500/15',
    iconGlow: 'shadow-[0_0_40px_rgba(52,211,153,0.4)]',
  },
};

export function GameEndModal({
  type,
  winner,
  subtitle,
  isOpen,
  actions,
  stats,
  children,
}: GameEndModalProps) {
  const config = TYPE_CONFIG[type];
  
  // Guard: if type is not a valid game-end type, don't render anything
  if (!config) return null;
  
  const title = config.defaultTitle(winner);
  const finalSubtitle = subtitle ?? config.defaultSubtitle;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ scale: 0.88, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            className={`
              relative overflow-hidden
              bg-gc-panel/95 backdrop-blur-xl border border-white/10 
              rounded-3xl p-8 max-w-md w-full 
              shadow-[0_40px_100px_-30px_rgba(0,0,0,0.95)]
            `}
          >
            {/* Animated gradient background accent */}
            <div
              className={`
                absolute inset-0 -z-10 opacity-60
                bg-gradient-to-br ${config.accentGradient}
              `}
            />

            {/* Icon with glow */}
            <motion.div
              initial={{ scale: 0.5, rotate: -12 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20, delay: 0.1 }}
              className="flex justify-center mb-5"
            >
              <span
                className={`
                  text-6xl select-none 
                  ${config.iconGlow}
                `}
              >
                {config.icon}
              </span>
            </motion.div>

            {/* Title */}
            <motion.h2
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="font-display text-3xl sm:text-4xl font-bold gc-title text-center mb-2"
            >
              {title}
            </motion.h2>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-gc-text-dim text-center text-sm mb-6"
            >
              {finalSubtitle}
            </motion.p>

            {/* Game Statistics */}
            {stats && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.22 }}
                className="flex justify-center mb-6"
              >
                <div className="bg-gc-panel-2/60 rounded-xl p-3 text-center border border-white/5 min-w-[96px]">
                  <div className="text-gc-text-dim text-xs mb-1">Moves</div>
                  <div className="text-gc-text font-bold text-lg">{stats.totalMoves}</div>
                </div>
              </motion.div>
            )}

            {/* Optional custom content */}
            {children && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.25 }}
                className="mb-6"
              >
                {children}
              </motion.div>
            )}

            {/* Action buttons */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-3"
            >
              {actions.map((action, idx) => {
                const isPrimary = action.variant === 'primary' || (idx === 0 && !action.variant);
                return (
                  <motion.button
                    key={action.label}
                    whileHover={{ scale: 1.03, y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={action.onClick}
                    title={action.label}
                    className={`
                      flex-1 py-3.5 px-6 rounded-2xl font-semibold text-[15px]
                      transition-all duration-150 focus-visible:outline-none 
                      focus-visible:ring-2 focus-visible:ring-gc-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-gc-panel
                      flex items-center justify-center gap-2
                      ${isPrimary
                        ? gcGradientGlow
                        : 'bg-gc-panel-2 text-gc-text ring-1 ring-white/10 hover:bg-gc-grid hover:ring-white/20'
                      }
                    `}
                  >
                    {action.icon && <span className="text-base">{action.icon}</span>}
                    {action.label}
                  </motion.button>
                );
              })}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { GameEndModal as default };
