// components/game/panels/ClockPanel.tsx — Consolidated twin clock (both sides, one glance)
//
// Chess-standard dual clock rendered in the left rail so both players' remaining time sits
// together instead of split across the top and bottom of a tall board. Only the side to move
// "runs" (accent fill + a live pulse); a side under 30s turns amber (pulsing while it is their
// turn); a flagged side turns rose with a flag. Rows are ordered to mirror the board — the
// top-seat player is rendered first, the bottom seat second — so the spatial mapping holds.
import type { PieceColor } from '@/types/game';
import { formatClock } from '@/constants/timeControls';

/** One side's clock data for a single row. */
export interface ClockRow {
  color: PieceColor;
  ms: number;
  /** Under the low-time threshold (<30s) but not yet flagged. */
  low: boolean;
  /** Ran out of time. */
  flagged: boolean;
}

export interface ClockPanelProps {
  /** Top-seat player (mirrors the board's top card). */
  top: ClockRow;
  /** Bottom-seat player (mirrors the board's bottom card). */
  bottom: ClockRow;
  /** Whose turn it is — the side actively counting down. */
  activeColor: PieceColor;
  /** True only while the game is in play; a paused/ended clock stops "running". */
  running: boolean;
}

function ClockRowView({ row, active, running }: { row: ClockRow; active: boolean; running: boolean }) {
  // "Live" = this side's clock is actually ticking right now (its turn, game in play, not out).
  const live = active && running && !row.flagged;

  return (
    <div
      className={`
        flex items-center justify-between gap-2 px-3 py-2.5 transition-colors
        ${row.flagged
          ? 'bg-rose-950/40'
          : live
            ? row.low ? 'bg-amber-950/30' : 'bg-gc-accent/10'
            : 'bg-transparent'}
      `}
    >
      {/* Identity — color disc + name */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
            row.color === 'white'
              ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.6)]'
              : 'bg-slate-900 ring-2 ring-slate-500'
          }`}
        />
        <span className={`text-xs font-medium truncate ${live ? 'text-gc-text' : 'text-gc-text-dim'}`}>
          {row.color === 'white' ? 'White' : 'Black'}
        </span>
      </div>

      {/* Time — big mono digits, right-aligned for at-a-glance monitoring */}
      <div className="flex items-center gap-1.5 shrink-0">
        {row.flagged ? (
          <span aria-hidden="true" className="text-sm leading-none">🚩</span>
        ) : live ? (
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full animate-pulse ${row.low ? 'bg-amber-400' : 'bg-gc-accent'}`}
          />
        ) : null}
        <span
          role="timer"
          aria-label={`${row.color === 'white' ? 'White' : 'Black'} clock`}
          className={`
            font-mono tabular-nums text-xl font-semibold leading-none
            ${row.flagged
              ? 'text-rose-300'
              : row.low
                ? 'text-amber-300'
                : live
                  ? 'text-gc-text'
                  : 'text-gc-text-dim'}
          `}
        >
          {formatClock(row.ms)}
        </span>
      </div>
    </div>
  );
}

export function ClockPanel({ top, bottom, activeColor, running }: ClockPanelProps) {
  return (
    <div className="rounded-2xl overflow-hidden ring-1 ring-white/5 bg-gc-panel-2 divide-y divide-white/5">
      <ClockRowView row={top} active={top.color === activeColor} running={running} />
      <ClockRowView row={bottom} active={bottom.color === activeColor} running={running} />
    </div>
  );
}

export default ClockPanel;
