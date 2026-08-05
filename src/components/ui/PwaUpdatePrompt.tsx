// components/ui/PwaUpdatePrompt.tsx — "a new version is available" toast.
//
// With registerType:'prompt' (vite.config.ts) a freshly deployed service worker waits
// instead of auto-activating, so the user gets the new build deliberately — no mid-session
// stale mix of an old page with new/cleaned chunks. `updateServiceWorker(true)` skips waiting
// and reloads. An hourly `registration.update()` lets a long-open session notice new deploys.
import { useRegisterSW } from 'virtual:pwa-register/react';
import { AnimatePresence, motion } from 'framer-motion';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => {
          void registration.update();
        }, UPDATE_CHECK_INTERVAL_MS);
      }
    },
  });

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pointer-events-none"
        >
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/10 bg-gc-panel/95 px-4 py-3 shadow-[0_16px_50px_-16px_rgba(0,0,0,0.7)] backdrop-blur-xl">
            <span className="text-sm text-gc-text">A new version is available.</span>
            <button
              onClick={() => updateServiceWorker(true)}
              className="rounded-lg bg-gc-accent px-3 py-1.5 text-sm font-semibold text-gc-bg transition hover:brightness-110"
            >
              Reload
            </button>
            <button
              onClick={() => setNeedRefresh(false)}
              aria-label="Dismiss update notice"
              className="rounded-lg px-2 py-1.5 text-sm text-gc-text-dim transition hover:text-gc-text"
            >
              ✕
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
