// components/game/modals/index.ts — Barrel export for the overlay dialog stack.
//
// External code imports modals through this barrel (mirrors panels/index.ts). The modals
// import each other via direct relative paths, never through here, to avoid a barrel
// self-cycle (this file re-exports GameModals, which composes its siblings).

export { GameModals, type GameModalsProps } from './GameModals';
export {
  GameEndModal,
  type GameEndType,
  type GameEndAction,
  type GameStats,
  type GameEndModalProps,
} from './GameEndModal';
export { ConfirmModal, type ConfirmModalProps } from './ConfirmModal';
export { NamePromptModal, type NamePromptModalProps } from './NamePromptModal';
export {
  ProtocolRunDryModal,
  type ProtocolRunDryModalProps,
  ProtocolRunDryPanel,
  type ProtocolRunDryPanelProps,
} from './ProtocolRunDryModal';
export { UplinkModal, type UplinkModalProps } from './UplinkModal';
export {
  WelcomeModal,
  type WelcomeModalProps,
  WelcomeProvider,
  useWelcome,
  useFirstRunWelcome,
} from './WelcomeModal';
