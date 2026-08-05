// lib/chess/generator.ts — Generate randomized starting positions
import type { ArchetypeKey, Board, Piece, Anomaly, King, Pawn, Square, File } from '@/types/game';
import { FILES, indexToFile } from '@/types/game';
import { generateBalancedArmy } from './balancedArmy';

/** How the back-rank army is rolled.
 *  'balanced' → every army's charges sum to EXACTLY a permutation of {24,23,23}, sampled
 *               uniformly (see balancedArmy.ts), then passed through the opposite-color
 *               bishop-pair placement rule below. This is the only supported mode. */
export type GenerationMode = 'balanced';
import { shuffle } from './random';

let pieceIdCounter = 0;
const generateId = () => `piece-${++pieceIdCounter}`;

/** Generate the back rank pieces (King + 7 Anomalies) for one side */
const generateBackRank = (color: 'white' | 'black'): Map<File, Piece> => {
  const pieces = new Map<File, Piece>();
  const positions = shuffle([0, 1, 2, 3, 4, 5, 6, 7]);
  
  // King goes in first shuffled position
  const kingFile = indexToFile(positions[0]!);
  const king: King = {
    id: generateId(),
    type: 'king',
    color,
    icon: color === 'white' ? '♔' : '♚',
  };
  pieces.set(kingFile, king);
  
  // 7 Anomalies in remaining positions: a uniformly-sampled army summing to exactly
  // 24/23/23 (see generateBalancedArmy).
  const army = generateBalancedArmy(7);

  // File index each anomaly is placed on (army[i] → anomalyFiles[i]). Uniformly random
  // from the back-rank shuffle above; the rule below only perturbs it in one rare case.
  const anomalyFiles = positions.slice(1);

  // Anti-degeneracy placement rule (opposite-color bishop pair):
  // A pure diagonal Absolute (absDiag, D=10) is the ONLY genuinely color-locked piece — with
  // zero Leap/Ortho charges it can never step onto the other square color. Every other
  // archetype can spend an L/O charge to switch colors, so none of them are color-locked.
  // If an army rolls the rare pair of absDiag pieces, force them onto opposite-color squares
  // (opposite file parity on the back rank) so each side fields a true light+dark bishop pair
  // instead of a redundant same-color one. Fires ONLY for exactly two absDiag pieces.
  // Always satisfiable: removing the king leaves 7 files with ≥3 of each parity, so an
  // opposite-parity swap partner always exists.
  const absDiagSlots = army.flatMap((rolled, i) => (rolled.archetype.key === 'absDiag' ? [i] : []));
  if (absDiagSlots.length === 2) {
    const [a, b] = absDiagSlots as [number, number];
    if (anomalyFiles[a]! % 2 === anomalyFiles[b]! % 2) {
      const wantParity = 1 - (anomalyFiles[a]! % 2);
      const swap = anomalyFiles.findIndex(
        (fileIdx, i) => i !== a && i !== b && fileIdx! % 2 === wantParity,
      );
      [anomalyFiles[b], anomalyFiles[swap]] = [anomalyFiles[swap]!, anomalyFiles[b]!];
    }
  }

  for (let i = 0; i < army.length; i++) {
    const file = indexToFile(anomalyFiles[i]!);
    const rolled = army[i]!;
    const archetype = rolled.archetype;
    const vectors = rolled.vectors;
    
    const anomaly: Anomaly = {
      id: generateId(),
      type: 'anomaly',
      color,
      archetype: archetype.key as Exclude<ArchetypeKey, 'omni'>,
      icon: archetype.icon,
      vectors,
      isGridlocked: false,
    };
    pieces.set(file, anomaly);
  }
  
  return pieces;
};

/** Generate initial board state */
export const generateInitialBoard = (): Board => {
  pieceIdCounter = 0; // Reset for deterministic IDs
  const board: Board = {};
  
  // Generate White's back rank
  const whiteBackRank = generateBackRank('white');
  
  // Place White pieces on rank 1 and mirror to Black on rank 8
  for (const file of FILES) {
    const whitePiece = whiteBackRank.get(file);
    if (whitePiece) {
      // White back rank (rank 1)
      const whiteSquare = `${file}1` as Square;
      board[whiteSquare] = whitePiece;
      
      // Black back rank (rank 8) — mirror with same archetype/stats
      const blackSquare = `${file}8` as Square;
      if (whitePiece.type === 'king') {
        board[blackSquare] = {
          ...whitePiece,
          id: generateId(),
          color: 'black',
          icon: '♚',
        } as King;
      } else if (whitePiece.type === 'anomaly') {
        board[blackSquare] = {
          ...whitePiece,
          id: generateId(),
          color: 'black',
          vectors: { ...whitePiece.vectors }, // Copy vectors
        } as Anomaly;
      }
    }
    
    // White pawns on rank 2
    const whitePawnSquare = `${file}2` as Square;
    const whitePawn: Pawn = {
      id: generateId(),
      type: 'pawn',
      color: 'white',
      icon: '♙',
      hasMoved: false,
    };
    board[whitePawnSquare] = whitePawn;
    
    // Black pawns on rank 7
    const blackPawnSquare = `${file}7` as Square;
    const blackPawn: Pawn = {
      id: generateId(),
      type: 'pawn',
      color: 'black',
      icon: '♟',
      hasMoved: false,
    };
    board[blackPawnSquare] = blackPawn;
  }
  
  return board;
};

/** Get layout code (for sharing/reproducing positions) */
export const getBoardLayoutCode = (board: Board): string => {
  const parts: string[] = [];
  
  for (const file of FILES) {
    const square = `${file}1` as Square;
    const piece = board[square];
    
    if (!piece) {
      parts.push('-');
    } else if (piece.type === 'king') {
      parts.push('K');
    } else if (piece.type === 'anomaly') {
      const v = piece.vectors as { L: number; O: number; D: number };
      parts.push(`${piece.archetype}:${v.L}${v.O}${v.D}`);
    }
  }
  
  return parts.join('|');
};
