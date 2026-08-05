// hooks/useKingMood.ts — the board King's live "mood" (its emoji face), by color.
//
// The King is drawn as an emoji face + crown. This tiny reactive store lets that FACE react to
// the game — 🤔 thinking (your move) → 😮 in check → 😅 just escaped → 😎 confident (waiting), and
// 😵 knocked out / 🫡 salute at game end — without prop-drilling through Board → Square → Piece →
// PieceGlyph. LocalGame computes the moods from the live/scrubbed state and writes them here; the
// King glyph reads them via useSyncExternalStore. A piloted royal has no King face, so this is
// naturally inert while boarded.
import { useSyncExternalStore } from 'react';
import type { PieceColor } from '@/types/game';
import type { KingMood } from '@/lib/chess/kingMood';

// The mood decision logic (and the KingMood type) live in the pure, React-free `lib/chess/kingMood`
// module so they can be unit-tested directly. Re-exported here so existing `useKingMood` imports of
// the type keep working.
export type { KingMood };

/** The face shown for each mood (the crown is drawn separately on top). */
export const KING_MOOD_EMOJI: Record<KingMood, string> = {
  confident: '😎',
  thinking: '🤔',
  surprised: '😮',
  relieved: '😅',
  respect: '🫡',
  dizzy: '😵',
};

let moods: Record<PieceColor, KingMood> = { white: 'confident', black: 'confident' };
const listeners = new Set<() => void>();

/** Set both kings' moods (no-op if unchanged, so it's cheap to call every move). */
export function setKingMoods(next: Record<PieceColor, KingMood>): void {
  if (next.white === moods.white && next.black === moods.black) return;
  moods = next;
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// Stable per-color snapshot getters (returning a primitive string, so useSyncExternalStore's
// Object.is comparison re-renders only when that color's mood actually changes).
const getWhite = (): KingMood => moods.white;
const getBlack = (): KingMood => moods.black;

/** Reactive mood for one King color. */
export function useKingMood(color: PieceColor): KingMood {
  return useSyncExternalStore(subscribe, color === 'white' ? getWhite : getBlack, () => 'confident');
}
