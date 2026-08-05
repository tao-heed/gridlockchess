// components/game/sandbox/SandboxToolbar.tsx — opponent config for the Sandbox (Pass & Play vs bot).
//
// `botDifficulty === null` means Pass & Play (two humans share the device, Offline PvP from the
// built position). Otherwise the bot plays the OTHER side from `humanColor`.
// Lock state mirrors OpponentSelect: bots are unlocked via Protocol: Run Dry progress.
import type { PieceColor } from '@/types/game';
import type { BotDifficulty } from '@/lib/chess/bot';
import { BotLevelSelect } from './BotLevelSelect';

export const DEFAULT_BOT_TIER: BotDifficulty = 'basic_1';

const SEG_BTN = (active: boolean) =>
  `rounded-md px-3 py-1 text-[12px] font-semibold capitalize transition-colors ${
    active ? 'bg-gc-accent/20 text-gc-text' : 'text-gc-text-dim hover:text-gc-text'
  }`;

export interface SandboxToolbarProps {
  botDifficulty: BotDifficulty | null;
  onSetBot: (d: BotDifficulty | null) => void;
  humanColor: PieceColor;
  onSetHumanColor: (c: PieceColor) => void;
  turn: PieceColor;
  onSetTurn: (c: PieceColor) => void;
  /** Both-Bots: two bots of the selected level play each other (White vs Black). */
  bothBots: boolean;
  onSetBothBots: (v: boolean) => void;
  /** Bots unlocked via Run Dry — passed through to BotLevelSelect. */
  unlockedBots: BotDifficulty[];
}

export function SandboxToolbar({ botDifficulty, onSetBot, humanColor, onSetHumanColor, turn, onSetTurn, bothBots, onSetBothBots, unlockedBots }: SandboxToolbarProps) {
  const isBot = botDifficulty !== null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-gc-text-dim">Opponent</span>
          <div className="inline-flex rounded-lg bg-gc-panel-2 p-0.5 ring-1 ring-white/10">
            <button type="button" onClick={() => onSetBot(null)} aria-pressed={!isBot} className={SEG_BTN(!isBot)}>
              Pass & Play
            </button>
            <button
              type="button"
              onClick={() => onSetBot(botDifficulty ?? DEFAULT_BOT_TIER)}
              aria-pressed={isBot}
              className={SEG_BTN(isBot)}
            >
              vs Bot
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-gc-text-dim">To move</span>
          <div className="inline-flex rounded-lg bg-gc-panel-2 p-0.5 ring-1 ring-white/10">
            {(['white', 'black'] as const).map((c) => (
              <button key={c} type="button" onClick={() => onSetTurn(c)} aria-pressed={turn === c} className={SEG_BTN(turn === c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isBot && (
        <div className="flex flex-wrap items-start gap-3">
          <BotLevelSelect value={botDifficulty ?? DEFAULT_BOT_TIER} onChange={onSetBot} unlockedBots={unlockedBots} />
          <div className="inline-flex rounded-lg bg-gc-panel-2 p-0.5 ring-1 ring-white/10">
            {(['white', 'black'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { onSetBothBots(false); onSetHumanColor(c); }}
                aria-pressed={!bothBots && humanColor === c}
                className={SEG_BTN(!bothBots && humanColor === c)}
              >
                You: {c}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onSetBothBots(true)}
              aria-pressed={bothBots}
              className={SEG_BTN(bothBots)}
            >
              Both: Bots
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
