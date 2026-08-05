// pages/Rules.tsx — Rules/Quick Start documentation page.
//
// DESIGN: Authored in MDX (src/pages/Rules.mdx) so prose stays in plain markdown
// while live, drift-proof React components (the interactive demo and the
// engine-driven reference tables) render inline. DocLayout provides the sidebar TOC,
// which is derived from the headings MDX actually renders.

import { DocLayout } from '@/components/docs';
import RulesContent from './Rules.mdx';

export function RulesPage() {
  return (
    <DocLayout
      title="Rules"
      subtitle="Learn the essential mechanics of Gridlock Chess"
      tocTitle="Topics"
    >
      <RulesContent />
    </DocLayout>
  );
}
