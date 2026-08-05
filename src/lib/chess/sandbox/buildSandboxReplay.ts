// lib/chess/sandbox/buildSandboxReplay.ts — Wrap a hand-built board as a zero-move GridlockReplay.
//
// The game's resume/import path already consumes a GridlockReplay (start position + move list), so
// the Sandbox → Play handoff just needs to produce one whose `start` is the built position and whose
// `moves` is empty — the game then begins from exactly that board. Pure and React-free.
import type { Board, PieceColor } from '@/types/game';
import { serializePosition, REPLAY_VERSION, type GridlockReplay } from '../format';

/**
 * Build a zero-move replay from a Sandbox board. `turn` is the position's side-to-move. Sandbox
 * positions never carry an en-passant target or an in-progress clock, so those start clean
 * (enPassant null, halfmoveClock 0, fullmove 1).
 */
export function buildSandboxReplay(board: Board, turn: PieceColor): GridlockReplay {
  return {
    v: REPLAY_VERSION,
    meta: { generationMode: 'balanced', createdAt: new Date().toISOString() },
    start: serializePosition(board, turn, null, 0, 1),
    moves: [],
  };
}
