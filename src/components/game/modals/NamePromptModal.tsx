// components/game/modals/NamePromptModal.tsx — Small text-input dialog (name a thing, confirm/cancel).
//
// Rendered at the page top level (NOT inside the swipe deck): a `fixed` overlay nested inside the
// deck's transformed motion node would anchor to that node instead of the viewport. Autofocuses the
// input, submits on Enter, cancels on Escape / backdrop, and can surface a validation error inline.
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { gcGradientGlow } from '@/constants/ui';

export interface NamePromptModalProps {
  isOpen: boolean;
  title: string;
  /** Optional supporting line under the title. */
  message?: string;
  /** Prefilled value (e.g. a suggested name). */
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  /** Inline error shown under the field (e.g. "Library full"). Clearing it re-enables submit. */
  error?: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NamePromptModal({
  isOpen,
  title,
  message,
  defaultValue = '',
  placeholder = 'Name (optional)',
  confirmLabel = 'Save',
  maxLength = 40,
  error,
  onConfirm,
  onCancel,
}: NamePromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed the field each time the dialog opens, then focus + select it.
  useEffect(() => {
    if (!isOpen) return;
    setValue(defaultValue);
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return () => cancelAnimationFrame(id);
  }, [isOpen, defaultValue]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onClick={onCancel}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-gc-panel/95 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl"
          >
            <h2 className="text-base font-bold text-gc-text">{title}</h2>
            {message && <p className="mt-1 text-[13px] text-gc-text-dim">{message}</p>}

            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(value); }}
              placeholder={placeholder}
              maxLength={maxLength}
              aria-label={title}
              className="mt-4 w-full rounded-lg bg-gc-panel-2 px-3 py-2 text-[13px] text-gc-text ring-1 ring-white/10 placeholder:text-gc-text-dim/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
            />
            {error && <p className="mt-2 text-[12px] font-medium text-red-300">{error}</p>}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-xl bg-gc-panel-2 py-2.5 text-[13px] font-semibold text-gc-text-dim ring-1 ring-white/10 transition-colors hover:text-gc-text hover:bg-gc-grid focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onConfirm(value)}
                className={`flex-1 rounded-xl py-2.5 text-[13px] font-semibold ${gcGradientGlow} focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
