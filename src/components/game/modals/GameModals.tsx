// components/game/modals/GameModals.tsx — All overlay dialogs for the local game screen
//
// Presentational shell that owns the modal stack: the end-of-game result, the Run Dry
// completion card, and every confirmation dialog (import, resign, restart, switch side,
// leave Uplink) plus the Uplink lobby. The end-modal's subtitle/actions branching lives
// here so LocalGame's render stays a thin orchestration layer.
import type { PieceColor, GameStatus, DrawReason } from '@/types/game';
import type { UplinkApi } from '@/hooks/useUplink';
import type { UseProtocolRunDryReturn } from '@/hooks/useProtocolRunDry';
import { GameEndModal, type GameEndType, type GameEndAction } from './GameEndModal';
import { ConfirmModal } from './ConfirmModal';
import { ProtocolRunDryModal } from './ProtocolRunDryModal';
import { UplinkModal } from './UplinkModal';
import type { OpponentMode } from '@/components/game/panels';
import type { TimeControlId } from '@/constants/timeControls';
import type { QuickMatchApi } from '@/hooks/useQuickMatch';

export interface GameModalsProps {
  // Game-end result modal
  endModalOpen: boolean;
  endModalType: GameEndType;
  endModalWinner: string | null;
  isUplink: boolean;
  opponentLeft: boolean;
  isQuickMatch: boolean;
  status: GameStatus;
  drawReason: DrawReason;
  opponentMode: OpponentMode;
  totalMoves: number;
  onPlayAgain: () => void;
  onNextTier: () => void;
  onViewBoard: () => void;
  onLeaveUplink: () => void;
  // Shared hook state
  runDry: UseProtocolRunDryReturn;
  uplink: UplinkApi;
  // Run Dry completion — single dismiss (reveals the final board)
  onRunDryReview: () => void;
  // Import replay
  pendingImport: { fileName: string; plies: number } | null;
  onConfirmImport: () => void;
  onCancelImport: () => void;
  importError: string | null;
  onClearImportError: () => void;
  // Resign
  showResignConfirm: boolean;
  resignTurn: PieceColor;
  onConfirmResign: () => void;
  onCancelResign: () => void;
  // Run Dry restart
  showRunDryRestartConfirm: boolean;
  onConfirmRunDryRestart: () => void;
  onCancelRunDryRestart: () => void;
  // New Game (consolidated abandon-and-start confirm — replaces the per-setting dialogs)
  showNewGameConfirm: boolean;
  newGameConfirmMessage: string;
  onConfirmNewGame: () => void;
  onCancelNewGame: () => void;
  // Leave Uplink
  pendingUplinkLeave: OpponentMode | null;
  onConfirmUplinkLeave: () => void;
  onCancelUplinkLeave: () => void;
  // Uplink lobby
  uplinkOpen: boolean;
  uplinkOnlineCount: number;
  uplinkTimeControlId: TimeControlId;
  onUplinkTimeControlChange: (id: TimeControlId) => void;
  onUplinkModalLeave: () => void;
  onUplinkModalClose: () => void;
  quickMatch: QuickMatchApi;
}

export function GameModals({
  endModalOpen,
  endModalType,
  endModalWinner,
  isUplink,
  opponentLeft,
  isQuickMatch,
  status,
  drawReason,
  opponentMode,
  totalMoves,
  onPlayAgain,
  onNextTier,
  onViewBoard,
  onLeaveUplink,
  runDry,
  uplink,
  onRunDryReview,
  pendingImport,
  onConfirmImport,
  onCancelImport,
  importError,
  onClearImportError,
  showResignConfirm,
  resignTurn,
  onConfirmResign,
  onCancelResign,
  showRunDryRestartConfirm,
  onConfirmRunDryRestart,
  onCancelRunDryRestart,
  showNewGameConfirm,
  newGameConfirmMessage,
  onConfirmNewGame,
  onCancelNewGame,
  pendingUplinkLeave,
  onConfirmUplinkLeave,
  onCancelUplinkLeave,
  uplinkOpen,
  uplinkOnlineCount,
  onUplinkModalLeave,
  onUplinkModalClose,
  uplinkTimeControlId,
  onUplinkTimeControlChange,
  quickMatch,
}: GameModalsProps) {
  // End-modal subtitle — describes the precise loss/draw cause. Uplink abandonment and
  // each draw reason get bespoke copy; everything else falls through to the modal default.
  const endSubtitle =
    isUplink && opponentLeft
      ? 'Your opponent left. There is no rematch — leave to continue.'
      : status === 'gridlock-death'
        ? "The Piloted Anomaly spent its last charge. The King is sealed in a Gridlocked bunker — instant loss."
        : status === 'draw'
          ? drawReason === 'repetition'
            ? 'The same position — placement, charges, and en passant — repeated three times. A frozen war of attrition.'
            : drawReason === 'gridlock'
              ? 'Total Gridlock: every Anomaly is depleted and no pawn can advance. The board is permanently paralyzed.'
              : drawReason === 'fifty-move'
                ? 'Fifty moves passed with no pawn move, capture, or charge spent. The King-and-pawn endgame stalled out.'
                : undefined
          : undefined;

  // End-modal actions — Uplink rematch/leave, Run Dry next/retry, or the plain rematch row.
  // Quick Match hides Rematch: players should Quick Match again for a new random opponent.
  const endActions: GameEndAction[] = isUplink
    ? opponentLeft || isQuickMatch
      ? [{ label: 'Leave', icon: '🚪', onClick: onLeaveUplink, variant: 'primary' }]
      : [{ label: 'View Board', icon: '🔍', onClick: onViewBoard, variant: 'primary' }]
    : opponentMode === 'protocol-run-dry'
      ? runDry.lastResult === 'win'
        ? [
            { label: 'Next Level', icon: '🪫', onClick: onNextTier, variant: 'primary' },
            { label: 'View Board', icon: '🔍', onClick: onViewBoard, variant: 'secondary' },
          ]
        : [
            { label: 'Retry Tier', icon: '🔄', onClick: onPlayAgain, variant: 'primary' },
            { label: 'View Board', icon: '🔍', onClick: onViewBoard, variant: 'secondary' },
          ]
      : [
          { label: 'Play Again', icon: '🔄', onClick: onPlayAgain, variant: 'primary' },
          { label: 'View Board', icon: '🔍', onClick: onViewBoard, variant: 'secondary' },
        ];

  return (
    <>
      {/* Game End Modal */}
      <GameEndModal
        type={endModalType}
        winner={endModalWinner}
        subtitle={endSubtitle}
        isOpen={endModalOpen}
        stats={{ totalMoves }}
        actions={endActions}
      />

      {/* Protocol: Run Dry — Completion Modal */}
      <ProtocolRunDryModal
        isOpen={runDry.showComplete}
        progress={runDry.progress}
        onClose={onRunDryReview}
      />

      {/* Import Replay Confirmation Modal */}
      <ConfirmModal
        isOpen={pendingImport !== null}
        title="Load this replay?"
        message={pendingImport
          ? `Importing \u201C${pendingImport.fileName}\u201D (${pendingImport.plies} move${pendingImport.plies === 1 ? '' : 's'}) replaces the current board with its final position. This ends the current game and switches to Offline play.`
          : ''}
        icon="⬆"
        confirmLabel="Load Replay"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={onConfirmImport}
        onCancel={onCancelImport}
      />

      {/* Import Error Modal */}
      <ConfirmModal
        isOpen={importError !== null}
        title="Couldn’t load replay"
        message={importError ?? ''}
        icon="⚠️"
        confirmLabel="OK"
        cancelLabel="Close"
        variant="neutral"
        onConfirm={onClearImportError}
        onCancel={onClearImportError}
      />

      {/* Resign Confirmation Modal */}
      <ConfirmModal
        isOpen={showResignConfirm}
        title="Resign Game?"
        message={isUplink
          ? 'You will forfeit this match. Your opponent wins.'
          : `${resignTurn === 'white' ? 'White' : 'Black'} will forfeit. ${resignTurn === 'white' ? 'Black' : 'White'} wins.`}
        icon="🏳️"
        confirmLabel="Resign"
        cancelLabel="Keep Playing"
        variant="danger"
        onConfirm={onConfirmResign}
        onCancel={onCancelResign}
      />

      {/* Protocol: Run Dry — Restart Run Confirmation Modal */}
      <ConfirmModal
        isOpen={showRunDryRestartConfirm}
        title="Restart from Level 1?"
        message="Your progress will reset to Level 1. Your best streak is kept. This starts a fresh game."
        icon="🪫"
        confirmLabel="Restart"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={onConfirmRunDryRestart}
        onCancel={onCancelRunDryRestart}
      />

      {/* New Game — the single consolidated confirm. Opens from the Play menu's "New Game"
          only when the opponent / clock / Play-As draft differs from the running game;
          abandoning it starts fresh with the chosen settings. */}
      <ConfirmModal
        isOpen={showNewGameConfirm}
        title="Start a new game?"
        message={newGameConfirmMessage}
        icon="⟳"
        confirmLabel="Abandon & Start"
        cancelLabel="Keep Playing"
        variant="warning"
        onConfirm={onConfirmNewGame}
        onCancel={onCancelNewGame}
      />

      {/* Leave Live Uplink Match Confirmation Modal — opens when the player picks another
          opponent mode mid-match. Switching away forfeits the game to the opponent. */}
      <ConfirmModal
        isOpen={pendingUplinkLeave !== null}
        title="Leave the Uplink Match?"
        message="You're in a live Uplink match. Leaving forfeits the game — your opponent wins. You'll continue in the mode you picked with a fresh game."
        icon="🚪"
        confirmLabel="Resign & Leave Uplink"
        cancelLabel="Stay in the Game"
        variant="danger"
        onConfirm={onConfirmUplinkLeave}
        onCancel={onCancelUplinkLeave}
      />

      <UplinkModal
        isOpen={uplinkOpen}
        status={uplink.status}
        role={uplink.role}
        roomCode={uplink.roomCode}
        error={uplink.error}
        onlineCount={uplinkOnlineCount}
        timeControlId={uplinkTimeControlId}
        onTimeControlChange={onUplinkTimeControlChange}
        onHost={uplink.host}
        onJoin={uplink.join}
        onRejoin={uplink.rejoin}
        onLeave={onUplinkModalLeave}
        onClose={onUplinkModalClose}
        quickMatch={quickMatch}
      />
    </>
  );
}
