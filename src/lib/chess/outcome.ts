// lib/chess/outcome.ts — Terminal-state resolution for a Gridlock position.
//
// Given a freshly-updated board and the side now to move, decide whether the game has
// ended (checkmate / stalemate / draw / gridlock-death) and why. This is the single
// source of truth for the outcome ladder that makeMove, promote, and the Override branch
// all previously duplicated.
//
// NOTE: this is distinct from format.ts's `gameOutcome`, which maps an already-decided
// GameStatus → a PGN-style result string. This module *computes* the status from a board.
import type { Board, PieceColor, GameStatus, DrawReason } from '@/types/game';
import { getLegalMoves, isGridlocked } from './movement';
import { isCheckmate, isStalemate } from './check';

/**
 * Fifty-move rule threshold, in half-moves (50 full moves × 2 = 100). When the halfmove
 * clock reaches this with no pawn move, capture, or charge spend in between, the game is
 * drawn. In practice this only bites in the bare King-and-pawn endgame: any Anomaly move
 * spends a charge, which counts as irreversible progress and resets the clock.
 */
export const FIFTY_MOVE_HALFMOVES = 100;

/**
 * Total Gridlock — the thematic replacement for the 50-move rule.
 * Returns true when the board is *permanently* paralyzed: every surviving Anomaly is
 * Gridlocked (0 charges, so it can never move again) and no Pawn of either side can
 * ever advance or capture. We test pawns on a king-removed copy of the board: a king
 * can never be captured, so removing both kings can only *reveal* latent pawn mobility
 * (e.g. a pawn a king is currently blocking) — it can never hide a real move. If even
 * that relaxed board yields zero pawn moves, no king relocation could ever un-freeze
 * the position. With only kings left mobile, and Gridlocked anomalies unable to give
 * check, no checkmate can be forced — so the match is a draw.
 */
export function isTotalGridlock(board: Board): boolean {
  const squares = Object.keys(board) as (keyof Board)[];

  // 1) Every anomaly must be Gridlocked (0 charges → permanently immobile).
  for (const sq of squares) {
    const p = board[sq];
    if (p && p.type === 'anomaly' && !isGridlocked(p)) return false;
  }

  // 2) On a king-less copy, no pawn of either side may have any legal move.
  const kingless: Board = {};
  for (const sq of squares) {
    const p = board[sq];
    if (p && p.type !== 'king') kingless[sq] = p;
  }
  for (const sq of Object.keys(kingless) as (keyof Board)[]) {
    const p = kingless[sq];
    if (p && p.type === 'pawn' && getLegalMoves(p, sq, kingless).length > 0) return false;
  }

  return true;
}

/** Optional signals that only some call sites can supply. */
export interface OutcomeSignals {
  /** Threefold-repetition count for the new position (makeMove only). */
  posCount?: number;
  /** Halfmove clock after this move, for the fifty-move rule (makeMove only). */
  halfmoveClock?: number;
  /** True when a Piloted Anomaly just spent its last charge (Override death, §6.1). */
  gridlockDeath?: boolean;
}

/** The resolved terminal state for a position. */
export interface Outcome {
  status: GameStatus;
  drawReason: DrawReason;
}

/**
 * Resolve the outcome of a position after a move. `prevStatus` is returned unchanged when
 * the game is still live. The precedence ladder is:
 *   gridlock-death → checkmate → stalemate → repetition → total-gridlock → fifty-move.
 * Signals that a given caller does not supply are simply skipped, so callers that cannot
 * produce (e.g.) a repetition count behave exactly as before.
 */
export function evaluateOutcome(
  board: Board,
  sideToMove: PieceColor,
  prevStatus: GameStatus,
  signals: OutcomeSignals = {},
): Outcome {
  const { posCount, halfmoveClock, gridlockDeath } = signals;

  if (gridlockDeath) return { status: 'gridlock-death', drawReason: null };
  if (isCheckmate(board, sideToMove)) return { status: 'checkmate', drawReason: null };
  if (isStalemate(board, sideToMove)) return { status: 'stalemate', drawReason: null };
  if (posCount !== undefined && posCount >= 3) return { status: 'draw', drawReason: 'repetition' };
  if (isTotalGridlock(board)) return { status: 'draw', drawReason: 'gridlock' };
  if (halfmoveClock !== undefined && halfmoveClock >= FIFTY_MOVE_HALFMOVES) {
    return { status: 'draw', drawReason: 'fifty-move' };
  }

  return { status: prevStatus, drawReason: null };
}
