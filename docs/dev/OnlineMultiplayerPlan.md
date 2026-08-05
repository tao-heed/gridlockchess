# Online Multiplayer Plan — Firebase Migration (Uplink v2)

## Problem

The current Uplink system uses a self-hosted WebSocket relay (`server.js` on port 3005)
that players must reach at a public domain. The Android APK derives the relay URL from
`window.location` at runtime: hostname is always `localhost` inside Capacitor WebView, so
it generates `wss://localhost:3005/uplink` — the **phone's own localhost** — where nothing
is listening. Result: Uplink silently fails on every real Android device. There is no free,
zero-maintenance path to fix this with the current architecture.

---

## Goal

Replace the self-hosted relay with a **100% free, serverless, globally-hosted backend** so
players worldwide can connect with no infrastructure to maintain.

---

## Recommended Service: Firebase Realtime Database

| | Firebase RTDB | Ably | PubNub | Supabase Realtime |
|---|---|---|---|---|
| **Free tier** | 100 connections, 10 GB/mo transfer | 6M msgs/mo, 100 connections | 1M msgs/mo, 100 connections | 500 connections, 5 GB/mo |
| **Server needed?** | No | No | No | No |
| **Latency** | ~50–100ms (estimate) | ~30–70ms (estimate) | ~30–70ms (estimate) | ~80–150ms (estimate) |
| **Works in Capacitor WebView** | ✓ Web SDK, no native plugin | ✓ | ✓ | ✓ |
| **Reconnection / persistence** | ✓ Built-in | Manual | Manual | Manual |
| **Presence (`.onDisconnect`)** | ✓ First-class | Manual via heartbeat | Manual | Manual |
| **Data persists for reconnect** | ✓ | ✗ | ✗ | ✗ |
| **Anonymous auth** | ✓ Built-in | ✗ | ✗ | ✓ |
| **Long-term free** | ✓ (Spark plan, no credit card) | Free tier has shrunk historically | Free tier has shrunk historically | ✓ |

**Firebase RTDB wins** for this use case: built-in `.onDisconnect()` presence, persistent
rooms enabling reconnection, anonymous identity, and a stable free-forever Spark plan.

> **Latency note:** The numbers above are estimates, not benchmarks. Ably/PubNub are
> genuinely faster for pure pub/sub. Firebase's slight latency disadvantage is acceptable
> for turn-based chess (moves happen every few seconds, not milliseconds).

---

## S-Tier Feature Set

### Mode 1 — Play a Friend
> "I want to invite a specific person."

- Host taps **Play a Friend** → app generates a 5-char room code (existing `generatePasscode()`)
- Host shares the code verbally, via text, or via a **one-tap share sheet** (native Android share)
- Guest enters the code → matched instantly
- Optional Phase 4: **deep-link** (`gridlockchess://join/ABCDE`) so a tapped link pre-fills the code

### Mode 2 — Quick Match
> "I want to play anyone online right now."

- Player taps **Find a Match** → enters a global matchmaking queue
- Firebase atomically pairs the two oldest waiting players (FIFO, using RTDB transactions to
  avoid race conditions — two clients cannot claim the same queue slot)
- Matched in seconds when another player is waiting; shows "Searching…" spinner with elapsed
  time and live **online player count** while waiting
- Cancel button exits the queue cleanly

### Presence & Lobby
> "How many people are playing right now?"

- Anonymous, real-time counter: **"~12 players online"** (derived from `/presence/` children)
- Powered by Firebase `.onDisconnect()` — presence is removed when the server detects the
  client is gone. **Important:** `.onDisconnect()` triggers are NOT instant — Firebase's
  server needs ~60–90 seconds to confirm a dead connection before executing them. This
  means the online count can be stale by up to 90 seconds after a player leaves. Acceptable
  for a casual counter, but the UI should not present it as a "live" second-by-second number
- Online count is derived from `/presence/` children — each player writes `online: true`
  on connect, removed by `.onDisconnect().remove()`. The client counts children of
  `/presence/` (at ~50 max concurrent players, this downloads ~50 tiny objects — trivially
  cheap). This avoids the `/stats/onlineCount` counter pattern, which has an unsolvable
  problem: `.onDisconnect()` does NOT support `runTransaction()`, so atomic decrement on
  disconnect is impossible. `ServerValue.increment(-1)` inside `.onDisconnect().set()` can
  work but is fragile if the connect-side increment races. Counting presence nodes is
  simpler, correct, and doesn't drift
- Shown in the Uplink modal before connecting, purely informational

### Reconnection
> "My phone dropped signal mid-game — can I resume?"

- When a player loses connectivity, Firebase's server detects the dead connection after
  ~60–90 seconds and fires `.onDisconnect()`, setting `connected: false` on their seat node
- The opponent, watching that seat with `onValue`, sees the transition and starts a
  **90-second countdown** (giving ~3 minutes total real-world grace: server detect + countdown)
- During the countdown the opponent sees **"Opponent reconnecting…"**; clocks pause
  (`useChessClock` is already pauseable)
- Firebase room persists during the window; the returning player sets `connected: true`
  on their seat, the opponent sees it, and the game resumes seamlessly
- After the 90-second countdown, the opponent can claim the win (via existing forfeit logic)

### Anonymous Identity (No Account Required)
> "I don't want to create an account just to play."

- Firebase Anonymous Auth assigns each device a persistent `uid` behind the scenes
- The player only enters their **display name** (same as today) — no email, no password
- The uid persists across sessions via localStorage (Firebase SDK handles this)
- Firebase Security Rules use the uid to ensure only the rightful player can write to their seat

### Rematch
Already implemented in the current protocol (`RematchMessage`). Preserved as-is.

---

## What Does NOT Change

The current protocol is well-designed. These are preserved exactly:

| Component | Status | Verified? |
|---|---|---|
| `protocol.ts` — all message types (`move`, `resign`, `state-init`, `resync`, etc.) | **Keep** | ✓ Read |
| `protocol.ts` — `hashBoard()` desync detection | **Keep** | ✓ Read |
| `protocol.ts` — `generatePasscode()` | **Keep** | ✓ Read |
| `protocol.ts` — `sanitizePlayerName()` | **Keep** | ✓ Read |
| `protocol.ts` — `uplinkUrl()` | **Delete** — becomes dead code | ✓ Read |
| `useUplink.ts` — `UplinkApi` interface (host, join, leave, send, status, role, roomCode, error) | **Must preserve exactly in Phase 1** — `useUplinkGame.ts` and `LocalGame.tsx` depend on it. Phase 2 adds `'reconnecting'` to `UplinkStatus` (see below). | ✓ Read |
| `useUplinkGame.ts` — host/guest roles, board generation, move application | **Phase 1: untouched. Phase 2: minor extension** (see below) | ✓ Read |
| `useUplinkGame.ts` — resync, clock sync, rematch logic | **Phase 1: untouched. Phase 2: minor extension** (see below) | ✓ Read |
| `LocalGame.tsx` — all Uplink UI wiring | **Phase 1: untouched. Phase 2: minor extension** (clock pause + reconnecting UI) | ✓ Read |
| `UplinkModal.tsx` — passcode entry UI | **Keep, extend with new screen** | ✓ Read |

**Critical:** The replacement `useUplink.ts` must return the exact same `UplinkApi`:
```ts
export interface UplinkApi {
  status: UplinkStatus;   // 'idle' | 'connecting' | 'waiting' | 'connected' | 'error'
  role: UplinkRole | null;
  roomCode: string | null;
  error: string | null;
  host: () => string;
  join: (code: string) => void;
  leave: () => void;
  send: (msg: GameMessage) => void;
}
```
Breaking this interface would cascade into `useUplinkGame.ts` and `LocalGame.tsx`.

Only the internals of **`useUplink.ts`** change. The public surface stays identical.

### Phase 2 Exception: Reconnection Requires Interface Extension

Phase 1 preserves all interfaces exactly. Phase 2 (reconnection) requires small extensions
because the current `onPeerLeft` handler in `useUplinkGame.ts` (line 149-155) awards the
win **immediately** on disconnect:

```ts
onPeerLeft: () => {
  setOpponentLeft(true);
  if (matchStartedRef.current) setUplinkResult((r) => r ?? 'win');
},
```

For reconnection, we need a 90-second grace window. Delaying `onPeerLeft` inside
`useUplink.ts` is insufficient — the UI must show "Opponent reconnecting..." and the
clock must pause, which requires state to propagate to `LocalGame.tsx`.

**Phase 2 changes (minimal):**

1. **`UplinkStatus`** — add `'reconnecting'` value:
   `'idle' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error'`
2. **`useUplink.ts`** — when opponent's `connected` goes `false`, set status to
   `'reconnecting'` and start internal 90s timer. If `connected` goes `true` before
   expiry: set status back to `'connected'`. If timer expires: set status to `'connected'`
   and fire `onPeerLeft` (existing flow awards win).
3. **`useUplinkGame.ts`** — watch for `uplink.status === 'reconnecting'` to expose a
   `reconnecting: boolean` field. No handler changes needed.
4. **`LocalGame.tsx`** — clock is currently `running: status === 'playing'` (line 409).
   Change to `running: status === 'playing' && !uplinkGame.reconnecting`. One-line change.
   Show reconnection banner when `uplinkGame.reconnecting` is true.

These are additive (new status value, new field). No existing behavior changes.

---

## What ACTUALLY Changes in UplinkModal

The existing `UplinkModal.tsx` uses a `screen: 'choice' | 'join'` state — NOT tabs.
Adding Quick Match means adding a **third screen** (`'quick-match'`), consistent with the
existing pattern. The "tab" layout shown in earlier drafts was inaccurate.

```
Existing screens:          New screens:
  'choice'                   'choice'       ← add "Find a Match" button here
  'join'                     'join'         ← unchanged
                             'quick-match'  ← new: spinner + cancel
```

The `'choice'` screen gets one new button: **"🌐 Find a Match"**. Everything else on that
screen stays as-is (clock selector, "Open Uplink", "Join Uplink" buttons).

---

## Firebase Setup (Day 0 — No Code)

Before writing a single line of code, these manual steps are required:

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project (free Spark plan — no credit card required)
3. **Enable Realtime Database** → Start in **test mode** (lock down with real rules before shipping)
4. **Enable Authentication → Anonymous** sign-in provider
5. Copy the Firebase config object (Settings → Your apps → Web app):
   ```
   apiKey, authDomain, databaseURL, projectId, storageBucket, messagingSenderId, appId
   ```
6. Add to `.env` (never commit the real values):
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_DATABASE_URL=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_APP_ID=...
   ```
7. Add `.env` to `.gitignore` (verify it's already there)

> **Note:** Unlike native Android Firebase (which requires `google-services.json`), the
> Firebase web SDK only needs the config object above. No `google-services.json` needed
> because we are NOT using native Firebase plugins — only the JS SDK inside the WebView.

---

## Firebase Data Model

> **Key insight:** RTDB is a state-sync database, NOT a message queue. The current WebSocket
> `send()` fires 8 distinct message types. These map to two categories of Firebase paths:
>
> 1. **State nodes** — overwritten in place; listeners fire on `value` change.
>    Used for: `state-init`, `resync` (both write to `/state/`), and `move` (appends to `/moves/`).
> 2. **Signal nodes** — pushed (append-only); listeners fire on `child_added`.
>    Used for: `resign`, `timeout`, `rematch`, `hello`, `resync-request`.
>    These are one-shot events with no persistent state to sync.

```
/presence/
  {uid}/
    name: string           // display name
    online: true           // removed by .onDisconnect() on disconnect
    inGame: boolean        // true while in a room
    since: number          // ms timestamp (serverTimestamp)

/stats/                            // REMOVED: onlineCount / gameCount counters.
                                   // Online count is derived by counting /presence/ children
                                   // client-side. .onDisconnect() doesn't support runTransaction(),
                                   // so a server-side counter can't be decremented atomically on
                                   // disconnect. Counting presence nodes is simpler and never drifts.

/rooms/
  {passcode}/
    host/
      uid: string
      name: string
      connected: boolean   // false on disconnect; .onDisconnect() sets this
    guest/
      uid: string
      name: string
      connected: boolean
    state/                             // ← written by state-init AND resync
      board: Board                     //   host writes; guest listens
      turn: PieceColor
      enPassantTarget: Square | null
      mode: GenerationMode
      hostColor: PieceColor
      timeControlId: TimeControlId
      clock: ClockRemaining | null
      ply: number                      //   ply guard — guest ignores if ply < local ply
    moves/                             // ← append-only move log
      {ply}/                           //   "0", "1", "2"… keyed by ply number
        from: Square
        to: Square
        hash: string                   //   post-move board hash for desync detection
        clock: ClockRemaining | null   //   mover's authoritative clock snapshot
    signals/                           // ← one-shot events, pushed with .push()
      {push_id}/
        type: 'resign' | 'timeout' | 'rematch' | 'hello' | 'resync-request'
        from: string                   //   sender uid
        ts: number                     //   serverTimestamp
        payload: object | null         //   { name: string } for hello; null otherwise
    meta/
      createdAt: number    // serverTimestamp on room create
      status: 'waiting' | 'active' | 'finished'
      hostColor: PieceColor
      timeControlId: TimeControlId

/queue/
  {uid}/                   // Quick Match queue entries
    name: string
    since: number          // serverTimestamp — FIFO ordering
    matchedWith: string | null   // set atomically by the first player who claims the pair
    roomCode: string | null      // claimer generates via generatePasscode(), writes here
```

### Message Type → Firebase Path Mapping

This is the critical translation layer. Every `send(msg)` in `useUplinkGame.ts` maps to
a specific Firebase write, and every Firebase listener triggers a specific `UplinkHandlers`
callback:

| WebSocket `send()` type | Firebase write | Firebase listener → callback |
|---|---|---|
| `state-init` | `set()` on `/rooms/{code}/state/` (ply=0) | Guest: `onValue` on `/state/` when ply=0 → `onStateInit` |
| `move` | `set()` on `/rooms/{code}/moves/{ply}/` | Both: `onChildAdded` on `/moves/` → `onRemoteMove` (skip own ply) |
| `resign` | `.push()` to `/rooms/{code}/signals/` | Both: `onChildAdded` on `/signals/` where type='resign' → `onResign` |
| `timeout` | `.push()` to `/rooms/{code}/signals/` | Both: `onChildAdded` on `/signals/` where type='timeout' → `onTimeout` |
| `rematch` | `.push()` to `/rooms/{code}/signals/` | Both: `onChildAdded` on `/signals/` where type='rematch' → `onRematch` |
| `hello` | `.push()` to `/rooms/{code}/signals/` | Both: `onChildAdded` on `/signals/` where type='hello' → `onPeerHello` |
| `resync` | `set()` on `/rooms/{code}/state/` (ply>0) | Guest: `onValue` on `/state/` when ply>0 → `onResync` |
| `resync-request` | `.push()` to `/rooms/{code}/signals/` | Host: `onChildAdded` on `/signals/` where type='resync-request' → `onResyncRequest` |
| *(no message)* | Guest writes to `/rooms/{code}/guest/` | Host: `onValue` on `/guest/uid` → `onPeerJoined` |
| *(no message)* | `.onDisconnect()` sets `connected: false` | Opponent: `onValue` on seat's `connected` → `onPeerLeft` |

**Implementation notes:**
- **`useUplink.ts` must maintain its own ply counter.** `MoveMessage` in `protocol.ts`
  has `{ type: 'move', from, to, hash, clock? }` — no `ply` field. The WebSocket relay
  didn't need plies (it just forwarded blobs), but Firebase writes go to `/moves/{ply}/`.
  The new `useUplink.ts` keeps an internal counter: starts at 0, incremented on each sent
  or received move. Reset to 0 when writing `state-init` (new game / rematch). This counter
  is internal to the transport — `useUplinkGame.ts` still maintains its own `plyRef` for
  desync detection, unchanged.
- **Rematch cleanup.** On rematch, before writing the new `/state/` (ply=0), the host must
  `remove()` both `/rooms/{code}/moves/` and `/rooms/{code}/signals/` to clear stale data
  from the previous game. Without this: (a) the `!data.exists()` per-ply guard blocks new
  moves at ply slots that already exist, and (b) old signals (resign, rematch) from the
  previous game would re-fire if listeners are ever re-attached (e.g., on reconnect).
  The security rules grant the host DELETE access at the collection level for this purpose.
- `onChildAdded` on `/signals/` fires once per pushed node — the RTDB equivalent of a
  WebSocket message. Filter by `from !== myUid` to skip own signals (rematch is sent and
  received by different peers).
- `/state/` uses `onValue` (not `onChildAdded`) because it's overwritten in place — each
  write replaces the full snapshot. The ply guard (`if ply < localPly return`) prevents
  stale resyncs, matching the existing check in `useUplinkGame.ts` line 227.
- Moves use `onChildAdded` on `/moves/` — the listener fires once per appended ply.
  Skip plies where the mover is self (even ply = white, odd = black, known from color roll).

---

## Firebase Security Rules

> **Known issue with the rules draft in the previous version:** The `.read` rule on rooms
> required the guest's uid to already be in the room before they could read it — a chicken-
> and-egg deadlock. Corrected below.

```json
{
  "rules": {
    "presence": {
      ".read": true,
      "$uid": {
        ".write": "auth != null && auth.uid === $uid"
      }
    },
    "rooms": {
      "$passcode": {
        ".read": "auth != null",
        "host": {
          ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid)"
        },
        "guest": {
          ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid)"
        },
        "state": {
          ".write": "auth != null && (root.child('rooms').child($passcode).child('host/uid').val() === auth.uid)"
        },
        "moves": {
          ".write": "auth != null && !newData.exists() && root.child('rooms').child($passcode).child('host/uid').val() === auth.uid",
          "$ply": {
            ".write": "auth != null && !data.exists() && (root.child('rooms').child($passcode).child('host/uid').val() === auth.uid || root.child('rooms').child($passcode).child('guest/uid').val() === auth.uid)"
          }
        },
        "signals": {
          ".write": "auth != null && !newData.exists() && root.child('rooms').child($passcode).child('host/uid').val() === auth.uid",
          "$push_id": {
            ".write": "auth != null && (root.child('rooms').child($passcode).child('host/uid').val() === auth.uid || root.child('rooms').child($passcode).child('guest/uid').val() === auth.uid)"
          }
        },
        "meta": {
          ".write": "auth != null && (!data.exists() || root.child('rooms').child($passcode).child('host/uid').val() === auth.uid)"
        }
      }
    },
    "queue": {
      "$uid": {
        ".read": true,
        ".write": "auth != null && auth.uid === $uid",
        "matchedWith": {
          ".write": "auth != null && !data.exists()"
        },
        "roomCode": {
          ".write": "auth != null && !data.exists()"
        }
      }
    }
  }
}
```

> **Security rule changes from prior drafts:**
> - `moves/` has TWO levels of rules:
>   - **Collection level** (`moves/`): host-only DELETE (`!newData.exists()`) — needed for
>     rematch cleanup. Without this, the `!data.exists()` per-ply guard blocks new moves at
>     ply "0", "1", etc. that already exist from the previous game.
>   - **Per-ply level** (`moves/$ply`): append-only CREATE (`!data.exists()`) for both players.
> - `signals/` uses the same two-level pattern as `moves/`:
>   - **Collection level** (`signals/`): host-only DELETE (`!newData.exists()`) for rematch cleanup.
>   - **Per-signal level** (`signals/$push_id`): both players can push new signals.
> - `queue/$uid`: owner writes the full entry (name, since). But `matchedWith` and `roomCode`
>   need child-level rules allowing ANY authenticated user to write once (`!data.exists()`),
>   because the claiming player writes to another player's queue entry during Quick Match.
>   RTDB child `.write` rules grant access independently of parent denial.

> **These rules are a starting sketch, not production-ready.** They need review and
> testing in the Firebase Rules Playground before shipping. The `.read: true` on rooms
> means any authenticated user can read any room — acceptable for a passcode-gated game
> (guessing a 5-char code from a 32-char alphabet = 33M combinations) but not fully locked.

---

## Quick Match — Race Condition Handling

When two players enter the queue simultaneously, both read the same "oldest entry" and
try to match with it. Without protection this creates duplicate matches.

**Solution: Firebase RTDB transactions on `matchedWith`.**

```
Player A enters queue at t=0
Player B enters queue at t=1
Player C enters queue at t=2

Player B sees A's entry (oldest), runs transaction:
  if matchedWith === null → set matchedWith = B.uid, return A's entry as B's match
Player C also sees A's entry, runs transaction:
  matchedWith is already B.uid → transaction aborts → C waits for next entry
```

The transaction is atomic: only one player can claim any given queue slot. The matched
pair then negotiates who is host by uid comparison (lower uid = host, for determinism).

---

## New / Modified Files

| File | Change | Phase |
|---|---|---|
| `src/lib/net/firebase.ts` | **New** — Firebase app init, RTDB + Auth singletons | 1 |
| `src/hooks/useUplink.ts` | **Replace internals** — Firebase RTDB listeners, same `UplinkApi` surface. Phase 2: add `'reconnecting'` to `UplinkStatus` | 1, 2 |
| `src/lib/net/protocol.ts` | Remove `uplinkUrl()` (dead code after migration) | 1 |
| `src/hooks/useUplinkGame.ts` | Phase 1: untouched. **Phase 2: expose `reconnecting` boolean** from uplink status | 2 |
| `src/components/game/LocalGame.tsx` | Phase 1: untouched. **Phase 2: clock pause + reconnection banner** when `reconnecting` | 2 |
| `src/hooks/useOnlinePresence.ts` | **New** — presence write + `.onDisconnect()` + online count (auth is in `firebase.ts`, Phase 1) | 2 |
| `src/components/game/modals/UplinkModal.tsx` | Add `'quick-match'` screen + online count badge | 2–3 |
| `src/hooks/useQuickMatch.ts` | **New** — RTDB transaction-based matchmaking queue | 3 |
| `src/lib/net/roomCleanup.ts` | **New** — delete room node on game-end | 1 |
| `package.json` | Add `firebase` web SDK v10 | 1 |
| `src/main.tsx` | No change needed — auth is fire-and-forget in `firebase.ts`, not a render gate | — |
| `.env.example` | Add `VITE_FIREBASE_*` variables | 1 |
| `capacitor.config.ts` | No change needed | — |
| `server.js` | Remove Uplink relay (lines ~371-481 + `ws` import); engine proxy stays | cleanup |
| `src/vite-env.d.ts` | Remove `VITE_UPLINK_URL` type declaration (line 7) | cleanup |

---

## Migration Phases

### Phase 1 — Transport swap (Play a Friend only)
Replace `useUplink.ts` WebSocket internals with Firebase RTDB. Preserve `UplinkApi`
exactly. Remove `uplinkUrl()` from `protocol.ts`. No new UI. Uplink works on mobile.

### Phase 2 — Presence + reconnection
Implement `useOnlinePresence.ts` (presence write, `.onDisconnect()`, online count — auth
already handled in `firebase.ts` from Phase 1). Show counter in `UplinkModal`. Add
`'reconnecting'` to `UplinkStatus`. Implement 90-second reconnection window.

### Phase 3 — Quick Match
Implement `useQuickMatch.ts` with RTDB transactions. Add `'quick-match'` screen to
`UplinkModal`. FIFO matching with atomic claim.

### Phase 4 — Share sheet + deep links
`@capacitor/share` for native Android share sheet. Custom URI scheme
`gridlockchess://join/{code}` registered in `AndroidManifest.xml` + handled in routing.

---

## Packages Required

```bash
npm install firebase              # Web SDK v10 (modular, tree-shakeable)
npm install @capacitor/share      # Phase 4 only — native share sheet
```

No native Firebase Capacitor plugins needed. Firebase JS SDK v10 works inside
Capacitor's Android WebView identically to a browser. Anonymous Auth + RTDB are
implemented entirely in JavaScript with no native bridge required.

---

## Firebase Free Tier Limits & Headroom

| Metric | Free Limit | Per Active Game |
|---|---|---|
| Simultaneous connections | 100 | 2 |
| Storage | 1 GB | ~2–5 KB |
| Download | 10 GB/month | ~10–20 KB (moves + state) |
| **Simultaneous games** | | **~50** |
| **Games/month** | | **~millions** |

50 simultaneous games is plenty for an indie game at launch. If it exceeds that, the
Blaze (pay-as-you-go) plan is $5/GB — the Spark limits are generous enough to never
hit unless the game genuinely goes viral.

---

## Open Questions (Decide Before Phase 3)

1. **Elo / skill rating?** Pure FIFO is simpler and fairer at low player counts. Add Elo
   only when the player base is large enough that mismatched games become a complaint.

2. **Room expiry?** Recommend: client deletes the room node on game-end (Phase 1, in
   `roomCleanup.ts`). Add a TTL field + lazy cleanup (delete rooms older than 24h on next
   read) for orphaned rooms. Cloud Functions are overkill at this scale.

3. **Spectator mode?** Rooms are already persistent — spectators can listen to `moves/`
   and replay them. Architecturally free after Phase 1. Add as Phase 5 if desired.

4. **Guest name auto-generation?** If the player skips entering a name, generate one from
   the uid suffix: `"Player 3K7"`. Consistent with existing `sanitizePlayerName()` fallback
   to `'Opponent'`.

5. **`.env` in CI/APK builds?** When building the release APK, `VITE_FIREBASE_*` env vars
   must be set in the build environment (GitHub Actions secrets, local `.env`, etc.). The
   values are embedded in the compiled JS bundle — they are not secret (Firebase API keys
   are safe to bundle; security is enforced by Firebase Security Rules, not key secrecy).

---

## Known Gaps & Honest Caveats

- **`useUplinkGame.ts` verified** — fully read and confirmed: it only consumes `UplinkApi`
  via 10 `UplinkHandlers` callbacks. All 10 callbacks are mapped in the data model above.
- **Offline-first constraint** — the app works entirely without network (bot games,
  sandbox, Run Dry). Firebase auth is fire-and-forget, NOT a render gate. If auth fails
  (no network), the app renders normally — only Uplink features are unavailable. Auth is
  checked lazily in `useUplink.ts` before room operations.
- **Relay error parity** — the current WebSocket relay returns `'bad-room'` (room doesn't
  exist) and `'room-full'` (guest seat taken) errors (`useUplink.ts` line 113). The
  Firebase version must replicate this by reading host/guest seats before writing. Without
  these checks, `join()` would silently create phantom rooms or fail with opaque
  `PERMISSION_DENIED` errors instead of user-friendly messages.
- **Firebase Anonymous Auth on Android** — works via web SDK in WebView, confirmed by
  Firebase docs. Not personally tested in this project.
- **Latency numbers** are rough industry estimates, not benchmarks from this codebase.
- **Security rules** are a starting sketch. They must be tested in the Firebase Rules
  Playground before any real user data is stored.
- **Quick Match transactions** — Firebase RTDB transactions can fail and retry. The
  implementation must handle retries gracefully (spinner keeps running, not error state).
- **Clock sync with Firebase latency** — a move's clock snapshot is written to RTDB and
  arrives ~50–100ms later. The existing `useUplinkGame.ts` clock design already handles
  this: the mover's snapshot is authoritative (their machine timed their turn), and the
  `FLAG_CLAIM_GRACE_MS` of 3 seconds covers the round-trip. No additional design needed,
  but implementors should be aware that Firebase adds ~2x the latency of a direct WebSocket
  (two hops: client→Firebase→client vs client→relay→client).
- **`.onDisconnect()` is server-side, ~60–90s delay** — when a client loses connectivity,
  Firebase's server takes up to 60–90 seconds to confirm the dead connection before firing
  `.onDisconnect()` handlers. The 90-second reconnection window in the design is sized to
  match this: the opponent starts the countdown when they see `connected: false`, which
  Firebase writes after ~60–90s of silence. The countdown gives the disconnected player
  up to ~3 minutes total real-world grace (90s server detect + 90s countdown).
- **Reconnection + `onChildAdded` replay (Phase 2)** — if a player disconnects and
  reconnects mid-game, re-attaching `onChildAdded` listeners fires for ALL existing
  children — both `/signals/` AND `/moves/`. Consequences:
  - **Signals:** an old `rematch` signal re-firing mid-game would reset the board.
  - **Moves:** every move from the current game replays via `onRemoteMove` → `makeMove()`
    on an already-correct board, causing illegal move errors or double-applications. This
    is **worse** than the signals case because moves directly mutate board state.
  **Fix:** on reconnect, use `startAfter(lastSeenKey)` when re-attaching both listeners
  so only new children (added after the last one processed) trigger callbacks. The internal
  ply counter (for moves) and a "last-seen push ID" (for signals) provide the cursors.
  This is a Phase 2 concern — Phase 1 listeners stay attached for the full session.

---

## Implementation Checklist (Easiest → Hardest)

### Pre-work (no code)
- [x] Create Firebase project at console.firebase.google.com (Spark plan, free)
- [x] Enable Realtime Database (start in test mode)
- [x] Enable Authentication → Anonymous provider
- [x] Copy Firebase config object (apiKey, authDomain, databaseURL, projectId, appId)
- [x] Add `VITE_FIREBASE_*` variables to `.env` and `.env.example`
- [x] Verify `.env` is in `.gitignore`

### Phase 1 — Play a Friend via Firebase (core transport swap)
- [x] `npm install firebase`
- [x] Create `src/lib/net/firebase.ts` — init Firebase app, export `db` (RTDB) and `auth` (Auth) singletons
- [x] Call `signInAnonymously(auth)` in `firebase.ts` at import time (fire-and-forget). Do **NOT** gate the app render on auth — this is an offline-first app (local bot games, sandbox, Run Dry all work without network). If `signInAnonymously()` fails (no internet, first launch), the app must still render normally. Auth readiness is checked lazily: `useUplink.ts` reads `auth.currentUser` before `host()` or `join()`, and sets `error: 'Not connected'` + `status: 'error'` if null. The existing `UplinkModal.tsx` already disables Uplink buttons when offline (`disabled={!online}`, lines 139/146), so most users never hit this path.
- [x] Rewrite `useUplink.ts` internals to use RTDB listeners — same `UplinkApi` surface, no interface changes
  - [x] `host()`: write room node at `/rooms/{code}/host/{uid, name, connected: true}`, set `.onDisconnect()` on `connected`, listen for guest seat write via `onValue` on `/rooms/{code}/guest/uid` → trigger `onPeerJoined`
  - [x] `join(code)`: validate room BEFORE writing guest seat (bad-room + room-full error parity)
  - [x] Maintain internal ply counter; `send(msg)` routes all 8 message types correctly
  - [x] `onChildAdded` on moves (skip own plies) + signals (skip own uid)
  - [x] `onValue` on opponent seat `connected` → `onPeerLeft`
  - [x] `leave()`: remove own seat, detach listeners, cancel `.onDisconnect()`
- [x] Create `src/lib/net/roomCleanup.ts` — delete room node when game finishes
- [x] Remove `uplinkUrl()` from `protocol.ts`
- [x] Update `.env.example` with `VITE_FIREBASE_*` placeholder keys
- [ ] Smoke test: two browsers on same machine, Play a Friend works end-to-end
- [ ] Smoke test: browser + Android device, Play a Friend works end-to-end
- [x] `tsc -b` clean

### Phase 2 — Presence + reconnection
- [x] Create `src/hooks/useOnlinePresence.ts` — presence write, `.onDisconnect().remove()`, child count
- [x] Wire `useOnlinePresence` into `UplinkModal` — "~N online" badge in header
- [x] Add `'reconnecting'` to `UplinkStatus` type in `useUplink.ts`
- [x] Implement reconnection in `useUplink.ts`: 90s grace timer; cancel on reconnect; fire `onPeerLeft` on expiry
- [x] Extend `useUplinkGame.ts`: expose `reconnecting: boolean`
- [x] Extend `LocalGame.tsx`: clock pause + amber reconnection banner when `reconnecting`
- [x] `startAfter()` — not needed: listeners stay attached for the full session; Firebase SDK reconnects transport transparently
- [ ] Smoke test: kill network mid-game → opponent sees "reconnecting" + clocks pause → restore network → game resumes

### Phase 3 — Quick Match
- [x] Create `src/hooks/useQuickMatch.ts` — FIFO queue, RTDB transaction claim, host/guest split
- [x] Add searching screen — spinner, elapsed timer (`0:00`), online count, cancel
- [x] Add "🌐 Find a Match" as primary button on choice screen; rename "Open Uplink" → "📡 Play a Friend"
- [x] Quick Match host waiting: shows "Opponent found — connecting…" (no code to share)
- [ ] Smoke test: two devices enter queue → match within seconds → game starts

### Phase 4 — Share sheet
- [x] `npm install @capacitor/share`
- [x] Share button on "Play a Friend" waiting screen — uses `Share.canShare()` gate; fires native Android sheet or Web Share API; falls back silently (copy button always available)
- [ ] Deep links — `gridlockchess://` URI scheme in `AndroidManifest.xml` + routing handler (optional, deferred)
- [ ] Test on device: share → tap link → app opens to join screen with code pre-filled (deferred)

### Cleanup
- [x] Remove Uplink relay code from `server.js` (~110 lines + `ws` import removed; `httpServer` → `app.listen()`)
- [x] Remove `ws` and `@types/ws` from `package.json`
- [x] `VITE_UPLINK_URL` removed from `protocol.ts` and `src/vite-env.d.ts`
- [ ] **ACTION REQUIRED — Firebase Security Rules**: replace test-mode rules with the production rules in the §Firebase Security Rules section of this doc. Steps:
  1. Go to Firebase console → Realtime Database → Rules tab
  2. Paste the rules from §Firebase Security Rules above
  3. Test in Firebase Rules Playground (tab next to Rules)
  4. Publish
- [ ] Caddyfile: no config change needed (engine proxy only, no Uplink-specific route)

---

## Effort Assessment — Easiest to Hardest

### Manual Firebase Setup (Before Any Code)

All browser-based, no code. ~20–30 minutes:

1. Go to `console.firebase.google.com` — sign in with a Google account
2. **Create project** → name it (e.g. `gridlock-chess`) → Spark plan (free, no credit card required)
3. **Add a Web app** to the project → Firebase gives you the config object
4. **Enable Realtime Database** → Create database → Start in **test mode** (lock down with real rules before shipping)
5. **Enable Authentication** → Sign-in providers → **Anonymous** → Enable → Save
6. Copy `apiKey`, `authDomain`, `databaseURL`, `projectId`, `appId` into your `.env`
7. Before shipping: paste the security rules from §Firebase Security Rules into the Firebase console → Rules tab
8. Test those rules in the **Firebase Rules Playground** (tab inside the console)

No `google-services.json`, no native plugins needed — the Firebase JS SDK runs inside the Capacitor WebView identically to a browser.

---

### Implementation Steps — Easiest to Hardest

#### 1. `.env.example` — ~5 lines added · trivial · Phase 1
Add 5 `VITE_FIREBASE_*` placeholder vars. No logic.

---

#### 2. `src/vite-env.d.ts` — ~4 lines changed · trivial · Phase 1 / Cleanup
Remove `readonly VITE_UPLINK_URL?: string` (line 7). Add the 5 Firebase var type declarations.

---

#### 3. `src/lib/net/protocol.ts` — ~15 lines deleted · easy · Phase 1 / Cleanup
Remove `uplinkUrl()` (lines 195–204) and the `UPLINK_PATH` constant (line 19). Everything else — `hashBoard`, `generatePasscode`, `sanitizePlayerName`, all message types — stays exactly as-is.

---

#### 4. `src/lib/net/roomCleanup.ts` — new file, ~25 lines · easy · Phase 1
Single exported function that calls `remove()` on `/rooms/{code}`. Imports `db` from `firebase.ts`. Requires `firebase.ts` to exist first.

---

#### 5. `src/lib/net/firebase.ts` — new file, ~35 lines · easy · Phase 1
Init Firebase app from `VITE_FIREBASE_*` env vars, export `db` (RTDB ref) and `auth` (Auth instance), call `signInAnonymously(auth)` fire-and-forget. Must NOT be a render gate — auth failure leaves the app fully functional, only Uplink unavailable.

---

#### 6. `src/hooks/useUplinkGame.ts` — ~10 lines added · easy · Phase 2
Expose `reconnecting: boolean` derived from `uplink.status === 'reconnecting'`. Current file is 490 lines and untouched in Phase 1.

---

#### 7. `src/components/game/LocalGame.tsx` — ~20 lines changed · easy · Phase 2
Change clock's `running` prop to also check `!uplinkGame.reconnecting`. Add reconnection banner UI when `reconnecting` is true. Current file is 1591 lines; changes are localized (clock line ~409).

---

#### 8. `src/hooks/useOnlinePresence.ts` — new file, ~60 lines · medium · Phase 2
Write `presence/{uid}` on connect, `.onDisconnect().remove()` it, listen to `/presence/` children with `onValue` and count them. Key point: `.onDisconnect()` does NOT support `runTransaction()`, so the online count is derived by counting presence nodes client-side — not a server-side counter (which would drift).

---

#### 9. `src/components/game/modals/UplinkModal.tsx` — ~80 lines added · medium · Phase 2–3
Current file is 255 lines. Incremental across phases:
- **Phase 2**: Add online count badge to header (~20 lines)
- **Phase 3**: Add `'quick-match'` to the `screen` state union, add "🌐 Find a Match" button to choice screen, build quick-match screen with spinner + elapsed time + cancel button (~60 lines)

Existing `'choice' | 'join'` screen pattern is clean — adding `'quick-match'` follows the same structure.

---

#### 10. `src/hooks/useUplink.ts` — full rewrite, ~300 lines · hard · Phase 1–2
Current file is 212 lines (WebSocket). Replaces all internals with Firebase RTDB while preserving the exact `UplinkApi` surface. Breaking this interface cascades into `useUplinkGame.ts` and `LocalGame.tsx`.

Key complexity:
- `join()` must validate room exists AND isn't full before writing guest seat — replicating the current `'bad-room'`/`'room-full'` error messages (line 113 in current file)
- Internal ply counter required — `MoveMessage` has no `ply` field, the transport must track it
- `send()` routes 8 message types to two Firebase path patterns (state nodes vs. signal nodes)
- Rematch cleanup: `remove()` `/moves/` and `/signals/` before writing new `state-init`
- **Phase 2 addition**: `'reconnecting'` status + 90-second timer + `startAfter()` cursor on listener re-attach to prevent `onChildAdded` replay of already-processed moves and signals

---

#### 11. `src/hooks/useQuickMatch.ts` — new file, ~130 lines · hard · Phase 3
FIFO matchmaking with RTDB atomic transactions:
- Write own entry to `/queue/{uid}` with `serverTimestamp`
- Listen to `/queue` ordered by `since`; find oldest non-self entry
- Run `runTransaction()` on `matchedWith` — only one player can claim a queue slot
- Handle transaction retries gracefully (spinner stays running, no error state)
- Claimer generates room code via `generatePasscode()` and writes to matched entry's `roomCode` field; both sides read the same code and join the room

The race condition handling (two players simultaneously claiming the same slot) is the genuinely hard part.

---

#### 12. Phase 4 — deep links · hard (device-only) · Phase 4
~50 lines across 3 files, but hardest to verify — requires testing on a physical device:
- `AndroidManifest.xml`: register `gridlockchess://` URI scheme as an intent filter
- App routing: parse incoming deep link, extract join code, open UplinkModal pre-filled
- `UplinkModal.tsx`: share button using `@capacitor/share`

---

#### 13. `server.js` cleanup — ~110 lines deleted · easy · Cleanup
Remove Uplink relay code (lines ~371–481 + `ws` import). Keep engine proxy. Remove `ws` from `package.json`.

---

### Summary Table

| Step | File | Change | Lines | Difficulty | Phase |
|------|------|--------|-------|------------|-------|
| Firebase console | — | Manual setup | — | Trivial | Day 0 |
| `.env.example` | existing | +5 vars | ~5 | Trivial | 1 |
| `vite-env.d.ts` | existing | edit | ~4 | Trivial | 1 |
| `protocol.ts` | existing | delete `uplinkUrl()` | ~15 del | Easy | 1 |
| `roomCleanup.ts` | new | +25 | ~25 | Easy | 1 |
| `firebase.ts` | new | +35 | ~35 | Easy | 1 |
| `useUplinkGame.ts` | existing | +10 | ~10 | Easy | 2 |
| `LocalGame.tsx` | existing | +20 | ~20 | Easy | 2 |
| `useOnlinePresence.ts` | new | +60 | ~60 | Medium | 2 |
| `UplinkModal.tsx` | existing | +80 | ~80 | Medium | 2–3 |
| `useUplink.ts` | existing | full rewrite | ~300 | Hard | 1–2 |
| `useQuickMatch.ts` | new | +130 | ~130 | Hard | 3 |
| Deep links | 3 files | +50 | ~50 | Hard (device) | 4 |
| `server.js` | existing | ~110 del | ~110 del | Easy | Cleanup |

**Total: ~750 lines added, ~135 lines deleted across 4 phases.**

The Phase 1 `useUplink.ts` rewrite is the single highest-risk task. Everything else is additive or clearly bounded.
