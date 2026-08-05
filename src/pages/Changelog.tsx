// pages/Changelog.tsx — Release history page.
//
// DESIGN: Authored in MDX (src/pages/Changelog.mdx) so release notes stay in plain
// markdown, rendered through the shared DocLayout (sidebar TOC, header, styling)
// exactly like the Rules and Licenses pages.

import { DocLayout } from '@/components/docs';
import ChangelogContent from './Changelog.mdx';

export function ChangelogPage() {
  return (
    <DocLayout
      title="Changelog"
      subtitle="Release history for Gridlock Chess"
      tocTitle="Versions"
    >
      <ChangelogContent />
    </DocLayout>
  );
}
