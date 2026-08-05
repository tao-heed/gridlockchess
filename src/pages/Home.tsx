// pages/Home.tsx — App launcher / home screen for the Gridlock Chess mobile app.
//
// DESIGN: Full-screen dark landing page that opens the game. Shown at `/` when the
// app launches. Logo is centred with the app name and tagline; a single large "Play"
// CTA takes the player straight into the game. Quick Start sits immediately below Play
// so a first-time player can orient themselves without hunting. Secondary nav (Rules,
// About, Reddit, Legal) sits at the bottom so the play surface stays dominant.
// Fully responsive — works on every phone width from 280 px (foldable) upward.
import { Link } from 'react-router-dom';
import { BRAND } from '@/constants/brand';
import { useWelcome } from '@/components/game/modals';

export function HomePage() {
  const welcome = useWelcome();
  return (
    <div className="min-h-[100svh] flex flex-col items-center justify-between px-6 py-[max(2rem,env(safe-area-inset-top)+1.5rem)] pb-[max(2rem,env(safe-area-inset-bottom)+1.5rem)] bg-gc-bg">

      {/* Spacer — pushes logo+CTA block toward vertical center */}
      <div aria-hidden="true" />

      {/* ── Hero block ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-6 w-full max-w-[360px]">

        {/* Logo */}
        <img
          src="/pwa-192x192.png"
          alt="Gridlock Chess logo"
          className="w-[min(180px,42vw)] h-auto drop-shadow-[0_0_40px_rgba(34,224,255,0.35)]"
          draggable={false}
        />

        {/* Name + tagline */}
        <div className="text-center space-y-2">
          <h1 className="gc-title font-display text-3xl sm:text-4xl font-bold tracking-tight text-gc-text">
            {BRAND.appNameTrademarked}
          </h1>
          <p className="text-gc-text-dim text-sm leading-relaxed max-w-[26ch] mx-auto">
            A chess variant where pieces can run out of moves.
          </p>
        </div>

        {/* ── Play CTA ───────────────────────────────────────────────────── */}
        <Link
          to="/play"
          state={{ revealHeader: true }}
          className="
            mt-2 w-full max-w-[240px] flex items-center justify-center gap-2
            rounded-2xl bg-gc-accent text-gc-bg font-bold text-lg py-4
            shadow-[0_0_28px_rgba(34,224,255,0.4)]
            hover:brightness-110 active:scale-95
            transition-all duration-150
            focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gc-accent/60
          "
        >
          Play
        </Link>

        {/* Quick Start — secondary action for first-time players, immediately below Play */}
        <button
          type="button"
          onClick={welcome.open}
          className="text-sm text-gc-text-dim/60 hover:text-gc-accent transition-colors focus-visible:outline-none focus-visible:text-gc-accent"
        >
          Quick Start
        </button>

        {/* Protocol: Run Dry description */}
        <div className="flex flex-col items-center gap-0.5 text-[11px] text-center">
          <span className="text-gc-accent/75 font-medium">5.95 Billion Openings</span>
          <span className="text-gc-text-dim/60">Charges · Override · Gridlock</span>
        </div>
      </div>

      {/* ── Bottom nav ─────────────────────────────────────────────────────── */}
      <nav
        aria-label="Site navigation"
        className="flex items-center gap-6 flex-wrap justify-center"
      >
        {[
          { label: 'Rules', to: '/rules' },
          { label: 'About', to: '/about' },
        ].map(({ label, to }) => (
          <Link
            key={to}
            to={to}
            className="text-xs text-gc-text-dim/60 hover:text-gc-accent transition-colors focus-visible:outline-none focus-visible:text-gc-accent"
          >
            {label}
          </Link>
        ))}
        <Link
          to="/licenses"
          className="text-xs text-gc-text-dim/60 hover:text-gc-accent transition-colors focus-visible:outline-none focus-visible:text-gc-accent"
        >
          Legal
        </Link>
      </nav>
    </div>
  );
}
