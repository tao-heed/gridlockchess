// lib/chess/kingMood.ts — Pure decision logic for the board King's "mood" (its emoji face).
//
// Functional core / imperative shell: this module has ZERO React and ZERO side effects — it is a
// pure mapping from game state → each King's mood. LocalGame's two effects are the thin shell that
// feed live / scrubbed state in and write the result to the useKingMood store. Keeping the logic
// pure is exactly what makes it exhaustively unit-testable (see __tests__/kingMood.spec.ts) without
// rendering components, wrapping in act(), or juggling fake timers.
import type { PieceColor, GameStatus, MoveHistoryEntry } from '@/types/game';

/** The King's face states: 😎 confident · 🤔 thinking · 😮 surprised · 😅 relieved · 🫡 respect · 😵 dizzy. */
export type KingMood = 'confident' | 'thinking' | 'surprised' | 'relieved' | 'respect' | 'dizzy';

type Moods = Record<PieceColor, KingMood>;

const other = (c: PieceColor): PieceColor => (c === 'white' ? 'black' : 'white');

/** Terminal faces: the loser is knocked out 😵, everyone else salutes 🫡 (a null loser = a draw). */
function terminalMoods(loser: PieceColor | null): Moods {
  return {
    white: loser === 'white' ? 'dizzy' : 'respect',
    black: loser === 'black' ? 'dizzy' : 'respect',
  };
}

/** Turn baseline: the side to move is deciding (🤔), the side that just moved waits (😎). */
function baseMoods(sideToMove: PieceColor): Moods {
  return {
    white: sideToMove === 'white' ? 'thinking' : 'confident',
    black: sideToMove === 'black' ? 'thinking' : 'confident',
  };
}

export interface LiveMoodInput {
  /** Side to move at the live position. */
  turn: PieceColor;
  /** Is the side to move in check? */
  inCheck: boolean;
  /** Terminal by board status (checkmate / stalemate / draw / gridlock-death / resigned / timeout). */
  isGameOver: boolean;
  status: GameStatus;
  /** Uplink resign / timeout / abandon resolves out-of-band while `status` stays 'playing'. */
  uplinkResolved: boolean;
  uplinkResult: 'win' | 'loss' | null;
  /** MY seat's color, used to interpret `uplinkResult`. */
  myColor: PieceColor;
  /** Which color was in check at the PREVIOUS live position — powers the one-ply 😅. */
  prevCheckColor: PieceColor | null;
}

/**
 * Live moods, plus the `checkColor` to carry into the next call as `prevCheckColor`.
 * Priority: uplink-resolved → game-over → in-check (😮) → just-escaped (😅) → turn baseline.
 * For gridlock-death the LOSER is `other(turn)` (the mover spent its piloted royal's last charge,
 * so the turn already passed to the survivor); every other decisive status loses on `turn`.
 */
export function computeLiveKingMoods(i: LiveMoodInput): { moods: Moods; checkColor: PieceColor | null } {
  if (i.uplinkResolved) {
    const loser = i.uplinkResult === 'loss' ? i.myColor : other(i.myColor);
    return { moods: terminalMoods(loser), checkColor: null };
  }
  if (i.isGameOver) {
    if (i.status === 'stalemate' || i.status === 'draw') return { moods: terminalMoods(null), checkColor: null };
    const loser = i.status === 'gridlock-death' ? other(i.turn) : i.turn;
    return { moods: terminalMoods(loser), checkColor: null };
  }
  const checkColor: PieceColor | null = i.inCheck ? i.turn : null;
  const moods = baseMoods(i.turn);
  if (checkColor === 'white') moods.white = 'surprised'; // in check overrides thinking
  if (checkColor === 'black') moods.black = 'surprised';
  // A king that was in check last position and no longer is just escaped → 😅 for one ply (waiting side).
  if (i.prevCheckColor && i.prevCheckColor !== checkColor) {
    if (i.prevCheckColor === 'white' && moods.white === 'confident') moods.white = 'relieved';
    if (i.prevCheckColor === 'black' && moods.black === 'confident') moods.black = 'relieved';
  }
  return { moods, checkColor };
}

export interface ScrubMoodInput {
  /** Number of plies applied at the viewed position (scrub only calls with a real number). */
  viewPly: number | null;
  /** Side to move at the viewed ply. */
  displayTurn: PieceColor;
  /** Is the side to move in check at the viewed ply? */
  displayInCheck: boolean;
  moveHistory: MoveHistoryEntry[];
}

/**
 * Moods for a reviewed (scrubbed) ply, derived purely from the move log. The escape 😅 is read from
 * history: moveHistory[viewPly-2] delivered the check and moveHistory[viewPly-1] is the move that
 * escaped it, so that move's mover — the waiting side — gets 😅. Terminal 😵/🫡 are NOT produced here;
 * they live at the final (live) view, which scrubbing snaps back to at the end.
 */
export function computeScrubKingMoods(i: ScrubMoodInput): Moods {
  const checkColor: PieceColor | null = i.displayInCheck ? i.displayTurn : null;
  const escapeColor: PieceColor | null =
    i.viewPly !== null && i.viewPly >= 2 && i.moveHistory[i.viewPly - 2]?.isCheck
      ? (i.moveHistory[i.viewPly - 1]?.color ?? null)
      : null;
  const moods = baseMoods(i.displayTurn);
  if (checkColor === 'white') moods.white = 'surprised';   // in check overrides thinking
  if (checkColor === 'black') moods.black = 'surprised';
  if (escapeColor === 'white' && moods.white === 'confident') moods.white = 'relieved'; // just escaped
  if (escapeColor === 'black' && moods.black === 'confident') moods.black = 'relieved';
  return moods;
}
