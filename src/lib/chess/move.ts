// lib/chess/move.ts — the single source of truth for "what one move does to the board".
//
// This pure kernel owns every board mutation a move can cause: Override (King boarding a
// friendly Anomaly), captures (direct + en passant), pawn double-step / en-passant rights,
// Anomaly charge spend + gridlock recompute, and auto-promotion to Omni. It does NOT decide
// game outcome, repetition, or React state — callers layer that on top:
//   • useGameState.makeMove wraps it with React state + repetition/outcome/fifty-move.
//   • format.applyReplayMove wraps it with fullmove/status for portable replay.
// Keeping both on this one kernel is why a new move rule (e.g. gridlock-death) is written once.
import type {
  Board, Square, PieceColor, VectorType, Piece,
  Pawn, Anomaly, OmniAnomaly, VectorPool, OmniPool,
} from '@/types/game';
import { parseSquare, toSquare } from '@/types/game';
import { validateMove, isGridlocked } from './movement';
import { createOmniAnomaly } from './archetypes';

/** The record of one applied charge spend (for the "-1" spend indicator UI). */
export interface VectorSpend {
  square: Square;
  vector: VectorType;
  remaining: number;
  color: PieceColor;
}

/** Everything a successfully applied move changes on the board. */
export interface AppliedMove {
  /** The next board (a fresh copy; inputs are never mutated). */
  board: Board;
  /** New en-passant target square, or null. */
  nextEnPassant: Square | null;
  /** The piece removed by this move (direct or en-passant capture), or null. */
  captured: Piece | null;
  /** Charge-spend detail when an Anomaly moved, or null. */
  vectorSpend: VectorSpend | null;
  /** King boarded a friendly Anomaly (irreversible; King consumed). */
  isOverride: boolean;
  /** This move was an en-passant capture. */
  isEnPassant: boolean;
  /** The mover promoted (auto-Omni on reaching the back rank). */
  requiresPromotion: boolean;
  /** Capture, en passant, pawn advance, or charge spent — resets repetition + fifty-move. */
  irreversible: boolean;
  /** A Piloted Anomaly just spent its last charge → instant loss (GridlockChess.md §6.1). */
  gridlockDeath: boolean;
}

/** Discriminated result: `valid: true` carries the applied move; otherwise `error`. */
export type ApplyMoveResult = ({ valid: true } & AppliedMove) | { valid: false; error?: string };

/**
 * Apply ONE move to a board purely. Validates first; on an illegal move returns
 * `{ valid: false, error }`. On success returns the next board plus everything a move
 * touches, leaving `board` untouched (a fresh copy is returned).
 */
export function applyMoveToBoard(
  board: Board,
  from: Square,
  to: Square,
  turn: PieceColor,
  enPassant?: Square | null,
  /** When provided, use this piece for pawn promotion instead of auto-generating one.
   *  Passed through from the network (Uplink) so both peers apply the identical piece. */
  promotionPiece?: Piece,
): ApplyMoveResult {
  const res = validateMove(board, from, to, turn, enPassant ?? undefined);
  if (!res.valid) return { valid: false, error: res.error };

  const next: Board = { ...board };

  // ── Override (Anomaly Boarding) — GridlockChess.md §6.1 ─────────────────────
  // The King steps onto a friendly Anomaly and merges permanently. The host becomes
  // royal (piloted); the King is consumed. No capture, no charge spent, irreversible.
  if (res.isOverride) {
    const host = board[to] as Anomaly;
    delete next[from];
    next[to] = { ...host, piloted: true };
    return {
      valid: true,
      board: next,
      nextEnPassant: null,
      captured: null,
      vectorSpend: null,
      isOverride: true,
      isEnPassant: false,
      requiresPromotion: false,
      irreversible: true,
      gridlockDeath: false,
    };
  }

  const moved = { ...board[from]! };
  let captured: Piece | null = res.capture ?? null;

  // En-passant capture removes the pawn that sits beside the mover, not on `to`.
  if (res.isEnPassant) {
    const { fileIdx } = parseSquare(to);
    const victimRank = turn === 'white' ? 4 : 3;
    const victimSquare = toSquare(fileIdx, victimRank);
    if (victimSquare) {
      const victim = next[victimSquare];
      if (victim) captured = victim;
      delete next[victimSquare];
    }
  }

  // Pawn bookkeeping: mark moved, and grant en-passant rights on a double step.
  let nextEnPassant: Square | null = null;
  if (moved.type === 'pawn') {
    (moved as Pawn).hasMoved = true;
    (moved as Pawn).enPassantVulnerable = false;
    const { rankIdx: fromRank } = parseSquare(from);
    const { rankIdx: toRank } = parseSquare(to);
    if (Math.abs(toRank - fromRank) === 2) {
      (moved as Pawn).enPassantVulnerable = true;
      const epRank = turn === 'white' ? fromRank + 1 : fromRank - 1;
      const { fileIdx } = parseSquare(from);
      nextEnPassant = toSquare(fileIdx, epRank);
    }
  }

  // Anomaly charge spend: decrement the used pool and recompute gridlock.
  let vectorSpend: VectorSpend | null = null;
  if (moved.type === 'anomaly' && res.vectorUsed) {
    const anomaly = moved as Anomaly | OmniAnomaly;
    let remaining: number;
    if (anomaly.archetype === 'omni') {
      const pool = anomaly.vectors as OmniPool;
      remaining = pool.shared - 1;
      (anomaly as OmniAnomaly).vectors = { shared: remaining };
    } else {
      const pool = anomaly.vectors as VectorPool;
      remaining = pool[res.vectorUsed] - 1;
      (anomaly as Anomaly).vectors = { ...pool, [res.vectorUsed]: remaining };
    }
    anomaly.isGridlocked = isGridlocked(anomaly);
    vectorSpend = { square: to, vector: res.vectorUsed, remaining, color: turn };
  }

  // Execute the move (overwriting any captured piece on `to`).
  delete next[from];
  next[to] = moved;

  // Auto-promotion: pawns reaching the back rank become the promotion-only Omni.
  // If the caller supplies a promotionPiece (e.g. from Uplink, so both peers use the
  // identical piece), use it verbatim; otherwise generate the default OmniAnomaly.
  if (res.requiresPromotion) {
    next[to] = promotionPiece ?? createOmniAnomaly(moved.id, moved.color);
  }

  // Irreversible progress = capture (incl. en passant), pawn advance, or charge spent.
  const irreversible =
    !!res.capture || !!res.isEnPassant || moved.type === 'pawn' || !!res.vectorUsed;

  // Gridlock Death: a Piloted Anomaly that just spent its last charge loses instantly.
  const movedNowPiloted = moved.type === 'anomaly' && (moved as Anomaly).piloted === true;
  const gridlockDeath = movedNowPiloted && isGridlocked(moved);

  return {
    valid: true,
    board: next,
    nextEnPassant,
    captured,
    vectorSpend,
    isOverride: false,
    isEnPassant: !!res.isEnPassant,
    requiresPromotion: !!res.requiresPromotion,
    irreversible,
    gridlockDeath,
  };
}
