// lib/chess/pieces.ts — Canonical metadata for the non-archetype pieces (King & Pawn).
//
// SINGLE SOURCE OF TRUTH for how King and Pawn are labelled across the app. Mirrors the
// archetype pattern (ARCHETYPE_REGISTRY): the editorial `alias` is kept SEPARATE from the
// canonical `name` so each surface can render whichever it needs — the alias alone
// ("Robot"), the rules name alone ("King"), or the combined form ("King (Robot)") via
// pieceLabel(). Change an alias here and every page (Coach rail, Rules, etc.) updates.
//
// Component-free on purpose so it can be imported by both React components and MDX pages
// without tripping React Fast Refresh's "only export components" rule.

/** The two non-archetype piece kinds that carry a display alias. */
export type NamedPieceKind = 'king' | 'pawn';

/** Display metadata for a single non-archetype piece. */
export interface PieceMeta {
  /** Canonical chess name, e.g. 'King'. */
  name: string;
  /** Editorial callsign, e.g. 'Robot'. Kept separate from `name` for modular display. */
  alias: string;
  /** Emoji glyph used in coach/guide surfaces. */
  icon: string;
}

/** THE single source of truth for King & Pawn display metadata. */
export const PIECE_REGISTRY: Record<NamedPieceKind, PieceMeta> = {
  king: { name: 'King', alias: 'Commander', icon: '😎' },
  pawn: { name: 'Pawn', alias: 'riding in Auto Rickshaw', icon: '🛺' },
};

/** Combined label, e.g. 'King (Commander)'. Use where both the canonical name and the flavor
 *  alias help the reader; use `.alias` / `.name` directly when only one is wanted. */
export const pieceLabel = (kind: NamedPieceKind): string => {
  const { name, alias } = PIECE_REGISTRY[kind];
  return `${name} (${alias})`;
};
