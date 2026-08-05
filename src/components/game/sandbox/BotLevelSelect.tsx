// components/game/sandbox/BotLevelSelect.tsx — bot-level picker for the Sandbox.
//
// Same custom, CSS-controlled dropdown as the main Opponent selector (panels/OpponentSelect):
// the native <select> popup renders as a huge, unstyleable OS sheet on Android and its long
// long "Lvl N" labels wrap. This is a disclosure listbox instead — a compact trigger that
// expands a themed option list IN FLOW below it (never clipped), with ↑/↓ roving focus,
// Enter/Space select, Esc close. Flat list (no groups/action), unlike OpponentSelect.
import { useEffect, useRef, useState } from 'react';
import type { BotDifficulty, BotTier } from '@/lib/chess/bot';
import { BOT_TIERS, ALL_DIFFICULTIES } from '@/lib/chess/bot';
import { RUN_DRY_TIER_LABELS } from '@/hooks/useProtocolRunDry';

// All 25 bot levels grouped into 5 tiers. Lock state is applied per-render from unlockedBots.
const TIER_GROUP_LABELS: Record<BotTier, string> = {
  basic:        'Basic (L1-5)',
  intermediate: 'Intermediate (L6-10)',
  advanced:     'Advanced (L11-15) ⚡',
  expert:       'Expert (L16-20) ⚡',
  master:       'Master (L21-25) ⚡',
};
type TierGroup = { tier: BotTier; label: string; options: { value: BotDifficulty; label: string }[] };
const TIER_GROUPS: TierGroup[] = (BOT_TIERS as BotTier[]).map((tier) => ({
  tier,
  label: TIER_GROUP_LABELS[tier],
  options: ALL_DIFFICULTIES
    .filter((t) => t.startsWith(`${tier}_`))
    .map((t) => ({
      value: t,
      label: t === 'master_5'
        ? `${RUN_DRY_TIER_LABELS[t].callsign} ${RUN_DRY_TIER_LABELS[t].name} (Final Boss)`
        : `${RUN_DRY_TIER_LABELS[t].callsign} ${RUN_DRY_TIER_LABELS[t].name}`,
    })),
}));

export interface BotLevelSelectProps {
  value: BotDifficulty;
  onChange: (value: BotDifficulty) => void;
  /** Bots unlocked via Run Dry. Locked bots are shown dimmed and unselectable. */
  unlockedBots: BotDifficulty[];
}

export function BotLevelSelect({ value, onChange, unlockedBots }: BotLevelSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const unlockedSet = new Set(unlockedBots);
  const allOptions = TIER_GROUPS.flatMap((g) => g.options);
  const current = allOptions.find((o) => o.value === value) ?? allOptions[0];
  const currentLocked = !unlockedSet.has(current.value);

  // Close on outside pointer + Escape (Escape returns focus to the trigger).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // On open, focus the checked option (or the first) so ↑/↓ works immediately.
  useEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const checked = Array.from(items).find((el) => el.getAttribute('aria-checked') === 'true');
    (checked ?? items[0]).focus();
  }, [open]);

  const choose = (v: BotDifficulty) => {
    if (!unlockedSet.has(v)) return;
    setOpen(false);
    onChange(v);
  };

  // Roving focus between option buttons (↑/↓/Home/End).
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  };

  return (
    <div className="relative w-[14rem]" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Bot level"
        className="w-full flex items-center gap-2 py-2.5 px-3 rounded-xl bg-gc-panel-2 ring-1 ring-white/10 text-gc-text font-medium text-[13px] cursor-pointer hover:bg-gc-grid hover:ring-white/20 transition-all focus:outline-none focus:ring-2 focus:ring-gc-accent/70"
      >
        <span className="shrink-0">{currentLocked ? '🔒' : '🤖'}</span>
        <span className="flex-1 truncate text-left">{current.label}</span>
        <svg viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 text-gc-text-dim transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label="Bot level"
          onKeyDown={onListKeyDown}
          className="mt-1 rounded-xl bg-gc-panel-2 ring-1 ring-white/10 overflow-hidden max-h-[50vh] overflow-y-auto"
        >
          {TIER_GROUPS.map((group) => (
            <div key={group.tier}>
              <div className="px-3 pt-2.5 pb-1 text-[9px] uppercase tracking-widest text-gc-text-dim/70">{group.label}</div>
              {group.options.map((opt) => {
                const selected = opt.value === value;
                const locked = !unlockedSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={locked}
                    onClick={() => choose(opt.value)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left transition-colors focus:outline-none focus-visible:bg-white/10 ${
                      locked
                        ? 'text-gc-text-dim/40 cursor-default'
                        : selected
                          ? 'bg-gc-accent/15 text-gc-text'
                          : 'text-gc-text-dim hover:bg-white/5 hover:text-gc-text'
                    }`}
                  >
                    <span className="shrink-0 w-5 text-center">{locked ? '🔒' : '🤖'}</span>
                    <span className="flex-1 truncate">{opt.label}</span>
                    {selected && !locked && (
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-gc-accent" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 8.5l3.5 3.5L13 4.5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
