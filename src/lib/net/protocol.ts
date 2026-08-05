// lib/net/protocol.ts — Uplink (Online PvP) wire protocol.
//
// Defines the message types and shared utilities for the Firebase RTDB transport.
// Roles decide who authors the match — the host rolls the starting board AND a
// random color per match (see useUplinkGame); the guest adopts the opposite.
// Moves are fully deterministic so the host only transmits the concrete board once
// via `state-init`; thereafter both peers exchange `{ from, to }` coordinates.
// A rolling board hash rides along each move so a desync is detected immediately.

import type { Board, PieceColor, Square, Piece } from '@/types/game';
import type { GenerationMode } from '@/lib/chess/generator';
import type { TimeControlId, ClockRemaining } from '@/constants/timeControls';

/** Role assigned by the relay on join. Roles pick who authors the match, not color:
 *  the host rolls a random color per game (see StateSnapshot.hostColor) and the
 *  guest takes the opposite. */
export type UplinkRole = 'host' | 'guest';

/** The authoritative position the host sends once, so the guest skips generation. */
export interface StateSnapshot {
  board: Board;
  turn: PieceColor;
  enPassantTarget?: Square;
  mode: GenerationMode;
  /** Which color the host plays this game (rolled randomly per match for fairness).
   *  The guest plays the opposite. Carried on every snapshot so resyncs stay color-stable. */
  hostColor: PieceColor;
  /** The clock the host chose for this match ('none' = untimed). Host-authored: the guest
   *  adopts it verbatim so both peers run the identical time control. */
  timeControlId: TimeControlId;
  /** Remaining ms for both sides at the moment this snapshot was taken. Sent on a mid-game
   *  resync so a re-asserted position also re-aligns the clocks; omitted at game start
   *  (both sides are at base). */
  clock?: ClockRemaining;
}

// ── Peer ↔ peer ───────────────────────────────────────────────────────────────
export interface StateInitMessage {
  type: 'state-init';
  snapshot: StateSnapshot;
  /** Move count this snapshot represents (0 at game start). Guards against stale loads. */
  ply: number;
}

export interface MoveMessage {
  type: 'move';
  from: Square;
  to: Square;
  /** Board hash AFTER applying this move, for desync detection. */
  hash: string;
  /** The mover's authoritative remaining ms for BOTH sides, AFTER this move (their own clock
   *  includes the Fischer increment). The receiver adopts this to re-sync the clocks each move,
   *  bounding drift to a single move's network latency. Omitted in untimed matches. */
  clock?: ClockRemaining;
  /** When a pawn promoted on this move: the exact promoted piece, transmitted verbatim so
   *  both peers apply the identical piece (guards against any future randomness in the
   *  promotion path). Omitted for non-promotion moves. */
  promotion?: Piece;
}

export interface ResignMessage {
  type: 'resign';
}

/** A peer whose own clock reached zero self-reports the loss. Authoritative for the sender's
 *  own flag: a side can only flag on its own turn, so the running side is the source of truth.
 *  The opponent independently grace-claims the win if this never arrives (disconnect/cheat). */
export interface TimeoutMessage {
  type: 'timeout';
}

export interface RematchMessage {
  type: 'rematch';
}

/** Explicit wire notification of a board-level terminal state (checkmate, stalemate, draw,
 *  gridlock-death). Sent by the peer whose move caused the game to end so the opponent
 *  shows the end modal even if their local engine reaches a different conclusion.
 *  (Resign / timeout use their own dedicated signals instead.) */
export interface GameOverMessage {
  type: 'game-over';
  status: 'checkmate' | 'stalemate' | 'draw' | 'gridlock-death';
  /** Winning side for decisive endings; null for draws / stalemates. */
  winner: PieceColor | null;
}

/** Announces (or re-announces) a peer's display name. Sent on connect and on every
 *  in-match rename so the opponent's card stays live. The name is untrusted remote
 *  input — always run it through `sanitizePlayerName` before display. */
export interface HelloMessage {
  type: 'hello';
  name: string;
}

/** Host re-asserts authoritative state after a detected desync. */
export interface ResyncMessage {
  type: 'resync';
  snapshot: StateSnapshot;
  /** Host's move count when this snapshot was taken. A peer ignores any resync whose
   *  ply is older than its own committed state, so a stale resync can never revert a
   *  newer local move (fixes the resync-vs-local-move race). */
  ply: number;
}

/** A peer that detected a desync asks the host to re-assert authoritative state. */
export interface ResyncRequestMessage {
  type: 'resync-request';
}

export type GameMessage =
  | StateInitMessage
  | MoveMessage
  | ResignMessage
  | TimeoutMessage
  | HelloMessage
  | RematchMessage
  | GameOverMessage
  | ResyncMessage
  | ResyncRequestMessage;
export type UplinkMessage = GameMessage;

/**
 * Deterministic, order-independent hash of a position: piece placement, side to
 * move, AND the active en-passant target (two positions that differ only in EP
 * rights are genuinely distinct). Pieces are plain JSON data, so a stable
 * stringification of sorted squares is sufficient to detect any divergence
 * between the two peers.
 */
export function hashBoard(board: Board, turn: PieceColor, enPassant?: Square): string {
  const squares = Object.keys(board).sort();
  let h = 5381 ^ (turn === 'white' ? 1 : 2);
  const seed = `ep:${enPassant ?? '-'}`;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h) ^ seed.charCodeAt(i);
  }
  for (const sq of squares) {
    const piece = board[sq as Square];
    if (!piece) continue;
    const repr = `${sq}:${JSON.stringify(piece)}`;
    for (let i = 0; i < repr.length; i++) {
      h = ((h << 5) + h) ^ repr.charCodeAt(i); // djb2-xor
    }
  }
  // Unsigned 32-bit hex.
  return (h >>> 0).toString(16);
}

/** Generate a short, human-readable, unambiguous passcode (no 0/O/1/I). */
export function generatePasscode(length = 5): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const rand = new Uint32Array(length);
  crypto.getRandomValues(rand);
  for (let i = 0; i < length; i++) code += alphabet[rand[i] % alphabet.length];
  return code;
}

/**
 * Sanitize an opponent's display name received over the wire. The name is untrusted
 * remote input, so we: strip control/non-printable characters, collapse whitespace,
 * cap the length, and fall back to 'Opponent' if nothing usable remains. (React already
 * escapes text on render, so this is defense-in-depth against garbage/abuse, not XSS.)
 */
export function sanitizePlayerName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Opponent';
  // eslint-disable-next-line no-control-regex
  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return 'Opponent';
  return cleaned.slice(0, 20);
}

