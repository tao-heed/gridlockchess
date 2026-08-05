// lib/chess/movement.ts — Movement validation for all piece types
import type { 
  Board, Piece, Square, PieceColor, VectorType, MoveResult, 
  Anomaly, OmniAnomaly, Pawn, VectorPool, OmniPool 
} from '@/types/game';
import { parseSquare, toSquare } from '@/types/game';

/** Check if a piece is Gridlocked (cannot move) */
export const isGridlocked = (piece: Piece): boolean => {
  if (piece.type !== 'anomaly') return false;
  
  if (piece.archetype === 'omni') {
    return (piece.vectors as OmniPool).shared === 0;
  }
  
  const v = piece.vectors as VectorPool;
  return v.L === 0 && v.O === 0 && v.D === 0;
};

/** Check if square is on the board */
const isValidSquare = (fileIdx: number, rankIdx: number): boolean => 
  fileIdx >= 0 && fileIdx <= 7 && rankIdx >= 0 && rankIdx <= 7;

/** Get all squares a Knight can reach from a position */
const getLeapMoves = (fileIdx: number, rankIdx: number): Square[] => {
  const deltas = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1]
  ];
  
  return deltas
    .map(([df, dr]) => toSquare(fileIdx + df!, rankIdx + dr!))
    .filter((sq): sq is Square => sq !== null);
};

/** Get all squares in a direction until blocked */
const getSlidingMoves = (
  fileIdx: number, 
  rankIdx: number, 
  board: Board,
  color: PieceColor,
  deltaFile: number, 
  deltaRank: number
): Square[] => {
  const moves: Square[] = [];
  let f = fileIdx + deltaFile;
  let r = rankIdx + deltaRank;
  
  while (isValidSquare(f, r)) {
    const sq = toSquare(f, r)!;
    const occupant = board[sq];
    
    if (occupant) {
      // Can capture enemy, but can't go further
      if (occupant.color !== color) {
        // Check if enemy is Gridlocked — can still be captured
        moves.push(sq);
      }
      break; // Blocked by piece (friend or foe)
    }
    
    moves.push(sq);
    f += deltaFile;
    r += deltaRank;
  }
  
  return moves;
};

/** Get orthogonal (Rook-style) moves */
const getOrthogonalMoves = (fileIdx: number, rankIdx: number, board: Board, color: PieceColor): Square[] => {
  return [
    ...getSlidingMoves(fileIdx, rankIdx, board, color, 0, 1),   // up
    ...getSlidingMoves(fileIdx, rankIdx, board, color, 0, -1),  // down
    ...getSlidingMoves(fileIdx, rankIdx, board, color, 1, 0),   // right
    ...getSlidingMoves(fileIdx, rankIdx, board, color, -1, 0),  // left
  ];
};

/** Get diagonal (Bishop-style) moves */
const getDiagonalMoves = (fileIdx: number, rankIdx: number, board: Board, color: PieceColor): Square[] => {
  return [
    ...getSlidingMoves(fileIdx, rankIdx, board, color, 1, 1),   // up-right
    ...getSlidingMoves(fileIdx, rankIdx, board, color, 1, -1),  // down-right
    ...getSlidingMoves(fileIdx, rankIdx, board, color, -1, 1),  // up-left
    ...getSlidingMoves(fileIdx, rankIdx, board, color, -1, -1), // down-left
  ];
};

/** Get available moves for an Anomaly, respecting vector pools */
export const getAnomalyMoves = (
  piece: Anomaly | OmniAnomaly, 
  from: Square, 
  board: Board
): Map<Square, VectorType> => {
  const moves = new Map<Square, VectorType>();
  const { fileIdx, rankIdx } = parseSquare(from);
  
  if (isGridlocked(piece)) return moves;
  
  if (piece.archetype === 'omni') {
    // Omni can use any vector type from shared pool
    const pool = piece.vectors as OmniPool;
    if (pool.shared > 0) {
      // Add all possible moves with their vector types
      for (const sq of getLeapMoves(fileIdx, rankIdx)) {
        const occupant = board[sq];
        if (!occupant || occupant.color !== piece.color) {
          moves.set(sq, 'L');
        }
      }
      for (const sq of getOrthogonalMoves(fileIdx, rankIdx, board, piece.color)) {
        if (!moves.has(sq)) moves.set(sq, 'O');
      }
      for (const sq of getDiagonalMoves(fileIdx, rankIdx, board, piece.color)) {
        if (!moves.has(sq)) moves.set(sq, 'D');
      }
    }
  } else {
    // Standard Anomaly — check each vector pool
    const v = piece.vectors as VectorPool;
    
    if (v.L > 0) {
      for (const sq of getLeapMoves(fileIdx, rankIdx)) {
        const occupant = board[sq];
        if (!occupant || occupant.color !== piece.color) {
          moves.set(sq, 'L');
        }
      }
    }
    
    if (v.O > 0) {
      for (const sq of getOrthogonalMoves(fileIdx, rankIdx, board, piece.color)) {
        moves.set(sq, 'O');
      }
    }
    
    if (v.D > 0) {
      for (const sq of getDiagonalMoves(fileIdx, rankIdx, board, piece.color)) {
        moves.set(sq, 'D');
      }
    }
  }
  
  return moves;
};

/** Get available moves for a King.
 *  Includes Override (GridlockChess.md §6.1): a King may step onto an adjacent square
 *  occupied by a friendly, non-Omni, non-Gridlocked Anomaly to board it permanently. */
export const getKingMoves = (from: Square, board: Board, color: PieceColor): Square[] => {
  const { fileIdx, rankIdx } = parseSquare(from);
  const moves: Square[] = [];
  
  for (let df = -1; df <= 1; df++) {
    for (let dr = -1; dr <= 1; dr++) {
      if (df === 0 && dr === 0) continue;
      
      const sq = toSquare(fileIdx + df, rankIdx + dr);
      if (sq) {
        const occupant = board[sq];
        if (!occupant || occupant.color !== color) {
          // Empty square or enemy capture.
          moves.push(sq);
        } else if (
          occupant.type === 'anomaly' &&
          occupant.archetype !== 'omni' &&
          !isGridlocked(occupant)
        ) {
          // Override target — board a friendly Anomaly.
          moves.push(sq);
        }
      }
    }
  }
  
  return moves;
};

/** Get available moves for a Pawn */
export const getPawnMoves = (
  piece: Pawn, 
  from: Square, 
  board: Board,
  enPassantTarget?: Square
): { moves: Square[]; captures: Square[]; enPassant?: Square } => {
  const { fileIdx, rankIdx } = parseSquare(from);
  const direction = piece.color === 'white' ? 1 : -1;
  const moves: Square[] = [];
  const captures: Square[] = [];
  let enPassant: Square | undefined;
  
  // Forward one square
  const oneForward = toSquare(fileIdx, rankIdx + direction);
  if (oneForward && !board[oneForward]) {
    moves.push(oneForward);
    
    // Forward two squares (only if hasn't moved)
    if (!piece.hasMoved) {
      const twoForward = toSquare(fileIdx, rankIdx + direction * 2);
      if (twoForward && !board[twoForward]) {
        moves.push(twoForward);
      }
    }
  }
  
  // Diagonal captures
  for (const df of [-1, 1]) {
    const captureSq = toSquare(fileIdx + df, rankIdx + direction);
    if (captureSq) {
      const occupant = board[captureSq];
      if (occupant && occupant.color !== piece.color) {
        captures.push(captureSq);
      }
      
      // En passant
      if (captureSq === enPassantTarget) {
        enPassant = captureSq;
        captures.push(captureSq);
      }
    }
  }
  
  return { moves, captures, enPassant };
};

/** Get all legal moves for a piece */
export const getLegalMoves = (
  piece: Piece, 
  from: Square, 
  board: Board,
  enPassantTarget?: Square
): Square[] => {
  if (piece.type === 'king') {
    return getKingMoves(from, board, piece.color);
  }
  
  if (piece.type === 'pawn') {
    const { moves, captures } = getPawnMoves(piece, from, board, enPassantTarget);
    return [...moves, ...captures];
  }
  
  if (piece.type === 'anomaly') {
    return Array.from(getAnomalyMoves(piece, from, board).keys());
  }
  
  return [];
};

/** Determine which vector type is used for a move */
export const getVectorTypeForMove = (
  piece: Anomaly | OmniAnomaly,
  from: Square,
  to: Square,
  board: Board
): VectorType | undefined => {
  const moves = getAnomalyMoves(piece, from, board);
  return moves.get(to);
};

/** Validate a move and return result */
export const validateMove = (
  board: Board,
  from: Square,
  to: Square,
  turn: PieceColor,
  enPassantTarget?: Square
): MoveResult => {
  const piece = board[from];
  
  if (!piece) {
    return { valid: false, error: 'No piece at source square' };
  }
  
  if (piece.color !== turn) {
    return { valid: false, error: 'Not your turn' };
  }
  
  if (isGridlocked(piece)) {
    return { valid: false, error: 'Piece is Gridlocked' };
  }
  
  const legalMoves = getLegalMoves(piece, from, board, enPassantTarget);
  
  if (!legalMoves.includes(to)) {
    return { valid: false, error: 'Invalid move' };
  }
  
  const capture = board[to];
  const result: MoveResult = { valid: true };
  
  // Override (GridlockChess.md §6.1): King boarding a friendly Anomaly. The destination
  // piece is an ally being merged into — it is NOT a capture and costs no charge here.
  if (
    piece.type === 'king' &&
    capture &&
    capture.color === turn &&
    capture.type === 'anomaly' &&
    capture.archetype !== 'omni'
  ) {
    result.isOverride = true;
    return result;
  }
  
  if (capture) {
    result.capture = capture;
  }
  
  // Anomaly-specific: determine vector used
  if (piece.type === 'anomaly') {
    const vectorUsed = getVectorTypeForMove(piece, from, to, board);
    result.vectorUsed = vectorUsed;
    
    // Check if this would cause Gridlock
    if (piece.archetype === 'omni') {
      const pool = piece.vectors as OmniPool;
      if (pool.shared === 1) {
        result.causesGridlock = true;
      }
    } else if (vectorUsed) {
      const v = piece.vectors as VectorPool;
      const newValue = v[vectorUsed] - 1;
      if (newValue === 0 && v.L - (vectorUsed === 'L' ? 1 : 0) === 0 
          && v.O - (vectorUsed === 'O' ? 1 : 0) === 0 
          && v.D - (vectorUsed === 'D' ? 1 : 0) === 0) {
        result.causesGridlock = true;
      }
    }
  }
  
  // Pawn-specific: check promotion
  if (piece.type === 'pawn') {
    const { rankIdx } = parseSquare(to);
    const promotionRank = piece.color === 'white' ? 7 : 0;
    if (rankIdx === promotionRank) {
      result.requiresPromotion = true;
    }
    
    // Check en passant
    if (to === enPassantTarget) {
      result.isEnPassant = true;
      // The captured pawn is behind the target square
      const capturedPawnRank = piece.color === 'white' ? 4 : 3;
      const { fileIdx } = parseSquare(to);
      const capturedSquare = toSquare(fileIdx, capturedPawnRank);
      if (capturedSquare) {
        result.capture = board[capturedSquare];
      }
    }
  }
  
  return result;
};
