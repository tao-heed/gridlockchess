// lib/chess/check.ts — Check and checkmate detection
import type { Board, Square, PieceColor, Piece } from '@/types/game';
import { parseSquare, FILES, RANKS } from '@/types/game';
import { getLegalMoves, isGridlocked } from './movement';

/** A piece is "royal" if it is a King or a Piloted Anomaly (King boarded it via Override
 *  — see GridlockChess.md §6.1). Royal pieces carry every King-safety rule. */
export const isRoyal = (piece: Piece): boolean =>
  piece.type === 'king' || (piece.type === 'anomaly' && (piece as { piloted?: boolean }).piloted === true);

/** Find the royal piece's position for a given color (King or Piloted Anomaly). */
export const findKing = (board: Board, color: PieceColor): Square | null => {
  for (const file of FILES) {
    for (const rank of RANKS) {
      const sq = `${file}${rank}` as Square;
      const piece = board[sq];
      if (piece && piece.color === color && isRoyal(piece)) {
        return sq;
      }
    }
  }
  return null;
};

/** Check if a square is attacked by a specific color */
export const isSquareAttacked = (
  board: Board, 
  square: Square, 
  byColor: PieceColor
): boolean => {
  for (const file of FILES) {
    for (const rank of RANKS) {
      const sq = `${file}${rank}` as Square;
      const piece = board[sq];
      
      if (!piece || piece.color !== byColor) continue;
      
      // Gridlocked pieces cannot attack (per GridlockChess.md Section 5)
      if (isGridlocked(piece)) continue;
      
      // Check if this piece can reach the target square
      const moves = getLegalMoves(piece, sq, board);
      if (moves.includes(square)) {
        return true;
      }
    }
  }
  
  return false;
};

/** Check if a color's King is in check */
export const isInCheck = (board: Board, color: PieceColor): boolean => {
  const kingSquare = findKing(board, color);
  if (!kingSquare) return false; // No king found (shouldn't happen)
  
  const enemyColor = color === 'white' ? 'black' : 'white';
  return isSquareAttacked(board, kingSquare, enemyColor);
};

/** Apply a move to the board (creates a new board state) */
export const applyMove = (
  board: Board, 
  from: Square, 
  to: Square
): Board => {
  const newBoard = { ...board };
  const piece = newBoard[from];
  
  if (!piece) return newBoard;
  
  // Move the piece
  delete newBoard[from];
  newBoard[to] = { ...piece };
  
  // Handle pawn specifics
  if (piece.type === 'pawn') {
    const pawn = newBoard[to] as typeof piece;
    pawn.hasMoved = true;
    
    // Check for two-square move (set en passant vulnerability)
    const { rankIdx: fromRank } = parseSquare(from);
    const { rankIdx: toRank } = parseSquare(to);
    if (Math.abs(toRank - fromRank) === 2) {
      pawn.enPassantVulnerable = true;
    }
  }
  
  // Handle anomaly vector consumption
  if (piece.type === 'anomaly') {
    // Vector consumption is handled in game state, not here
    // This is just for move simulation
  }
  
  return newBoard;
};

/** Check if a move would leave own King in check */
export const wouldBeInCheck = (
  board: Board,
  from: Square,
  to: Square,
  color: PieceColor
): boolean => {
  const newBoard = applyMove(board, from, to);
  return isInCheck(newBoard, color);
};

/** Get all legal moves for a color (excluding moves that leave King in check) */
export const getAllLegalMoves = (
  board: Board, 
  color: PieceColor,
  enPassantTarget?: Square
): Map<Square, Square[]> => {
  const allMoves = new Map<Square, Square[]>();
  
  for (const file of FILES) {
    for (const rank of RANKS) {
      const sq = `${file}${rank}` as Square;
      const piece = board[sq];
      
      if (!piece || piece.color !== color) continue;
      if (isGridlocked(piece)) continue;
      
      const pieceMoves = getLegalMoves(piece, sq, board, enPassantTarget);
      const legalMoves = pieceMoves.filter(
        to => !wouldBeInCheck(board, sq, to, color)
      );
      
      if (legalMoves.length > 0) {
        allMoves.set(sq, legalMoves);
      }
    }
  }
  
  return allMoves;
};

/** Check if a color is in checkmate */
export const isCheckmate = (
  board: Board, 
  color: PieceColor,
  enPassantTarget?: Square
): boolean => {
  // Must be in check
  if (!isInCheck(board, color)) return false;
  
  // Must have no legal moves
  const legalMoves = getAllLegalMoves(board, color, enPassantTarget);
  return legalMoves.size === 0;
};

/** Check if a color is in stalemate */
export const isStalemate = (
  board: Board, 
  color: PieceColor,
  enPassantTarget?: Square
): boolean => {
  // Must NOT be in check
  if (isInCheck(board, color)) return false;
  
  // Must have no legal moves
  const legalMoves = getAllLegalMoves(board, color, enPassantTarget);
  return legalMoves.size === 0;
};
