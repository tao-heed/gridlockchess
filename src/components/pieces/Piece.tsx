// components/pieces/Piece.tsx — Renders a chess piece with stats
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Piece as PieceType, Anomaly, VectorPool, OmniPool } from '@/types/game';
import { VectorBadges } from './VectorBadge';
import { PieceGlyph } from './PieceGlyph';
import { isGridlocked } from '@/lib/chess/movement';

interface PieceProps {
  piece: PieceType;
  isDragging?: boolean;
  /** When true, this piece slides between squares on a move (framer shared-layout
   *  matched by the piece's stable id). Enabled on the live board; the DragOverlay
   *  clone leaves it off so there's never a duplicate layoutId. */
  animateMove?: boolean;
  /** When true, this piece plays a "death" animation (topple + desaturate + dim) —
   *  used on the checkmated King so the kill reads before the game-over modal. */
  defeated?: boolean;
  /** Wall-clock ms at which this piece should reach its peak float height (shuffle time +
   *  3s). Anomalies start low, hold until this instant, then ease up to peak and stay. */
  floatSettleAt?: number;
  /** Overrides the charge battery's size (in `cqw`); defaults to 20. Used by docs/demo tokens
   *  that render the piece larger than a board square and want a slightly smaller battery. */
  batteryCqw?: number;
}

/** Life-clock tier styling for a Piloted Anomaly (see GridlockChess.md §6.1).
 *  The combined L+O+D total is the King's "moves until death" — the ring and pill
 *  escalate gold → amber → orange → flashing red as the clock ticks down. */
function pilotLifeTier(total: number): {
  ring: string;       // life-clock ring color + glow
  pill: string;       // crown/counter pill color
  pulse: string;      // optional warning pulse animation
  label: string;      // crown glyph (always 👑)
} {
  if (total <= 0) {
    // Sealed bunker — the King is entombed (instant loss in real rules).
    return {
      ring: 'ring-red-600 shadow-[0_0_14px_rgba(220,38,38,0.85)]',
      pill: 'bg-red-950/90 text-red-300 ring-red-500/60',
      pulse: 'animate-pilot-low-pulse',
      label: '👑',
    };
  }
  if (total === 1) {
    return {
      ring: 'ring-red-500 shadow-[0_0_14px_rgba(239,68,68,0.85)]',
      pill: 'bg-red-950/90 text-red-300 ring-red-500/60',
      pulse: 'animate-pilot-low-pulse',
      label: '👑',
    };
  }
  if (total === 2) {
    return {
      ring: 'ring-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.75)]',
      pill: 'bg-orange-950/85 text-orange-200 ring-orange-400/50',
      pulse: 'animate-pilot-low-pulse',
      label: '👑',
    };
  }
  if (total === 3) {
    return {
      ring: 'ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.7)]',
      pill: 'bg-amber-950/80 text-amber-200 ring-amber-400/50',
      pulse: '',
      label: '👑',
    };
  }
  // Healthy: calm royal gold.
  return {
    ring: 'ring-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.6)]',
    pill: 'bg-amber-900/80 text-amber-100 ring-amber-300/50',
    pulse: '',
    label: '👑',
  };
}

export function Piece({ piece, isDragging, animateMove = false, defeated = false, floatSettleAt, batteryCqw }: PieceProps) {
  const gridlocked = isGridlocked(piece);
  const piloted = piece.type === 'anomaly' && (piece as Anomaly).piloted === true;
  const pilotTotal = piloted
    ? (() => { const v = piece.vectors as VectorPool; return v.L + v.O + v.D; })()
    : 0;
  const tier = piloted ? pilotLifeTier(pilotTotal) : null;

  // Both armies share one soft ambient shadow for grounding — no outer rim/halo,
  // so white and black read as one consistent set.
  const glyphContrastFilter = 'drop-shadow(0 1.5px 1.5px rgba(0,0,0,0.55))';

  // Glyph (SVG) wrapper — now the primary element (no disc behind it).
  // Anomalies levitate (rise once and hold, see below) unless they're gridlocked (locked in
  // place), being dragged, or toppling on defeat. Pawns and Kings stay grounded — only the
  // heavier/anomalous pieces levitate. Gates both the glyph lift AND its ground shadow.
  const isFloating = !gridlocked && !isDragging && !defeated
    && piece.type !== 'pawn' && piece.type !== 'king';
  // Levitation intro (anomalies only): each piece STARTS at its low resting point, holds
  // there until `floatSettleAt` (the board shuffle time + 3s), then eases straight up to its
  // peak (-9%) over ~2.5s and stays there for the rest of the game. No continuous bob and no
  // per-piece phase scatter — so there's never a "drift down then snap to top" glitch.
  //
  // Why a shared timestamp instead of a mount timer: a piece REMOUNTS every time it moves
  // (Board keys Squares by square; Square keys Piece by id), which would reset a mount timer
  // and re-drop the piece on every move. Comparing the stable settle instant means a piece
  // that moves after the opening 3s mounts already at peak (no re-animation), while pieces
  // alive during the opening play the one-time rise.
  const settleAt = floatSettleAt ?? 0;
  const prefersReducedMotion = typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [floatHeld, setFloatHeld] = useState(
    () => !prefersReducedMotion && Date.now() >= settleAt,
  );
  useEffect(() => {
    if (prefersReducedMotion || floatHeld || !isFloating) return;
    const delay = settleAt - Date.now();
    if (delay <= 0) { setFloatHeld(true); return; }
    const t = window.setTimeout(() => setFloatHeld(true), delay);
    return () => window.clearTimeout(t);
  }, [settleAt, floatHeld, isFloating, prefersReducedMotion]);
  const floatHolding = isFloating && floatHeld;
  // Both armies use the SAME square-relative size (container-query units) so every piece
  // scales in lockstep with the board on any device — except Anomalies, which run a touch
  // larger to read as the heavier board presence. `cqw` = % of the square's width (the Piece
  // root sets `container-type: inline-size`), so there are no viewport breakpoints or px floors.
  const glyphSize = piece.type === 'anomaly'
    ? 'w-[74cqw] h-[74cqw]'
    : 'w-[66cqw] h-[66cqw]';
  const getGlyphClasses = () => {
    const base = `relative z-10 ${glyphSize} transition-transform duration-150`;
    const gridlockStyle = gridlocked ? 'grayscale opacity-50' : 'group-hover:scale-110';
    const dragStyle = isDragging ? 'scale-125' : '';
    // Anomalies carry a battery pinned to the square's bottom edge; lift the glyph a
    // few px so it doesn't visually touch the battery.
    const batteryClearance = piece.type === 'anomaly' ? '-translate-y-[3px]' : '';
    // Levitation height is driven by the independent `translate` inline style (see the glyph
    // span below), not a keyframe class — so it composes with this transform-based clearance.
    return `${base} ${gridlockStyle} ${dragStyle} ${batteryClearance}`.trim();
  };

  const content = (
    <>
      {/* Ground shadow — the piece hovers above it; the growing gap sells the "floating" read.
          Behind the glyph (z-0). Eases from a broad, dark resting shadow (piece low) to a
          small, faint one (piece at peak) in lockstep with the glyph's rise. */}
      {isFloating && (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[64%] -translate-x-1/2 z-0 w-[40%] h-[7%] rounded-[50%] bg-black/45 blur-[2px]"
          style={{
            opacity: floatHolding ? 0.16 : 0.4,
            transform: floatHolding ? 'translateX(-50%) scale(0.8)' : 'translateX(-50%) scale(1)',
            transition: 'opacity 2000ms ease-in-out, transform 2000ms ease-in-out',
          }}
        />
      )}
      {/* Piloted: one simple glowing ring (same gentle pulse as a move target).
          Color follows the life-clock tier so low charges still warn.
          Centered via inset-0 + m-auto (NOT translate) because pulse-glow animates
          `transform: scale()`, which would otherwise wipe out translate centering. */}
      {piloted && tier && (
        <span
          aria-hidden="true"
          className={`absolute inset-0 m-auto z-[1] rounded-full ring-2 ${tier.ring} animate-pulse-glow w-[96cqw] h-[96cqw]`}
        />
      )}

      {/* Piece glyph (unified SVG set) — now standing on its own (no disc), separated from
          the square by its per-side contrast outline. On defeat the glyph topples around
          its own feet (transformOrigin bottom-center) so the King falls flat on its square. */}
      {defeated ? (
        <motion.span
          className={`relative z-10 ${glyphSize}`}
          style={{ transformOrigin: '50% 58%', filter: glyphContrastFilter }}
          initial={{ rotate: 0, scale: 1, y: 0 }}
          animate={{ rotate: [0, 92, 88], scale: [1, 0.99, 0.97], y: [0, 1, 3] }}
          transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1], times: [0, 0.8, 1], delay: 0.12 }}
        >
          <PieceGlyph piece={piece} />
        </motion.span>
      ) : (
        <span
          className={getGlyphClasses()}
          style={{
            filter: glyphContrastFilter,
            ...(isFloating
              ? { translate: floatHolding ? '0 -9%' : '0 0', transition: 'transform 150ms ease, translate 2000ms ease-in-out' }
              : {}),
          }}
        >
          <PieceGlyph piece={piece} />
        </span>
      )}

      {/* Piloted: plain crown (matches the drag-target crown). The remaining-charge
          total is already shown by the L/O/D vector badges, so no count is needed here. */}
      {piloted && tier && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 z-40 inline-flex items-center leading-none pointer-events-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
          <span className="text-[23cqw]">{tier.label}</span>
        </span>
      )}
      
      {/* Vector battery for Anomalies — horizontal O/D/L cells, bottom-center */}
      {piece.type === 'anomaly' && piece.archetype !== 'omni' && (
        <VectorBadges vectors={piece.vectors as VectorPool} sizeCqw={batteryCqw} />
      )}
      
      {/* Omni (Mech): one SHARED pool shown as the same battery — any move drains
          all three together, so O/D/L always read identically (8·8·8 → 7·7·7 → …). */}
      {piece.type === 'anomaly' && piece.archetype === 'omni' && (
        <VectorBadges
          vectors={{
            O: (piece.vectors as OmniPool).shared,
            D: (piece.vectors as OmniPool).shared,
            L: (piece.vectors as OmniPool).shared,
          }}
        />
      )}
    </>
  );

  // The Piece fills its square and is the container-query context for every child that scales
  // with the board (glyph, piloted ring, crown, vector battery) — all sized in `cqw`.
  const className = 'relative w-full h-full flex items-center justify-center [container-type:inline-size]';

  // S-tier defeat beat: the checkmated King *topples* — the glyph pivots from its feet
  // and falls flat with a small settle, reading as KNOCKED OVER on its square.
  // We KEEP layoutId here for identity continuity: on gridlock-death the
  // dying piece is the one that just moved (mid-slide), so dropping layoutId would make
  // framer discard the in-flight layout node and the piece would vanish.
  if (defeated) {
    return (
      <motion.div layoutId={animateMove ? piece.id : undefined} className={className}>
        {content}
      </motion.div>
    );
  }

  // S-tier slide: framer shared-layout matches this piece's stable id across squares,
  // so a move tweens from the old square to the new one instead of teleporting.
  // ~200ms snappy spring, no jarring overshoot. Drags stay instant — the source
  // unmounts on drag-start, so the board reports `animateMove={false}` for that commit.
  if (animateMove) {
    return (
      <motion.div
        layoutId={piece.id}
        transition={{ type: 'spring', stiffness: 650, damping: 42, mass: 0.9 }}
        className={className}
      >
        {content}
      </motion.div>
    );
  }

  return <div className={className}>{content}</div>;
}

export { Piece as default };
