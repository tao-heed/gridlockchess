// components/docs/tocUtils.ts — TOC data model + DOM extraction helper.
//
// Split out of TableOfContents.tsx so that file only exports the component (keeps
// React Fast Refresh working; the rule flags a component file that also exports a
// non-component value).

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

/**
 * Reads TOC items from already-rendered headings inside a container element.
 *
 * This walks the real DOM produced by MDX (whose headings carry rehype-slug `id`s),
 * so the sidebar always matches what's on screen — no separate markdown parser to
 * drift out of sync. Returns { id, text, level } for h2–h4 headings that have an id.
 */
export function extractTocFromElement(container: HTMLElement | null): TocItem[] {
  if (!container) return [];
  const headings = container.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id], h4[id]');
  return Array.from(headings).map((el) => ({
    id: el.id,
    text: el.textContent ?? '',
    level: Number(el.tagName[1]),
  }));
}
