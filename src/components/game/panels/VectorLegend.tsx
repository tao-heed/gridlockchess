// components/game/panels/VectorLegend.tsx — Vector battery legend + live dual-side charge meter
//
// Explains the bottom-center charge "battery" on each Anomaly: three cells, left → right
// O / D / L, where the FILL COLOR is the identity (green = O, yellow = D, coral = L) —
// matching VectorBadge.tsx. When a `charges` map is supplied it becomes a LIVE meter: each
// vector row shows BOTH armies' summed remaining charges (White | Black), ticking down as
// their Anomalies spend charges or get captured. Columns are labeled by COLOR (not
// "you"/"opponent") so they never swap identity in Pass & Play; a small accent dot marks
// whichever side is "yours". Omit `charges` for the static color key. Stateless apart from
// the native <details> disclosure; `defaultOpen` sets its initial expanded state.
//
// Depletion feedback (live mode): a single -1 spend is invisible in a summed total, so each
// update diffs against the previous charges and (a) floats a "-N" delta pip up from the cell
// that just dropped and (b) leaves a LINGERING ring/tint on that cell until the NEXT spend,
// so the "which vector did I just burn?" answer is always readable, not a 500ms blink.
import { Fragment, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { PieceColor, VectorPool } from '@/types/game';

// Row config, ordered to match the on-piece battery (O / D / L, left → right).
const VECTORS: {
  key: keyof VectorPool;
  label: string;
  glyph: string;
  glyphTitle: string;
  colorClass: string;
  ring: string;
}[] = [
  { key: 'O', label: 'Orthogonal', glyph: '♜', glyphTitle: 'Moves like a Rook', colorClass: 'text-gc-ortho', ring: 'ring-gc-ortho/70 bg-gc-ortho/10' },
  { key: 'D', label: 'Diagonal', glyph: '♝', glyphTitle: 'Moves like a Bishop', colorClass: 'text-gc-diag', ring: 'ring-gc-diag/70 bg-gc-diag/10' },
  { key: 'L', label: 'Leap', glyph: '♞', glyphTitle: 'Moves like a Knight', colorClass: 'text-gc-leap', ring: 'ring-gc-leap/70 bg-gc-leap/10' },
];

const SIDES: { color: PieceColor; label: string }[] = [
  { color: 'white', label: 'White' },
  { color: 'black', label: 'Black' },
];

export interface VectorCharges {
  white: VectorPool;
  black: VectorPool;
  /** Which side is "you" — gets the accent dot in its column header. */
  you: PieceColor;
}

export function VectorLegend({
  charges,
  resetKey,
}: {
  /** When set, the legend renders a live "remaining charges" meter for BOTH armies
   *  (summed across each side's Anomalies, per vector). Omit for the static color key. */
  charges?: VectorCharges;
  /** Bumps on every New Game / import / resume (the game's identity). When it changes, the
   *  depletion tracker re-baselines instead of diffing — a fresh army reshuffles the totals,
   *  which must never read as a "spend". Race-free: the new board and this key commit together. */
  resetKey?: number | string;
}) {
  const reduce = useReducedMotion();
  // Previous charge snapshot + the most recent "just spent" cells. `ids` maps a
  // `${side}-${vector}` cell to its (negative) delta; `nonce` bumps on every spend so the
  // floating pip re-mounts and replays. The marker persists until the next spend replaces it.
  const prevRef = useRef<VectorCharges | null>(null);
  const prevResetKeyRef = useRef(resetKey);
  const [spent, setSpent] = useState<{ ids: Record<string, number>; nonce: number }>({ ids: {}, nonce: 0 });

  useEffect(() => {
    if (!charges) {
      prevRef.current = null;
      prevResetKeyRef.current = resetKey;
      return;
    }
    // New game / import / resume: re-baseline to the freshly-dealt army and drop any marker.
    // A reshuffle raises some vectors and lowers others; that is NOT a spend, so never diff
    // across a game boundary. This commits in the same render as the new board, so there is
    // no transient frame where an old baseline could flash a false depletion.
    if (prevResetKeyRef.current !== resetKey) {
      prevResetKeyRef.current = resetKey;
      prevRef.current = charges;
      setSpent((p) => (Object.keys(p.ids).length ? { ids: {}, nonce: p.nonce } : p));
      return;
    }
    const prev = prevRef.current;
    prevRef.current = charges;
    if (!prev) return;
    const ids: Record<string, number> = {};
    let increased = false;
    for (const s of SIDES) {
      for (const v of VECTORS) {
        const d = charges[s.color][v.key] - prev[s.color][v.key];
        if (d < 0) ids[`${s.color}-${v.key}`] = d;
        else if (d > 0) increased = true;
      }
    }
    if (Object.keys(ids).length > 0) {
      setSpent((p) => ({ ids, nonce: p.nonce + 1 }));
    } else if (increased) {
      // A refill/promotion added charges with no spend — clear a stale marker.
      setSpent((p) => (Object.keys(p.ids).length ? { ids: {}, nonce: p.nonce } : p));
    }
  }, [charges, resetKey]);

  return (
    <div className="pt-2 pb-0.5">
      {charges ? (
        // Centered, grouped table — Movement | White | Black columns sit together (not stretched
        // edge-to-edge), so it reads as one compact table.
        <div className="mx-auto w-fit grid grid-cols-[auto_auto_auto] items-center gap-x-5 gap-y-1 text-[12px]">
          <span className="text-[10px] uppercase tracking-wide text-gc-text-dim">Movement</span>
          {SIDES.map((s) => {
            const isYou = s.color === charges.you;
            return (
              <span
                key={s.color}
                className={`justify-self-end text-[10px] uppercase tracking-wide ${isYou ? 'text-gc-accent font-bold' : 'text-gc-text-dim'}`}
                title={isYou ? 'This is your side' : undefined}
              >
                {s.label}
              </span>
            );
          })}

          {VECTORS.map((v) => (
            <Fragment key={v.key}>
              <span className="flex items-center gap-1.5 pr-2">
                <span className={`${v.colorClass} leading-none`} title={v.glyphTitle}>{v.glyph}</span>
                <b className={v.colorClass}>{v.label}</b>
              </span>
              {SIDES.map((s) => {
                const remaining = charges[s.color][v.key];
                const cellId = `${s.color}-${v.key}`;
                const delta = spent.ids[cellId];
                const justSpent = delta != null;
                return (
                  <span key={s.color} className="justify-self-end relative inline-flex justify-end">
                    {justSpent && !reduce && (
                      <motion.span
                        key={`${cellId}-${spent.nonce}`}
                        aria-hidden="true"
                        className={`absolute -top-3.5 right-0 text-[9px] font-bold leading-none pointer-events-none ${v.colorClass}`}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: [0, 1, 1, 0], y: -8 }}
                        transition={{ duration: 0.9, times: [0, 0.15, 0.6, 1] }}
                      >
                        {delta}
                      </motion.span>
                    )}
                    <span
                      className={`tabular-nums font-semibold text-[14px] leading-none text-right ${v.colorClass} transition-all ${justSpent ? `px-1.5 py-0.5 -my-0.5 rounded-md ring-1 ${v.ring}` : ''}`}
                      title={`${s.label}: ${remaining} ${v.label} charge${remaining === 1 ? '' : 's'} left`}
                    >
                      {remaining}
                    </span>
                  </span>
                );
              })}
            </Fragment>
          ))}

          {/* Grand total per side — O + D + L summed, so each army's whole remaining battery is
              legible at a glance without adding the three rows by eye. Neutral (not a vector color)
              since it's a mix; a hairline divider spanning the table sets it apart from the rows. */}
          <span className="col-span-3 mt-0.5 h-px bg-white/10" aria-hidden="true" />
          <span className="flex items-center gap-1.5 pr-2">
            <span className="leading-none" aria-hidden="true">🔋</span>
            <b className="text-gc-text">Total Charge</b>
          </span>
          {SIDES.map((s) => {
            const total = VECTORS.reduce((sum, v) => sum + charges[s.color][v.key], 0);
            return (
              <span key={s.color} className="justify-self-end">
                <span
                  className="tabular-nums font-bold text-[14px] leading-none text-right text-gc-text"
                  title={`${s.label}: ${total} total charge${total === 1 ? '' : 's'} left`}
                >
                  {total}
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-[12px]">
          {VECTORS.map((v) => (
            <div key={v.key} className="flex items-center gap-1.5">
              <span className={`${v.colorClass} leading-none`} title={v.glyphTitle}>{v.glyph}</span>
              <b className={v.colorClass}>{v.label}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
