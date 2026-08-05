// components/pieces/PieceGlyph.tsx
// Platform-proof SVG piece set for Gridlock Chess.
//
// Both armies share one monochrome-tinted treatment (black → grayscale, white → full
// color). King and Pawn use their PIECE_REGISTRY emoji; every archetype uses its registry emoji.
// All pieces render at the shared base size with no decorative accents.

import type { ReactNode } from 'react';
import type { Piece as PieceType, ArchetypeKey } from '@/types/game';
import { ARCHETYPE_REGISTRY } from '@/lib/chess/archetypes';
import { PIECE_REGISTRY } from '@/lib/chess/pieces';
import { useKingMood, KING_MOOD_EMOJI } from '@/hooks/useKingMood';

const C = 24; // center of the 48×48 viewBox

// ── King & Pawn silhouettes ───────────────────────────────────────────────────
function KingSilhouette({ isWhite }: { isWhite: boolean }) {
  // King emoji with crown on top. The FACE reacts to the game via the king-mood store
  // (😎 confident → 😮 in check → 😅 just escaped → 😎, and 🫡 at game end). The crown "passes"
  // to a piloted anomaly when the King overrides into it, so both share the royal marker.
  const mood = useKingMood(isWhite ? 'white' : 'black');
  return (
    <>
      {/* Crown above the king head */}
      <text
        x={C}
        y={6}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={14}
        style={{ userSelect: 'none' }}
      >
        👑
      </text>
      {/* King body — its face is the current mood; slightly smaller & lowered to make room for the crown */}
      <EmojiGlyph emoji={KING_MOOD_EMOJI[mood]} white={isWhite} dark={!isWhite} size={30} y={4} />
    </>
  );
}

/** Archetype emblem for the live board.
 *  Every archetype renders its registry emoji, monochrome-tinted by side (black →
 *  grayscale, white → full color), at the shared base size. */
function archetypeEmblemEmoji(key: ArchetypeKey, isWhite: boolean): ReactNode {
  return <EmojiGlyph emoji={ARCHETYPE_REGISTRY[key].icon} white={isWhite} dark={!isWhite} />;
}

/** Renders an emoji centered in the 48×48 viewBox.
 *  When `dark` is true (black pieces), renders the emoji in grayscale so the font's
 *  own internal edges/panel lines survive as gray detail (instead of a flat black blob).
 *  When `white` is true (white pieces), renders the emoji unfiltered so it shows its
 *  true full-color appearance.
 *  Optional `y` offset shifts the glyph down from center. */
function EmojiGlyph({ emoji, dark, white, size = 40, y = 0 }: { emoji: string; dark?: boolean; white?: boolean; size?: number; y?: number }) {
  const filter = white
    ? undefined
    : dark
      ? 'grayscale(1) brightness(0.62) contrast(1.15)'
      : undefined;
  return (
    <text
      x={C}
      y={C + 2 + y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={size}
      style={{
        userSelect: 'none',
        filter,
      }}
    >
      {emoji}
    </text>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
interface PieceGlyphProps {
  piece: PieceType;
}

export function PieceGlyph({ piece }: PieceGlyphProps) {
  const isWhite = piece.color === 'white';

  if (piece.type === 'king') {
    return (
      <svg viewBox="0 0 48 48" className="w-full h-full" role="img" aria-label="King">
        <KingSilhouette isWhite={isWhite} />
      </svg>
    );
  }

  if (piece.type === 'pawn') {
    return (
      <svg viewBox="0 0 48 48" className="w-full h-full" role="img" aria-label="Pawn">
        <EmojiGlyph emoji={PIECE_REGISTRY.pawn.icon} white={isWhite} dark={!isWhite} />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 48 48"
      className="w-full h-full"
      style={{ overflow: 'visible' }}
      role="img"
      aria-label={`${piece.archetype} anomaly`}
    >
      {archetypeEmblemEmoji(piece.archetype, isWhite)}
    </svg>
  );
}

/** Standalone emblem (no side disc) for legends / pickers. Defaults to the white variant. */
export function ArchetypeGlyph({ archetype, color = 'white' }: { archetype: ArchetypeKey; color?: 'white' | 'black' }) {
  return (
    <svg viewBox="0 0 48 48" className="w-full h-full" role="img" aria-label={archetype}>
      {archetypeEmblemEmoji(archetype, color === 'white')}
    </svg>
  );
}

export { PieceGlyph as default };
