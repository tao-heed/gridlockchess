// components/game/panels/GameInfoPanel.tsx — Left rail: live game state (battery / coach / history)
//
// Pure presentation. The clock sits at the top; below it a swipeable PanelDeck loops the three
// tall panels (Vector Battery / Coach / Move History) into ONE compact, board-adjacent surface so
// the board stays in view without a long scroll.
import type { ReactNode } from 'react';
import { panelStack } from '@/constants/ui';
import type { Piece, PieceColor } from '@/types/game';
// Direct relative imports (not the barrel): these leaves are siblings, and pulling them
// through ./index would create a parent↔child cycle (index re-exports this rail).
import { VectorLegend, type VectorCharges } from './VectorLegend';
import { MoveHistoryPanel } from './MoveHistoryPanel';
import { CapturedPiecesPanel } from './CapturedPiecesPanel';
import { PanelDeck } from './PanelDeck';

export interface GameInfoPanelProps {
  /** Live Vector Battery meter — summed remaining charges of BOTH armies' Anomalies. */
  vectorCharges: VectorCharges;
  /** Game identity — bumps on New Game / import / resume so the battery meter re-baselines
   *  its depletion tracking instead of misreading the fresh army as a spend. */
  gameId: number;
  viewPly: number | null;
  plyCount: number;
  onSeek: (ply: number) => void;
  getReplayJson: () => string;
  onImportReplay: (json: string, fileName: string) => void;
  /** Save the game (up to the viewed ply) as a ⏪ replay in the Sandbox library. */
  onSaveGameplay?: (ply: number) => void;
  /** Bump to jump the deck to the Replay panel (set when a recorded game is loaded). */
  replayFocusSignal?: number;
  /** Optional twin-clock, pinned above the swipe deck. */
  clockSlot?: ReactNode;
  /** The live Coach rail — cycled alongside Battery + History inside the deck. */
  coachSlot: ReactNode;
  /** Both sides' captured pieces (each color's array = what THAT side has taken). */
  capturedPieces: { white: Piece[]; black: Piece[] };
  /** True vs a bot — flips the captured labels to "You took" / "Opponent took". */
  botActive: boolean;
  /** Which side the local human plays (picks the "You took" row when botActive). */
  humanColor: PieceColor;
}

export function GameInfoPanel({
  vectorCharges,
  gameId,
  viewPly,
  plyCount,
  onSeek,
  getReplayJson,
  onImportReplay,
  clockSlot,
  coachSlot,
  capturedPieces,
  botActive,
  humanColor,
  onSaveGameplay,
  replayFocusSignal,
}: GameInfoPanelProps) {
  return (
    <aside className={`w-full ${panelStack}`}>
      {/* Clock — both sides together, pinned above the deck (not part of the cycle). */}
      {clockSlot}

      {/* Swipe deck — Charge → Captured → Replay → Coach (loops). One visible at a time. */}
      <PanelDeck
        replayKey={gameId}
        replayFocusSignal={replayFocusSignal}
        panels={[
          {
            id: 'battery',
            label: 'Charge',
            content: <VectorLegend charges={vectorCharges} resetKey={gameId} />,
          },
          {
            id: 'captured',
            label: 'Captured',
            content: (
              <CapturedPiecesPanel
                capturedPieces={capturedPieces}
                botActive={botActive}
                humanColor={humanColor}
              />
            ),
          },
          {
            id: 'history',
            label: 'Replay',
            content: (
              <MoveHistoryPanel
                viewPly={viewPly}
                plyCount={plyCount}
                onSeek={onSeek}
                getReplayJson={getReplayJson}
                onImportReplay={onImportReplay}
                onSaveGameplay={onSaveGameplay}
              />
            ),
          },
          { id: 'coach', label: 'Coach', content: coachSlot },
        ]}
      />
    </aside>
  );
}
