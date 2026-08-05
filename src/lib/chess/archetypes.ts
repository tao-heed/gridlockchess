// lib/chess/archetypes.ts — The 11 Archetypes per GridlockChess.md Section 3
//
// SINGLE SOURCE OF TRUTH. Every archetype fact — key, display name, callsign/alias,
// board icon, taxonomy group, display order, specialty blurb, guide label, and the live
// charge-roll logic — lives in ARCHETYPE_REGISTRY below and NOWHERE else. All other
// modules (engine, board glyphs, Rules tables, interactive demos) derive from it, so an
// archetype can never fall out of sync across the app.
//
// To add or change an archetype: add/edit ONE entry in ARCHETYPE_REGISTRY (and, for a new
// key, the ArchetypeKey union in types/game.ts). TypeScript's `Record<ArchetypeKey, …>`
// forces every key to have a complete entry at compile time.
import type { Archetype, ArchetypeKey, VectorPool, OmniPool, PieceColor, OmniAnomaly } from '@/types/game';
import { shuffle } from './random';

const rand = (min: number, max: number): number => 
  Math.floor(Math.random() * (max - min + 1)) + min;

/** Split remaining points between two vectors with min 1 each */
const splitTwo = (total: number, min = 1): [number, number] => {
  const a = rand(min, total - min);
  return [a, total - a];
};

/** Taxonomy family an archetype belongs to (drives grouping in the guide/reference UI). */
export type ArchetypeGroup = 'absolute' | 'high' | 'hybrid' | 'balanced' | 'omni';

/** The complete, authoritative definition of a single archetype. Generic over its own key
 *  so the registry can pin each entry's `key` to its record key (see ArchetypeRegistry). */
export interface ArchetypeDef<K extends ArchetypeKey = ArchetypeKey> {
  /** Stable engine key (also the discriminant on Anomaly.archetype). */
  key: K;
  /** Full display name, e.g. 'High Leap'. */
  name: string;
  /** Editorial callsign, e.g. 'Motor'. */
  alias: string;
  /** Board/emoji glyph, e.g. '🏍️'. */
  icon: string;
  /** Taxonomy family for grouping. */
  group: ArchetypeGroup;
  /** 1-based display order (Absolute → High → Hybrid → Balanced → Omni). */
  order: number;
  /** Self-teaching "specialty" blurb (display-only). */
  specialty: string;
  /** Short label used in the compact self-teaching guide, e.g. 'Leap + Ortho'. */
  guideLabel: string;
  /** Omni is promotion-only; standard archetypes appear on the starting back rank. */
  promotionOnly: boolean;
  /** Roll a fresh charge pool exactly like the live game. Standard archetypes return a
   *  VectorPool; Omni returns an OmniPool (shared pool). */
  generate: () => VectorPool | OmniPool;
  /** Omni shared-pool size. Defined only for the Omni archetype. */
  sharedPool?: number;
}

/** Registry shape: each entry's `key` is pinned to its record key, so a mismatched key
 *  (e.g. `absLeap: { key: 'absDiag', … }`) fails to compile. */
export type ArchetypeRegistry = { [K in ArchetypeKey]: ArchetypeDef<K> };

/**
 * THE single source of truth for all 11 archetypes. Keyed by ArchetypeKey so the compiler
 * guarantees exactly one complete entry per key, with each entry's `key` pinned to its slot.
 */
export const ARCHETYPE_REGISTRY: ArchetypeRegistry = {
  // ── Absolute — all 10 charges in one vector ──────────────────────────────────
  absLeap: {
    key: 'absLeap',
    name: 'Absolute Leap',
    alias: 'Motorbike',
    icon: '🏍️',
    group: 'absolute',
    order: 1,
    specialty: '10 Leap charges — pure knight, no slides',
    guideLabel: 'Leap',
    promotionOnly: false,
    generate: (): VectorPool => ({ L: 10, O: 0, D: 0 }),
  },
  absDiag: {
    key: 'absDiag',
    name: 'Absolute Diagonal',
    alias: 'Racing Car',
    icon: '🏎️',
    group: 'absolute',
    order: 2,
    specialty: '10 Diagonal charges — pure bishop, color-locked',
    guideLabel: 'Diagonal',
    promotionOnly: false,
    generate: (): VectorPool => ({ L: 0, O: 0, D: 10 }),
  },
  absOrtho: {
    key: 'absOrtho',
    name: 'Absolute Orthogonal',
    alias: 'Car',
    icon: '🚗',
    group: 'absolute',
    order: 3,
    specialty: '10 Orthogonal charges — pure rook, no diagonals',
    guideLabel: 'Orthogonal',
    promotionOnly: false,
    generate: (): VectorPool => ({ L: 0, O: 10, D: 0 }),
  },

  // ── High — one dominant vector (6–8) ─────────────────────────────────────────
  highLeap: {
    key: 'highLeap',
    name: 'High Leap',
    alias: 'Police Car',
    icon: '🚓',
    group: 'high',
    order: 4,
    specialty: '6–8 Leap charges, 2–4 diagonal & orthogonal',
    guideLabel: 'High Leap',
    promotionOnly: false,
    generate: (): VectorPool => {
      const L = rand(6, 8);
      const [D, O] = splitTwo(10 - L);
      return { L, O, D };
    },
  },
  highDiag: {
    key: 'highDiag',
    name: 'High Diagonal',
    alias: 'Ambulance',
    icon: '🚑',
    group: 'high',
    order: 5,
    specialty: '6–8 Diagonal charges, 2–4 leap & orthogonal',
    guideLabel: 'High Diag',
    promotionOnly: false,
    generate: (): VectorPool => {
      const D = rand(6, 8);
      const [L, O] = splitTwo(10 - D);
      return { L, O, D };
    },
  },
  highOrtho: {
    key: 'highOrtho',
    name: 'High Orthogonal',
    alias: 'Firetruck',
    icon: '🚒',
    group: 'high',
    order: 6,
    specialty: '6–8 Orthogonal charges, 2–4 leap & diagonal',
    guideLabel: 'High Ortho',
    promotionOnly: false,
    generate: (): VectorPool => {
      const O = rand(6, 8);
      const [L, D] = splitTwo(10 - O);
      return { L, O, D };
    },
  },

  // ── Hybrid — two vectors split (4–5 primary) ─────────────────────────────────
  hybridLD: {
    key: 'hybridLD',
    name: 'Hybrid Leap/Diag',
    alias: 'Plane',
    icon: '🛩️',
    group: 'hybrid',
    order: 7,
    specialty: '4–5 Leap charges, 4–6 diagonal (rare 1 orthogonal)',
    guideLabel: 'Leap + Diag',
    promotionOnly: false,
    generate: (): VectorPool => {
      const L = rand(4, 5);
      const O = rand(0, 1);
      const D = 10 - L - O;
      return { L, O, D };
    },
  },
  hybridLO: {
    key: 'hybridLO',
    name: 'Hybrid Leap/Ortho',
    alias: 'Airliner',
    icon: '✈️',
    group: 'hybrid',
    order: 8,
    specialty: '4–5 Leap charges, 4–6 orthogonal (rare 1 diagonal)',

    guideLabel: 'Leap + Ortho',
    promotionOnly: false,
    generate: (): VectorPool => {
      const L = rand(4, 5);
      const D = rand(0, 1);
      const O = 10 - L - D;
      return { L, O, D };
    },
  },
  hybridDO: {
    key: 'hybridDO',
    name: 'Hybrid Diag/Ortho',
    alias: 'Rocket',
    icon: '🚀',
    group: 'hybrid',
    order: 9,
    specialty: '4–5 Diagonal charges, 4–6 orthogonal (rare 1 leap)',
    guideLabel: 'Diag + Ortho',
    promotionOnly: false,
    generate: (): VectorPool => {
      const D = rand(4, 5);
      const L = rand(0, 1);
      const O = 10 - D - L;
      return { L, O, D };
    },
  },

  // ── Balanced — 4/3/3 across any vector ───────────────────────────────────────
  balanced: {
    key: 'balanced',
    name: 'Balanced',
    alias: 'Chopper',
    icon: '🚁',
    group: 'balanced',
    order: 10,
    specialty: '4/3/3 split on any vector — jack of all trades',

    guideLabel: 'Balanced',
    promotionOnly: false,
    generate: (): VectorPool => {
      const dist = shuffle([4, 3, 3]);
      return { L: dist[0]!, O: dist[1]!, D: dist[2]! };
    },
  },

  // ── Omni — shared 8-charge pool, PROMOTION ONLY ──────────────────────────────
  omni: {
    key: 'omni',
    name: 'Omni',
    alias: 'Mech',
    icon: '🤖',
    group: 'omni',
    order: 11,
    specialty: '8 shared charges — spend freely on any vector — pawn promotion only',

    guideLabel: 'Omni',
    promotionOnly: true,
    sharedPool: 8,
    generate: (): OmniPool => ({ shared: 8 }),
  },
};

/** All archetype definitions, in canonical display order (Absolute → … → Omni). */
export const ARCHETYPE_DEFS_IN_ORDER: ArchetypeDef[] = Object.values(ARCHETYPE_REGISTRY)
  .slice()
  .sort((a, b) => a.order - b.order);

/** Look up the full definition for any archetype key. */
export const getArchetypeDef = (key: ArchetypeKey): ArchetypeDef => ARCHETYPE_REGISTRY[key];

/** All 10 starting archetypes (Omni excluded — promotion only), derived from the registry. */
export const ARCHETYPES: Archetype[] = ARCHETYPE_DEFS_IN_ORDER
  .filter((d) => !d.promotionOnly)
  .map((d) => ({
    key: d.key,
    name: d.name,
    icon: d.icon,
    generate: d.generate as () => VectorPool,
  }));

/** Omni archetype — PROMOTION ONLY. Derived from the registry. */
export const OMNI_ARCHETYPE: {
  key: 'omni';
  name: string;
  icon: string;
  sharedPool: number;
} = {
  key: 'omni',
  name: ARCHETYPE_REGISTRY.omni.name,
  icon: ARCHETYPE_REGISTRY.omni.icon,
  sharedPool: ARCHETYPE_REGISTRY.omni.sharedPool!,
};

/** All archetypes including Omni (for promotion selection) */
export const ALL_ARCHETYPES_FOR_PROMOTION: (Archetype | typeof OMNI_ARCHETYPE)[] = [
  ...ARCHETYPES,
  OMNI_ARCHETYPE,
];

/**
 * Build a live Omni Anomaly from the registry — the single constructor for the
 * promotion-only Omni piece. `shared` defaults to the registry's full pool (fresh
 * promotion); pass a stored value to restore an in-progress piece (import/replay).
 * `isGridlocked` is derived, and the icon always comes from the registry so every
 * surface renders the same glyph.
 */
export function createOmniAnomaly(
  id: string,
  color: PieceColor,
  shared: number = ARCHETYPE_REGISTRY.omni.sharedPool!,
): OmniAnomaly {
  return {
    id,
    type: 'anomaly',
    color,
    archetype: 'omni',
    icon: ARCHETYPE_REGISTRY.omni.icon,
    vectors: { shared },
    isGridlocked: shared === 0,
  };
}

/** Get archetype by key */
export const getArchetype = (key: ArchetypeKey): Archetype | typeof OMNI_ARCHETYPE | undefined => {
  if (key === 'omni') return OMNI_ARCHETYPE;
  return ARCHETYPES.find(a => a.key === key);
};

/** A fully-rolled anomaly: archetype + its generated vector pool. */
export interface GeneratedAnomaly {
  archetype: Archetype;
  vectors: VectorPool;
}
