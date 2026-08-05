// components/game/panels/PlaySettings.tsx — Match configuration shown in the Header "Play" menu.
//
// The set-once controls (Opponent, Clock, Flip, Play As) + the Archetype Guide were moved off
// the board view into the hamburger menu to keep the play surface clean. Prop-light: LocalGame
// owns the state/handlers and passes them in; the Run Dry progress card is injected as a slot.
import type { ReactNode } from 'react';
import type { PieceColor } from '@/types/game';
import type { BotDifficulty } from '@/lib/chess/bot';
import type { UplinkStatus } from '@/hooks/useUplink';
import { RUN_DRY_TIER_LABELS } from '@/hooks/useProtocolRunDry';
import type { TimeControlId } from '@/constants/timeControls';
import { TimeControlSelect } from '@/components/game/TimeControlSelect';
import { BOARD_ANGLES, ANGLE_LABEL, type BoardAngle } from '@/components/board/boardOrientation';
import { OpponentSelect } from './OpponentSelect';

export type OpponentMode = 'offline' | 'protocol-run-dry' | 'uplink' | BotDifficulty;

export interface PlaySettingsProps {
  // Opponent selection
  opponentMode: OpponentMode;
  onOpponentChange: (mode: OpponentMode) => void;
  botActive: boolean;
  activeBotDifficulty: BotDifficulty;
  humanColor: PieceColor;
  // Uplink status line
  isUplink: boolean;
  uplinkStatus: UplinkStatus;
  uplinkRoomCode: string | null;
  myColor: PieceColor;
  opponentName: string | null;
  /** Protocol: Run Dry progress card — shown under the Opponent select for that mode. */
  runDrySlot: ReactNode;
  /** Bots unlocked via Run Dry — passed through to OpponentSelect. */
  unlockedBots: BotDifficulty[];
  /** Open the Sandbox position editor (the dropdown's "Sandbox" entry navigates, not selects). */
  onOpenSandbox: () => void;
  // Match setup
  onColorSwitch: (color: PieceColor) => void;
  timeControlId: TimeControlId;
  onTimeControlChange: (id: TimeControlId) => void;
  /** When true, the clock selector is disabled (e.g. Uplink — networked clock is separate). */
  timeControlDisabled: boolean;
  /** Whether the current Uplink match is a Quick Match (affects clock tooltip). */
  isQuickMatch: boolean;
  /** Current board rotation (0/90/180/270). */
  boardAngle: BoardAngle;
  onSetBoardAngle: (angle: BoardAngle) => void;
  /** Commit the drafted settings and start a new game (asks once if anything changed). */
  onNewGame: () => void;
}

const SELECT_CLASS =
  'w-full py-2.5 px-3 rounded-xl bg-gc-panel-2 ring-1 ring-white/10 text-gc-text font-medium ' +
  'text-[13px] cursor-pointer hover:bg-gc-grid hover:ring-white/20 transition-all focus:outline-none ' +
  'focus:ring-2 focus:ring-gc-accent/70 appearance-none disabled:cursor-not-allowed disabled:opacity-60';

const SELECT_CHEVRON = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238896b0' d='M2 4l4 4 4-4'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
} as const;

export function PlaySettings({
  opponentMode,
  onOpponentChange,
  botActive,
  activeBotDifficulty,
  humanColor,
  isUplink,
  uplinkStatus,
  uplinkRoomCode,
  myColor,
  opponentName,
  runDrySlot,
  unlockedBots,
  onOpenSandbox,
  onColorSwitch,
  timeControlId,
  onTimeControlChange,
  timeControlDisabled,
  isQuickMatch,
  boardAngle,
  onSetBoardAngle,
  onNewGame,
}: PlaySettingsProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Opponent selector */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-gc-text-dim uppercase tracking-widest">Game Mode</span>
        <OpponentSelect
          value={opponentMode}
          onChange={(val) => onOpponentChange(val as OpponentMode)}
          onOpenSandbox={onOpenSandbox}
          unlockedBots={unlockedBots}
        />
        {opponentMode === 'protocol-run-dry' && runDrySlot}
        {botActive && opponentMode !== 'protocol-run-dry' && (
          <p className="text-[11px] text-gc-text-dim/70 italic mt-1">
            You play {humanColor === 'white' ? 'White' : 'Black'} vs {RUN_DRY_TIER_LABELS[activeBotDifficulty].callsign}.
          </p>
        )}
        {isUplink && (
          <p className="text-[11px] text-gc-accent/70 italic mt-1">
            {uplinkStatus === 'connected'
              ? `Connected · vs ${opponentName ?? 'Opponent'} · You play ${myColor === 'white' ? 'White' : 'Black'}${uplinkRoomCode ? ` · Room ${uplinkRoomCode}` : ''}`
              : uplinkStatus === 'waiting'
                ? `Waiting for opponent · Room ${uplinkRoomCode ?? ''}`
                : 'Open or join a room to begin.'}
          </p>
        )}
      </div>

      {/* Clock — optional Rapid time control. Changing it starts a fresh game (a clock can't
          be added fairly mid-game). "No clock" is hidden when the mode forces a clock. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-gc-text-dim uppercase tracking-widest">Clock</span>
        <TimeControlSelect
          value={timeControlId}
          onChange={onTimeControlChange}
          disabled={timeControlDisabled}
          className={SELECT_CLASS}
          style={SELECT_CHEVRON}
          title={timeControlDisabled
            ? (opponentMode === 'protocol-run-dry'
                ? 'Protocol: Run Dry always runs without a clock.'
                : isQuickMatch
                  ? 'Quick Match uses a fixed 10 + 5 Rapid clock.'
                  : 'Clock is set in the Uplink lobby before the match begins.')
            : 'Choose a Rapid time control. Changing it deals a fresh board.'}
        />
        <p className="text-[10px] leading-snug text-gc-text-dim/60">Faster clocks are more chaotic — charges can’t be planned at speed.</p>
      </div>

      {/* Play As — choose your side vs the bot (starts a fresh game). Hidden in
          PvP/Uplink where color is local-symmetric or server-assigned. */}
      {botActive && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-gc-text-dim uppercase tracking-widest">Play As</span>
          <div className="flex rounded-xl bg-gc-panel-2 ring-1 ring-white/10 p-1 gap-1">
            <button
              onClick={() => onColorSwitch('white')}
              className={`
                flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-gc-panel-2
                ${humanColor === 'white'
                  ? 'bg-gc-grid text-gc-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'text-gc-text-dim hover:text-gc-text hover:bg-gc-grid/50'}
              `}
              title="Play the White army (you move first). Starts a new game."
            >
              White
            </button>
            <button
              onClick={() => onColorSwitch('black')}
              className={`
                flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-gc-panel-2
                ${humanColor === 'black'
                  ? 'bg-gc-grid text-gc-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'text-gc-text-dim hover:text-gc-text hover:bg-gc-grid/50'}
              `}
              title="Play the Black army (the bot opens). Starts a new game."
            >
              Black
            </button>
          </div>
        </div>
      )}

      {/* New Game — commit the selected settings (asks once if changed) or re-deal.
          `data-close-menu` opts this commit action into dismissing the panel (adjustment
          controls above deliberately do not), so the fresh board / confirm is unobscured. */}
      <button
        type="button"
        onClick={onNewGame}
        data-close-menu
        disabled={isUplink}
        className={`w-full py-2.5 rounded-xl text-[13px] font-semibold transition-all bg-gc-panel-2 ring-1 ring-gc-accent/60 text-gc-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 disabled:cursor-not-allowed disabled:opacity-60 ${isUplink ? '' : 'hover:bg-gc-grid hover:ring-gc-accent/80 active:scale-[0.98]'}`}
        title={isUplink ? 'Online PvP boards are host-dealt — use Rematch to re-deal.' : 'Start a new game with the selected settings.'}
      >
        ⟳ New Game
      </button>

      {/* Board rotation — a view preference, not part of the New Game setup, so it sits BELOW the
          New Game commit. Splits the old single Flip toggle into four absolute rotations
          (0° / 90° / 180° / 270°), mirroring the Sandbox board-mode control. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-gc-text-dim uppercase tracking-widest">Rotate Board</span>
        <div className="flex rounded-xl bg-gc-panel-2 ring-1 ring-white/10 p-1 gap-1">
          {BOARD_ANGLES.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onSetBoardAngle(a)}
              aria-pressed={boardAngle === a}
              className={`
                flex-1 py-2 rounded-lg text-[13px] font-semibold transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gc-accent/70 focus-visible:ring-offset-1 focus-visible:ring-offset-gc-panel-2
                ${boardAngle === a
                  ? 'bg-gc-grid text-gc-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                  : 'text-gc-text-dim hover:text-gc-text hover:bg-gc-grid/50'}
              `}
              title={a === 0
                ? 'Normal view — White at the bottom.'
                : `Rotate the board ${a}° clockwise.`}
            >
              {ANGLE_LABEL[a]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
