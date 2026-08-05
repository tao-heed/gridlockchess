// lib/chess/repetition.ts — Threefold-repetition keying for the live game.
//
// A repetition key is a compact, canonical string identifying a position for the
// threefold-repetition draw rule. Two positions collide (repeat) only when they are
// truly identical for play purposes: same placement, same side to move, same remaining
// charges on every anomaly, AND the same en-passant rights.
//
// NOTE: this is deliberately separate from format.ts's `serializePosition`, which builds
// a *portable, lossless* GridlockPosition for export/replay. This one is an internal,
// throwaway equality key — smaller and faster, never persisted.
import type { Board, PieceColor, Square, Anomaly, OmniAnomaly, VectorPool, OmniPool } from '@/types/game';

/**
 * Build a repetition key for a position.
 * Includes placement, side to move, every anomaly's remaining charges, AND the active
 * en-passant target — so two positions that differ only in EP rights (or in charges
 * spent) count as distinct. Only a genuinely frozen position (e.g. a bare King shuffle)
 * ever repeats.
 */
export function repetitionKey(board: Board, turn: PieceColor, enPassant: Square | null): string {
  const parts: string[] = [turn, `ep:${enPassant ?? '-'}`];
  for (const sq of (Object.keys(board) as Square[]).sort()) {
    const p = board[sq];
    if (!p) continue;
    let tag = `${sq}${p.color[0]}${p.type[0]}`;
    if (p.type === 'anomaly') {
      const a = p as Anomaly | OmniAnomaly;
      if (a.archetype === 'omni') {
        tag += `o${(a.vectors as OmniPool).shared}`;
      } else {
        const v = a.vectors as VectorPool;
        tag += `${a.archetype}.${v.L}.${v.O}.${v.D}`;
      }
    }
    parts.push(tag);
  }
  return parts.join('|');
}
