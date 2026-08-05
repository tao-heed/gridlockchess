# Firestore Migration Plan — RTDB → Firestore (Uplink v3)

## When to Trigger This Migration

Do NOT migrate prematurely. Trigger this plan when **any** of the following are observed
in production:

- Firebase console shows simultaneous RTDB connections routinely above **70** (the safe
  headroom before the 100-connection Spark ceiling causes user-facing errors)
- Players report "Connection failed" errors that correlate with peak concurrent sessions
- Firebase console → Realtime Database → Usage → Connections graph is consistently near 100

Until then, the current RTDB Spark setup is free, stable, and requires zero action.

---

## Why Not a Full RTDB → Firestore Swap

Firestore has **no `onDisconnect()` equivalent**. This API is the backbone of Gridlock's
peer-left detection: Firebase server sets `connected = false` on a seat the moment the
client's TCP connection drops, without any client-side code running. Firestore cannot do
this without a Cloud Function (which requires the Blaze plan — costs money).

**Solution: Hybrid architecture.**

| Layer | Database | Why |
|---|---|---|
| Presence (`connected` flags) | RTDB | `onDisconnect()` is irreplaceable and free |
| Game data (state, moves, signals) | Firestore | No connection ceiling, better free tier |
| Matchmaking queue | Firestore | Atomic transactions, no connection cost |
| Auth | Firebase Auth | Unchanged |

RTDB is kept **only** for the two `connected` boolean fields per room. Everything else
moves to Firestore. RTDB connection count drops from 1-per-user to 1-per-user (unchanged)
BUT Firestore listeners are HTTP/2 and do NOT count toward RTDB's 100-connection limit.
Result: game data scales freely; presence stays cheap.

---

## Free Tier After Migration

### Firebase RTDB (presence only)
| Limit | Spark | Usage after migration |
|---|---|---|
| Simultaneous connections | 100 | 1 per active player (presence only) |
| Storage | 1 GB | ~negligible (just booleans) |
| Downloads | 10 GB/mo | ~negligible |

### Firestore (game data)
| Limit | Spark | Estimate per match |
|---|---|---|
| Document reads | 50,000/day | ~5–10 reads per match |
| Document writes | 20,000/day | ~30–60 writes per 30-move game |
| Document deletes | 20,000/day | ~5 deletes on cleanup |
| Storage | 1 GB | ~2–5 KB per room |
| **Simultaneous connections** | **No limit** | — |

At 20,000 writes/day ÷ ~50 writes/match = **~400 matches/day free**. Orders of magnitude
beyond RTDB's 50 simultaneous matches.

---

## Current RTDB Data Model

```
/presence/{uid}                     boolean (true)
/queue/{uid}                        { name, since, matchedWith, roomCode }
/rooms/{code}/host                  { uid, name, connected }
/rooms/{code}/guest                 { uid, name, connected }
/rooms/{code}/state                 { ...StateSnapshot, ply }
/rooms/{code}/moves/{ply}           { from, to, hash, clock?, promotion? }
/rooms/{code}/signals/{pushId}      { type, from, ts, payload? }
```

---

## Target Data Model

### RTDB (presence only — unchanged paths)
```
/presence/{uid}                     boolean (true)          ← unchanged
/rooms/{code}/host/connected        boolean                 ← ONLY this field stays in RTDB
/rooms/{code}/guest/connected       boolean                 ← ONLY this field stays in RTDB
```

### Firestore (new)
```
/rooms/{code}                       document: { hostUid, hostName, guestUid?, guestName? }
/rooms/{code}/moves/{ply}           document: { from, to, hash, clock?, promotion?, ts }
/rooms/{code}/signals/{auto-id}     document: { type, from, ts, payload? }
/rooms/{code}/state                 single document: { ...StateSnapshot, ply }
/queue/{uid}                        document: { name, since, matchedWith?, roomCode? }
```

**Note:** Move documents use the ply number as their Firestore document ID (e.g. `"0"`,
`"1"`, `"2"`) — identical to the current RTDB key scheme. This keeps the rejoin ply
counter logic in `useUplink.ts` unchanged.

---

## API Mapping Reference

| RTDB | Firestore |
|---|---|
| `ref(db, path)` | `doc(db, path)` or `collection(db, path)` |
| `set(ref, data)` | `setDoc(docRef, data)` |
| `get(ref)` | `getDoc(docRef)` |
| `push(ref, data)` | `addDoc(collRef, data)` |
| `remove(ref)` | `deleteDoc(docRef)` |
| `onValue(ref, cb)` | `onSnapshot(docRef, cb)` |
| `onChildAdded(ref, cb)` | `onSnapshot(query(collRef, orderBy('ts')), cb)` + `docChanges()` |
| `onDisconnect(ref).set(v)` | **No equivalent → stays in RTDB** |
| `runTransaction(ref, fn)` | `runTransaction(db, async (tx) => { ... })` |
| `serverTimestamp()` | `serverTimestamp()` (from `firebase/firestore`) |
| `orderByChild('since')` | `orderBy('since')` |
| `query(ref, orderByChild(...))` | `query(collRef, orderBy(...))` |

### `onChildAdded` → Firestore `onSnapshot` pattern

RTDB `onChildAdded` fires once per existing child on attach, then once per new child.
Firestore `onSnapshot` fires with the full collection, then incremental diffs. Use
`docChanges()` filtered to `type === 'added'`:

```typescript
// RTDB (current)
onChildAdded(ref(db, `rooms/${code}/moves`), (snap) => {
  const plyKey = Number(snap.key);
  const data = snap.val();
  // handle move
});

// Firestore (target)
onSnapshot(
  query(collection(db, `rooms/${code}/moves`), orderBy('__name__')),
  (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== 'added') return;
      const plyKey = Number(change.doc.id);
      const data = change.doc.data();
      // handle move — identical logic
    });
  }
);
```

---

## File-by-File Changes

### 1. `src/lib/net/firebase.ts`

Add Firestore instance alongside the existing RTDB instance:

```typescript
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';

const app    = initializeApp(firebaseConfig);
export const db      = getDatabase(app);   // RTDB — presence only
export const fstore  = getFirestore(app);  // Firestore — game data
export const auth    = getAuth(app);

signInAnonymously(auth).catch(() => {});
```

**Est. change: +3 lines.**

---

### 2. `src/lib/net/roomCleanup.ts`

Delete the Firestore room document AND the RTDB presence nodes:

```typescript
import { doc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { ref, remove } from 'firebase/database';
import { db, fstore } from './firebase';

export async function cleanupRoom(roomCode: string): Promise<void> {
  // Firestore: delete room document + subcollections (moves, signals, state)
  const subcollections = ['moves', 'signals', 'state'];
  await Promise.all([
    deleteDoc(doc(fstore, `rooms/${roomCode}`)),
    ...subcollections.map(async (sub) => {
      const snap = await getDocs(collection(fstore, `rooms/${roomCode}/${sub}`));
      return Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    }),
  ]);
  // RTDB: delete the presence nodes
  remove(ref(db, `rooms/${roomCode}`)).catch(() => {});
}
```

**Note:** Firestore does not cascade-delete subcollections when a document is deleted.
Each subcollection must be deleted explicitly. For production scale, use a Cloud Function
or the Firebase Admin SDK to handle this server-side.

**Est. change: ~20 lines.**

---

### 3. `src/hooks/useQuickMatch.ts`

Replace RTDB queue with Firestore collection. Logic is identical; only the API changes:

```typescript
import {
  doc, collection, setDoc, deleteDoc, onSnapshot,
  query, orderBy, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { fstore } from '@/lib/net/firebase';

// set queue entry
await setDoc(doc(fstore, `queue/${myUid}`), {
  name: playerNameRef.current,
  since: serverTimestamp(),
  matchedWith: null,
  roomCode: null,
});

// watch queue ordered by since
onSnapshot(query(collection(fstore, 'queue'), orderBy('since')), (snap) => {
  // snap.docs replaces snap.forEach
  // runTransaction API is similar but callback is async and receives transaction object
});

// delete on cancel
await deleteDoc(doc(fstore, `queue/${myUid}`));
```

**Est. change: ~40 lines (API swap, logic unchanged).**

---

### 4. `src/hooks/useUplink.ts` — Major rewrite (~150 lines changed)

This is the largest change. The structure and logic are identical; only the transport layer
changes. Key sections:

#### `host()` — Write host seat to Firestore, presence to RTDB

```typescript
// Firestore: seat data
await setDoc(doc(fstore, `rooms/${code}`), { hostUid: myUid, hostName: '' });

// RTDB: connected flag + onDisconnect (unchanged)
await set(ref(db, `rooms/${code}/host/connected`), true);
await onDisconnect(ref(db, `rooms/${code}/host/connected`)).set(false);
```

#### `attachGameListeners()` — Firestore listeners for moves/signals/state

```typescript
// Moves
const unsubMoves = onSnapshot(
  query(collection(fstore, `rooms/${code}/moves`), orderBy('__name__')),
  (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== 'added') return;
      const plyKey = Number(change.doc.id);
      // existing logic unchanged
    });
  }
);

// Signals
const unsubSignals = onSnapshot(
  query(collection(fstore, `rooms/${code}/signals`), orderBy('ts')),
  (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== 'added') return;
      // existing logic unchanged
    });
  }
);

// Opponent connected — RTDB (unchanged — onDisconnect requires it)
const unsubConnected = onValue(
  ref(db, `rooms/${code}/${opponentSeat}/connected`), (snap) => {
    // existing logic completely unchanged
  }
);

// Self-disconnect — RTDB (unchanged)
const unsubSelfConnected = onValue(ref(db, '.info/connected'), (snap) => {
  // existing logic completely unchanged
});

// State listener — Firestore
const unsubState = onSnapshot(doc(fstore, `rooms/${code}/state`), (snap) => {
  if (!snap.exists()) return;
  const raw = snap.data() as StateSnapshot & { ply: number };
  // existing logic completely unchanged
});
```

#### `send()` — Write to Firestore

```typescript
case 'move': {
  const ply = plyRef.current;
  sentPliesRef.current.add(ply);
  await setDoc(doc(fstore, `rooms/${code}/moves/${ply}`), {
    from: msg.from, to: msg.to, hash: msg.hash,
    ...(msg.clock     ? { clock:     msg.clock     } : {}),
    ...(msg.promotion ? { promotion: msg.promotion } : {}),
  });
  plyRef.current = ply + 1;
  break;
}

case 'state-init':
case 'resync': {
  const isInit = msg.type === 'state-init';
  if (isInit) {
    plyRef.current = 0;
    sentPliesRef.current = new Set();
    // Delete stale subcollections
    const cleanup = async () => {
      const [movesSnap, sigsSnap] = await Promise.all([
        getDocs(collection(fstore, `rooms/${code}/moves`)),
        getDocs(collection(fstore, `rooms/${code}/signals`)),
      ]);
      await Promise.all([
        ...movesSnap.docs.map((d) => deleteDoc(d.ref)),
        ...sigsSnap.docs.map((d) => deleteDoc(d.ref)),
      ]);
    };
    await cleanup();
  }
  await setDoc(doc(fstore, `rooms/${code}/state`), {
    ...msg.snapshot,
    ply: isInit ? 0 : msg.ply,
  });
  break;
}

default: {
  // signals — addDoc (auto-id, same as RTDB push())
  await addDoc(collection(fstore, `rooms/${code}/signals`), {
    type: msg.type, from: myUid,
    ts: serverTimestamp(),
    payload: msg.type === 'hello' ? { name: msg.name } : null,
  });
  break;
}
```

---

### 5. Firestore Security Rules (`firestore.rules`)

New file — equivalent of the current `database.rules.json` but for Firestore:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Matchmaking queue — any authenticated user can read/write their own entry
    match /queue/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }

    match /rooms/{code} {
      // Both players can read the room document
      allow read: if request.auth != null;

      // Host seat: only creatable/updatable by the host uid stored in the document
      allow create: if request.auth != null;
      allow update: if request.auth != null
        && (resource.data.hostUid == request.auth.uid
            || resource.data.guestUid == request.auth.uid);

      // Moves subcollection — host or guest can write
      match /moves/{ply} {
        allow read: if request.auth != null;
        allow write: if request.auth != null
          && (get(/databases/$(database)/documents/rooms/$(code)).data.hostUid == request.auth.uid
              || get(/databases/$(database)/documents/rooms/$(code)).data.guestUid == request.auth.uid);
      }

      // Signals subcollection — host or guest can write
      match /signals/{signalId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null
          && (get(/databases/$(database)/documents/rooms/$(code)).data.hostUid == request.auth.uid
              || get(/databases/$(database)/documents/rooms/$(code)).data.guestUid == request.auth.uid);
      }

      // State document — host or guest can write
      match /state {
        allow read: if request.auth != null;
        allow write: if request.auth != null
          && (get(/databases/$(database)/documents/rooms/$(code)).data.hostUid == request.auth.uid
              || get(/databases/$(database)/documents/rooms/$(code)).data.guestUid == request.auth.uid);
      }
    }
  }
}
```

**RTDB rules** (`database.rules.json`) — stripped to presence only:

```json
{
  "rules": {
    "presence": {
      "$uid": {
        ".read":  "auth !== null",
        ".write": "auth.uid === $uid"
      }
    },
    "rooms": {
      "$code": {
        "host": {
          "connected": {
            ".read":  "auth !== null",
            ".write": "auth !== null"
          }
        },
        "guest": {
          "connected": {
            ".read":  "auth !== null",
            ".write": "auth !== null"
          }
        }
      }
    }
  }
}
```

---

## Files to Modify

| File | Change | Est. lines |
|---|---|---|
| `src/lib/net/firebase.ts` | Add Firestore instance | +3 |
| `src/lib/net/roomCleanup.ts` | Rewrite for Firestore + RTDB hybrid | ~20 |
| `src/hooks/useQuickMatch.ts` | Swap RTDB API → Firestore API | ~40 |
| `src/hooks/useUplink.ts` | Major rewrite — transport layer only, logic unchanged | ~150 |
| `src/lib/net/protocol.ts` | **No changes** — pure types, transport-agnostic | 0 |
| `src/hooks/useUplinkGame.ts` | **No changes** — uses handlers only | 0 |
| `firestore.rules` | New file | ~40 |
| `database.rules.json` | Strip to presence-only paths | ~10 |
| **Total** | | **~263** |

---

## Rollout Strategy

### Phase 0 — Preparation (do now, costs nothing)
- Enable Firestore in the Firebase console (same project, add the service)
- Deploy `firestore.rules` with read/write locked to authenticated users only
- Do NOT migrate any code yet

### Phase 1 — Parallel write (low risk)
- Write to BOTH RTDB and Firestore simultaneously from `useUplink.ts`
- Read from RTDB (no change to read path)
- Validates Firestore receives correct data without affecting live players

### Phase 2 — Read from Firestore (cut-over)
- Switch reads to Firestore, keep RTDB writes as fallback
- Monitor for errors; one-line revert to RTDB reads if issues appear

### Phase 3 — RTDB write removal
- Remove all RTDB writes except presence nodes
- RTDB is now presence-only

### Phase 4 — Cleanup
- Remove RTDB rules for game data paths
- Delete orphaned RTDB room data

---

## Rollback Plan

Every phase is independently reversible:

- **Phase 1 rollback:** Remove Firestore writes — back to RTDB-only, zero impact
- **Phase 2 rollback:** One flag/import swap back to RTDB reads
- **Phase 3 rollback:** Re-add RTDB writes alongside Firestore reads

Keep the RTDB `useUplink.ts` implementation in a `feature/uplink-rtdb` git branch for
the duration of the migration. Do not delete it until Phase 4 has been stable for 30 days.

---

## Testing Checklist

Before cutting Phase 2:

- [ ] Host creates room, guest joins — match starts correctly
- [ ] Both players make 10+ moves — moves arrive on both sides, no desync
- [ ] Host disconnects mid-game — guest sees reconnecting state, grace timer fires
- [ ] Host reconnects via "Reconnect to Room" — board restores, correct turn/color
- [ ] Guest disconnects and reconnects — same verification
- [ ] Quick Match — two clients match and start a game
- [ ] Quick Match cancel — queue entry removed from Firestore
- [ ] Resign — opponent receives signal
- [ ] Rematch — board resets, old moves/signals cleared from Firestore
- [ ] Room cleanup on game end — Firestore subcollections deleted
- [ ] Firestore rules — verify non-participants cannot write to a room
- [ ] Spark quota — verify reads/writes/deletes per match are within estimate

---

## What Does NOT Change

- `src/lib/net/protocol.ts` — wire protocol types are transport-agnostic
- `src/hooks/useUplinkGame.ts` — all game logic, color assignment, resync handlers
- `src/components/game/modals/UplinkModal.tsx` — UI untouched
- `src/hooks/useQuickMatch.ts` logic — only the Firebase API calls change
- Firebase Auth — anonymous auth unchanged
- All reconnect UX (30s grace, selfDisconnect countdown, `RECONNECT_KEY`) — unchanged
- All game rules, board state, move validation — completely unaffected
