// components/game/sandbox/PalettePanel.tsx — piece palette for the Sandbox editor.
//
// White/Black tab → a grid of chips (King, Pawn, then every archetype incl. Omni). Tapping a chip
// "arms" it; the armed chip is highlighted. Placement (tap a square) is handled by the page.
import { useState } from 'react';
import type { PieceColor } from '@/types/game';
import { ARCHETYPE_DEFS_IN_ORDER } from '@/lib/chess/archetypes';
import { PieceGlyph } from '@/components/pieces/PieceGlyph';
import { createSandboxPiece, samePaletteItem, type PaletteItem } from '@/hooks/useSandbox';

function itemLabel(item: PaletteItem): string {
  if (item.kind === 'king') return 'King';
  if (item.kind === 'pawn') return 'Pawn';
  return ARCHETYPE_DEFS_IN_ORDER.find((d) => d.key === item.archetype)?.name ?? item.archetype;
}

function PaletteChip({ item, armed, onArm }: { item: PaletteItem; armed: boolean; onArm: () => void }) {
  const piece = createSandboxPiece(item, 'chip');
  return (
    <button
      type="button"
      onClick={onArm}
      aria-pressed={armed}
      aria-label={`${item.color === 'white' ? 'White' : 'Black'} ${itemLabel(item)}`}
      className={`flex flex-col items-center gap-1 rounded-xl p-1.5 ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 ${
        armed ? 'bg-gc-accent/15 ring-gc-accent' : 'bg-gc-panel-2 ring-white/10 hover:ring-white/25'
      }`}
    >
      <span className="h-9 w-9 [container-type:inline-size]">
        <PieceGlyph piece={piece} />
      </span>
      <span className="w-full truncate text-center text-[9px] leading-none text-gc-text-dim">{itemLabel(item)}</span>
    </button>
  );
}

/** The Sandbox board-mode cycle (a single button): Normal → Mirror → Reverse → 90° → 180° → 270° → Normal.
 *  Rotations step a consistent 90° clockwise each tap.
 *  - normal:  free placement, White's view (0°).
 *  - mirror:  place White on your half; it auto-mirrors as Black on the opposite rank, same file.
 *  - reverse: place White on your half; it auto-mirrors as Black point-reflected (opposite file & rank).
 *  - rot90:   board view turned 90° CW → White on the LEFT; placement is free.
 *  - rot180:  board view turned 180° → White at the TOP; placement is free.
 *  - rot270:  board view turned 270° CW → White on the RIGHT; placement is free. */
export type BoardMode = 'normal' | 'mirror' | 'reverse' | 'rot90' | 'rot180' | 'rot270';

const MODE_LABEL: Record<BoardMode, string> = { normal: 'Normal', mirror: 'Mirror', reverse: 'Reverse', rot90: '90°', rot180: '180°', rot270: '270°' };
const MODE_TITLE: Record<BoardMode, string> = {
  normal: 'Board: Normal (0°) — tap for Mirror (auto-mirror White → Black, same file)',
  mirror: 'Board: Mirror on — tap for Reverse (auto-mirror White → Black, opposite file & rank)',
  reverse: 'Board: Reverse on — tap to rotate 90° (White on the left)',
  rot90: 'Board: 90° — White on the left — tap for 180°',
  rot180: 'Board: 180° — White at the top — tap for 270°',
  rot270: 'Board: 270° — White on the right — tap to return to Normal',
};

export function PalettePanel({ armed, onArm, onClear, onUndo, canUndo, boardMode, onCycleBoardMode }: { armed: PaletteItem | null; onArm: (item: PaletteItem) => void; onClear: () => void; onUndo: () => void; canUndo: boolean; boardMode: BoardMode; onCycleBoardMode: () => void }) {
  const [color, setColor] = useState<PieceColor>('white');
  const isMirror = boardMode === 'mirror' || boardMode === 'reverse';
  // Twin modes (mirror / reverse) place White on your half and auto-mirror it in Black, so only White is selectable.
  const effectiveColor: PieceColor = isMirror ? 'white' : color;

  const items: PaletteItem[] = [
    { kind: 'king', color: effectiveColor },
    { kind: 'pawn', color: effectiveColor },
    ...ARCHETYPE_DEFS_IN_ORDER.map((d) => ({ kind: 'anomaly', color: effectiveColor, archetype: d.key }) as PaletteItem),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-lg bg-gc-panel-2 p-0.5 ring-1 ring-white/10">
          {(['white', 'black'] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            disabled={isMirror && c === 'black'}
            aria-pressed={effectiveColor === c}
            className={`rounded-md px-3 py-1 text-[12px] font-semibold capitalize transition-colors ${
              effectiveColor === c ? 'bg-gc-accent/20 text-gc-text' : 'text-gc-text-dim hover:text-gc-text'
            } ${isMirror && c === 'black' ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {c}
          </button>
        ))}
        </div>
        <button
          type="button"
          onClick={onCycleBoardMode}
          title={MODE_TITLE[boardMode]}
          aria-label={`Board mode: ${MODE_LABEL[boardMode]}. Tap to cycle Normal → Mirror → Reverse → 90° → 180° → 270°.`}
          className={`inline-flex items-center rounded-lg px-3 py-1 text-[12px] font-semibold ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent ${
            boardMode === 'normal'
              ? 'text-gc-text-dim ring-white/15 hover:text-gc-text hover:ring-white/30'
              : 'bg-gc-accent/20 text-gc-text ring-gc-accent/50'
          }`}
        >
          {MODE_LABEL[boardMode]}
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo last change"
            className="rounded-lg px-3 py-1 text-xs font-semibold text-gc-text-dim ring-1 ring-white/15 transition-colors hover:text-gc-text hover:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg px-3 py-1 text-xs font-semibold text-red-300/90 ring-1 ring-red-400/30 transition-colors hover:text-red-200 hover:ring-red-400/50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
        {items.map((item) => (
          <PaletteChip
            key={`${item.kind}-${item.kind === 'anomaly' ? item.archetype : ''}`}
            item={item}
            armed={samePaletteItem(armed, item)}
            onArm={() => onArm(item)}
          />
        ))}
      </div>
    </div>
  );
}
