// lib/chess/sandbox/charges.ts — Legal charge "builds" for the Sandbox editor.
//
// A Sandbox anomaly may only hold a charge split the real game could actually ROLL — one of the 36
// discrete builds across the 10 standard archetypes (the "36 builds" the Rules page cites; base of
// the 36^7 opening count). Rather than re-enumerate them, this delegates to the SINGLE source of
// truth — `enumerateBuilds` in balancedArmy.ts, which the army generator already uses and which is
// drift-guarded against each archetype's live generate() by balancedArmy.spec.ts. The editor picks a
// build from this list, so every placed piece is legal by construction (no sliders, no drift).
import type { ArchetypeKey, VectorPool, OmniPool } from '@/types/game';
import { enumerateBuilds } from '@/lib/chess/balancedArmy';
import { ARCHETYPES } from '@/lib/chess/archetypes';

/** Standard (non-Omni) archetype keys — the only ones with vector builds. */
export type StandardArchetypeKey = Exclude<ArchetypeKey, 'omni'>;

/** The legal builds for a standard archetype, best-first (index 0 = canonical default). */
export function archetypeBuilds(key: StandardArchetypeKey): readonly VectorPool[] {
  return enumerateBuilds(key);
}

/** Total standard builds across all archetypes — the Rules page's "36" (derived, not hardcoded). */
export const TOTAL_BUILDS: number = ARCHETYPES.reduce((n, a) => n + enumerateBuilds(a.key).length, 0);

/** Deterministic default charges a freshly-placed piece receives (no random roll).
 *  Omni is a shared 8-charge pool; standard archetypes get their canonical (index-0) build. */
export function canonicalCharges(key: ArchetypeKey): VectorPool | OmniPool {
  if (key === 'omni') return { shared: 8 };
  return { ...enumerateBuilds(key)[0]! };
}

/** True iff `v` is one of `key`'s legal builds (exact L/O/D match). */
export function isLegalBuild(key: StandardArchetypeKey, v: VectorPool): boolean {
  return enumerateBuilds(key).some((b) => b.L === v.L && b.O === v.O && b.D === v.D);
}

/** Highest legal Omni pool (starts full; only ever depletes). */
export const OMNI_MAX_SHARED = 8;

/** True iff `v` is a legal LIVE charge state for `key` — i.e. SOME starting build could deplete
 *  down to it (each vector only ever spent, never gained → componentwise `v ≤ build`). This is
 *  looser than `isLegalBuild`: besides the 36 pristine builds it also accepts the spent/depleted
 *  states a real game produces, so an anomaly whose charges were burned mid-game (e.g. a position
 *  loaded from a replay) still validates. Negative charges, or a split no build could reach, fail. */
export function isReachableCharge(key: StandardArchetypeKey, v: VectorPool): boolean {
  if (v.L < 0 || v.O < 0 || v.D < 0) return false;
  return enumerateBuilds(key).some((b) => v.L <= b.L && v.O <= b.O && v.D <= b.D);
}
