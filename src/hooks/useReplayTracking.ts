// hooks/useReplayTracking.ts — Move history, replay construction, and board scrubbing.
// Extracted from LocalGame.tsx (Phase 2C of LocalGame_Modular_Extraction_Plan.md).

import { useState, useEffect, useRef } from 'react';
import type { RefObject, MutableRefObject, Dispatch, SetStateAction } from 'react';
import type { Board, PieceColor, Square, VectorType, MoveHistoryEntry, DrawReason } from '@/types/game';
import type { GenerationMode } from '@/lib/chess/generator';
import type { GridlockMove, GridlockReplay, GridlockPosition, ReplayState } from '@/lib/chess/format';
import { serializePosition, replayTo, REPLAY_VERSION, gameOutcome } from '@/lib/chess/format';
import { isInCheck, findKing } from '@/lib/chess/check';
import { saveGameplayReplay } from '@/lib/chess/sandbox/savedPositions';
import type { SaveResult } from '@/lib/chess/sandbox/savedPositions';

export interface ReplayTrackingReturn {
  moveHistory: MoveHistoryEntry[];
  replayMoves: GridlockMove[];
  viewPly: number | null;
  replay: GridlockReplay | null;
  isScrubbing: boolean;
  scrubState: ReplayState | null;
  displayBoard: Board;
  displayTurn: PieceColor;
  displayInCheck: boolean;
  displayKingSquare: Square | null;
  displayDefeatedSquare: Square | null;
  displayLastMove: { from: Square; to: Square } | null;
  displayLastMoveVectorType: VectorType | null;
  saveGameplayPly: number | null;
  saveGameplayError: string | null;
  startPosRef: RefObject<GridlockPosition | null>;
  replayStateRef: MutableRefObject<ReplayState | null>;
  pendingImportLoadRef: MutableRefObject<GridlockReplay | null>;
  /** Set the pending import ref so the gameId effect preserves the replay's start + moves. */
  loadPendingReplay: (r: GridlockReplay) => void;
  setMoveHistory: Dispatch<SetStateAction<MoveHistoryEntry[]>>;
  setReplayMoves: Dispatch<SetStateAction<GridlockMove[]>>;
  setViewPly: Dispatch<SetStateAction<number | null>>;
  setSaveGameplayPly: Dispatch<SetStateAction<number | null>>;
  setSaveGameplayError: Dispatch<SetStateAction<string | null>>;
  /** Clamp + update viewPly. Pass ply = replayMoves.length to snap back to the present. */
  seekPly: (ply: number) => void;
  handleSaveGameplay: (name: string) => void;
}

export function useReplayTracking(params: {
  board: Board;
  turn: PieceColor;
  inCheck: boolean;
  kingSquare: Square | null;
  enPassantTarget: Square | undefined;
  // For replay meta construction
  generationMode: GenerationMode;
  playerName: string;
  player2Name: string;
  status: string;        // display status (statusForReveal) — used in replay outcome
  drawReason: DrawReason;
  // For display derived values
  lastMove: { from: Square; to: Square } | null;
  lastVectorSpend: { vector: VectorType } | null;
  defeatedSquare: Square | null;
  gameId: number;
}): ReplayTrackingReturn {
  const {
    board, turn, inCheck, kingSquare, enPassantTarget,
    generationMode, playerName, player2Name, status, drawReason,
    lastMove, lastVectorSpend, defeatedSquare, gameId,
  } = params;

  const [moveHistory, setMoveHistory] = useState<MoveHistoryEntry[]>([]);
  // Portable replay capture: the start position (lossless GridlockPosition) plus every
  // applied move as {from,to}. Per-move state (charges, captures, gridlock) is derived on
  // rewind, so we only record the two squares. Used for ◀▶ scrubbing and Copy → JSON.
  const startPosRef = useRef<GridlockPosition | null>(null);
  const [replayMoves, setReplayMoves] = useState<GridlockMove[]>([]);
  // Live incremental reconstruction: the replay engine state AFTER the last recorded move.
  // The move effect advances this one ply at a time (O(1)) via the same `deriveMoveInfo`
  // primitive `buildMoveLog` uses, so the live log matches a replayed one without walking
  // the whole game on every move. Re-seeded by the gameId effect on new game/import/resume.
  const replayStateRef = useRef<ReplayState | null>(null);
  // Carries an imported replay through the gameId effect so its start + moves survive the
  // load (otherwise the snapshot effect would overwrite them with the loaded board).
  const pendingImportLoadRef = useRef<GridlockReplay | null>(null);
  // null = live game; a number = read-only view of the board at that ply (0 = start).
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [saveGameplayPly, setSaveGameplayPly] = useState<number | null>(null);
  const [saveGameplayError, setSaveGameplayError] = useState<string | null>(null);

  // New game (gameId changes) → snapshot the lossless start position and clear the replay.
  // Captured before any move, so it's the true initial board (fullmove 1, clock 0).
  // Exception: an import carries its own start + move list, preserved so the whole game
  // stays scrubbable instead of collapsing to the loaded final board.
  //
  // NOTE: `board`, `turn`, `enPassantTarget` are intentionally excluded from the dep array —
  // we only want this to run on a new game (gameId bump), not on every move.
  useEffect(() => {
    const imported = pendingImportLoadRef.current;
    pendingImportLoadRef.current = null;
    if (imported) {
      startPosRef.current = imported.start;
      setReplayMoves(imported.moves);
      // Seed the incremental cursor at the END of the imported game so a resumed/continued
      // move appends correctly. replayTo walks all moves once (one-time load cost).
      replayStateRef.current = replayTo(imported);
    } else {
      const startPos = serializePosition(board, turn, enPassantTarget ?? null, 0, 1);
      startPosRef.current = startPos;
      setReplayMoves([]);
      // Fresh game: cursor sits at the initial position (ply 0), ready for the first move.
      replayStateRef.current = replayTo({ v: REPLAY_VERSION, meta: {}, start: startPos, moves: [] }, 0);
    }
    setViewPly(null);
  }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed values ────────────────────────────────────────────────────────

  const replay: GridlockReplay | null = startPosRef.current
    ? {
        v: REPLAY_VERSION,
        meta: {
          generationMode,
          players: { white: playerName, black: player2Name },
          ...(replayMoves.length > 0 ? gameOutcome(status as Parameters<typeof gameOutcome>[0], drawReason, turn) : {}),
        },
        start: startPosRef.current,
        moves: replayMoves,
      }
    : null;

  const isScrubbing = viewPly !== null && replay !== null;
  // When scrubbing, re-derive the board at the chosen ply through the rules engine.
  const scrubState = isScrubbing ? replayTo(replay, viewPly) : null;
  const displayBoard = scrubState ? scrubState.board : board;
  const displayLastMove = scrubState && viewPly !== null
    ? viewPly > 0 ? { from: replayMoves[viewPly - 1]!.from, to: replayMoves[viewPly - 1]!.to } : null
    : lastMove;
  const displayLastMoveVectorType: VectorType | null = scrubState && viewPly !== null
    ? viewPly > 0 ? (moveHistory[viewPly - 1]?.vector ?? null) : null
    : (lastVectorSpend?.vector ?? null);
  // Check / king / defeat / turn highlights must follow the SCRUBBED position, not the
  // live terminal one. Without this, rewinding a finished game leaves the mating square
  // glowing red and the toppled King frozen wherever the game ended.
  const displayTurn = scrubState ? scrubState.turn : turn;
  const displayInCheck = scrubState ? isInCheck(scrubState.board, scrubState.turn) : inCheck;
  const displayKingSquare = scrubState ? findKing(scrubState.board, scrubState.turn) : kingSquare;
  const displayDefeatedSquare = scrubState
    ? scrubState.status === 'checkmate'
      ? findKing(scrubState.board, scrubState.turn)
      : scrubState.status === 'gridlock-death'
        ? findKing(scrubState.board, scrubState.turn === 'white' ? 'black' : 'white')
        : null
    : defeatedSquare;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const loadPendingReplay = (r: GridlockReplay) => { pendingImportLoadRef.current = r; };

  const seekPly = (ply: number) => {
    const clamped = Math.max(0, Math.min(ply, replayMoves.length));
    setViewPly(clamped >= replayMoves.length ? null : clamped);
  };

  const handleSaveGameplay = (name: string) => {
    if (saveGameplayPly === null || !replay) { setSaveGameplayPly(null); return; }
    const truncated: GridlockReplay = { ...replay, moves: replay.moves.slice(0, saveGameplayPly) };
    const res: SaveResult = saveGameplayReplay(name, truncated, truncated.moves.length);
    if (res.ok) { setSaveGameplayPly(null); setSaveGameplayError(null); }
    else setSaveGameplayError(
      res.reason === 'empty' ? 'Nothing to save yet \u2014 make a move first.'
        : res.reason === 'full' ? `Sandbox library is full (${res.list.length}) \u2014 delete one there first.`
          : 'Couldn\u2019t save \u2014 storage unavailable.',
    );
  };

  return {
    moveHistory,
    replayMoves,
    viewPly,
    replay,
    isScrubbing,
    scrubState,
    displayBoard,
    displayTurn,
    displayInCheck,
    displayKingSquare,
    displayDefeatedSquare,
    displayLastMove,
    displayLastMoveVectorType,
    saveGameplayPly,
    saveGameplayError,
    startPosRef,
    replayStateRef,
    pendingImportLoadRef,
    loadPendingReplay,
    setMoveHistory,
    setReplayMoves,
    setViewPly,
    setSaveGameplayPly,
    setSaveGameplayError,
    seekPly,
    handleSaveGameplay,
  };
}
