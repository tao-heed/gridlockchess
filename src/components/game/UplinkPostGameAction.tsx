// components/game/UplinkPostGameAction.tsx — Center-card post-game controls for Uplink matches.
//
// Quick Match (isQuickMatch=true):
//   → Leave (accent) — no rematch, find a fresh opponent via matchmaking
//
// Friend Room (isQuickMatch=false):
//   idle        → Resume + Leave (with optional countdown)
//   myPending   → Waiting for opponent… (pulsing label)
//   opponentWants → "Opponent is ready · Resume" + Leave
//   opponentLeft  → "Opponent left" label + Leave
//
// Uses CenterPill for every pill-shaped element so styling stays in one place.

import { CenterPill } from './CenterPill';

interface UplinkPostGameActionProps {
  isQuickMatch: boolean;
  opponentLeft: boolean;
  myRematchPending: boolean;
  opponentWantsRematch: boolean;
  remainingSeconds: number | null;
  onRematch: () => void;
  onLeave: () => void;
}

export function UplinkPostGameAction({
  isQuickMatch,
  opponentLeft,
  myRematchPending,
  opponentWantsRematch,
  remainingSeconds,
  onRematch,
  onLeave,
}: UplinkPostGameActionProps) {
  if (isQuickMatch) {
    return (
      <div className="justify-self-center inline-flex items-center">
        <CenterPill variant="accent" onClick={onLeave}>
          {remainingSeconds != null ? `Leave in ${remainingSeconds}s` : 'Leave'}
        </CenterPill>
      </div>
    );
  }

  if (opponentLeft) {
    return (
      <div className="justify-self-center inline-flex items-center gap-1.5">
        <CenterPill variant="label">Opponent left</CenterPill>
        <CenterPill variant="accent" onClick={onLeave}>Leave</CenterPill>
      </div>
    );
  }

  if (myRematchPending) {
    return (
      <div className="justify-self-center inline-flex items-center">
        <CenterPill variant="label" pulse>
          Waiting for opponent in {remainingSeconds ?? 0}s…
        </CenterPill>
      </div>
    );
  }

  return (
    <div className="justify-self-center inline-flex items-center gap-1.5">
      <CenterPill variant="accent" onClick={onRematch}>
        {opponentWantsRematch ? 'Opponent is ready · Resume' : 'Resume'}
      </CenterPill>
      <CenterPill variant="dim" onClick={onLeave}>
        {remainingSeconds != null ? `Leave in ${remainingSeconds}s` : 'Leave'}
      </CenterPill>
    </div>
  );
}
