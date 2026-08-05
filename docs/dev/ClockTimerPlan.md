# Clock / Timer Feature — Implementation Plan

Status: **PROPOSED — not yet implemented.** No code written. This plan is the agreed design
for adding an optional chess clock to Gridlock Chess.

Last updated: 2026-07-05

> Every file/line reference below was verified by reading the code, not from memory. Where a
> fact is unverified, it is explicitly marked `[UNVERIFIED]`.

---

## 1. Goal & product rules (from the owner)

Add an optional game clock. Gridlock's charge mechanics need cognitive time, so the **only**
timed option offered is **Rapid** — nothing faster (no Bullet/Blitz), nothing slower.

### Time controls in the menu
| Label | Model (Fischer base+increment) |
|-------|--------------------------------|
| **No clock** (default) | `null` |
| 10+0 | `{ baseMs: 600000, incrementMs: 0 }` |
| 10+5 | `{ baseMs: 600000, incrementMs: 5000 }` |
| 15+10 | `{ baseMs: 900000, incrementMs: 10000 }` |

"10+5" = 10 minutes each, +5 seconds added on every completed move (Fischer increment).

### Per-mode gating (verified against real modes)
`OpponentMode = 'offline' | 'protocol-run-dry' | 'uplink' | BotDifficulty`
(from [`GameSetupPanel.tsx`](../../src/components/game/panels/GameSetupPanel.tsx) line 18).

| Mode | Clock policy |
|------|--------------|
| `offline` (local PVP) | No clock **or** Rapid |
| `BotDifficulty` (vs bot) | No clock **or** Rapid |
| `protocol-run-dry` | No clock **or** Rapid |
| `uplink` | **Always Rapid** (No clock removed) |

### Approved defaults (owner to confirm/override)
1. **Bot is on the clock too** (both sides timed). Justified by math in §5.
2. **Forced-Rapid modes are still choosable** among the 3 rapids; default **10+5**. Only the
   "No clock" option is removed for Uplink.
3. **Uplink host transmits the time control**; guest adopts it. Falls back to 10+5 if absent.

---

## 2. Core architecture

### 2.1 The clock MUST be wall-clock based, NOT tick-accumulating
This is the load-bearing correctness decision.

- **Wrong (naive):** a `setInterval`/`requestAnimationFrame` that subtracts elapsed ticks from
  a running total. Browsers **throttle** background-tab `setInterval` (to ≥1s, then ≥1min
  after ~5min hidden) and **pause** `requestAnimationFrame` entirely. A tick-accumulator would
  **freeze while the tab is hidden** — both incorrect and trivially exploitable (hide tab to
  stop your own clock).
- **Correct (S-tier):** store timestamps, derive remaining time from `Date.now()`.
  - On turn start: record `turnStartedAt = Date.now()` and `remainingAtStartMs`.
  - Displayed remaining = `Math.max(0, remainingAtStartMs - (Date.now() - turnStartedAt))`.
  - A timer (250ms interval is enough) only triggers a **re-render**; it never IS the source
    of truth.
  - On `document.visibilitychange` → recompute immediately; if the active side is already
    `<= 0`, flag retroactively.

### 2.2 New hook: `useChessClock`
Isolated, unit-testable, no board knowledge.

Responsibilities:
- Hold `{ whiteMs, blackMs }`, the active color, `turnStartedAt`, and the `TimeControl`.
- Start/stop keyed on the committed `turn` value (turn-edge triggered).
- On each committed move: add `incrementMs` to the side that just moved (Fischer).
- Expose a derived `remaining(color)` computed from `Date.now()`.
- Fire `onFlag(color)` exactly once when a side hits 0.
- Pause when the game is not `'playing'` (terminal status) and, in Uplink, while awaiting
  `state-init`.

> Because it's turn-edge triggered, **promotion needs no special-casing** — `promote()` in
> [`useGameState.ts`](../../src/hooks/useGameState.ts) (line ~214) flips `turn` exactly once,
> same as any move.

### 2.3 New terminal status: `'timeout'`
`GameStatus` (from [`types/game.ts`](../../src/types/game.ts) line 98) gains `'timeout'`.
Winner = the side that did NOT flag.

---

## 3. The `'timeout'` wiring — full site list (the main cost)

This is a MEDIUM feature, not a small one: `'timeout'` touches ~13 sites across 8 files.
Missing any one mislabels the winner or fails to open the end modal. Each site verified:

| # | File / symbol | Change |
|---|---------------|--------|
| 1 | [`types/game.ts`](../../src/types/game.ts) `GameStatus` (L98) | add `'timeout'` |
| 2 | [`GameEndModal.tsx`](../../src/components/game/modals/GameEndModal.tsx) `GameEndType` (L7) | add `'timeout'` + modal copy. NOTE: this union currently lacks `'gridlock-death'` — LocalGame maps that to `'checkmate'`. Do the same style deliberately for `'timeout'`. |
| 3 | [`statusMessage.ts`](../../src/utils/statusMessage.ts) `getStatusMessage` (L27) | add `'timeout'` branch → "{loser} flagged — {winner} wins" |
| 4 | `statusMessage.ts` `isTerminalStatus` (L61) | include `'timeout'` (else end modal never opens) |
| 5 | `statusMessage.ts` `isDecisiveMate` (L73) | decide: is a flag "decisive"? Recommend **no** (instant reveal, like resign) |
| 6 | [`LocalGame.tsx`](../../src/components/game/LocalGame.tsx) `defeatedSquare` (~L644) | `'timeout'` → topple the flagged side's king (optional visual) |
| 7 | `LocalGame.tsx` `endModalType` (~L659) | map `'timeout'` |
| 8 | `LocalGame.tsx` `endModalWinner` (~L664) | winner = side that didn't flag |
| 9 | [`useProtocolRunDry.ts`](../../src/hooks/useProtocolRunDry.ts) `isTerminal` (~L190) | include `'timeout'` |
| 10 | `useProtocolRunDry.ts` `humanWon` (~L205) | `'timeout' && flaggedColor === botColor` |
| 11 | `useProtocolRunDry.ts` `humanLost` (~L208) | `'timeout' && flaggedColor === humanColor` |
| 12 | Clock display render | in [`PlayerCard.tsx`](../../src/components/game/PlayerCard.tsx) — already has `isActive` + `position` props |
| 13 | Time-control selector | in the setup panel; hide "No clock" when mode resolves to Uplink |

> **Winner logic (corrected):** a chess clock only runs for the side whose turn it is
> (your clock freezes during the opponent's turn; increment is added to your clock as it
> stops). Therefore you can ONLY flag on your OWN turn — the flagged side is **always**
> `turn` (the side to move). This makes a timeout's winner relationship **identical to
> checkmate**: `turn` = loser, winner = the opposite color. So `humanWon` gets
> `status === 'timeout' && turn === botColor` and `humanLost` gets
> `status === 'timeout' && turn === humanColor` — exactly mirroring the existing checkmate
> lines. `onFlag` may still pass the flagged color for clarity, but it is NOT required to
> disambiguate the winner (an earlier draft of this plan wrongly claimed it was).

---

## 4. Uplink (Phase 2) — networked clock

### 4.1 Transmit the time control (verified safe)
Add `timeControl?: TimeControl` to `StateSnapshot`
([`protocol.ts`](../../src/lib/net/protocol.ts) line 26).

- **Why it's safe:** `hashBoard` ([`protocol.ts`](../../src/lib/net/protocol.ts) line ~118)
  hashes **only** board placement + turn + en-passant target — NOT the other snapshot fields.
  Adding `timeControl` therefore **cannot** trip the desync guards. Verified by reading the
  hash function.
- Host picks; guest adopts on `state-init`. Absent field → default 10+5 (back-compat with
  older peers).

### 4.2 Flags are NOT authoritative — by necessity
- The relay is "friends-trust, not cheat-proof, by design" (documented in `server.js`). There
  is no server timestamp authority.
- Resignation is already handled **out-of-band** via `uplinkResult` + `ResignMessage`
  ([`protocol.ts`](../../src/lib/net/protocol.ts) line ~73).
- **Design:** each peer runs both clocks locally for DISPLAY, but a peer only ever declares
  **its own** timeout — send a new `TimeoutMessage` (exact parallel to `ResignMessage`). You
  never flag the opponent from your local view.
- **Why (math):** with no shared clock, each peer measures the opponent's remaining time with
  ~½ RTT error per move. China↔Brazil RTT ≈ 250–350ms; over ~40 moves that compounds to
  **seconds** of disagreement — enough for the two peers to disagree on a flag. Self-reporting
  removes the dispute: the flagging side concedes, just like resigning.
- New message type: `TimeoutMessage { type: 'timeout' }` added to the `GameMessage` union and
  handled in `useUplinkGame` alongside resign.

---

## 5. Edge-case & math validation

- **Bot flag risk (both-timed):** bot move cost = `Promise.all([chooseBotMove, minDelay])`,
  minDelay 1.2–2.0s ([`LocalGame.tsx`](../../src/components/game/LocalGame.tsx) ~L481), engine
  `movetime ≤ 4000ms` (asi tier, [`bot.ts`](../../src/lib/chess/bot.ts) L163). Worst ≈ 4s/move.
  On 10+0: `600000 / 4000 = 150` moves before a theoretical bot flag — beyond normal game
  length; with any increment, effectively never. ∴ both-timed is safe.
- **Background-tab throttling:** handled by the wall-clock design (§2.1). Verified concern —
  `setInterval`/`rAF` throttle/pause when hidden.
- **Flag on own turn:** a clock only runs for the side to move, so a flag can ONLY occur on
  the flagging side's own turn — flagged side == `turn`. This is WHY timeout winner logic
  equals checkmate winner logic (§3).
- **Simultaneous game-end + flag:** if a mate and a flag land in the same tick, board outcome
  should win (the move completed). Guard: only evaluate flag while `status === 'playing'`.
- **Increment on the final move:** apply increment on move COMMIT, before switching the active
  clock — standard Fischer. A move that delivers mate still adds increment but the game ends,
  so it's moot.

---

## 6. Persistence, reset, display & UX semantics

These were omitted from the first draft. All references below were verified by reading
[`LocalGame.tsx`](../../src/components/game/LocalGame.tsx).

### 6.1 Time-control preference persistence
- **Verified:** a safe, versioned localStorage convention already exists in
  [`lib/storage.ts`](../../src/lib/storage.ts) — `readString` / `writeString` / `readJSON` /
  `writeJSON`, each wrapped for SSR/quota/disabled-storage. Existing keys follow the pattern
  `gridlock:<name>:v1` (e.g. `gridlock:resume:v1`, `gridlock:sound-muted:v1`).
- **Plan:** persist the last-picked time control under `gridlock:timecontrol:v1` via
  `writeString`/`readString`. No new infrastructure needed. Low effort, expected UX.
- **`[UNVERIFIED]`** whether the `opponentMode` selection itself is persisted as a *standalone*
  preference (separate from the resume snapshot) — not required for the clock, so left open.

### 6.2 In-progress clock state (resume-on-refresh) — real decision
The app resumes an in-progress single-player game across refresh via
`RESUME_KEY = 'gridlock:resume:v1'` and `ResumeSnapshot` (v:1), written after every committed
move and cleared when `status !== 'playing'`. **Uplink is excluded** from resume
([`LocalGame.tsx`](../../src/components/game/LocalGame.tsx) ~L388–L445).

**The snapshot is a replay (start + moves). It stores NO elapsed time.** So a clocked game
cannot be resumed accurately without adding clock fields. Three honest options:

| Option | Behavior | Verdict |
|--------|----------|---------|
| **A — Don't resume clocked games** | If a saved game has a time control, clear it on load (like Uplink). Only "No clock" games resume. | Simplest, fully honest. Safe default. |
| **B — Pause-on-refresh** | Persist `{ whiteMs, blackMs }` at each move-commit; on restore, restore those exact values, ignoring wall-time elapsed while away. | Casual-friendly. NOT a true clock (a player could refresh to dodge time pressure) — acceptable for local single-player, matches the app's casual/friends-trust ethos. **Recommended.** |
| **C — True wall-clock persistence** | Persist `{ whiteMs, blackMs, activeColor, turnStartedAt(epoch) }`; on restore subtract real elapsed time. | "Correct" but brutal: refresh hours later = auto-flag. Wrong for a casual local game. |

**Recommended: Option B.** It also means the persist effect must additionally serialize the
clock remaining ms.

### 6.3 ResumeSnapshot version compatibility
`ResumeSnapshot.v` is currently `1`; restore discards anything where `saved?.v !== 1`
([`LocalGame.tsx`](../../src/components/game/LocalGame.tsx) ~L396). Two paths:
- **Add clock fields as OPTIONAL on v:1** → old saves keep resuming (missing clock = treat as
  no-clock). **Recommended** — does not nuke in-progress games on upgrade.
- Bump to `v: 2` → discards every in-progress game on first load after upgrade. Avoid unless
  the shape genuinely breaks.

### 6.4 Clock reset semantics
The clock must reset to `baseMs` (both sides) on EACH of these, all verified to exist:
- **New game** — `handleNewGame` → `resetGame`
  ([`LocalGame.tsx`](../../src/components/game/LocalGame.tsx) ~L509).
- **Rematch** — the Uplink `RematchMessage` path / end-modal rematch action.
- **Run Dry tier change** — each new board via a `runDry` tier transition (advance / restart)
  starts a fresh game → fresh clock.
- **Color switch / board flip** must NOT reset the clock (they don't start a new game).

### 6.5 Display format
- `mm:ss` above 10s; show tenths (`0:09.4`) below 10s — standard for Rapid finishes.
- Increment feedback (optional): a subtle `+0:05` flash when increment is added.
- The clock text belongs in [`PlayerCard.tsx`](../../src/components/game/PlayerCard.tsx), which
  already receives `isActive` (whose turn) and `position` (top/bottom).

### 6.6 Low-time UX, sound & accessibility
- **Low-time visual:** color-shift / pulse under ~30s and again under ~10s on the active card.
- **Sound (verified):** `useGameSound()` ([`useGameSound.ts`](../../src/hooks/useGameSound.ts))
  exposes `play(event, delay?)`, `muted`, `toggleMuted`; mute persists + syncs cross-tab. The
  `SoundEvent` union ([`audio/engine.ts`](../../src/lib/audio/engine.ts) L21) has 10 events:
  `move, anomalyMove, override, vectorExhausted, gridlock, capture, check, gameEnd,
  modeBalanced, promotion`. **There is NO low-time/tick cue and NO flag-specific cue.** Options:
  (a) reuse `gameEnd` for a flag — zero new audio, ships now; (b) add new `SoundEvent`(s) (e.g.
  `timeLow`, `flag`) — requires authoring waveforms in the engine, a larger task. Recommend (a)
  for Phase 1; treat (b) as optional polish.
- **Accessibility:** wrap the active clock in an `aria-live="polite"` region OR (better, to
  avoid per-second screamer spam) announce only threshold crossings ("30 seconds",
  "10 seconds") and the flag. A per-second `aria-live` update is an a11y anti-pattern.

---

## 7. Open / unresolved items

- **`[UNVERIFIED]` promotion model inconsistency:** [`protocol.ts`](../../src/lib/net/protocol.ts)
  line 8 comment says promotion "always auto-promotes to a fixed Omni," but `promote(archetypeKey)`
  in [`useGameState.ts`](../../src/hooks/useGameState.ts) accepts a choice. This does NOT affect
  the clock (both flip `turn` once), but it should be reconciled separately. Flagged, not fixed.
- **Owner confirmations still needed:** the 3 approved defaults in §1 (bot timed / choosable
  rapids / host transmits control).

---

## 8. Phased delivery

### Phase 1 — Local (no netcode)
Covers `offline`, all `BotDifficulty`, and `protocol-run-dry`.
1. `TimeControl` type + the 4-option menu constant.
2. `useChessClock` hook (wall-clock design) + unit tests.
3. `'timeout'` status wired through sites 1–11 (§3).
4. Clock display in `PlayerCard` (site 12) — `mm:ss` + sub-10s tenths (§6.5).
5. Time-control selector in setup panel (site 13).
6. Clock reset wired to new-game / rematch / Run Dry tier transitions (§6.4).
7. Resume-on-refresh: Option B pause-on-refresh — add OPTIONAL clock fields to `ResumeSnapshot`
   v:1 (§6.2–6.3).
8. Low-time visual + a11y threshold announcements (§6.6). Flag sound reuses the existing
   `gameEnd` cue (no new audio needed for Phase 1).
9. Validate: `tsc -b` clean, `vitest run` (115+ tests: existing 111 + new clock tests).

### Phase 2 — Uplink
1. `timeControl?` on `StateSnapshot`; host picks, guest adopts (§4.1).
2. `TimeoutMessage` type + `useUplinkGame` handler (§4.2).
3. Hide No-clock for Uplink.
4. Validate: `tsc -b` clean, `vitest run`, plus a manual two-tab Uplink smoke test.

---

## 9. Validation gates (every phase)
- `npx tsc -b --force` → must print no errors.
- `npx vitest run` → all tests pass (existing 111 baseline + new clock unit tests).
- `npm run lint` → no NEW errors (12 pre-existing warnings are unrelated).
- React Compiler is ON — do NOT use `useMemo`/`useCallback`/`memo` (they are compile errors in
  this project).
