/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Gridlock Chess color palette
        'gc-bg': '#070a12',
        'gc-panel': '#0f1521',
        'gc-panel-2': '#161e2e',
        'gc-grid': '#2a3650',
        'gc-light-sq': '#8599c1',
        'gc-dark-sq': '#4d6493',
        'gc-accent': '#22e0ff',
        'gc-accent-dim': '#0891a8',
        'gc-violet': '#9b7bff',
        'gc-text': '#eaf1fb',
        'gc-text-dim': '#8896b0',
        // Vector colors
        'gc-leap': '#ff8f87',
        'gc-ortho': '#34d399',
        'gc-diag': '#fbbf24',
        'gc-gridlock': '#5b6577',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'Cascadia Code', 'SF Mono', 'monospace'],
        display: ['"Space Grotesk Variable"', '"Inter Variable"', 'sans-serif'],
      },
      boxShadow: {
        'glow-accent': '0 0 0 1px rgba(34,224,255,0.4), 0 0 24px -4px rgba(34,224,255,0.55)',
        'glow-soft': '0 8px 40px -12px rgba(0,0,0,0.7)',
        'board': '0 24px 70px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(40,52,80,0.6)',
        'panel': '0 16px 50px -16px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.04)',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '0.55', transform: 'scale(0.82)' },
          '50%': { opacity: '1', transform: 'scale(1)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // Gentle levitation for board pieces. Uses the INDEPENDENT `translate` property (not
        // `transform`) so it composes with the glyph's transform-based clearance/hover/scale
        // and framer's move-slide instead of overriding them.
        'float': {
          '0%, 100%': { translate: '0 0' },
          '50%': { translate: '0 -9%' },
        },
        // Ground shadow that shrinks + fades as its piece rises — the growing gap sells the
        // levitation depth. Runs on the same 8s clock + per-piece delay as `float`, so the
        // shadow is smallest exactly when the piece is highest.
        'float-shadow': {
          '0%, 100%': { opacity: '0.4', transform: 'translateX(-50%) scale(1)' },
          '50%': { opacity: '0.16', transform: 'translateX(-50%) scale(0.8)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        // ── Override (Anomaly Boarding) — see GridlockChess.md §6.1 ──
        // Persistent "this piece is royal" breathing aura behind the disc.
        'pilot-breathe': {
          '0%, 100%': { opacity: '0.22', transform: 'translate(-50%, -50%) scale(0.9)' },
          '50%': { opacity: '0.5', transform: 'translate(-50%, -50%) scale(1.14)' },
        },
        // One-time merge: the King crown fades/shrinks away as the host takes over.
        'pilot-merge-king': {
          '0%': { opacity: '1', transform: 'translate(-50%, -52%) scale(1.05)' },
          '55%': { opacity: '0.4' },
          '100%': { opacity: '0', transform: 'translate(-50%, -50%) scale(0.65)' },
        },
        // One-time merge: the host anomaly cross-fades in (never blank — overlaps the King).
        'pilot-merge-anomaly': {
          '0%': { opacity: '0.25', transform: 'scale(0.82)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        // One-time merge spark: a white core flash at the moment of bonding.
        'pilot-spark': {
          '0%': { opacity: '0', transform: 'translate(-50%, -50%) scale(0.35)' },
          '35%': { opacity: '0.95', transform: 'translate(-50%, -50%) scale(1)' },
          '100%': { opacity: '0', transform: 'translate(-50%, -50%) scale(1.35)' },
        },
        // One-time merge: a gold ring snaps outward to confirm the bond.
        'pilot-ring-snap': {
          '0%': { opacity: '0', transform: 'translate(-50%, -50%) scale(0.5)' },
          '40%': { opacity: '1' },
          '100%': { opacity: '0', transform: 'translate(-50%, -50%) scale(1.55)' },
        },
        // Low-stamina life-clock warning flash (stamina ≤ 2).
        'pilot-low-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 1.6s ease-in-out infinite',
        'pop-in': 'pop-in 0.18s ease-out',
        'float': 'float 8s ease-in-out infinite',
        'float-shadow': 'float-shadow 8s ease-in-out infinite',
        'shimmer': 'shimmer 6s linear infinite',
        'pilot-breathe': 'pilot-breathe 3s ease-in-out infinite',
        'pilot-merge-king': 'pilot-merge-king 0.8s ease-out forwards',
        'pilot-merge-anomaly': 'pilot-merge-anomaly 0.8s ease-out',
        'pilot-spark': 'pilot-spark 0.7s ease-out forwards',
        'pilot-ring-snap': 'pilot-ring-snap 0.8s ease-out forwards',
        'pilot-low-pulse': 'pilot-low-pulse 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
