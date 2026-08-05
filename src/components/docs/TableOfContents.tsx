// components/docs/TableOfContents.tsx — Sidebar navigation for documentation pages.
//
// DESIGN: Sticky sidebar that tracks scroll position and highlights the active section.
// Uses Intersection Observer for performant scroll tracking. Supports nested headings
// with visual indentation.

import { useState, useEffect } from 'react';
import type { TocItem } from './tocUtils';

interface TableOfContentsProps {
  items: TocItem[];
  /** Title shown above the TOC */
  title?: string;
}

export function TableOfContents({ items, title = 'On this page' }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string>('');

  // Scroll-spy: highlight the section whose heading is the last one above a small
  // offset from the top. A bottom-of-page guard guarantees the final section lights
  // up even when it's too short to scroll under the offset band (the classic
  // "last item never activates" IntersectionObserver bug).
  useEffect(() => {
    if (items.length === 0) return;

    const OFFSET = 120; // px below the sticky header where "active" begins
    let frame = 0;

    const computeActive = () => {
      frame = 0;
      const scrollBottom = window.scrollY + window.innerHeight;
      const pageBottom = document.documentElement.scrollHeight;

      // Within 2px of the bottom → the last section is the one being read.
      if (scrollBottom >= pageBottom - 2) {
        setActiveId(items[items.length - 1]!.id);
        return;
      }

      let current = items[0]!.id;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (el && el.getBoundingClientRect().top <= OFFSET) {
          current = item.id;
        } else {
          break;
        }
      }
      setActiveId(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(computeActive);
    };

    computeActive();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [items]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      // Smooth scroll with offset for sticky header
      const yOffset = -100;
      const y = el.getBoundingClientRect().top + window.scrollY + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
      // Update URL hash without jumping
      window.history.pushState(null, '', `#${id}`);
      setActiveId(id);
    }
  };

  if (items.length === 0) return null;

  return (
    <nav className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-4">
      <h2 className="text-[11px] uppercase tracking-[0.2em] text-gc-text-dim/70 font-semibold mb-4">
        {title}
      </h2>
      <ul className="space-y-1 border-l border-white/10">
        {items.map((item) => {
          const isActive = activeId === item.id;
          // Indent based on heading level (h2=0, h3=1, h4=2)
          const indent = Math.max(0, item.level - 2);

          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                onClick={(e) => handleClick(e, item.id)}
                className={`
                  block py-2 text-sm leading-snug rounded-r-md transition-colors
                  border-l-2 -ml-[2px]
                  ${indent === 1 ? 'pl-6' : indent === 2 ? 'pl-9' : 'pl-4'}
                  ${
                    isActive
                      ? 'border-gc-accent bg-gc-accent/10 text-gc-accent font-medium'
                      : 'border-transparent text-gc-text-dim hover:text-gc-text hover:bg-white/5 hover:border-white/30'
                  }
                `}
              >
                {item.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

