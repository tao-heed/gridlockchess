// components/game/panels/CapturedPiecesPanel.tsx — Captured pieces panel (deck slot)
//
// Shows both sides' captured pieces as a flat, deck-native surface (no card box — matches the
// Charge / Coach / Replay panels). `capturedPieces[color]` is the list a side HAS TAKEN (the
// mover's array, see useGameState), so the headline reads "You took" / "Opponent took" vs a bot,
// or "White took" / "Black took" in Pass & Play.
//
// Each captured chip owns an accessible, portaled tooltip (hover + keyboard focus) naming the
// piece's alias and its charge state AT CAPTURE. Charges are shown as-captured — NOT the piece's
// original roll: starting charges are random per piece (archetypes.ts) and aren't persisted, so
// "how drained it was when it died" is the honest and more useful figure.
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Piece, PieceColor } from '@/types/game';
import { PieceGlyph } from '@/components/pieces/PieceGlyph';
import { VectorBadges } from '@/components/pieces/VectorBadge';
import { ARCHETYPE_REGISTRY } from '@/lib/chess/archetypes';

export interface CapturedPiecesPanelProps {
  capturedPieces: { white: Piece[]; black: Piece[] };
  /** True when playing a bot (labels become "You took" / "Opponent took"). */
  botActive: boolean;
  /** Which side the local human plays — picks the "You took" row when botActive. */
  humanColor: PieceColor;
}

// ── Piece → human label ───────────────────────────────────────────────────────
/** Alias (headline) + formal type name (subtitle) for a captured piece. */
function pieceLabel(p: Piece): { title: string; subtitle?: string } {
  if (p.type === 'pawn') return { title: 'Pawn' };
  if (p.type === 'king') return { title: 'King' };
  const def = ARCHETYPE_REGISTRY[p.archetype];
  return { title: def.alias, subtitle: def.name };
}

/** Accessible one-line summary used as the chip's aria-label (SR fallback if tooltip unseen). */
function ariaSummary(p: Piece): string {
  const { title, subtitle } = pieceLabel(p);
  const name = subtitle ? `${title} (${subtitle})` : title;
  if (p.type !== 'anomaly') return name;
  if (p.archetype === 'omni') {
    return `${name}, ${p.vectors.shared} shared charge${p.vectors.shared === 1 ? '' : 's'} at capture`;
  }
  const { L, O, D } = p.vectors;
  return `${name}, at capture ${O} orthogonal, ${D} diagonal, ${L} leap`;
}

// ── Identity grouping ─────────────────────────────────────────────────────────
// Collapse captures of the SAME KIND into one chip + count: every Pawn together, every King
// together, and every Anomaly of the same archetype together (omni counts as its own kind).
// Charges-at-capture are NOT part of the key — two Airliners taken at different charge levels
// still merge into one chip badged "2". Order is preserved by first appearance. (Because a merged
// group can hold pieces with different charges, the per-piece "charges at capture" tooltip is
// shown only for a lone capture — count === 1 — so it never claims one value for a mixed group.)
function groupKey(p: Piece): string {
  if (p.type === 'pawn') return 'pawn';
  if (p.type === 'king') return 'king';
  return `anomaly:${p.archetype}`;
}

function groupCaptured(list: Piece[]): { piece: Piece; count: number }[] {
  const groups: { piece: Piece; count: number }[] = [];
  const indexByKey = new Map<string, number>();
  for (const p of list) {
    const key = groupKey(p);
    const at = indexByKey.get(key);
    if (at === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ piece: p, count: 1 });
    } else {
      groups[at]!.count += 1;
    }
  }
  return groups;
}

// ── Tooltip card (portaled to <body>, self-positioning, edge-clamped) ─────────
interface TooltipCardProps {
  id: string;
  piece: Piece;
  count: number;
  anchor: DOMRect;
}

function TooltipCard({ id, piece, count, anchor }: TooltipCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Start hidden until measured so it never flashes at (0,0).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { title, subtitle } = pieceLabel(piece);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 8;
    // Prefer above the anchor; flip below if it would clip the top edge.
    let top = anchor.top - h - gap;
    if (top < gap) top = anchor.bottom + gap;
    // Center horizontally on the anchor, clamped into the viewport.
    let left = anchor.left + anchor.width / 2 - w / 2;
    left = Math.max(gap, Math.min(left, window.innerWidth - w - gap));
    setPos({ top, left });
  }, [anchor]);

  const isAnomaly = piece.type === 'anomaly';
  const isOmni = isAnomaly && piece.archetype === 'omni';

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="tooltip"
      style={{
        position: 'fixed',
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="z-[70] pointer-events-none select-none rounded-lg border border-white/10 bg-gc-panel/95 px-3 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.5)] backdrop-blur-sm"
    >
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 shrink-0">
          <PieceGlyph piece={piece} />
        </span>
        <span className="text-[12px] font-semibold text-gc-text leading-tight">
          {title}
        </span>
        {subtitle && (
          <span className="text-[10px] text-gc-text-dim/80 leading-tight">{subtitle}</span>
        )}
        {count > 1 && (
          <span className="text-[11px] font-semibold tabular-nums text-gc-accent leading-tight">
            ×{count}
          </span>
        )}
      </div>

      {isAnomaly && count === 1 && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wide text-gc-text-dim/60">
            At capture
          </span>
          {isOmni ? (
            <span className="font-mono text-[11px] tabular-nums text-gc-text">
              ◇ {piece.vectors.shared}
            </span>
          ) : (
            // Reuse the exact board battery so the mapping (O · D · L) is learned once. It sizes
            // itself in container-query units (cqw = % of the nearest container), so this wrapper
            // MUST establish its own `container-type` — otherwise, portaled to <body> with no
            // container ancestor, `cqw` falls back to the viewport and the battery renders huge.
            // The wrapper width therefore sets the battery's scale (≈20% of it = the digit size).
            <span className="relative inline-block h-4 w-[46px] shrink-0 [container-type:inline-size]">
              <VectorBadges vectors={piece.vectors} />
            </span>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}

// ── Captured chip (focusable trigger owning its tooltip) ──────────────────────
// `count` = how many identical pieces this chip stands for. When >1 a small superscript-style
// badge sits at the top-left (e.g. one pawn glyph badged "2" instead of two pawn chips).
function CapturedChip({ piece, count }: { piece: Piece; count: number }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  const show = () => {
    if (ref.current) setAnchor(ref.current.getBoundingClientRect());
  };
  const hide = () => setAnchor(null);

  return (
    <span
      ref={ref}
      tabIndex={0}
      aria-label={count > 1 ? `${count}× ${ariaSummary(piece)}` : ariaSummary(piece)}
      aria-describedby={anchor ? tipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide();
      }}
      className={`relative inline-flex items-center justify-center w-7 h-7 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.4)] outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 ${
        piece.color === 'white'
          ? 'bg-gradient-to-b from-slate-700 to-slate-900 ring-1 ring-sky-400/50'
          : 'bg-gradient-to-b from-slate-100 to-slate-300 ring-1 ring-slate-400/60'
      }`}
    >
      <span className="w-[27px] h-[27px]">
        <PieceGlyph piece={piece} />
      </span>
      {count > 1 && (
        <span
          aria-hidden="true"
          className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-[3px] inline-flex items-center justify-center rounded-full bg-gc-accent text-gc-bg text-[9px] font-bold leading-none tabular-nums ring-1 ring-gc-panel shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
        >
          {count}
        </span>
      )}
      {anchor && <TooltipCard id={tipId} piece={piece} count={count} anchor={anchor} />}
    </span>
  );
}

export function CapturedPiecesPanel({
  capturedPieces,
  botActive,
  humanColor,
}: CapturedPiecesPanelProps) {
  return (
    <div className="flex flex-col gap-2 pb-1.5">
      {(['white', 'black'] as const).map((side) => {
        const groups = groupCaptured(capturedPieces[side]);
        const heading = botActive
          ? side === humanColor
            ? 'You took'
            : 'Opponent took'
          : `${side === 'white' ? 'White' : 'Black'} took`;
        return (
          <div key={side} className="flex flex-col gap-1">
            {/* Centered heading, flat — no card box, no divider lines. */}
            <h3 className="text-center text-[10px] uppercase tracking-widest text-gc-text-dim/80">
              {heading}
            </h3>
            <div className="flex flex-wrap gap-1.5 items-center justify-center">
              {groups.length === 0 ? (
                <span className="text-gc-text-dim/50 text-xs">—</span>
              ) : (
                groups.map((g, i) => <CapturedChip key={i} piece={g.piece} count={g.count} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
