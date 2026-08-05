// components/docs/DocLayout.tsx — Reusable layout for documentation pages.
//
// DESIGN: Three-column responsive layout:
// - Left: Table of Contents (hidden on mobile, sticky on desktop)
// - Center: Main content area
// - Right: Reserved for future use (e.g., "Edit this page", version picker)
//
// The layout is designed to be reused across all documentation pages (Rules, Changelog, About, etc.)

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MDXProvider } from '@mdx-js/react';
import { TableOfContents } from './TableOfContents';
import { extractTocFromElement, type TocItem } from './tocUtils';
import { mdxComponents } from './mdxComponents';

interface DocLayoutProps {
  /** Page title shown in the header */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Rendered MDX document (and any inline components) to display */
  children: ReactNode;
  /** Optional: Override auto-generated TOC title */
  tocTitle?: string;
  /** Optional: Show back to home link */
  showBackLink?: boolean;
  /** Optional: Cinematic hero banner shown above the page title (click to view full). */
  hero?: string;
  /** Optional: Alt text for the hero image (decorative by default). */
  heroAlt?: string;
}

export function DocLayout({
  title,
  subtitle,
  children,
  tocTitle,
  showBackLink = true,
  hero,
  heroAlt = '',
}: DocLayoutProps) {
  // Derive the TOC from the headings MDX actually renders, so the sidebar can't
  // drift from the content. Re-runs whenever the rendered document changes.
  const articleRef = useRef<HTMLElement>(null);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { hash } = useLocation();

  useEffect(() => {
    setTocItems(extractTocFromElement(articleRef.current));
  }, [children]);

  // Deep-link support: when the URL carries a #hash (e.g. /rules#random-openings),
  // scroll the matching heading into view once the MDX content has mounted. In a
  // client-rendered SPA the browser's native anchor jump fires before React has
  // rendered the headings, so we do it ourselves after paint. Re-runs when the hash
  // or the rendered document changes. `scroll-mt-24` on headings keeps them clear of
  // the sticky header. Respects reduced-motion by skipping the smooth animation.
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    let raf = 0;
    raf = window.requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [hash, tocItems]);

  // Close the hero lightbox on Escape and lock body scroll while it's open.
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxOpen]);

  return (
    <div className="min-h-screen bg-gc-bg">
      {/* Header */}
      <header className="border-b border-white/10 bg-gc-panel/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {showBackLink && (
              <Link
                to="/"
                className="text-gc-text-dim hover:text-gc-accent transition-colors flex items-center gap-2 text-sm min-h-[44px]"
              >
                <span className="text-lg">←</span>
                <span>Back to Game</span>
              </Link>
            )}
          </div>
          <Link
            to="/"
            className="gc-title font-display text-lg font-bold tracking-tight hover:text-gc-accent transition-colors inline-flex items-center min-h-[44px]"
          >
            GRIDLOCK CHESS
          </Link>
        </div>
      </header>

      {/* Main content area */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex gap-12">
          {/* Left sidebar - TOC (hidden on mobile) */}
          <aside className="hidden lg:block w-64 shrink-0">
            <TableOfContents items={tocItems} title={tocTitle} />
          </aside>

          {/* Main content */}
          <main className="flex-1 min-w-0 max-w-3xl">
            {/* Cinematic hero banner (optional, click to view full image) */}
            {hero && (
              <figure className="group relative mb-8">
                <div className="relative h-48 w-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] sm:h-64">
                  <img
                    src={hero}
                    alt={heroAlt}
                    loading="eager"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  {/* Bottom fade so the title reads cleanly against the image */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-gc-bg via-gc-bg/40 to-transparent" />
                  {/* Accent wash for the brand's cyan/violet identity */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-gc-accent/15 via-transparent to-gc-violet/15" />

                  {/* Lightbox trigger covers the image (sits below the controls). */}
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    aria-label="View full image"
                    className="group/btn absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gc-accent/70"
                  >
                    <span className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white/90 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                      </svg>
                      View full image
                    </span>
                  </button>
                </div>
              </figure>
            )}

            {/* Page header */}
            <div className="mb-8">
              <h1 className="gc-title font-display text-3xl sm:text-4xl font-bold tracking-tight">
                {title}
              </h1>
              {subtitle && (
                <p className="text-gc-text-dim mt-2 text-lg">{subtitle}</p>
              )}
            </div>

            {/* Mobile TOC (collapsible) */}
            <details className="lg:hidden mb-8 bg-gc-panel/50 rounded-xl border border-white/10">
              <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-gc-text-dim hover:text-gc-text transition-colors">
                On this page
              </summary>
              <div className="px-4 pb-4">
                <ul className="space-y-2 border-l border-white/10 ml-2">
                  {tocItems.map((item) => {
                    const indent = Math.max(0, item.level - 2);
                    return (
                      <li key={item.id}>
                        <a
                          href={`#${item.id}`}
                          className={`
                            flex items-center min-h-[44px] text-sm text-gc-text-dim hover:text-gc-accent transition-colors
                            ${indent === 1 ? 'pl-6' : indent === 2 ? 'pl-9' : 'pl-4'}
                          `}
                        >
                          {item.text}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>

            {/* MDX content */}
            <article ref={articleRef} className="prose-gc">
              <MDXProvider components={mdxComponents}>{children}</MDXProvider>
            </article>

            {/* Footer navigation */}
            <nav className="mt-16 pt-8 border-t border-white/10 flex items-center justify-end">
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="text-gc-text-dim hover:text-gc-accent transition-colors flex items-center gap-2"
              >
                <span>Back to top</span>
                <span>↑</span>
              </button>
            </nav>
          </main>

          {/* Right sidebar - reserved for future use */}
          <aside className="hidden xl:block w-48 shrink-0">
            {/* Future: Edit this page link, version selector, etc. */}
          </aside>
        </div>
      </div>

      {/* Hero lightbox — full-resolution view */}
      {hero && lightboxOpen && (
        <div
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm cursor-zoom-out"
          role="dialog"
          aria-modal="true"
          aria-label={heroAlt || 'Full image'}
        >
          <img
            src={hero}
            alt={heroAlt}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-2xl text-white/80 transition-colors hover:bg-black/70 hover:text-white"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
