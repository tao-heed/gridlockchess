// pages/About.tsx — Story, vision, and design philosophy page.
//
// DESIGN: Authored in MDX (src/pages/About.mdx) so the narrative stays in plain
// markdown, rendered through the shared DocLayout (sidebar TOC, header, styling)
// exactly like the Rules, Licenses, and Changelog pages.

import { DocLayout } from '@/components/docs';
import AboutContent from './About.mdx';

export function AboutPage() {
  return (
    <DocLayout
      title="About Gridlock Chess"
      subtitle="The world, the idea, and why every move runs out"
      tocTitle="Sections"
    >
      <AboutContent />
    </DocLayout>
  );
}
