// components/layout/Header.tsx — Fixed, translucent app header (brand left, menu right).
//
// Modern app-bar pattern: a `fixed`, backdrop-blurred bar pinned to the top. The brand
// links home on the left; the right cluster holds the sound toggle + a menu button. The
// menu opens a dropdown showing the site nav columns (Project / Connect / Legal), sourced
// from NAV_COLUMNS + NavLinkItem so links live in exactly one place.
//
// The sound state is passed in (not read here) so the single `useGameSound` instance in
// the game stays authoritative — no duplicate mute state.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { BRAND } from '@/constants/brand';
import { useWelcome } from '@/components/game/modals';
import { isNativeEngineAvailable } from '@/lib/chess/nativeEngine';
import { EngineLogModal } from '@/components/ui/EngineLogModal';

interface HeaderProps {
  muted: boolean;
  onToggleMute: () => void;
  /** Game config (Opponent / Clock / Flip / Play As / Archetype Guide) rendered in the menu. */
  playSlot?: ReactNode;
  /** Fired when the menu opens — lets the game refresh the Play-settings drafts from reality. */
  onMenuOpen?: () => void;
  /** Bump this number to briefly reveal the auto-hiding bar (e.g. after a game ends, or on arrival
   *  from the Home "Play" button, so the player discovers the menu). Normal tap-outside /
   *  mouse-leave then hides it again. Reveals the BAR only — it does NOT open the menu dropdown. */
  revealSignal?: number;
  /** When true, the bar stays permanently visible and auto-hide is disabled. The game sets this
   *  only when the bar clears the top player card (tall phones), so it never overlaps the name. */
  pinned?: boolean;
}

const iconBtn =
  'grid place-items-center w-9 h-9 rounded-full text-gc-text-dim hover:text-gc-accent ' +
  'hover:bg-white/5 ring-1 ring-white/10 hover:ring-gc-accent/40 transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent';

export function Header({ muted, onToggleMute, playSlot, onMenuOpen, revealSignal, pinned }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const clusterRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const welcome = useWelcome();

  // Pinned (enough room above the board) OR temporarily revealed → the bar is down.
  const showBar = pinned || revealed;

  const cancelHide = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
  };
  const reveal = () => { cancelHide(); setRevealed(true); };
  // Delayed hide (mouse only) so brief pointer excursions off the bar don't snap it away.
  const hideSoon = () => {
    if (open || pinned) return;
    cancelHide();
    hideTimer.current = setTimeout(() => setRevealed(false), 450);
  };

  // Keep the bar down while its menu is open.
  useEffect(() => { if (open) { cancelHide(); setRevealed(true); } }, [open]);

  // External reveal: when `revealSignal` changes (bumped by the game after a match ends), slide
  // the bar down so the otherwise-hidden menu announces itself. 0/undefined = initial mount, so
  // it never reveals on first load; the normal tap-outside / mouse-leave logic then hides it.
  useEffect(() => {
    if (!revealSignal) return;
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    setRevealed(true);
  }, [revealSignal]);

  // Close the menu on Escape or a pointer press outside the right cluster.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => {
      if (clusterRef.current && !clusterRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // Revealed by touch (no pointer-leave to catch): dismiss on the next tap outside the bar.
  // Skipped entirely when pinned — the bar is meant to stay down there.
  useEffect(() => {
    if (!revealed || open || pinned) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target;
      if (el instanceof Element && el.closest('[data-header-zone]')) return;
      setRevealed(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [revealed, open, pinned]);

  // Clear any pending timer on unmount.
  useEffect(() => cancelHide, []);

  const handleAction = (action: string) => {
    if (action === 'quickStart') welcome.open();
    setOpen(false);
  };

  return (
    <>
      {/* Top-edge trigger + discoverability handle. Hover (mouse) or touch this strip to
          slide the bar down; it stays while the pointer is over the bar, and auto-hides.
          Height and padding-top clear env(safe-area-inset-top) so the pill is always
          visible below the system status bar / notch, not hidden behind it. */}
      <div
        data-header-zone
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') reveal(); }}
        onPointerDown={reveal}
        className="fixed inset-x-0 top-0 z-40 flex justify-center pt-[calc(env(safe-area-inset-top)+0.625rem)] h-[calc(env(safe-area-inset-top)+2.5rem)]"
        aria-hidden="true"
      >
        <div
          className={`h-1 w-10 rounded-full bg-white/25 transition-opacity duration-300 ${showBar ? 'opacity-0' : 'opacity-100'}`}
        />
      </div>

      <motion.header
        data-header-zone
        onPointerEnter={reveal}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') hideSoon(); }}
        initial={false}
        animate={{ y: showBar ? 0 : '-100%' }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed inset-x-0 top-0 z-50 h-[calc(3.5rem_+_env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] border-b border-white/10 bg-gc-bg/70 backdrop-blur-md will-change-transform"
      >
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <Link
          to="/"
          className="gc-title font-display text-lg font-bold tracking-tight sm:text-xl focus-visible:outline-none focus-visible:text-gc-accent"
        >
          {BRAND.appNameTrademarked}
        </Link>

        {/* Right cluster: sound toggle + menu */}
        <div ref={clusterRef} className="relative flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
            aria-pressed={muted}
            title={muted ? 'Unmute' : 'Mute'}
            className={iconBtn}
          >
            {muted ? '🔇' : '🔊'}
          </button>

          <button
            type="button"
            onClick={() => { if (!open) onMenuOpen?.(); setOpen((o) => !o); }}
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={open}
            className={iconBtn}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {/* Dropdown menu — a Play settings section (game config) above the site nav. */}
          {open && (
            <div
              aria-label="Menu"
              className="absolute right-0 top-12 flex w-[min(22rem,calc(100vw-1rem))] max-h-[80vh] flex-col gap-5 overflow-y-auto rounded-2xl border border-white/10 bg-gc-panel/95 p-4 shadow-2xl ring-1 ring-black/30 backdrop-blur-xl"
            >
              {/* Play — match settings (Opponent / Clock / Flip / Play As / Archetype Guide).
                  Adjustments here must NOT close the menu (the user may tweak several in a
                  row), so it sits outside the nav's close-on-click handler. The exception is
                  a commit action that opts in via `data-close-menu` (New Game): dismissing
                  lets the fresh board / Abandon confirm own the screen behind the panel. */}
              {playSlot && (
                <section
                  aria-label="Play settings"
                  onClick={(e) => { if ((e.target as HTMLElement).closest('[data-close-menu]')) setOpen(false); }}
                  className="flex flex-col gap-2"
                >
                  <h2 className="text-[10px] uppercase tracking-widest text-gc-text-dim/70">Play</h2>
                  {playSlot}
                </section>
              )}

              {/* Quick Start — flat link at the bottom, no section header. */}
              <button
                type="button"
                onClick={() => handleAction('quickStart')}
                className="text-left text-[14px] text-gc-text-dim hover:text-gc-accent transition-colors focus-visible:outline-none focus-visible:text-gc-accent focus-visible:underline"
              >
                Quick Start
              </button>

              {/* Engine log — a discreet dev entry point, only on the native Android app where
                  the real engine runs. Bottom-right, below the nav. Opening it closes the menu. */}
              {isNativeEngineAvailable() && (
                <div className="flex justify-end border-t border-white/5 pt-2">
                  <button
                    type="button"
                    onClick={() => { setLogOpen(true); setOpen(false); }}
                    aria-label="Engine log"
                    title="Engine log"
                    className="grid h-7 w-7 place-items-center rounded-lg text-gc-text-dim/60 ring-1 ring-white/10 transition-colors hover:text-gc-accent hover:ring-gc-accent/40"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 5h16v14H4zM8 10l2 2-2 2M13 14h3" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.header>

      {logOpen && <EngineLogModal onClose={() => setLogOpen(false)} />}
    </>
  );
}
