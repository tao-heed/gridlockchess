// lib/chess/sandbox/setupValidation.ts — Pure legality check for a hand-built Sandbox position.
//
// A hand-built board can be illegal in ways the game never produces. `validateSetup` returns every
// reason the position can't begin play, so the UI can disable Play with a readable message. Pure and
// React-free (styled like outcome.ts) → fully unit-tested without rendering.
import type { Board, PieceColor, Square, VectorPool, OmniPool, Piece } from '@/types/game';
import { isInCheck } from '../check';
import { isReachableCharge, OMNI_MAX_SHARED } from './charges';

export interface SetupError {
  code:
    | 'no-king'
    | 'multiple-kings'
    | 'pawn-on-back-rank'
    | 'idle-side-in-check'
    | 'illegal-charges';
  message: string;
}

const COLORS: readonly PieceColor[] = ['white', 'black'];
const cap = (c: PieceColor): string => (c === 'white' ? 'White' : 'Black');

/** True when this piece is the side's royal — a plain King OR an anomaly the King is piloting. */
const isRoyal = (p: Piece): boolean => p.type === 'king' || (p.type === 'anomaly' && p.archetype !== 'omni' && !!p.piloted);

/**
 * Validate a hand-built position. Returns `{ ok, errors }`; `ok` is true only when `errors` is empty.
 * Rules (MVP):
 *  - exactly one royal per side — a plain King OR one piloted anomaly (the King's mount), never both;
 *  - no pawns on rank 1 or rank 8;
 *  - every anomaly's charges are one of its archetype's legal builds (Omni = shared 8);
 *  - the side NOT to move must not already be in check (you can't start having "captured" the king).
 */
export function validateSetup(board: Board, turn: PieceColor): { ok: boolean; errors: SetupError[] } {
  const errors: SetupError[] = [];

  const royalCount: Record<PieceColor, number> = { white: 0, black: 0 };
  for (const sq of Object.keys(board) as Square[]) {
    if (isRoyal(board[sq]!)) royalCount[board[sq]!.color]++;
  }
  for (const c of COLORS) {
    if (royalCount[c] === 0) errors.push({ code: 'no-king', message: `${cap(c)} needs a King (or a Piloted Anomaly).` });
    else if (royalCount[c] > 1) errors.push({ code: 'multiple-kings', message: `${cap(c)} has more than one royal (King or Piloted Anomaly).` });
  }

  for (const sq of Object.keys(board) as Square[]) {
    const p = board[sq]!;
    const rank = sq[1];

    if (p.type === 'pawn' && (rank === '1' || rank === '8')) {
      errors.push({ code: 'pawn-on-back-rank', message: `A pawn cannot be on rank ${rank} (${sq}).` });
    }

    if (p.type === 'anomaly') {
      if (p.archetype === 'omni') {
        // Omni starts at a shared pool of 8 and only depletes — so 0..8 is legal (a mid-game/loaded
        // Omni may have spent charges). Only an impossible pool (negative or above the max) fails.
        const shared = (p.vectors as OmniPool).shared;
        if (shared < 0 || shared > OMNI_MAX_SHARED) {
          errors.push({ code: 'illegal-charges', message: `The Omni at ${sq} has an impossible shared pool (${shared}).` });
        }
      } else {
        // Accept any charge state a real game could REACH by depletion (not just pristine builds),
        // so an anomaly whose charges were spent mid-game (e.g. a loaded replay) stays valid.
        const v = p.vectors as VectorPool;
        if (!isReachableCharge(p.archetype, v)) {
          errors.push({ code: 'illegal-charges', message: `The anomaly at ${sq} has charges no ${p.archetype} can reach (${v.L}/${v.O}/${v.D}).` });
        }
      }
    }
  }

  // The side NOT to move may not already be in check. (The mover CAN be in check — it's their turn
  // to escape.) isInCheck safely returns false when that side has no king, which is flagged above.
  const idle: PieceColor = turn === 'white' ? 'black' : 'white';
  if (isInCheck(board, idle)) {
    errors.push({ code: 'idle-side-in-check', message: `${cap(idle)} (not to move) is already in check.` });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Reject a single placement up front. Returns a human-readable reason the piece may NOT be placed
 * at `square` (given whose move it is), or null if allowed. The editor uses this to prevent an
 * illegal piece from ever landing, with a message — instead of placing it and failing validation
 * later. Covers the placement-time rules; completeness (e.g. missing a King) is NOT a violation
 * here — you just haven't finished building — so that stays in `validateSetup`.
 */
export function placementViolation(board: Board, piece: Piece, square: Square, turn: PieceColor): string | null {
  // Pawns can't sit on the back rank (there they'd have promoted).
  if (piece.type === 'pawn' && (square[1] === '1' || square[1] === '8')) {
    return `Pawns can't go on the back rank (rank ${square[1]}).`;
  }

  const next: Board = { ...board, [square]: piece };

  // Only one royal per side — a King (or a Piloted Anomaly) can't join a side that already has one.
  if (piece.type === 'king') {
    let royals = 0;
    for (const sq of Object.keys(next) as Square[]) {
      const p = next[sq]!;
      if (p.color === piece.color && isRoyal(p)) royals++;
    }
    if (royals > 1) return 'Only one royal per side (King or Piloted Anomaly).';
  }

  // A placement must not NEWLY put the side that isn't moving in check (they can't start already
  // "captured"). Only a placement that introduces the check is rejected — one that blocks an
  // existing check is fine.
  const idle: PieceColor = turn === 'white' ? 'black' : 'white';
  if (!isInCheck(board, idle) && isInCheck(next, idle)) {
    return `That would put ${cap(idle)} in check — but it's not their move.`;
  }

  return null;
}
