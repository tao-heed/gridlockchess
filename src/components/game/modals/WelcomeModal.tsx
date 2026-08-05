// components/game/modals/WelcomeModal.tsx — First-run onboarding + reopenable "How to Play"
import { useEffect, useState, useRef, createContext, useContext, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, animate, useReducedMotion } from 'framer-motion';
import { Piece } from '@/components/pieces/Piece';
import { gcGradientGlow } from '@/constants/ui';
import type { Anomaly } from '@/types/game';

const STORAGE_KEY = 'gridlock:welcome-seen:v1';

/** Returns true if the player has never dismissed the welcome modal. */
export function useFirstRunWelcome(): {
  isOpen: boolean;
  open: () => void;
  close: (rememberDismissal?: boolean) => void;
} {
  const [isOpen, setIsOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    // Auto-open the first-run tour only once the player is actually in the game (/play),
    // not on the home screen — a newcomer should see the board before the mechanics tour.
    // (The provider stays global so the "Quick Start" reopen link works on every route.)
    if (pathname !== '/play') return;
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setIsOpen(true);
    } catch {
      // localStorage unavailable (private mode / SSR) — just show once this session.
      setIsOpen(true);
    }
  }, [pathname]);

  const open = () => setIsOpen(true);
  const close = (rememberDismissal = true) => {
    setIsOpen(false);
    if (rememberDismissal) {
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        /* ignore */
      }
    }
  };

  return { isOpen, open, close };
}

interface Card {
  icon: string;
  title: string;
  body: React.ReactNode;
}

// ── Randomness stats (derived from the generators in archetypes.ts/generator.ts) ──
// Each Anomaly is one of 36 distinct L/O/D stat builds (enumerated from the archetype
// point ranges). A board = King on 1 of 8 files × 7 mirrored Anomaly rolls; Black
// mirrors White exactly.
//   • Balanced (the only mode) keeps only armies whose vector totals are exactly
//     {24,23,23} (≤2 Absolutes / ≤2 duplicates): 743,855,490 ordered armies × 8 king
//     files = 5,950,843,920, minus 326,160 same-color bishop-pair positions dropped by
//     the opposite-color bishop rule = 5,950,517,760 (see docs/dev/scripts/verify_bishop_rule.mjs).
const ANOMALY_BUILDS = 36;
const TOTAL_POSITIONS = 5_950_517_760; // 8 × 743,855,490 − 326,160 bishop-pair positions

/**
 * Animated counter that eases from `from` → `to` on mount.
 * Uses LOG-SCALE interpolation so each order of magnitude (thousands → millions → billions)
 * gets roughly equal screen time — perfect for "960 → 5.95 billion" drama.
 * `holdDuration` pauses at the start value before launching.
 * Honors prefers-reduced-motion (shows final value instantly).
 */
function CountUp({
  from = 0,
  to,
  holdDuration = 0,
  duration = 1.6,
  format,
}: {
  from?: number;
  to: number;
  holdDuration?: number;
  duration?: number;
  format: (n: number) => string;
}) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : from);

  useEffect(() => {
    if (reduce) {
      setValue(to);
      return;
    }

    // Animate on log scale so each decade (10x) gets equal time
    const logFrom = Math.log10(Math.max(from, 1));
    const logTo = Math.log10(to);

    let controls: ReturnType<typeof animate> | null = null;
    const timeout = setTimeout(() => {
      controls = animate(logFrom, logTo, {
        duration,
        ease: [0.25, 0.1, 0.25, 1], // smooth ease-in-out with slight acceleration
        onUpdate: (logV) => setValue(Math.pow(10, logV)),
      });
    }, holdDuration * 1000);

    return () => {
      clearTimeout(timeout);
      controls?.stop();
    };
  }, [from, to, holdDuration, duration, reduce]);

  return <>{format(value)}</>;
}

const VECTOR = {
  L: { color: 'text-gc-leap', ring: 'ring-gc-leap/40', bg: 'bg-gc-leap/10', label: 'Leap', glyph: '♘' },
  O: { color: 'text-gc-ortho', ring: 'ring-gc-ortho/40', bg: 'bg-gc-ortho/10', label: 'Orthogonal', glyph: '♖' },
  D: { color: 'text-gc-diag', ring: 'ring-gc-diag/40', bg: 'bg-gc-diag/10', label: 'Diagonal', glyph: '♗' },
} as const;

function VectorChip({ k }: { k: keyof typeof VECTOR }) {
  const v = VECTOR[k];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[13px] font-semibold ring-1 ${v.bg} ${v.ring} ${v.color}`}
    >
      <span className="text-base leading-none">{v.glyph}</span>
      <span>· {v.label}</span>
    </span>
  );
}

const CARDS: Card[] = [
  {
    icon: '🔋',
    title: "It's chess, but your pieces get tired.",
    body: (
      <>
        <p>
          A normal <span className="text-gc-text font-semibold">8×8 board</span>. Your{' '}
          <span className="text-gc-text font-semibold">King</span> and{' '}
          <span className="text-gc-text font-semibold">pawns</span> move exactly as you remember.
        </p>
        <p>
          But your back row is <span className="text-gc-accent font-semibold">7 Anomalies</span>, each
          rolled with random stats every game — both sides get the{' '}
          <span className="text-gc-text font-semibold">same mirrored army</span>, so it's{' '}
          <span className="text-gc-text font-semibold">zero material luck</span>.
        </p>
        <div className="rounded-xl bg-white/[0.04] ring-1 ring-gc-accent/30 px-4 py-3 text-center">
          <div
            className="font-display text-[2rem] font-bold gc-title leading-none"
            title={`${TOTAL_POSITIONS.toLocaleString()} exact`}
          >
            <CountUp
              from={960}
              to={TOTAL_POSITIONS}
              holdDuration={0.5}
              duration={2.2}
              format={(n) => {
                if (n < 1e4) return Math.round(n).toLocaleString();
                if (n < 1e6) return `${Math.round(n / 1e3)}K`;
                if (n < 1e9) return `${Math.round(n / 1e6)} million`;
                return `${(n / 1e9).toFixed(2)} billion`;
              }}
            />
          </div>
          <div className="text-[12px] text-gc-text-dim mt-1.5 leading-snug">
            unique starting positions
          </div>
          <div className="text-[11px] text-gc-text-dim/70 mt-1">
            {ANOMALY_BUILDS} Anomaly builds · you’ll never play the same board twice
          </div>
        </div>
      </>
    ),
  },
  {
    icon: '🪫',
    title: 'Three movement types. Ten charges.',
    body: (
      <>
        <p>Every Anomaly has 10 charges split across three movement types:</p>
        <div className="flex items-center justify-center gap-4 my-3">
          {/* Example piece — actual game token with the real glyph + badges */}
          {(() => {
            const mockPiece: Anomaly = {
              id: 'demo',
              type: 'anomaly',
              color: 'white',
              archetype: 'balanced',
              icon: '🚁',
              vectors: { L: 3, O: 4, D: 3 },
              isGridlocked: false,
            };
            return (
              // The SAME <Piece> used on the board + Rules demo, in a responsive
              // container-query square: its glyph (74cqw), battery (20cqw) and any piloted
              // ring all size off THIS box, so they scale together across phone sizes and stay
              // pixel-consistent with the live game — no fixed px to drift or overlap.
              <div className="relative aspect-square w-[clamp(4.5rem,24vw,7rem)] shrink-0">
                {/* Token disc — dark board square color (matches /play board) */}
                <span className="absolute inset-0 rounded-full bg-gc-dark-sq ring-2 ring-slate-400/70 shadow-[0_2px_6px_rgba(0,0,0,0.45),inset_0_1px_2px_rgba(255,255,255,0.9)]" />
                <Piece piece={mockPiece} animateMove={false} batteryCqw={16} />
              </div>
            );
          })()}
          {/* Legend chips — ordered to match the badge stack, top → bottom: O, D, L */}
          <div className="flex flex-col gap-1.5">
            <VectorChip k="O" />
            <VectorChip k="D" />
            <VectorChip k="L" />
          </div>
        </div>
        <p>
          Each move <span className="text-gc-text font-semibold">spends 1 charge</span> from that type. When a type
          hits <span className="font-mono text-gc-text">0</span>, that piece can no longer move that way.
        </p>
      </>
    ),
  },
  {
    icon: '🪫',
    title: 'Gridlock — and how to win.',
    body: (
      <>
        <p>
          When all charges hit <span className="font-mono text-gc-text">0</span>, the piece is{' '}
          <span className="text-gc-gridlock font-semibold" style={{ color: '#9aa6bd' }}>
            Gridlocked
          </span>{' '}
          — frozen in place, but still capturable. Your <span className="text-gc-text font-semibold">King and pawns
          never tire</span>.
        </p>
        <p>
          Win the same way as always: <span className="text-gc-accent font-semibold">checkmate</span>.
          But every army is randomized, every position is new — no opening book to fall back on.
          Just tactics, adaptation, and knowing when to spend your last charge.
        </p>
      </>
    ),
  },
];

export interface WelcomeModalProps {
  isOpen: boolean;
  /** Called when the user closes the modal. `remember` = persist "don't show again". */
  onClose: (remember: boolean) => void;
}

export function WelcomeModal({ isOpen, onClose }: WelcomeModalProps) {
  const [index, setIndex] = useState(0);
  const isLast = index === CARDS.length - 1;
  const navigate = useNavigate();

  // Touch/mouse swipe to page the carousel (same threshold as the PanelDeck): a clearly
  // horizontal drag advances (left = next, right = back); vertical drags scroll the card.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onSwipeDown = (e: ReactPointerEvent) => { swipeStart.current = { x: e.clientX, y: e.clientY }; };
  const onSwipeUp = (e: ReactPointerEvent) => {
    const s = swipeStart.current;
    swipeStart.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      setIndex((i) => (dx < 0 ? Math.min(i + 1, CARDS.length - 1) : Math.max(i - 1, 0)));
    }
  };

  // Reset to first card whenever the modal opens.
  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);

  // Keyboard: Escape closes the modal, arrows navigate.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(true);
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, CARDS.length - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const card = CARDS[index];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => onClose(true)}
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Gridlock Chess Quick Start"
        >
          <motion.div
            initial={{ scale: 0.88, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 12 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onSwipeDown}
            onPointerUp={onSwipeUp}
            onPointerCancel={() => { swipeStart.current = null; }}
            style={{ touchAction: 'pan-y' }}
            className="relative flex max-h-[90dvh] flex-col overflow-hidden bg-gc-panel/95 backdrop-blur-xl border border-white/10 rounded-3xl p-6 max-w-xl w-full shadow-[0_40px_100px_-30px_rgba(0,0,0,0.95)]"
          >
            {/* Gradient accent */}
            <div className="absolute inset-0 -z-10 opacity-60 bg-gradient-to-br from-gc-accent/20 via-gc-violet/15 to-gc-accent/20" />

            {/* Close (X) */}
            <button
              onClick={() => onClose(true)}
              aria-label="Close"
              className="absolute top-4 right-4 w-8 h-8 rounded-full grid place-items-center text-gc-text-dim hover:text-gc-text hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
            >
              ✕
            </button>

            {/* Eyebrow */}
            <p className="text-[11px] uppercase tracking-[0.2em] text-gc-accent/80 font-semibold text-center mb-2">
              Quick Start · {index + 1} / {CARDS.length}
            </p>

            {/* Animated card content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={index}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.2 }}
                className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
              >
                <div className="flex justify-center mb-3">
                  <span className="text-5xl select-none drop-shadow-[0_0_20px_rgba(34,224,255,0.35)]">
                    {card.icon}
                  </span>
                </div>
                <h2
                  id="welcome-title"
                  className="font-display text-2xl font-bold gc-title text-center mb-3 leading-snug"
                >
                  {card.title}
                </h2>
                <div className="text-gc-text-dim text-[15px] leading-relaxed space-y-3 text-left">
                  {card.body}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Progress dots */}
            <div className="flex justify-center gap-2 my-3">
              {CARDS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIndex(i)}
                  aria-label={`Go to card ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index ? 'w-6 bg-gc-accent' : 'w-1.5 bg-white/20 hover:bg-white/40'
                  }`}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              {index === 0 ? (
                <button
                  onClick={() => onClose(true)}
                  className="py-3 px-5 rounded-2xl font-semibold text-[14px] bg-gc-panel-2 text-gc-text-dim ring-1 ring-white/10 hover:bg-gc-grid hover:text-gc-text transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
                >
                  Skip
                </button>
              ) : (
                <button
                  onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                  className="py-3 px-5 rounded-2xl font-semibold text-[14px] bg-gc-panel-2 text-gc-text-dim ring-1 ring-white/10 hover:bg-gc-grid hover:text-gc-text transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70"
                >
                  Back
                </button>
              )}
              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  if (isLast) {
                    // Dismiss (remember), then land on the game screen.
                    onClose(true);
                    navigate('/play');
                  } else {
                    setIndex((i) => Math.min(i + 1, CARDS.length - 1));
                  }
                }}
                className={`flex-1 py-3 px-6 rounded-2xl font-semibold text-[15px] ${gcGradientGlow} transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70`}
              >
                {isLast ? "Got it — let's play" : 'Next'}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Context for sharing Welcome modal state across components ──────────────
interface WelcomeContextValue {
  isOpen: boolean;
  open: () => void;
  close: (remember?: boolean) => void;
}

const WelcomeContext = createContext<WelcomeContextValue | null>(null);

export function WelcomeProvider({ children }: { children: ReactNode }) {
  const welcome = useFirstRunWelcome();
  return (
    <WelcomeContext.Provider value={welcome}>
      {children}
      <WelcomeModal isOpen={welcome.isOpen} onClose={welcome.close} />
    </WelcomeContext.Provider>
  );
}

export function useWelcome(): WelcomeContextValue {
  const ctx = useContext(WelcomeContext);
  if (!ctx) throw new Error('useWelcome must be used within a WelcomeProvider');
  return ctx;
}

export { WelcomeModal as default };
