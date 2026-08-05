// components/game/panels/OpponentSelect.tsx — Custom, mobile-first Game Mode picker.
//
// Replaces the native <select> whose OPEN popup Android renders as a huge, unstyleable OS sheet
// (long "Lvl N" labels wrap onto a second line and look broken). A native select popup can't
// be themed, so this is a fully CSS-controlled disclosure listbox instead: a compact trigger that
// expands a grouped (Game Modes / Bots) option list IN FLOW right below it — inline (not an absolute
// overlay) so it can never be clipped inside the scrollable hamburger menu. Keyboard + a11y wired:
// role="menu" / role="menuitemradio" + aria-checked, ↑/↓ roving focus, Enter/Space select, Esc close.
import { useEffect, useRef, useState } from 'react';
import type { BotDifficulty, BotTier } from '@/lib/chess/bot';
import { BOT_TIERS, ALL_DIFFICULTIES } from '@/lib/chess/bot';
import { RUN_DRY_TIER_LABELS } from '@/hooks/useProtocolRunDry';

type OptItem = { kind: 'mode' | 'action'; value: string; emoji: string; label: string; locked?: boolean };
type OptGroup = { label: string; items: OptItem[] };

const TIER_GROUP_LABELS: Record<BotTier, string> = {
  basic:        'Basic (L1-5)',
  intermediate: 'Intermediate (L6-10)',
  advanced:     'Advanced (L11-15) ⚡',
  expert:       'Expert (L16-20) ⚡',
  master:       'Master (L21-25) ⚡',
};

/** Static game-modes group — no header label; the "Game Mode" section label above covers it. */
const MODE_GROUP: OptGroup = {
  label: '',
  items: [
    { kind: 'mode', value: 'offline', emoji: '👥', label: 'Offline PvP (Pass & Play)' },
    { kind: 'mode', value: 'uplink', emoji: '🛰', label: 'Uplink · Online PvP' },
    { kind: 'mode', value: 'protocol-run-dry', emoji: '🪫', label: 'Protocol: Run Dry' },
    { kind: 'action', value: '__sandbox__', emoji: '🧪', label: 'Sandbox · build a position' },
  ],
};

export interface OpponentSelectProps {
  /** Current opponent mode (one of the `mode` option values; the sandbox action is never stored). */
  value: string;
  /** Fired when a real opponent mode is chosen. */
  onChange: (value: string) => void;
  /** Fired when the "Sandbox" action row is chosen (navigates to the editor; not a stored mode). */
  onOpenSandbox: () => void;
  /** Bot levels unlocked via Run Dry. Empty = no bots shown yet. */
  unlockedBots: BotDifficulty[];
}

export function OpponentSelect({ value, onChange, onOpenSandbox, unlockedBots }: OpponentSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // All 25 bots are always visible — locked ones are dimmed to motivate unlocking via Run Dry.
  // Grouped by tier so 25 items stay easy to scan.
  const unlockedSet = new Set(unlockedBots);
  const botGroups: OptGroup[] = (BOT_TIERS as BotTier[]).map((tier) => ({
    label: TIER_GROUP_LABELS[tier],
    items: ALL_DIFFICULTIES
      .filter((d) => d.startsWith(`${tier}_`))
      .map((d) => {
        const isUnlocked = unlockedSet.has(d);
        return {
          kind: 'mode' as const,
          value: d,
          emoji: isUnlocked ? '🤖' : '🔒',
          label: d === 'master_5'
            ? `${RUN_DRY_TIER_LABELS[d].callsign} ${RUN_DRY_TIER_LABELS[d].name} (Final Boss)`
            : `${RUN_DRY_TIER_LABELS[d].callsign} ${RUN_DRY_TIER_LABELS[d].name}`,
          locked: !isUnlocked,
        };
      }),
  }));

  const OPPONENT_GROUPS = [MODE_GROUP, ...botGroups];
  const ALL_ITEMS = OPPONENT_GROUPS.flatMap((g) => g.items);

  const current = ALL_ITEMS.find((o) => o.value === value) ?? OPPONENT_GROUPS[0].items[0];

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

  // On open, move focus to the checked option (or the first) so ↑/↓ works immediately.
  useEffect(() => {
    if (!open) return;
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items?.length) return;
    const checked = Array.from(items).find((el) => el.getAttribute('aria-checked') === 'true');
    (checked ?? items[0]).focus();
  }, [open]);

  const choose = (opt: OptItem) => {
    if (opt.locked) return;
    setOpen(false);
    if (opt.kind === 'action') onOpenSandbox();
    else onChange(opt.value);
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
    <div className="relative" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-2.5 px-3 rounded-xl bg-gc-panel-2 ring-1 ring-white/10 text-gc-text font-medium text-[13px] cursor-pointer hover:bg-gc-grid hover:ring-white/20 transition-all focus:outline-none focus:ring-2 focus:ring-gc-accent/70"
      >
        <span className="shrink-0">{current.emoji}</span>
        <span className="flex-1 truncate text-left">{current.label}</span>
        <svg viewBox="0 0 12 12" className={`h-3 w-3 shrink-0 text-gc-text-dim transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          role="menu"
          aria-label="Game Mode"
          onKeyDown={onListKeyDown}
          className="mt-1 rounded-xl bg-gc-panel-2 ring-1 ring-white/10 overflow-hidden max-h-[50vh] overflow-y-auto"
        >
          {/* Game modes — flat, no section header */}
          {MODE_GROUP.items.map((opt) => {
            const selected = opt.kind === 'mode' && opt.value === value && !opt.locked;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={!!opt.locked}
                onClick={() => choose(opt)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-left transition-colors focus:outline-none focus-visible:bg-white/10 ${
                  opt.locked
                    ? 'text-gc-text-dim/40 cursor-default'
                    : selected
                      ? 'bg-gc-accent/15 text-gc-text'
                      : 'text-gc-text-dim hover:bg-white/5 hover:text-gc-text'
                }`}
              >
                <span className="shrink-0 w-5 text-center">{opt.emoji}</span>
                <span className="flex-1 truncate">{opt.label}</span>
                {selected && (
                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-gc-accent" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 8.5l3.5 3.5L13 4.5" />
                  </svg>
                )}
              </button>
            );
          })}

          {/* Bots section — single section header explains the unlock gate */}
          <div className="border-t border-white/[0.07]">
            <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-widest text-gc-text-dim/60">
              Bots — Beat Run Dry to unlock
            </div>
            {botGroups.map((group) => (
              <div key={group.label}>
                <div className="px-3 pt-1.5 pb-0.5 text-[9px] uppercase tracking-widest text-gc-text-dim/40">{group.label}</div>
                {group.items.map((opt) => {
                  const selected = opt.kind === 'mode' && opt.value === value && !opt.locked;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={!!opt.locked}
                      onClick={() => choose(opt)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-left transition-colors focus:outline-none focus-visible:bg-white/10 ${
                        opt.locked
                          ? 'text-gc-text-dim/40 cursor-default'
                          : selected
                            ? 'bg-gc-accent/15 text-gc-text'
                            : 'text-gc-text-dim hover:bg-white/5 hover:text-gc-text'
                      }`}
                    >
                      <span className="shrink-0 w-5 text-center">{opt.emoji}</span>
                      <span className="flex-1 truncate">{opt.label}</span>
                      {selected && (
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
        </div>
      )}
    </div>
  );
}
