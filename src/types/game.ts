// types/game.ts — Core type definitions for Gridlock Chess
// Per dev-standards.md GRIDLOCK CHESS: DOMAIN TYPES

/** Movement vector types */
export type VectorType = 'L' | 'O' | 'D';

/** Charge pool for standard Anomalies (always sums to 10 at creation) */
export interface VectorPool {
  L: number;  // Leap (Knight-style)
  O: number;  // Orthogonal — Rook-style (ranks & files)
  D: number;  // Diagonal (Bishop-style)
}

/** Shared pool for Omni archetype (promotion only) — 8 points, any vector */
export interface OmniPool {
  shared: number;  // starts at 8, decrements on ANY move type
}

/** The 11 Archetypes (Omni is promotion-only). This union is the canonical ROSTER of which
 *  archetypes exist. All per-archetype DATA (icon, display name, alias, charge
 *  distribution, roll logic, etc.) lives in ARCHETYPE_REGISTRY in lib/chess/archetypes.ts —
 *  do not duplicate it here. The registry is typed `{ [K in ArchetypeKey]: ArchetypeDef<K> }`,
 *  so adding a key here forces a matching registry entry at compile time. */
export type ArchetypeKey =
  | 'highLeap'
  | 'highDiag'
  | 'highOrtho'
  | 'hybridLD'
  | 'hybridLO'
  | 'hybridDO'
  | 'balanced'
  | 'absLeap'
  | 'absDiag'
  | 'absOrtho'
  | 'omni';

export interface Archetype {
  key: ArchetypeKey;
  name: string;
  icon: string;
  generate: () => VectorPool;
}

/** Chess file letters */
export type File = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h';

/** Chess rank numbers */
export type Rank = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';

/** Chess square notation (a1-h8) */
export type Square = `${File}${Rank}`;

export type PieceColor = 'white' | 'black';

interface BasePiece {
  id: string;
  color: PieceColor;
}

export interface King extends BasePiece {
  type: 'king';
  icon: '♔' | '♚';
}

export interface Pawn extends BasePiece {
  type: 'pawn';
  icon: '♙' | '♟';
  hasMoved: boolean;
  enPassantVulnerable?: boolean;  // true if just moved 2 squares
}

export interface Anomaly extends BasePiece {
  type: 'anomaly';
  archetype: Exclude<ArchetypeKey, 'omni'>;
  icon: string;
  vectors: VectorPool;
  isGridlocked: boolean;  // true when L:0, O:0, D:0
  /** King has Overridden (boarded) this Anomaly — see GridlockChess.md §6.1. When true this
   *  Anomaly IS the royal piece: `isRoyal`/`findKing` in check.ts treat it as the King for all
   *  check/checkmate logic. It also drives the Piloted Anomaly rendering. */
  piloted?: boolean;
}

export interface OmniAnomaly extends BasePiece {
  type: 'anomaly';
  archetype: 'omni';
  icon: string;  // registry-sourced (ARCHETYPE_REGISTRY.omni.icon) — single source of truth
  vectors: OmniPool;
  isGridlocked: boolean;  // true when shared:0
}

export type Piece = King | Pawn | Anomaly | OmniAnomaly;

/** Board state: sparse map of occupied squares */
export type Board = Partial<Record<Square, Piece>>;

/** Game status */
export type GameStatus = 
  | 'waiting' 
  | 'playing' 
  | 'checkmate' 
  | 'stalemate' 
  | 'resigned' 
  | 'gridlock-death'  // a Piloted Anomaly spent its last charge — the pilot loses (GridlockChess.md §6.1)
  | 'timeout'         // a side's clock reached 0 — the flagged side (turn) loses
  | 'draw';

/** Draw reason (when status === 'draw') */
export type DrawReason = 'repetition' | 'gridlock' | 'fifty-move' | null;

/** Full game state */
export interface GameState {
  board: Board;
  turn: PieceColor;
  status: GameStatus;
  inCheck: boolean;
  selectedSquare: Square | null;
  legalMoves: Square[];
  lastMove: { from: Square; to: Square } | null;
  capturedPieces: { white: Piece[]; black: Piece[] };
  promotionSquare: Square | null;  // non-null when awaiting promotion choice
  /** Why the game drew (when status === 'draw'). null for non-draws and agreement draws. */
  drawReason: DrawReason;
  /** The most recent anomaly charge spend (for onboarding coachmark). null when the last move spent no vector. */
  lastVectorSpend: { square: Square; vector: VectorType; remaining: number; color: PieceColor } | null;
  /**
   * Authoritative outcome of the last applied move — set exactly where the move resolves,
   * so audio + history never have to infer captures/overrides from running tallies.
   * `captured` includes en-passant victims; null on a quiet move.
   */
  lastMoveMeta: { color: PieceColor; captured: Piece | null; isOverride: boolean } | null;
  /** Occurrence count per game-state key (placement + side + charges + en passant), for threefold repetition. */
  positionCounts: Record<string, number>;
  /**
   * Half-moves since the last irreversible progress (pawn move, capture, or charge spend).
   * Drives the fifty-move rule: at 100 half-moves the game is drawn. Because every Anomaly
   * move spends a charge (which resets this), it only ever ticks in the bare King-and-pawn
   * endgame — exactly where chess's fifty-move rule applies.
   */
  halfmoveClock: number;
}

/** Move validation result */
export interface MoveResult {
  valid: boolean;
  vectorUsed?: VectorType;        // Which pool to decrement
  capture?: Piece;                // Captured piece, if any
  causesCheck?: boolean;          // Would put opponent in check
  causesGridlock?: boolean;       // Would deplete last vector point
  requiresPromotion?: boolean;    // Pawn reached back rank
  isEnPassant?: boolean;          // En passant capture
  isOverride?: boolean;           // King boarding a friendly Anomaly (Override) — see GridlockChess.md §6.1
  error?: string;                 // Why move is invalid
}

/** Move history entry for game log display */
export interface MoveHistoryEntry {
  moveNumber: number;        // 1, 2, 3...
  color: PieceColor;
  pieceType: string;         // 'king' | 'pawn' | archetype key
  from: Square;
  to: Square;
  captured?: string;         // captured piece type/archetype
  vector?: VectorType;       // vector used (anomaly only)
  vectorCost?: number;       // remaining after spend
  isCheck?: boolean;
  isCheckmate?: boolean;
  isOverride?: boolean;      // King boarded an Anomaly (Override)
  promoted?: boolean;        // Pawn synthesised into an Omni this move (Anomaly Synthesis)
  causesGridlock?: boolean;  // A non-piloted Anomaly drained its last charge (0/0/0) this move
  isGridlockDeath?: boolean; // A piloted Anomaly spent its last charge → carried King dies
}

// Helper constants
export const FILES: File[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS: Rank[] = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const fileToIndex = (file: File): number => FILES.indexOf(file);
export const rankToIndex = (rank: Rank): number => RANKS.indexOf(rank);
export const indexToFile = (index: number): File => FILES[index]!;
export const indexToRank = (index: number): Rank => RANKS[index]!;

export const parseSquare = (square: Square): { file: File; rank: Rank; fileIdx: number; rankIdx: number } => {
  const file = square[0] as File;
  const rank = square[1] as Rank;
  return { file, rank, fileIdx: fileToIndex(file), rankIdx: rankToIndex(rank) };
};

export const toSquare = (fileIdx: number, rankIdx: number): Square | null => {
  if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return null;
  return `${indexToFile(fileIdx)}${indexToRank(rankIdx)}` as Square;
};
