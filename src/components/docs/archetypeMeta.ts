// components/docs/archetypeMeta.ts — Shared archetype display metadata.
//
// Lives in its own (component-free) module so it can be imported by BOTH the Rules-page
// reference tables and the interactive VectorChargesDemo without tripping React Fast
// Refresh's "only export components" rule.
//
// The "specialty" blurbs are NOT authored here — they are derived from the single source
// of truth (ARCHETYPE_REGISTRY in lib/chess/archetypes.ts) so they can never drift.

import type { ArchetypeKey } from '@/types/game';
import { ARCHETYPE_REGISTRY } from '@/lib/chess/archetypes';

/** Editorial "specialty" blurb per archetype (display-only), derived from the registry. */
export const ARCHETYPE_SPECIALTY: Record<ArchetypeKey, string> = Object.fromEntries(
  Object.values(ARCHETYPE_REGISTRY).map((d) => [d.key, d.specialty]),
) as Record<ArchetypeKey, string>;
