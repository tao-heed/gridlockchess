// constants/archetypes.ts — Static archetype reference data
//
// Self-teaching guide for the UI: shape style = distribution, color = vector.
// This is display-only data with no runtime logic. The archetype membership, order and
// short labels are DERIVED from the single source of truth (ARCHETYPE_REGISTRY) so the
// guide can never drift; only the group hints are authored here.

import type { ArchetypeKey } from '@/types/game';
import { ARCHETYPE_DEFS_IN_ORDER, type ArchetypeGroup } from '@/lib/chess/archetypes';

/** A single archetype item for the guide */
export interface ArchetypeGuideItem {
  key: ArchetypeKey;
  label: string;
}

/** A group of related archetypes */
export interface ArchetypeGuideSection {
  group: string;
  hint: string;
  items: ArchetypeGuideItem[];
}

/** Guide section shells: heading + hint + which registry groups they cover. Membership and
 *  labels are filled in from the registry below. */
const GUIDE_SECTIONS: { group: string; hint: string; groups: ArchetypeGroup[] }[] = [
  { group: 'Absolute', hint: 'All 10 in one vector', groups: ['absolute'] },
  { group: 'High', hint: 'One dominant vector', groups: ['high'] },
  { group: 'Hybrid', hint: 'Two vectors split — half / half', groups: ['hybrid'] },
  { group: 'Balanced & Omni', hint: 'Equal split / shared pool', groups: ['balanced', 'omni'] },
];

/** Self-teaching guide: shape style = distribution, color = vector. Derived from the registry. */
export const ARCHETYPE_GUIDE: ArchetypeGuideSection[] = GUIDE_SECTIONS.map((section) => ({
  group: section.group,
  hint: section.hint,
  items: ARCHETYPE_DEFS_IN_ORDER.filter((d) => section.groups.includes(d.group)).map((d) => ({
    key: d.key,
    label: d.guideLabel,
  })),
}));
