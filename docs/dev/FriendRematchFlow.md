# Plan: Friend Room Rematch Flow Redesign

## Overview

Replace the current single-click rematch (one player clicks → game immediately restarts) with a
two-sided mutual confirmation flow. Both players must opt in before the board resets. This prevents
the jarring experience of the board resetting under a player who was still reviewing it.

Applies only to **friend rooms** (`isQuickMatch === false`). Quick Match keeps its existing
"Leave"-only flow unchanged.

---

## Word Choices

| Old | New | Why |
|-----|-----|-----|
| `Leave Uplink` | **Leave** | Shorter, friendlier, industry standard (Lichess, Chess.com) |
| *(primary action)* | **View Board** | Lets players review the position without exiting |
| *(none)* | **Rematch** | Unchanged — already clear |
| *(none)* | **Waiting for [name]…** | Personalised with opponent's display name; falls back to "Waiting for opponent…" if name unknown |

Also update the hardcoded `endSubtitle` in `GameModals.tsx` line 128:
`'Your opponent left the Uplink. There is no rematch — exit to continue.'`
→ `'Your opponent left. There is no rematch — leave to continue.'`

---

## UI State Machine (friend room only)

```
GAME ENDS
    │
    ▼
┌─────────────────────────────────────┐
│  [View Board]  [Rematch]  [Leave]   │  ← idle (neither side has clicked)
└─────────────────────────────────────┘
         │                    │
   I click Rematch      I click Leave
         │                    │
         ▼                    ▼
┌──────────────────────────┐  disconnect
│  [View Board]            │
│  ⏳ Waiting for name…    │  ← myRematchPending (status text, NOT a button)
│  [Leave]                 │
└──────────────────────────┘
         │
  opponent clicks Rematch
  (their signal arrives)
         │
         ▼
  ┌──────────────┐
  │  Board resets │  ← both confirmed → new game
  │  Modal closes │
  │  🏳️ returns  │
  └──────────────┘
```

```
OPPONENT CLICKS REMATCH FIRST (their signal arrives while idle)
    │
    ▼
┌────────────────────────────────────────────┐
│  [View Board]                              │
│  [🔄 Rematch · name is ready]  ← accented │  ← opponentWantsRematch
│  [Leave]                                   │
└────────────────────────────────────────────┘
         │
   I click Rematch (my signal sent)
         │
         ▼
  ┌──────────────┐
  │  Board resets │  ← both signals exchanged → new game
  │  Modal closes │
  │  🏳️ returns  │
  └──────────────┘
```

### View Board → Replay

Clicking "View Board" only dismisses the end-modal overlay (`setEndModalDismissed(true)`). The
board, PanelDeck, and Replay timeline remain fully visible underneath. The game already auto-
switches PanelDeck to the Replay tab when the game ends (`useEffect` on `isGameOver` bumps
`replayFocusSignal` — `LocalGame.tsx` lines 1008–1012), so the move history scrub controls are
already active. Both players can step through every move while deciding whether to rematch.

### Rematch limit

**Unlimited.** There is no rematch counter or cap anywhere in the protocol or client. Each
rematch re-rolls colors, generates a fresh board, and resets all tracking. Both players can
rematch as many times as they want within the same room session.

### Edge: View Board while waiting

If Player A clicks "View Board" to dismiss the modal while their rematch request is pending:
- The waiting state (`myRematchPendingRef`) persists in the hook — it is NOT cancelled.
- If Player B then clicks Rematch (their signal arrives via `onRematch`), the handler sees
  `myRematchPendingRef.current === true` → starts the new game immediately.
- The modal re-opens via `setEndModalDismissed(false)` inside `startNewGame()`, which the existing
  `pendingInit` → `state-init` flow already handles (guest's `onStateInit` calls
  `setEndModalDismissed(false)`; host's `resetGame()` triggers the same path).

If Player A has dismissed the modal and Player B's rematch signal arrives while
`myRematchPendingRef.current === false` (A never clicked Rematch):
- `onRematch` sets `opponentWantsRematch = true` AND calls `setEndModalDismissed(false)` to
  re-open the modal, now showing the "name is ready · Rematch" button.

### Edge: Opponent leaves while I'm waiting

- `onPeerLeft` fires → sets `opponentLeft = true`, clears `opponentName`.
- The `opponentLeft` branch in the end-modal actions takes priority, showing only `[Leave]`.
- `myRematchPending` and `opponentWantsRematch` are cleared by `onPeerLeft` as well.

### Edge: Simultaneous click (both click Rematch at ~same time)

Both players send `{ type: 'rematch' }` near-simultaneously. Because `rematch()` writes to
`myRematchPendingRef.current = true` **synchronously** (before React batches the state update),
when the opponent's signal arrives milliseconds later and `onRematch` reads
`myRematchPendingRef.current`, it sees `true` → starts the game. No deadlock.

---

## Protocol

No new signal type. The existing `{ type: 'rematch' }` signal is reused as a handshake:

- Sending `rematch` = "I want to play again."
- Receiving `rematch` while I've already sent mine = mutual confirmation → start game.
- Receiving `rematch` while I haven't sent mine = opponent is waiting → show ready indicator.

Order-independent, symmetric, zero new protocol surface.

---

## New State (useUplinkGame.ts)

```ts
// State (drives UI re-renders)
const [myRematchPending, setMyRematchPending] = useState(false);
const [opponentWantsRematch, setOpponentWantsRematch] = useState(false);

// Refs (for async socket callbacks — MUST mirror state synchronously)
const myRematchPendingRef = useRef(false);
const opponentWantsRematchRef = useRef(false);
```

Every `setMyRematchPending(v)` call MUST be paired with `myRematchPendingRef.current = v`.
Same for `opponentWantsRematch`. This follows the existing codebase pattern
(`uplinkColorRef` mirrors `uplinkColor`, `uplinkTimeControlIdRef` mirrors `uplinkTimeControlId`,
etc.).

Both flags reset to `false` on:
- `startNewGame()` (mutual confirmation)
- `leaveToOffline()` / `leaveQuietly()` / `leaveTo()`
- `onPeerLeft` (opponent disconnected)
- `onPeerJoined` (new guest joined — fresh match)

---

## Logic Changes

### Extract `startNewGame()` helper

The reset+re-roll+init logic currently duplicated in `rematch()` (lines 501–517) and
`onRematch` (lines 247–265) gets extracted into one helper. This is the ONLY place that
calls `resetTracking()`, `setUplinkResult(null)`, `resetGame()`, etc.

```ts
const startNewGame = () => {
  // Clear rematch handshake
  setMyRematchPending(false);
  myRematchPendingRef.current = false;
  setOpponentWantsRematch(false);
  opponentWantsRematchRef.current = false;

  // Existing reset (moved FROM current rematch/onRematch)
  resetTracking();
  plyRef.current = 0;
  expectedRemoteHashRef.current = null;
  remoteClockRef.current = null;
  clearFlagClaim();
  setUplinkResult(null);
  setResultReason(null);
  setEndModalDismissed(false);

  if (roleRef.current === 'host') {
    const hostColor: PieceColor = Math.random() < 0.5 ? 'white' : 'black';
    setUplinkColor(hostColor);
    uplinkColorRef.current = hostColor;
    setPerspective(hostColor);
    setGenerationMode('balanced');
    resetGame();
    setPendingInit(true);
  }
  // Guest: no action here — waits for host's state-init.
};
```

### `rematch()` — rewritten (called when this client clicks Rematch)

**Critical:** does NOT call `resetTracking()`, `setUplinkResult(null)`, or `resetGame()`.
Those are deferred to `startNewGame()` on mutual confirmation.

```ts
const rematch = () => {
  uplink.send({ type: 'rematch' });
  setMyRematchPending(true);
  myRematchPendingRef.current = true;

  // If opponent already requested, both sides are now confirmed → start game.
  if (opponentWantsRematchRef.current) {
    startNewGame();
  }
};
```

Note: reads `opponentWantsRematchRef.current` (the ref), not the state variable, because
this function may be called from a click handler that has a stale closure over the state.

### `onRematch` handler — rewritten (called when opponent's signal arrives via socket)

```ts
onRematch: () => {
  if (myRematchPendingRef.current) {
    // Both confirmed → start game.
    startNewGame();
  } else {
    // Opponent requested first → show "ready" button, wait for us.
    setOpponentWantsRematch(true);
    opponentWantsRematchRef.current = true;
    // Re-open the end modal if it was dismissed (View Board).
    setEndModalDismissed(false);
  }
},
```

Note: reads `myRematchPendingRef.current` (the ref), not the state variable, because
`onRematch` is a socket callback captured in a closure at mount time.

### `onPeerLeft` — add cleanup

```ts
onPeerLeft: () => {
  setOpponentName(null);
  setOpponentLeft(true);
  // Clear any pending rematch handshake.
  setMyRematchPending(false);
  myRematchPendingRef.current = false;
  setOpponentWantsRematch(false);
  opponentWantsRematchRef.current = false;
  if (matchStartedRef.current) setUplinkResult((r) => r ?? 'win');
},
```

### `leaveToOffline()` / `leaveQuietly()` / `leaveTo()` — add cleanup

Add to each:
```ts
setMyRematchPending(false);
myRematchPendingRef.current = false;
setOpponentWantsRematch(false);
opponentWantsRematchRef.current = false;
```

### Return value — expose new state

```ts
return {
  // ... existing fields ...
  myRematchPending,
  opponentWantsRematch,
};
```

---

## End-Modal Actions (GameModals.tsx)

### New props

```ts
export interface GameModalsProps {
  // ... existing props ...
  myRematchPending: boolean;
  opponentWantsRematch: boolean;
  opponentName: string | null;   // already in useUplinkGame, newly threaded here
}
```

### Updated action array

The waiting state is rendered as **inline status text in the modal JSX**, not as a fake
`GameEndAction`. The `actions` array only contains real clickable buttons.

```ts
// Friend room — game over, opponent still connected
const friendRoomActions: GameEndAction[] = myRematchPending
  ? [
      { label: 'View Board', icon: '🔍', onClick: onViewBoard, variant: 'secondary' },
      { label: 'Leave',      icon: '🚪', onClick: onLeaveUplink, variant: 'secondary' },
    ]
  : opponentWantsRematch
    ? [
        { label: 'View Board', icon: '🔍', onClick: onViewBoard,      variant: 'secondary' },
        { label: `${opponentName ?? 'Opponent'} is ready · Rematch`,
                              icon: '🔄', onClick: onUplinkRematch,  variant: 'primary'   },
        { label: 'Leave',     icon: '🚪', onClick: onLeaveUplink,    variant: 'secondary' },
      ]
    : [
        { label: 'View Board', icon: '🔍', onClick: onViewBoard,      variant: 'secondary' },
        { label: 'Rematch',    icon: '🔄', onClick: onUplinkRematch,  variant: 'primary'   },
        { label: 'Leave',      icon: '🚪', onClick: onLeaveUplink,    variant: 'secondary' },
      ];
```

The "Waiting for …" text is rendered as a `children` slot on `GameEndModal`, not as an action:

```tsx
<GameEndModal ...props actions={endActions}>
  {isUplink && myRematchPending && (
    <p className="text-center text-sm text-gc-text-dim animate-pulse">
      ⏳ Waiting for {opponentName ?? 'opponent'}…
    </p>
  )}
</GameEndModal>
```

`GameEndModal` already accepts `children?: ReactNode` and renders it between the subtitle and
the action buttons (lines 191–201 of `GameEndModal.tsx`). No changes to `GameEndModal.tsx`
needed — no `'waiting'` variant, no new props.

### Updated `endSubtitle` (opponent left)

```ts
const endSubtitle = isUplink && opponentLeft
  ? 'Your opponent left. There is no rematch — leave to continue.'
  // ... rest unchanged
```

---

## Props Threading (LocalGame.tsx)

Destructure from `useUplinkGame` return:
```ts
const { ..., myRematchPending, opponentWantsRematch, opponentName } = uplinkGame;
```

(`opponentName` is already returned but may not be destructured in the `GameModals` call site.)

Pass to `<GameModals>`:
```tsx
<GameModals
  // ... existing props ...
  myRematchPending={uplinkGame.myRematchPending}
  opponentWantsRematch={uplinkGame.opponentWantsRematch}
  opponentName={uplinkGame.opponentName}
/>
```

---

## Files to Modify

| File | Change | Est. lines |
|------|--------|-----------|
| `src/hooks/useUplinkGame.ts` | Add state + refs; extract `startNewGame()`; rewrite `rematch()` and `onRematch`; cleanup in `onPeerLeft`, leave functions | ~50 |
| `src/components/game/modals/GameModals.tsx` | Add `myRematchPending`, `opponentWantsRematch`, `opponentName` props; new friend-room action branching; waiting `children`; update `endSubtitle` | ~30 |
| `src/components/game/LocalGame.tsx` | Destructure + pass through new props | ~10 |
| `src/components/game/modals/GameEndModal.tsx` | No changes needed | 0 |
| **Total** | | **~90** |

---

## Verification

1. **A clicks Rematch** → A sees "⏳ Waiting for [B]…" (pulse) + View Board + Leave; B sees
   "🔄 [A] is ready · Rematch" + View Board + Leave
2. **B clicks Rematch** → both modals close, board resets with re-rolled colors, 🏳️ returns
3. **Simultaneous click** → both send signal, refs ensure `onRematch` sees `myRematchPendingRef =
   true` → game starts on both sides without deadlock
4. **A clicks Rematch, B clicks Leave** → B disconnects; `onPeerLeft` fires on A → clears
   `myRematchPending`, shows "Leave" only (opponentLeft path)
5. **A clicks View Board (mid-wait)** → modal closes, waiting state persists; B clicks Rematch →
   `onRematch` reads `myRematchPendingRef = true` → `startNewGame()` fires → new game starts
6. **A dismisses modal (View Board), B clicks Rematch while A hasn't clicked** → `onRematch`
   fires with `myRematchPendingRef = false` → sets `opponentWantsRematch = true` + re-opens
   modal with "B is ready · Rematch" button
7. **Quick Match** → unchanged: only "Leave" shown, no Rematch button
8. **Opponent left** → unchanged: only "Leave" shown, subtitle updated to "leave to continue"
