// components/pieces/VectorBadge.tsx — Stacked "battery" charge badges for Anomalies.
//
// All three vector charges live in ONE bottom-center battery — Orthogonal, Diagonal, Leap
// from left to right — instead of three scattered corners. Each vector is a solid color cell
// (green = O, yellow = D, coral = L) with its remaining charge in black inside. Identity is
// carried by fixed position + color, and a native tooltip names the full vector on hover.
// The vertical order matches the Rules VectorTable and both live demos so it's learned once.
import { motion, useReducedMotion } from 'framer-motion';
import type { VectorType, VectorPool } from '@/types/game';

interface VectorBadgesProps {
  vectors: VectorPool;
  /** Pops the battery with the accent ring + a soft glow — set for the piece the player is
   *  acting on (selected) or the piece that just moved, so focus lands there without dimming
   *  any other battery (important on mobile, where charges must stay readable without hover). */
  emphasis?: boolean;
  /** Battery size in `cqw` (the whole battery is em-based off this). Defaults to 20; docs/demo
   *  tokens rendered larger than a board square pass a smaller value. */
  sizeCqw?: number;
}

// Fixed left → right order — must match the Rules VectorTable + demo legends.
const ROW_ORDER: readonly VectorType[] = ['O', 'D', 'L'] as const;

// Each cell: fill color IS the identity (green = O, yellow = D, coral = L), named on hover.
const CELL_META: Record<VectorType, { bg: string; name: string }> = {
  O: { bg: 'bg-gc-ortho', name: 'Orthogonal' },
  D: { bg: 'bg-gc-diag', name: 'Diagonal' },
  L: { bg: 'bg-gc-leap', name: 'Leap' },
};

/**
 * The charge "battery" pinned to a piece's bottom-center: three solid color cells butted
 * together left-to-right into one rounded row, each showing its vector's remaining charge in
 * black. Spent (0) cells drop to gridlock gray with dimmed text so the state stays legible
 * without competing with live charges.
 */
export function VectorBadges({ vectors, emphasis = false, sizeCqw }: VectorBadgesProps) {
  return (
    <span
      aria-label="Vector charges"
      style={sizeCqw ? { fontSize: `${sizeCqw}cqw` } : undefined}
      className={`absolute bottom-[4cqw] left-1/2 z-20 inline-flex -translate-x-1/2 flex-row overflow-hidden rounded-[0.3em] text-[20cqw] shadow-sm transition-shadow duration-200 ${
        emphasis
          ? 'ring-1 ring-gc-accent/80 shadow-[0_0_7px_rgba(34,224,255,0.55)]'
          : 'ring-1 ring-black/40'
      }`}
    >
      {ROW_ORDER.map((type) => {
        const value = vectors[type];
        const isZero = value === 0;
        const meta = CELL_META[type];
        return (
          <span
            key={type}
            title={`${meta.name} — ${value} charge${value === 1 ? '' : 's'} left`}
            className={`flex min-w-[1.1em] items-center justify-center px-[0.15em] pt-[0.15em] pb-[0.1em] font-mono font-semibold leading-none tabular-nums ${
              isZero ? 'bg-gc-gridlock text-black/40' : `${meta.bg} text-black`
            }`}
          >
            {value}
          </span>
        );
      })}
    </span>
  );
}

interface GhostBatteryProps {
  /** The Anomaly's battery values BEFORE its last move (after + 1 on the spent vector). */
  vectors: VectorPool;
  /** The single cell that just dropped — kept fully clear while the rest dim, so the
   *  before/after comparison is obvious. `null` for Omni, whose shared pool drains
   *  every cell at once. */
  spentVector: VectorType | null;
}

/**
 * A ghost "before" copy of the battery left on the square an Anomaly just vacated. Read it
 * against the live battery now sitting on the destination square to see exactly which charge
 * was spent: the depleted cell renders at full clarity while the untouched cells are dimmed,
 * so the eye lands straight on the vector that dropped. Fades in gently (respecting
 * reduced-motion) and lingers until the next move moves the last-move highlight off this
 * square. For Omni (no single spent vector) every cell drains, so all cells stay dimmed.
 */
export function GhostBattery({ vectors, spentVector }: GhostBatteryProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden="true"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="pointer-events-none absolute bottom-[4cqw] left-1/2 z-10 inline-flex -translate-x-1/2 flex-row overflow-hidden rounded-[0.3em] text-[20cqw] ring-1 ring-white/30 shadow-sm"
    >
      {ROW_ORDER.map((type) => {
        const value = vectors[type];
        const isZero = value === 0;
        const meta = CELL_META[type];
        const isSpent = type === spentVector;
        return (
          <span
            key={type}
            className={`flex min-w-[1.1em] items-center justify-center px-[0.15em] pt-[0.15em] pb-[0.1em] font-mono font-semibold leading-none tabular-nums ${
              isZero ? 'bg-gc-gridlock text-black/40' : `${meta.bg} text-black`
            } ${isSpent ? 'opacity-100' : 'opacity-40 saturate-[0.6]'}`}
          >
            {value}
          </span>
        );
      })}
    </motion.span>
  );
}

export { VectorBadges as default };
