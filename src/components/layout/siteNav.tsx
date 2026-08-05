// components/layout/siteNav.tsx — Shared site navigation (Project / Connect / Legal).
//
// Single source of truth for the app's nav links, consumed by the Header's hamburger menu.
// Fully config-driven: adding/removing a link or column is a one-line edit to NAV_COLUMNS
// with no JSX churn. External links get rel="noopener noreferrer" (prevents reverse-tabnabbing).

import { Link } from 'react-router-dom';

// ── Types ────────────────────────────────────────────────────────────────────
export interface NavLink {
  label: string;
  href: string;
  /** External links open in a new tab and get security rel attributes. */
  external?: boolean;
  /** Special action to trigger instead of navigation. */
  action?: 'quickStart';
}

export interface NavColumn {
  heading: string;
  links: NavLink[];
}

// ── Config — EDIT HERE. The app's one source of nav truth. ──
export const NAV_COLUMNS = [
  {
    heading: 'Project',
    links: [
      { label: 'Quick Start', href: '#', action: 'quickStart' },
      { label: 'Rules', href: '/rules' },
      { label: 'About', href: '/about' },
      // HIDDEN: Changelog link. The /changelog page/route still works — only this entry is
      // hidden. To unhide, uncomment: { label: 'Changelog', href: '/changelog' },
    ],
  },
  {
    heading: 'Connect',
    links: [
      { label: 'Reddit', href: 'https://www.reddit.com/user/gridlockchess', external: true },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Legal', href: '/licenses' },
    ],
  },
] satisfies NavColumn[];

// ── Link renderer ────────────────────────────────────────────────────────────
/** One nav link, with security attrs applied automatically for external targets. */
export function NavLinkItem({ link, onAction }: { link: NavLink; onAction?: (action: string) => void }) {
  const baseClasses =
    'text-gc-text-dim hover:text-gc-accent transition-colors focus-visible:outline-none focus-visible:text-gc-accent focus-visible:underline';

  // Special actions (e.g. quickStart opens the Welcome modal instead of navigating).
  if (link.action && onAction) {
    return (
      <button onClick={() => onAction(link.action!)} className={`${baseClasses} text-left`}>
        {link.label}
      </button>
    );
  }

  // External links open in a new tab with security attributes.
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noopener noreferrer" className={baseClasses}>
        {link.label}
      </a>
    );
  }

  // Internal links use React Router.
  return (
    <Link to={link.href} className={baseClasses}>
      {link.label}
    </Link>
  );
}
