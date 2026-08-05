// components/game/CenterPill.tsx — Pill-shaped atom for the PlayerCard center-action slot.
//
// Three variants:
//   accent  — primary action (Resume, Leave when opponent left) — teal ring + bg
//   dim     — secondary action (Leave in Xs) — muted ring + bg, brightens on hover
//   label   — non-interactive status text (Opponent left, Waiting…) — same muted shell, no hover
//
// Optional `pulse` prop adds animate-pulse for the "Waiting…" state.
// All interactive variants satisfy focus-visible accessibility.

import type { ReactNode } from 'react';

interface CenterPillProps {
  variant: 'accent' | 'dim' | 'label';
  onClick?: () => void;
  pulse?: boolean;
  children: ReactNode;
}

const BASE = 'inline-flex items-center h-7 px-2.5 rounded-full text-[12px] whitespace-nowrap';

const STYLES: Record<CenterPillProps['variant'], string> = {
  accent: `${BASE} bg-gc-accent/15 ring-1 ring-gc-accent/50 text-gc-accent font-semibold hover:bg-gc-accent/25 active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent`,
  dim:    `${BASE} bg-gc-panel-2/80 ring-1 ring-white/10 text-gc-text-dim font-medium hover:text-gc-text hover:ring-white/20 active:scale-95 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent`,
  label:  `${BASE} bg-gc-panel-2/80 ring-1 ring-white/10 text-gc-text-dim font-medium`,
};

export function CenterPill({ variant, onClick, pulse, children }: CenterPillProps) {
  const cls = `${STYLES[variant]}${pulse ? ' animate-pulse' : ''}`;

  if (variant === 'label' || !onClick) {
    return <span className={cls}>{children}</span>;
  }

  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
