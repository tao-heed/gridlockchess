// hooks/useGameState.ts — Game state management
import { useState } from 'react';
import type { 
  GameState, Board, Square, PieceColor,
  Anomaly, OmniAnomaly, ArchetypeKey, VectorPool, VectorType, Piece 
} from '@/types/game';
import { generateInitialBoard } from '@/lib/chess/generator';
import { isGridlocked, getAnomalyMoves, getLegalMoves } from '@/lib/chess/movement';
import { isInCheck, findKing, wouldBeInCheck } from '@/lib/chess/check';
import { getArchetype, ALL_ARCHETYPES_FOR_PROMOTION, createOmniAnomaly } from '@/lib/chess/archetypes';
import { applyMoveToBoard } from '@/lib/chess/move';
import { evaluateOutcome } from '@/lib/chess/outcome';
import { repetitionKey } from '@/lib/chess/repetition';

const createInitialState = (): GameState => {
  const board = generateInitialBoard();
  return {
    board,
    turn: 'white',
    status: 'playing',
    inCheck: false,
    selectedSquare: null,
    legalMoves: [],
    lastMove: null,
    capturedPieces: { white: [], black: [] },
    promotionSquare: null,
    drawReason: null,
    lastVectorSpend: null,
    lastMoveMeta: null,
    positionCounts: {},
    halfmoveClock: 0,
  };
};

export function useGameState() {
  const [state, setState] = useState<GameState>(createInitialState);
  const [enPassantTarget, setEnPassantTarget] = useState<Square | null>(null);
  // Per-game instance id. Bumped on every reset so the board can fully remount and
  // framer-motion discards stale shared-layout (layoutId) snapshots from the prior
  // game — piece ids restart at piece-1 each game, so without this they collide.
  const [gameId, setGameId] = useState(0);
  // Track which vector type each legal move uses (for colored dots)
  const [legalMovesVectorMap, setLegalMovesVectorMap] = useState<Map<Square, VectorType | null>>(new Map());

  // ── Opponent-move preview (read-only inspection) ──────────────────────────────
  // Clicking an opponent Anomaly highlights every square it could legally reach,
  // color-coded by the vector it would spend — purely to *visualize* enemy reach. It
  // lives in its own state, fully separate from selectedSquare/legalMoves, so a preview
  // can NEVER be turned into a move (see previewOpponent + the useBoardDnD routing).
  const [previewSquare, setPreviewSquare] = useState<Square | null>(null);
  const [previewMoves, setPreviewMoves] = useState<Square[]>([]);
  const [previewMovesVectorMap, setPreviewMovesVectorMap] = useState<Map<Square, VectorType | null>>(new Map());

  const clearPreview = () => {
    setPreviewSquare(null);
    setPreviewMoves([]);
    setPreviewMovesVectorMap(new Map());
  };

  // Inspect an opponent piece's legal reach without moving anything — callable on ANY
  // turn. Re-clicking the same piece (or a non-opponent / gridlocked square) clears it.
  const previewOpponent = (square: Square) => {
    if (state.status !== 'playing' || state.promotionSquare) return;
    const piece = state.board[square];
    if (!piece || piece.color === state.turn || isGridlocked(piece) || previewSquare === square) {
      clearPreview();
      return;
    }
    const rawMoves = getLegalMoves(piece, square, state.board, enPassantTarget ?? undefined);
    const moves = rawMoves.filter(to => !wouldBeInCheck(state.board, square, to, piece.color));
    const vectorMap = new Map<Square, VectorType | null>();
    if (piece.type === 'anomaly') {
      const anomalyMoves = getAnomalyMoves(piece, square, state.board);
      for (const sq of moves) vectorMap.set(sq, anomalyMoves.get(sq) ?? null);
    } else {
      for (const sq of moves) vectorMap.set(sq, null);
    }
    // A preview and an actionable own-piece selection are mutually exclusive so the
    // board stays readable — clear any selection when inspecting an enemy.
    setState(prev => ({ ...prev, selectedSquare: null, legalMoves: [] }));
    setLegalMovesVectorMap(new Map());
    setPreviewSquare(square);
    setPreviewMoves(moves);
    setPreviewMovesVectorMap(vectorMap);
  };

  // Find current player's king
  const kingSquare = findKing(state.board, state.turn);
  
  // Handle square selection
  const selectSquare = (square: Square) => {
    clearPreview(); // any actionable selection dismisses a read-only enemy preview
    setState(prev => {
      if (prev.status !== 'playing' || prev.promotionSquare) return prev;
      
      const piece = prev.board[square];
      
      // If clicking on own piece, select it
      if (piece && piece.color === prev.turn && !isGridlocked(piece)) {
        // Get legal moves that don't leave king in check
        const rawMoves = getLegalMoves(piece, square, prev.board, enPassantTarget ?? undefined);
        const legalMoves = rawMoves.filter(
          to => !wouldBeInCheck(prev.board, square, to, prev.turn)
        );
        
        // Build vector type map for anomalies
        const vectorMap = new Map<Square, VectorType | null>();
        if (piece.type === 'anomaly') {
          const anomalyMoves = getAnomalyMoves(piece, square, prev.board);
          for (const sq of legalMoves) {
            vectorMap.set(sq, anomalyMoves.get(sq) ?? null);
          }
        } else {
          // King/Pawn - no vector type
          for (const sq of legalMoves) {
            vectorMap.set(sq, null);
          }
        }
        setLegalMovesVectorMap(vectorMap);
        
        return {
          ...prev,
          selectedSquare: square,
          legalMoves,
        };
      }
      
      // If a piece is selected and clicking on a legal move, make the move
      if (prev.selectedSquare && prev.legalMoves.includes(square)) {
        return prev; // Let makeMove handle this
      }
      
      // Deselect
      setLegalMovesVectorMap(new Map());
      return {
        ...prev,
        selectedSquare: null,
        legalMoves: [],
      };
    });
  };
  
  // Make a move. `promotionOverride` is supplied by Uplink so the receiver applies the
  // exact same promoted piece the sender had (both peers stay byte-identical).
  const makeMove = (from: Square, to: Square, promotionOverride?: Piece) => {
    clearPreview(); // a committed move dismisses any read-only enemy preview
    setState(prev => {
      if (prev.status !== 'playing') return prev;

      const applied = applyMoveToBoard(prev.board, from, to, prev.turn, enPassantTarget, promotionOverride);
      if (!applied.valid) return prev;

      const { board: newBoard, nextEnPassant, captured, vectorSpend, isOverride, irreversible, gridlockDeath } = applied;
      setEnPassantTarget(nextEnPassant);

      const nextTurn: PieceColor = prev.turn === 'white' ? 'black' : 'white';
      const inCheck = isInCheck(newBoard, nextTurn);

      // Track captures for the panel.
      const newCaptured = { ...prev.capturedPieces };
      if (captured) newCaptured[prev.turn] = [...newCaptured[prev.turn], captured];

      // ── Override (Anomaly Boarding) — GridlockChess.md §6.1 ───────────────────
      // Boarding is irreversible (the King is consumed) → reset repetition history.
      if (isOverride) {
        const positionCounts: Record<string, number> = {};
        positionCounts[repetitionKey(newBoard, nextTurn, null)] = 1;

        const { status, drawReason } = evaluateOutcome(newBoard, nextTurn, prev.status);

        return {
          ...prev,
          board: newBoard,
          turn: nextTurn,
          status,
          drawReason,
          positionCounts,
          inCheck,
          selectedSquare: null,
          legalMoves: [],
          lastMove: { from, to },
          capturedPieces: newCaptured,
          promotionSquare: null,
          lastVectorSpend: null,
          lastMoveMeta: { color: prev.turn, captured: null, isOverride: true },
          halfmoveClock: 0,
        };
      }

      // After an irreversible move, no earlier position can ever recur, so clear the history.
      const positionCounts = irreversible ? {} : { ...prev.positionCounts };
      const posKey = repetitionKey(newBoard, nextTurn, nextEnPassant);
      const posCount = (positionCounts[posKey] ?? 0) + 1;
      positionCounts[posKey] = posCount;

      // Fifty-move clock: irreversible progress resets it; everything else ticks. Since any
      // Anomaly move spends a charge (irreversible), this only advances in the King-and-pawn
      // endgame — exactly where chess's fifty-move rule is meant to apply.
      const halfmoveClock = irreversible ? 0 : prev.halfmoveClock + 1;

      const { status, drawReason } = evaluateOutcome(newBoard, nextTurn, prev.status, {
        posCount,
        halfmoveClock,
        gridlockDeath,
      });

      return {
        ...prev,
        board: newBoard,
        turn: nextTurn,
        status,
        drawReason,
        positionCounts,
        inCheck,
        selectedSquare: null,
        legalMoves: [],
        lastMove: { from, to },
        capturedPieces: newCaptured,
        promotionSquare: null,
        lastVectorSpend: vectorSpend,
        lastMoveMeta: { color: prev.turn, captured, isOverride: false },
        halfmoveClock,
      };
    });
  };
  
  // Handle promotion choice
  const promote = (archetypeKey: ArchetypeKey) => {
    setState(prev => {
      if (!prev.promotionSquare) return prev;
      
      const archetype = getArchetype(archetypeKey);
      if (!archetype) return prev;
      
      const newBoard: Board = { ...prev.board };
      const pawn = newBoard[prev.promotionSquare];
      
      if (!pawn || pawn.type !== 'pawn') return prev;
      
      // Create the promoted piece
      let promotedPiece: Anomaly | OmniAnomaly;
      
      if (archetypeKey === 'omni') {
        promotedPiece = createOmniAnomaly(pawn.id, pawn.color);
      } else {
        const arch = archetype as { generate: () => VectorPool; icon: string };
        promotedPiece = {
          id: pawn.id,
          type: 'anomaly',
          color: pawn.color,
          archetype: archetypeKey as Exclude<ArchetypeKey, 'omni'>,
          icon: arch.icon,
          vectors: arch.generate(),
          isGridlocked: false,
        } as Anomaly;
      }
      
      newBoard[prev.promotionSquare] = promotedPiece;
      
      // Switch turns and check game state
      const nextTurn: PieceColor = prev.turn === 'white' ? 'black' : 'white';
      const inCheck = isInCheck(newBoard, nextTurn);
      
      // Promotion is irreversible (a pawn advanced and transformed) → reset the repetition
      // history and start fresh from the new position. A promoting pawn clears en passant.
      const positionCounts: Record<string, number> = {};
      const posKey = repetitionKey(newBoard, nextTurn, null);
      positionCounts[posKey] = 1;
      
      const { status, drawReason } = evaluateOutcome(newBoard, nextTurn, prev.status);
      
      return {
        ...prev,
        board: newBoard,
        turn: nextTurn,
        status,
        drawReason,
        positionCounts,
        inCheck,
        promotionSquare: null,
        lastVectorSpend: null,
        lastMoveMeta: null,
        halfmoveClock: 0,
      };
    });
  };
  
  // Handle square click (select or move)
  const handleSquareClick = (square: Square) => {
    if (state.selectedSquare && state.legalMoves.includes(square)) {
      makeMove(state.selectedSquare, square);
    } else {
      selectSquare(square);
    }
  };
  
  // Reset game
  const resetGame = () => {
    setState(createInitialState());
    setEnPassantTarget(null);
    setGameId(id => id + 1);
  };
  
  // Load an externally-supplied position (Uplink: the host's authoritative board; or a
  // resumed/imported game). Bypasses random generation so both peers share an identical
  // starting state. `capturedPieces` is optional — supply it to faithfully restore the
  // captured-pieces panel when resuming/importing an in-progress game.
  const loadState = (snapshot: {
    board: Board;
    turn: PieceColor;
    enPassantTarget?: Square | null;
    capturedPieces?: { white: Piece[]; black: Piece[] };
  }) => {
    setState({
      board: snapshot.board,
      turn: snapshot.turn,
      status: 'playing',
      inCheck: isInCheck(snapshot.board, snapshot.turn),
      selectedSquare: null,
      legalMoves: [],
      lastMove: null,
      capturedPieces: snapshot.capturedPieces ?? { white: [], black: [] },
      promotionSquare: null,
      drawReason: null,
      lastVectorSpend: null,
      lastMoveMeta: null,
      positionCounts: {},
      halfmoveClock: 0,
    });
    setEnPassantTarget(snapshot.enPassantTarget ?? null);
    setGameId(id => id + 1);
  };
  
  // Resign
  const resign = () => {
    setState(prev => ({
      ...prev,
      status: 'resigned',
    }));
  };

  // Clock flag — the side to move ran out of time. A clock only runs for the side whose turn
  // it is, so the flagged side is always the current `turn` (the loser); winner logic mirrors
  // checkmate. Guarded to `playing` so a board result landing in the same tick still wins.
  const flagTimeout = () => {
    setState(prev => (prev.status === 'playing' ? { ...prev, status: 'timeout' } : prev));
  };
  
  return {
    ...state,
    kingSquare,
    gameId,
    enPassantTarget: enPassantTarget ?? undefined,
    legalMovesVectorMap,
    previewSquare,
    previewMoves,
    previewMovesVectorMap,
    previewOpponent,
    clearPreview,
    handleSquareClick,
    makeMove,
    promote,
    resetGame,
    resign,
    flagTimeout,
    loadState,
    promotionOptions: ALL_ARCHETYPES_FOR_PROMOTION,
  };
}
