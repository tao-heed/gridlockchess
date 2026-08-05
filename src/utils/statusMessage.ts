// utils/statusMessage.ts — Game status message generation
//
// Pure function to generate human-readable status messages.
// No React dependencies — can be unit tested independently.

import type { PieceColor, GameStatus, DrawReason } from '@/types/game';

export interface StatusMessageParams {
  status: GameStatus;
  turn: PieceColor;
  drawReason?: DrawReason;
  inCheck: boolean;
}

/**
 * Generates a human-readable status message for the current game state.
 * 
 * @param params - Current game state parameters
 * @returns Formatted status string
 */
export function getStatusMessage({
  status,
  turn,
  drawReason,
  inCheck,
}: StatusMessageParams): string {
  if (status === 'checkmate') {
    const winner = turn === 'white' ? 'Black' : 'White';
    return `Checkmate — ${winner} wins`;
  }
  
  if (status === 'gridlock-death') {
    // The pilot (the side that just moved) is sealed in a bunker; `turn` is the winner.
    const winner = turn === 'white' ? 'White' : 'Black';
    const loser = turn === 'white' ? 'Black' : 'White';
    return `Gridlock Death — ${loser}'s King is sealed. ${winner} wins`;
  }
  
  if (status === 'stalemate') return 'Stalemate — Draw';
  
  if (status === 'draw') {
    if (drawReason === 'repetition') return 'Draw — Threefold Repetition';
    if (drawReason === 'gridlock') return 'Draw — Total Gridlock';
    if (drawReason === 'fifty-move') return 'Draw — Fifty-Move Rule';
    return 'Draw';
  }
  
  if (status === 'resigned') {
    const winner = turn === 'white' ? 'Black' : 'White';
    return `${turn === 'white' ? 'White' : 'Black'} resigned — ${winner} wins`;
  }
  
  if (status === 'timeout') {
    // A clock only runs for the side to move, so the flagged side is always `turn` (the loser).
    const winner = turn === 'white' ? 'Black' : 'White';
    const loser = turn === 'white' ? 'White' : 'Black';
    return `${loser} flagged — ${winner} wins`;
  }
  
  if (inCheck) return `${turn === 'white' ? 'White' : 'Black'} is in check`;
  
  return `${turn === 'white' ? 'White' : 'Black'} to move`;
}

/**
 * Determines if the game has ended (any terminal state).
 */
export function isTerminalStatus(status: GameStatus): status is Exclude<GameStatus, 'waiting' | 'playing'> {
  return (
    status === 'checkmate' ||
    status === 'stalemate' ||
    status === 'resigned' ||
    status === 'draw' ||
    status === 'timeout' ||
    status === 'gridlock-death'
  );
}

/**
 * Determines if the game ended with a decisive mate (not draw/resign).
 */
export function isDecisiveMate(status: GameStatus): boolean {
  return status === 'checkmate' || status === 'gridlock-death';
}
