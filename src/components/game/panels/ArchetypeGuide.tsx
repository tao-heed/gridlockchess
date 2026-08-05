// components/game/panels/ArchetypeGuide.tsx — Collapsible archetype reference
//
// Pure display component showing the archetype shape/color system.
// Consumes ARCHETYPE_GUIDE constant from constants/archetypes.ts

import { useState } from 'react';
import type { ArchetypeKey } from '@/types/game';
import { ARCHETYPE_GUIDE } from '@/constants/archetypes';
import { ARCHETYPE_REGISTRY } from '@/lib/chess/archetypes';
import { ArchetypeGlyph } from '@/components/pieces/PieceGlyph';

export function ArchetypeGuide() {
  // Click a tile to reveal its type / alias / specialty below the section; click the same
  // tile again (or another) to toggle. One open at a time keeps the guide compact.
  const [expanded, setExpanded] = useState<ArchetypeKey | null>(null);

  return (
    <div className="pt-4 border-t border-white/5">
      <h3 className="text-[10px] text-gc-text-dim uppercase tracking-widest">
        Archetype Guide
      </h3>
      <p className="text-[10px] text-gc-text-dim/60 mt-1">
        Tap any icon for details
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {ARCHETYPE_GUIDE.map((section) => (
          <div key={section.group}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-gc-text">{section.group}</span>
              <span className="text-[10px] text-gc-text-dim/70">{section.hint}</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {section.items.map((item) => {
                const isOpen = expanded === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setExpanded((k) => (k === item.key ? null : item.key))}
                    aria-expanded={isOpen}
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 ring-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 ${
                      isOpen
                        ? 'bg-gc-accent/10 ring-gc-accent/50'
                        : 'bg-gc-panel-2/50 ring-white/5 hover:bg-white/5 hover:ring-white/20'
                    }`}
                  >
                    <span className="w-7 h-7">
                      <ArchetypeGlyph archetype={item.key} />
                    </span>
                    <span className="text-[9px] text-gc-text-dim text-center leading-tight px-1">
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Detail panel — shows under the section whose tile is open. */}
            {expanded && section.items.some((i) => i.key === expanded) && (
              <div className="mt-2 rounded-lg bg-gc-panel-2/70 ring-1 ring-gc-accent/30 p-3 flex flex-col gap-1.5 text-left">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 shrink-0">
                    <ArchetypeGlyph archetype={expanded} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold text-gc-text leading-tight">
                      {ARCHETYPE_REGISTRY[expanded].name}
                    </div>
                    <div className="text-[10px] text-gc-text-dim leading-tight">
                      “{ARCHETYPE_REGISTRY[expanded].alias}”
                    </div>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-gc-text-dim">
                  {ARCHETYPE_REGISTRY[expanded].specialty}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
