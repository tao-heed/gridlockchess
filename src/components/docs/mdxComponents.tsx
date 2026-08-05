// components/docs/mdxComponents.tsx — Styled element map for MDX-authored docs.
//
// DESIGN: MDX compiles authored markdown/JSX to React. <MDXProvider> injects this map
// so every plain markdown element (headings, tables, lists, code, …) renders with the
// app's design system — while authors can still drop in live React components (demos,
// reference tables) inline. This is the single source of truth for doc prose styling.

import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import { useWelcome } from '@/components/game/modals';

// Hash-href convention that mirrors the site nav's `action: 'quickStart'` link: any MDX
// link pointing here opens the Quick Start (Welcome) modal instead of navigating.
const QUICK_START_HREF = '#quick-start';

/** Prose link renderer. Special-cases the Quick Start trigger; everything else is a plain
 *  anchor (external links get security attrs). */
function MdxLink({ href, children }: { href?: string; children?: ReactNode }) {
  const welcome = useWelcome();

  if (href === QUICK_START_HREF) {
    return (
      <button
        type="button"
        onClick={() => welcome.open()}
        className="text-gc-accent hover:text-gc-accent/80 underline underline-offset-2 transition-colors"
      >
        {children}
      </button>
    );
  }

  const external = href?.startsWith('http');
  return (
    <a
      href={href}
      className="text-gc-accent hover:text-gc-accent/80 underline underline-offset-2 transition-colors"
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
    >
      {children}
    </a>
  );
}

export const mdxComponents: MDXComponents = {
  h1: ({ children }) => (
    <h1 className="gc-title font-display text-3xl sm:text-4xl font-bold mb-6 mt-8 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children, id }) => (
    <h2
      id={id}
      className="text-xl sm:text-2xl font-bold text-gc-text mt-12 mb-4 pb-2 border-b border-white/10 scroll-mt-24"
    >
      {children}
    </h2>
  ),
  h3: ({ children, id }) => (
    <h3 id={id} className="text-lg sm:text-xl font-semibold text-gc-text mt-8 mb-3 scroll-mt-24">
      {children}
    </h3>
  ),
  h4: ({ children, id }) => (
    <h4 id={id} className="text-base font-semibold text-gc-text mt-6 mb-2 scroll-mt-24">
      {children}
    </h4>
  ),

  p: ({ children }) => <p className="text-gc-text-dim leading-relaxed mb-4">{children}</p>,

  ul: ({ children }) => (
    <ul className="list-disc list-outside ml-6 mb-4 space-y-2 text-gc-text-dim">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside ml-6 mb-4 space-y-2 text-gc-text-dim">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-gc-accent/50 pl-4 py-2 my-4 bg-gc-accent/5 rounded-r-lg italic text-gc-text-dim">
      {children}
    </blockquote>
  ),

  code: ({ children }) => (
    <code className="px-1.5 py-0.5 rounded bg-white/10 text-gc-accent text-[0.9em] font-mono">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="bg-gc-panel/80 border border-white/10 rounded-xl p-4 mb-4 overflow-x-auto text-sm font-mono text-gc-text-dim">
      {children}
    </pre>
  ),

  table: ({ children }) => (
    <div className="overflow-x-auto mb-6">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-white/20 bg-white/5">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-white/10">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-white/5 transition-colors">{children}</tr>,
  th: ({ children }) => (
    <th className="px-4 py-3 text-left font-semibold text-gc-text align-top break-words">{children}</th>
  ),
  td: ({ children }) => <td className="px-4 py-3 text-gc-text-dim align-top break-words">{children}</td>,

  a: ({ href, children }) => <MdxLink href={href}>{children}</MdxLink>,

  hr: () => <hr className="border-white/10 my-8" />,

  strong: ({ children }) => <strong className="font-semibold text-gc-text">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  img: ({ src, alt }) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt}
      className="rounded-xl max-w-full h-auto my-4 border border-white/10"
      loading="lazy"
    />
  ),
};
