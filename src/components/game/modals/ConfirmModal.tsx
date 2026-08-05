// components/game/modals/ConfirmModal.tsx — Reusable confirmation dialog (resign, draw offer, etc.)
import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';
import { gcGradientGlow } from '@/constants/ui';

export interface ConfirmModalProps {
  /** Whether the modal is visible */
  isOpen: boolean;
  /** Modal title */
  title: string;
  /** Modal description/message */
  message: string;
  /** Icon to display (emoji or ReactNode) */
  icon?: ReactNode;
  /** Confirm button label */
  confirmLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Callback when confirmed */
  onConfirm: () => void;
  /** Callback when cancelled */
  onCancel: () => void;
  /** Visual variant for the confirm button */
  variant?: 'danger' | 'warning' | 'neutral';
}

const VARIANT_STYLES = {
  danger: {
    confirmBtn: 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-[0_4px_20px_-4px_rgba(239,68,68,0.5)] hover:shadow-[0_6px_28px_-4px_rgba(239,68,68,0.6)]',
    iconGlow: 'shadow-[0_0_40px_rgba(239,68,68,0.4)]',
    accentGradient: 'from-red-500/15 via-red-600/10 to-red-500/15',
  },
  warning: {
    confirmBtn: 'bg-gradient-to-r from-amber-500 to-orange-500 text-gc-bg shadow-[0_4px_20px_-4px_rgba(251,191,36,0.5)] hover:shadow-[0_6px_28px_-4px_rgba(251,191,36,0.6)]',
    iconGlow: 'shadow-[0_0_40px_rgba(251,191,36,0.4)]',
    accentGradient: 'from-amber-500/15 via-orange-400/10 to-amber-500/15',
  },
  neutral: {
    confirmBtn: gcGradientGlow,
    iconGlow: 'shadow-[0_0_40px_rgba(34,224,255,0.4)]',
    accentGradient: 'from-gc-accent/15 via-gc-violet/10 to-gc-accent/15',
  },
};

export function ConfirmModal({
  isOpen,
  title,
  message,
  icon,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'neutral',
}: ConfirmModalProps) {
  const styles = VARIANT_STYLES[variant];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className={`
              relative overflow-hidden
              bg-gc-panel/95 backdrop-blur-xl border border-white/10 
              rounded-2xl p-6 max-w-sm w-full 
              shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]
            `}
          >
            {/* Background accent */}
            <div
              className={`
                absolute inset-0 -z-10 opacity-50
                bg-gradient-to-br ${styles.accentGradient}
              `}
            />

            {/* Icon */}
            {icon && (
              <motion.div
                initial={{ scale: 0.6, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22, delay: 0.05 }}
                className="flex justify-center mb-4"
              >
                <span className={`text-5xl select-none ${styles.iconGlow}`}>
                  {icon}
                </span>
              </motion.div>
            )}

            {/* Title */}
            <motion.h3
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="font-display text-xl font-bold text-gc-text text-center mb-2"
            >
              {title}
            </motion.h3>

            {/* Message */}
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="text-gc-text-dim text-center text-sm mb-5"
            >
              {message}
            </motion.p>

            {/* Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
              className="flex gap-3"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onCancel}
                className="flex-1 py-3 px-4 rounded-xl font-semibold text-sm bg-gc-panel-2 text-gc-text ring-1 ring-white/10 hover:bg-gc-grid hover:ring-white/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
              >
                {cancelLabel}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02, y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={onConfirm}
                className={`flex-1 py-3 px-4 rounded-xl font-semibold text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gc-panel ${styles.confirmBtn}`}
              >
                {confirmLabel}
              </motion.button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { ConfirmModal as default };
