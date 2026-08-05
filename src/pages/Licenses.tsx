// pages/Licenses.tsx — Credits & open-source acknowledgements page.
//
// DESIGN: Authored in MDX (src/pages/Licenses.mdx) so the credits stay in plain
// markdown, rendered through the shared DocLayout (sidebar TOC, header, styling)
// exactly like the Rules page.

import { DocLayout } from '@/components/docs';
import LicensesContent from './Licenses.mdx';

export function LicensesPage() {
  return (
    <DocLayout
      title="Legal & Licenses"
      subtitle="Privacy, disclaimer, and third-party credits for Gridlock Chess"
      tocTitle="Sections"
    >
      <LicensesContent />
    </DocLayout>
  );
}
