# Limited Restart Monetization Plan

## Model: "Charge on Abandonment, Not Completion"

Free download with **31 restart charges**. One-time IAP for unlimited restarts.

## How It Works

| Action | Charge cost |
|---|---|
| Game ends naturally (win / loss / draw) → new game starts | **0** (free) |
| Mid-game abandon via restart icon or Play Menu new game | **1 charge** |
| Player runs out of charges and triggers a mid-game restart | **Paywall** — one-time purchase prompt |

### Why 31 charges?

- Casual players who mostly play to completion may never hit 31 — they play for free indefinitely.
- Serious opening explorers who restart frequently will burn through 31 within a few sessions — exactly the users who value the "5.95 billion openings" proposition and are willing to pay.
- 31 is generous enough to avoid feeling stingy on first impression, but low enough that power users convert quickly.

### Key UX rules

1. **Last-charge confirmation dialog**: When the player has **1 charge remaining** and triggers a mid-game restart, show a confirmation: *"This will use your last free restart. Continue?"*
2. **Charge counter visibility**: Display remaining charges near the restart icon (small badge or counter) so the player is always aware.
3. **Post-purchase**: After IAP, the charge counter disappears — restarts are unlimited, no visual clutter.
4. **Paywall screen**: When charges hit 0 and a mid-game restart is triggered, show a modal explaining the one-time purchase. Include: price, "unlimited restarts forever", and a "Continue current game" dismiss button.

## What Counts as "Restart"

A charge is consumed when **both** conditions are true:
1. `engineStatus === 'playing'` (game has not reached a terminal state)
2. The reset is triggered by a **user-initiated restart path** (see table below)

The guard uses `engineStatus` (the raw engine state, destructured at the top of `LocalGame`), **not** `status`/`statusForReveal` — which can differ in Uplink games when a peer reports a result before the local engine detects it.

### Complete `resetGame()` call map

Every call to `resetGame()` in `LocalGame.tsx` and whether it consumes a charge. Line numbers are approximate — use function names as the stable reference.

| Trigger | Function | Consumes charge? | Why |
|---|---|---|---|
| Restart icon during play | `plainNewGame()` | **Yes** | User-initiated mid-game abandon |
| Restart icon post-game (non-Run-Dry "Play Again" pill) | `plainNewGame()` | No | `engineStatus` is terminal — gate passes through |
| Play Menu "New Game" (no settings change) | `commitNewGame()` → `plainNewGame()` | **Yes** | Same path as restart icon — gate in `plainNewGame()` fires |
| Play Menu "New Game" (settings changed) | `commitNewGame()` → `applyDraftAndNewGame()` | **Yes** | User-initiated mid-game abandon |
| End modal "Play Again" | `handlePlayAgain()` | No | Only reachable post-terminal (end modal requires `isGameOver`) |
| Run Dry progress restart (ProtocolRunDryPanel) | `handlePlayAgain()` | No | **Exempt** — resetting tier progress is already punishing; double-charging is hostile |
| End modal "Next Level" / "Retry Tier" | `handleNextTier()` | No | Post-terminal — game is already over |
| Uplink → Run Dry mode switch | direct `resetGame()` | No | **Exempt** — mode transition, not a restart |

### Exempt paths (bypass the charge gate)

These call `resetGame()` while `engineStatus` may be `'playing'`, but are exempt by design:

1. **Run Dry progress restart**: Calls `handlePlayAgain()` from the `ProtocolRunDryPanel` restart button. The player is already losing all tier progress — consuming a restart charge on top of that is double punishment.

2. **Uplink → Run Dry mode switch**: Direct `resetGame()` call inside `handleDraftOpponent` when leaving an Uplink lobby and switching to Run Dry. This is a mode transition, not a user abandoning a position they dislike.

3. **Both-Bots mode** (Sandbox spectate): When `bothBots === true`, the player is watching two bots play — they aren't playing a game themselves. Re-rolling a spectator match is not an "abandonment." Restarts in Both-Bots mode are free.

### How NOT to start a new game for free (no exploits)

- **Navigate home → come back**: Game persistence (`useGamePersistence.ts`) saves and restores the in-progress game. Returning from Home resumes the same position — no new opening dealt.
- **Change settings to trigger `applyDraftAndNewGame`**: This path is guarded — consumes a charge when `engineStatus === 'playing'`.
- **Kill/reinstall app**: Reinstall clears localStorage (see Known Limitations). Accepted tradeoff.

## Technical Implementation

### Phase 1 — Core counter (local-only, no IAP)

1. **`useRestartCharges` hook**
   - Persistent counter in `localStorage` (key: `gridlock:restart-charges`)
   - Initial value: `31`
   - Exposes: `chargesLeft`, `consumeCharge()`, `isUnlimited`, `resetCharges()` (dev only)

2. **Wire into restart flow** (`LocalGame.tsx`)
   - Add a charge gate check at the top of `plainNewGame()` and `applyDraftAndNewGame()` — the two user-initiated restart paths
   - Gate condition: `engineStatus === 'playing' && !bothBots && !isUnlimited`
   - When gated:
     - If `chargesLeft > 1` → `consumeCharge()`, then proceed with the restart
     - If `chargesLeft === 1` → show last-charge confirmation dialog; on confirm → `consumeCharge()` + restart
     - If `chargesLeft === 0` → show paywall modal; block the restart
   - Exempt paths (`handlePlayAgain`, `handleNextTier`, Uplink→RunDry direct call) are NOT modified — they call `resetGame()` directly as before
   - **`commitNewGame()` dialog integration**: When settings changed mid-game with moves played, the existing "Abandon & start new game?" confirm dialog fires BEFORE `applyDraftAndNewGame()`. The charge gate inside `applyDraftAndNewGame()` would then fire a SECOND dialog (last-charge confirm or paywall). To avoid double-dialog UX, move the charge check into `commitNewGame()` itself — run it before `setShowNewGameConfirm(true)`. If zero charges, show the paywall immediately and skip the abandon confirm. If last charge, fold the charge warning into the abandon confirm message (e.g., *"Abandon & start new game? This will use your last free restart."*). This keeps the user to one dialog per action.

3. **Charge badge UI**
   - Small counter badge on or near the restart icon
   - Hidden when `isUnlimited` or `bothBots`

4. **Paywall modal**
   - Title: "Out of free restarts"
   - Body: Explain one-time purchase for unlimited restarts
   - Buttons: "Purchase" (disabled until Phase 2) + "Continue current game"

### Phase 2 — Google Play Billing IAP

1. Evaluate Capacitor billing plugin (e.g. `capacitor-purchases` via RevenueCat, or a direct Google Play Billing plugin — TBD)
2. Create "unlimited_restarts" non-consumable product in Google Play Console
3. On successful purchase → set `isUnlimited = true` in localStorage; verify purchase on-device via Google Play Billing Library (no backend needed)
4. On app launch → restore purchases via Google Play (handle reinstalls / new devices)
5. **Race condition**: Purchase restore is async. Defer charge gate checks until restore completes on fresh installs, or show a brief loading state — prevents a paid user from seeing a false paywall on reinstall.

### Phase 3 — Polish

- Purchase restoration on new device / reinstall
- Analytics: track charge consumption rate, conversion funnel
- A/B test charge count (31 vs 50 vs 20) if analytics warrant it

## Known Limitations

1. **localStorage is client-side only**: A technically savvy user with ADB access could manually edit `gridlock:restart-charges` in WebView storage to reset their counter. Acceptable tradeoff for a solo-dev app without a backend — the target audience won't do this.

2. **App reinstall resets the free counter**: Uninstalling and reinstalling clears localStorage, giving the player 31 fresh charges. The friction of reinstalling (lose all game history, settings, Run Dry progress) is a sufficient deterrent. IAP purchases are restored via Google Play (Phase 2, step 4), so paying users are unaffected.

3. **No server-side enforcement**: Without a backend, there is no way to tie the charge counter to an account. Purchase verification is handled on-device by Google Play Billing — no server round-trip needed. This is a deliberate scope decision — adding a backend solely for charge tracking would be overengineering for the app's scale.

## Monetization Reference

Inspired by **Ouroboros King** — free chess variant game with limited runs, one-time purchase for unlimited play.

## Implementation Checklist

Ordered easiest → hardest. Check off each item as it ships.

### Phase 0 — Prerequisites (manual, no code)

These are blocking dependencies. Phase 1 (code) can proceed in parallel, but Phase 2 cannot start until these are done.

- [ ] **0.1 Google Play Developer Account** — one-time $25 fee at play.google.com/console. Requires government-issued ID for identity verification. Approval can take days to weeks — start early.
- [ ] **0.2 Google payments merchant profile** — linked to your developer account. Requires bank account details and tax information. Must be completed before you can sell anything.
- [ ] **0.3 App listing in Google Play Console** — create the Gridlock Chess listing: app name, description, screenshots, feature graphic, content rating questionnaire, target audience & content declaration.
- [ ] **0.4 Privacy policy** — Google Play requires a privacy policy URL for all apps. Must disclose: localStorage usage for game state/charge counter, no personal data collection, no ads (if AdMob is not used). Host on a simple static page (GitHub Pages, etc.).
- [ ] **0.5 Release signing key** — generate a production keystore for signing release APKs/AABs. Debug keys are rejected by Google Play. Store the keystore securely — losing it means you can never update the app.
- [ ] **0.6 Closed testing track** — upload a signed AAB to at least a closed testing track. Google requires this before IAP products can be tested with real purchase flows. Add your own Google account as a tester.
- [ ] **0.7 Create "unlimited_restarts" IAP product** — in Google Play Console → Monetize → In-app products. Set as non-consumable (one-time purchase). Set price. Only possible after 0.1–0.6 are done.
- [ ] **0.8 If using RevenueCat** — create RevenueCat account, generate API key, map the "unlimited_restarts" product in their dashboard. *(Skip if using Google Play Billing directly.)*

### Phase 1 — Core counter (code, no IAP)

Can start immediately — no Phase 0 dependencies.

- [ ] **1.1 Create `useRestartCharges` hook** — `localStorage` read/write, `chargesLeft`, `consumeCharge()`, `isUnlimited` state. Pure data hook, no UI. *(easiest — isolated, no dependencies)*
- [ ] **1.2 Add charge gate to `plainNewGame()`** — early return when `engineStatus === 'playing' && !bothBots && !isUnlimited` and charges exhausted. Silent consume when `chargesLeft > 1`. *(wiring only — one function, one guard)*
- [ ] **1.3 Add charge gate to `applyDraftAndNewGame()`** — same guard as 1.2. *(copy-paste of 1.2's pattern)*
- [ ] **1.4 Integrate charge check into `commitNewGame()`** — move gate before `setShowNewGameConfirm(true)` to avoid double-dialog. Fold charge warning into abandon confirm message when last charge. *(slightly harder — dialog message logic)*
- [ ] **1.5 Build paywall modal** — "Out of free restarts" modal with "Continue current game" dismiss. Purchase button disabled (placeholder until Phase 2). *(new component, but simple modal)*
- [ ] **1.6 Build last-charge confirmation dialog** — *"This will use your last free restart. Continue?"* Shown when `chargesLeft === 1`. *(similar to paywall modal — reuse modal pattern)*
- [ ] **1.7 Add charge badge to restart icon** — small counter near the restart icon, hidden when `isUnlimited` or `bothBots`. *(UI polish — CSS/layout work)*
- [ ] **1.8 Manual QA** — verify all paths: restart icon, Play Menu new game (settings changed / unchanged), post-game Play Again, Run Dry progress restart, Both-Bots, Uplink→RunDry switch. Confirm charges decrement correctly and exempt paths are free.

### Phase 2 — Google Play Billing (requires Phase 0 complete)

- [ ] **2.1 Select and install Capacitor billing plugin**
- [ ] **2.2 Wire purchase flow into paywall modal** — enable the Purchase button, handle success/failure callbacks
- [ ] **2.3 On purchase success → set `isUnlimited = true`** — verify on-device via Google Play Billing Library
- [ ] **2.4 Purchase restore on app launch** — query Google Play for existing purchases, set `isUnlimited` before charge gate runs
- [ ] **2.5 Handle restore race condition** — defer charge checks until restore completes on fresh installs
- [ ] **2.6 End-to-end IAP test on closed track** — test full flow: exhaust charges → paywall → purchase → unlimited. Test restore on reinstall.

### Phase 3 — Polish

- [ ] **3.1 Update `src/pages/About.mdx`** — remove or qualify the "no paywalls" claim before Google Play release. The IAP is optional (free players keep playing indefinitely, just can't mid-game restart), so the copy should reflect that nuance rather than simply deleting the line.
- [ ] **3.2 Analytics** — track charge consumption rate, conversion funnel, charges remaining at purchase
- [ ] **3.3 A/B test charge count** — if analytics warrant it

## Open Questions

- [ ] Exact IAP price point (research comparable chess variant apps on Google Play)
- [ ] Badge design for charge counter on restart icon
- [ ] Capacitor billing plugin selection (RevenueCat vs direct Google Play Billing)
