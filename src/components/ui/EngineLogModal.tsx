// components/ui/EngineLogModal.tsx — Dev diagnostic viewer for the native engine's search log.
//
// Shows one row per bot move for the CURRENT game only (the log clears when a new game
// starts — see LocalGame). Each row reports the depth the search actually reached and the
// node rate, so a weak move that was a shallow (CPU-starved) search is instantly visible
// versus one that searched deep. The log lives purely in memory (a few KB), is never
// persisted, and is read reactively via useSyncExternalStore.
import { useEffect, useSyncExternalStore } from 'react';
import {
  subscribeEngineLog,
  getEngineLog,
  clearEngineLog,
  type EngineLogEntry,
} from '@/lib/chess/nativeEngine';

interface EngineLogModalProps {
  onClose: () => void;
}

/** 142000 → "142k", 900 → "900". */
function fmtNps(nps: number): string {
  return nps >= 1000 ? `${Math.round(nps / 1000)}k` : String(nps);
}

export function EngineLogModal({ onClose }: EngineLogModalProps) {
  const log = useSyncExternalStore(subscribeEngineLog, getEngineLog);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Newest move first — that's the one you just watched play.
  const rows: EngineLogEntry[] = [...log].reverse();

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Engine move log"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[min(30rem,calc(100vw-1rem))] flex-col rounded-2xl border border-white/10 bg-gc-panel/95 shadow-2xl ring-1 ring-black/30 backdrop-blur-xl"
      >
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex flex-col">
            <h2 className="font-display text-sm font-bold tracking-tight text-gc-text">Engine Log</h2>
            <p className="text-[10px] text-gc-text-dim/70">
              This game · {log.length} {log.length === 1 ? 'move' : 'moves'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearEngineLog}
              className="rounded-lg px-2.5 py-1 text-[11px] text-gc-text-dim ring-1 ring-white/10 transition-colors hover:text-gc-accent hover:ring-gc-accent/40"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-full text-gc-text-dim ring-1 ring-white/10 transition-colors hover:text-gc-accent hover:ring-gc-accent/40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="overflow-y-auto px-2 py-2 font-mono text-[11px] leading-relaxed">
          {rows.length === 0 ? (
            <p className="px-2 py-6 text-center text-gc-text-dim/60">
              No engine moves yet. Play a bot move to record its search.
            </p>
          ) : (
            <table className="w-full tabular-nums">
              <thead className="text-gc-text-dim/50">
                <tr className="text-left">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 font-medium">skill</th>
                  <th className="px-2 py-1 font-medium">depth</th>
                  <th className="px-2 py-1 font-medium">nps</th>
                  <th className="px-2 py-1 font-medium">ms</th>
                  <th className="px-2 py-1 font-medium">by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.n} className="border-t border-white/5 text-gc-text">
                    <td className="px-2 py-1 text-gc-text-dim">{e.n}</td>
                    <td className="px-2 py-1">{e.skill ?? 'max'}</td>
                    <td className="px-2 py-1">
                      <span className={e.reachedDepth < e.targetDepth ? 'text-amber-300' : 'text-gc-text'}>
                        {e.reachedDepth}
                      </span>
                      <span className="text-gc-text-dim/40">/{e.targetDepth}</span>
                    </td>
                    <td className="px-2 py-1">{fmtNps(e.nps)}</td>
                    <td className="px-2 py-1 text-gc-text-dim">{e.movetimeMs}</td>
                    <td className="px-2 py-1">
                      <span className={e.source === 'Overlay' ? 'font-semibold text-gc-accent' : 'text-gc-text-dim/70'}>
                        {e.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
