// components/game/panels/index.ts — Barrel export for panel components
//
// Re-exports all panel components for clean imports.

export { VectorLegend } from './VectorLegend';
export { ArchetypeGuide } from './ArchetypeGuide';
export { ClockPanel, type ClockPanelProps, type ClockRow } from './ClockPanel';
export { MoveHistoryPanel, type MoveHistoryPanelProps } from './MoveHistoryPanel';
export { CapturedPiecesPanel, type CapturedPiecesPanelProps } from './CapturedPiecesPanel';

// Composite rails + the contextual Coach leaf (co-located so all panel UI lives here).
export { GameInfoPanel, type GameInfoPanelProps } from './GameInfoPanel';
export { PanelDeck, type DeckPanel } from './PanelDeck';
export { PlaySettings, type PlaySettingsProps, type OpponentMode } from './PlaySettings';
export { CoachPanel, type MatchContext } from './CoachPanel';
