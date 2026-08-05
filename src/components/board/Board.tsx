// components/board/Board.tsx — The 8x8 chess board
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Board as BoardType, Square as SquareType, PieceColor, VectorType, VectorPool } from '@/types/game';
import { Square } from './Square';
import { PlayerCard } from '@/components/game/PlayerCard';
import { squareAt, type BoardAngle } from './boardOrientation';

const SCREEN = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** Player info for the card display */
export interface PlayerInfo {
  name: string;
  color: PieceColor;
  isEditable: boolean;
  onNameChange?: (newName: string) => void;
  subtitle?: string;
  /** True while this player (a bot) is computing its move. */
  thinking?: boolean;
  /** Live status shown on the ACTIVE seat only (e.g. "White to move" / "White is in check"). */
  statusText?: string;
  /** Role qualifier paired with statusText (e.g. "Your turn" / "Bot is thinking"). */
  statusRole?: string;
  /** Visual tone for statusText: 'win' (accent), 'danger' (red — check/defeat), 'neutral'. */
  statusTone?: 'neutral' | 'win' | 'danger';
  /** When set, renders a styled clock display (icon + time) instead of the generic status text. */
  clockDisplay?: { time: string; tone: 'danger' | 'neutral' };
  /** Optional context-aware action rendered dead-center of the card (New Game / Resign). */
  centerAction?: ReactNode;
}

/** The subset of BoardProps that switches between playing and review mode.
 *  Construct two objects (playingHighlights, scrubbingHighlights) and spread the active one. */
export type BoardHighlightProps = Pick<BoardProps,
  | 'selectedSquare'
  | 'legalMoves'
  | 'legalMovesVectorMap'
  | 'previewSquare'
  | 'previewMoves'
  | 'previewMovesVectorMap'
  | 'onSquareClick'
  | 'canInteract'
>;

interface BoardProps {
  board: BoardType;
  selectedSquare: SquareType | null;
  legalMoves: SquareType[];
  legalMovesVectorMap?: Map<SquareType, VectorType | null>;
  /** Read-only opponent-piece preview: the inspected enemy square + the squares it can
   *  reach, color-coded by the vector it would spend. Never actionable. */
  previewSquare?: SquareType | null;
  previewMoves?: SquareType[];
  previewMovesVectorMap?: Map<SquareType, VectorType | null>;
  lastMove: { from: SquareType; to: SquareType } | null;
  /** Vector type used in the last move (for anomaly-specific highlight colors). */
  lastMoveVectorType?: VectorType | null;
  /** Faded "before" battery to draw on the origin square of the last Anomaly move. */
  moveGhost?: { square: SquareType; vectors: VectorPool; spentVector: VectorType | null } | null;
  inCheck: boolean;
  turn: PieceColor;
  /** Board view rotation (clockwise from the classic White-at-bottom view). */
  angle: BoardAngle;
  onSquareClick: (square: SquareType) => void;
  kingSquare?: SquareType | null;
  /** Override demo: squares holding a boardable Anomaly target (see GridlockChess.md §6.1). */
  pilotTargets?: Set<SquareType>;
  /** When true, pieces slide between squares on a move; false keeps placement instant (drags). */
  animateMoves?: boolean;
  /** True when the human may act right now (own turn, not the bot's, not scrubbing). Gates which
   *  pieces are draggable so enemy/idle pieces can't start a phantom drag that hides them. */
  canInteract?: boolean;
  /** Square holding the checkmated King — plays the defeat animation. */
  defeatedSquare?: SquareType | null;
  /** Player at top of board (opponent from current perspective). Always top — unaffected by
   *  board rotation, which turns only the 8×8 grid + pieces. */
  topPlayer?: PlayerInfo;
  /** Player at bottom of board (self from current perspective). Always bottom. */
  bottomPlayer?: PlayerInfo;
}

export function Board({
  board,
  selectedSquare,
  legalMoves,
  legalMovesVectorMap,
  previewSquare,
  previewMoves = [],
  previewMovesVectorMap,
  lastMove,
  lastMoveVectorType,
  moveGhost,
  inCheck,
  turn,
  angle,
  onSquareClick,
  kingSquare,
  pilotTargets,
  animateMoves = true,
  canInteract = true,
  defeatedSquare,
  topPlayer,
  bottomPlayer,
}: BoardProps) {
  // Wall-clock ms at which anomalies should reach peak float height: this board's mount
  // time + 1s. The Board is keyed by gameId in LocalGame, so it remounts on every new
  // game/restart — this initializer therefore re-arms per game while staying stable across
  // in-game re-renders. Passed to each Piece so the rise survives per-move piece remounts.
  const [floatSettleAt] = useState(() => Date.now() + 1000);

  const renderCard = (info: PlayerInfo, position: 'top' | 'bottom') => (
    <div className="px-3">
      <PlayerCard
        name={info.name}
        color={info.color}
        isEditable={info.isEditable}
        onNameChange={info.onNameChange}
        subtitle={info.subtitle}
        isActive={turn === info.color}
        thinking={info.thinking}
        statusText={info.statusText}
        statusRole={info.statusRole}
        statusTone={info.statusTone}
        clockDisplay={info.clockDisplay}
        centerAction={info.centerAction}
        position={position}
      />
    </div>
  );

  return (
    <div className="w-full">
      {/* Player cards stay top/bottom and upright in every rotation — only the grid below turns. */}
      {topPlayer && renderCard(topPlayer, 'top')}

      {/* Full-bleed board — edge-to-edge, no coordinate gutters, no card wrapper (mobile-first RPG
          feel). `angle` rotates ONLY this grid + its pieces, via a square remap (pieces stay upright
          and readable). */}
      <div className="grid grid-cols-8 grid-rows-8 w-full aspect-square select-none">
        {SCREEN.map((row) =>
          SCREEN.map((col) => {
            const square = squareAt(angle, row, col);
            const piece = board[square];
            const isSelected = selectedSquare === square;
            const isLegalMove = legalMoves.includes(square);
            const isLastMoveFrom = lastMove?.from === square;
            const isLastMoveTo = lastMove?.to === square;
            const isKingInCheck = inCheck && square === kingSquare;
            const moveVectorType = legalMovesVectorMap?.get(square);
            const isPreviewSelected = previewSquare === square;
            const isPreviewMove = previewMoves.includes(square);
            const previewVectorType = previewMovesVectorMap?.get(square) ?? null;
            const ghost = moveGhost && moveGhost.square === square
              ? { vectors: moveGhost.vectors, spentVector: moveGhost.spentVector }
              : null;

            return (
              <Square
                key={square}
                square={square}
                piece={piece}
                isSelected={isSelected}
                isLegalMove={isLegalMove}
                moveVectorType={moveVectorType}
                isPreviewSelected={isPreviewSelected}
                isPreviewMove={isPreviewMove}
                previewVectorType={previewVectorType}
                isLastMoveFrom={isLastMoveFrom}
                isLastMoveTo={isLastMoveTo}
                lastMoveVectorType={lastMoveVectorType}
                isInCheck={isKingInCheck}
                isPilotTarget={pilotTargets?.has(square)}
                animateMove={animateMoves}
                isDefeated={defeatedSquare === square}
                ghost={ghost}
                floatSettleAt={floatSettleAt}
                isDraggable={!!piece && piece.color === turn && canInteract}
                onClick={() => onSquareClick(square)}
              />
            );
          }),
        )}
      </div>

      {bottomPlayer && renderCard(bottomPlayer, 'bottom')}
    </div>
  );
}

export { Board as default };
