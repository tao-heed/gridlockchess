// hooks/useUplink.ts — Uplink (Online PvP) Firebase Realtime Database client.
//
// Replaces the WebSocket relay with Firebase RTDB. The public UplinkApi surface
// is identical to the prior WebSocket version — useUplinkGame.ts and LocalGame.tsx
// are unchanged in Phase 1.
//
// Data model (abbreviated):
//   /rooms/{code}/host|guest  — seat nodes; connected field drives peer-left detection
//   /rooms/{code}/state       — overwritten in place (state-init + resync)
//   /rooms/{code}/moves/{ply} — append-only move log
//   /rooms/{code}/signals/    — one-shot events pushed with push() (resign, rematch, …)
import { useEffect, useRef, useState } from 'react';
import {
  ref, set, get, push, remove, onValue, onChildAdded, onDisconnect, serverTimestamp,
  type DataSnapshot,
} from 'firebase/database';
import { db, auth } from '@/lib/net/firebase';
import {
  generatePasscode,
  type GameMessage,
  type StateSnapshot,
  type UplinkRole,
} from '@/lib/net/protocol';
import type { ClockRemaining } from '@/constants/timeControls';
import type { Piece } from '@/types/game';

// Persisted reconnect data — survives page refresh so the lobby can offer auto-reconnect.
// No TTL: data persists until leave() clears it. We can't know when the opponent will start
// their 30s grace countdown (Firebase detection delay is ~60-90s), so a client-side timer
// would be inaccurate. Instead we show the button unconditionally and let rejoin() fail
// gracefully if the room is already dead.
const RECONNECT_KEY = 'gridlock:uplink-reconnect';

/** How the current match was found — controls the reconnect label in the lobby. */
export type MatchSource = 'quick-match' | 'friend';

export interface ReconnectData {
  code: string;
  role: UplinkRole;
  source: MatchSource;
}

/** Read a persisted reconnect record, or null. */
export function readReconnectData(): ReconnectData | null {
  try {
    const raw = localStorage.getItem(RECONNECT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReconnectData;
  } catch { return null; }
}

function writeReconnectData(code: string, role: UplinkRole, source: MatchSource) {
  try {
    localStorage.setItem(RECONNECT_KEY, JSON.stringify({ code, role, source }));
  } catch { /* quota / private mode */ }
}

export function clearReconnectData() {
  try { localStorage.removeItem(RECONNECT_KEY); } catch { /* ignore */ }
}

export type UplinkStatus =
  | 'idle'
  | 'connecting'
  | 'waiting' // host joined, awaiting opponent
  | 'connected'
  | 'reconnecting' // opponent dropped; 30s grace window before awarding win
  | 'error';

export interface UplinkHandlers {
  onPeerJoined?: () => void;
  onPeerLeft?: () => void;
  /** Opponent's connected flag went from false → true (they came back or re-joined). */
  onPeerReconnected?: () => void;
  onStateInit?: (snapshot: StateSnapshot, ply: number) => void;
  onRemoteMove?: (from: string, to: string, hash: string, clock?: ClockRemaining, promotion?: Piece) => void;
  onResign?: () => void;
  onTimeout?: () => void;
  onRematch?: () => void;
  onGameOver?: (status: string, winner: string | null) => void;
  onResync?: (snapshot: StateSnapshot, ply: number) => void;
  onResyncRequest?: () => void;
  onPeerHello?: (name: string) => void;
}

export interface UplinkApi {
  status: UplinkStatus;
  role: UplinkRole | null;
  roomCode: string | null;
  error: string | null;
  /** ms timestamp when the opponent's reconnect grace period ends; null when not reconnecting. */
  reconnectDeadline: number | null;
  /** ms timestamp when OUR OWN connection dropped; null when connected. Lets the
   *  disconnected player see "Connection lost — reconnect within Xs" on their own card. */
  selfDisconnectDeadline: number | null;
  host: (source?: MatchSource) => string;
  join: (code: string, source?: MatchSource) => void;
  /** Re-join a room after a page refresh using persisted code+role. No code entry needed. */
  rejoin: (code: string, role: UplinkRole) => void;
  leave: () => void;
  send: (msg: GameMessage) => void;
}

export function useUplink(handlers: UplinkHandlers): UplinkApi {
  const [status, setStatus]     = useState<UplinkStatus>('idle');
  const [role, setRole]         = useState<UplinkRole | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [reconnectDeadline, setReconnectDeadline] = useState<number | null>(null);
  const [selfDisconnectDeadline, setSelfDisconnectDeadline] = useState<number | null>(null);

  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; });

  // Internal refs — mutable state that does not need to trigger renders
  const plyRef             = useRef(0);
  const sentPliesRef       = useRef(new Set<number>());
  const roomCodeRef        = useRef<string | null>(null);
  const myRoleRef          = useRef<UplinkRole | null>(null);
  const unsubsRef          = useRef<Array<() => void>>([]);
  const reconnectTimerRef  = useRef<number | null>(null);
  // True during re-join: suppresses onRemoteMove from replaying old moves (onChildAdded
  // fires for ALL existing children on attach). Cleared when the resync arrives.
  const awaitingResyncRef  = useRef(false);

  const uid = (): string | null => auth.currentUser?.uid ?? null;

  const clearListeners = () => {
    for (const fn of unsubsRef.current) fn();
    unsubsRef.current = [];
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const resetRefs = () => {
    clearListeners();
    clearReconnectTimer();
    plyRef.current       = 0;
    sentPliesRef.current = new Set();
    roomCodeRef.current  = null;
    myRoleRef.current    = null;
    awaitingResyncRef.current = false;
  };

  // ── Game listeners ────────────────────────────────────────────────────────
  // Attached once both seats are written and the match is live.
  // Called with the role so each side subscribes to the correct paths.

  const attachGameListeners = (code: string, myRole: UplinkRole, isRejoin = false) => {
    const myUid        = uid()!;
    const opponentSeat = myRole === 'host' ? 'guest' : 'host';

    // Moves — onChildAdded fires once per appended ply, including past ones
    // on first attach. Skip plies we sent ourselves, and skip ALL replayed moves
    // during a re-join (awaitingResyncRef blocks until the live board resync arrives).
    if (isRejoin) awaitingResyncRef.current = true;
    const unsubMoves = onChildAdded(ref(db, `rooms/${code}/moves`), (snap) => {
      const plyKey = Number(snap.key);
      if (awaitingResyncRef.current) { plyRef.current = plyKey + 1; return; }
      if (sentPliesRef.current.has(plyKey)) return;
      const data = snap.val() as { from: string; to: string; hash: string; clock?: ClockRemaining; promotion?: Piece };
      plyRef.current = plyKey + 1;
      handlersRef.current.onRemoteMove?.(data.from, data.to, data.hash, data.clock, data.promotion);
    });
    unsubsRef.current.push(unsubMoves);

    // Signals — one-shot events; skip our own.
    //
    // On rejoin, we must never process signals that were already in Firebase before we
    // re-attached (e.g. a stale resign that fires "White Wins!" on the reconnecting player).
    // The awaitingResyncRef guard is unreliable here: Firebase can deliver onValue(state) and
    // onChildAdded(signals) in separate async batches, so the state listener may clear the flag
    // before signals have finished replaying — letting a stale signal through regardless.
    //
    // The correct fix: call get(signals) first to snapshot all pre-existing keys, then attach
    // onChildAdded. Every key in that snapshot is historical and is skipped unconditionally,
    // independent of delivery timing. Keys that appear after the get() call are truly new.
    const processSignal = (snap: DataSnapshot, skipKeys: Set<string>) => {
      if (skipKeys.has(snap.key!)) return;                     // historical — skip
      const data = snap.val() as {
        type: string;
        from: string;
        payload?: { name?: string; status?: string; winner?: string | null } | null;
      };
      if (data.from === myUid) return;
      // While the board hasn't been resynced yet, block game-ending signals regardless
      // of whether this is a rejoin or a first join. They may be stale signals from a
      // previous session that arrived after the skipKeys snapshot was taken, or they may
      // have been pushed in the narrow window between get() completing and onChildAdded
      // being attached. Non-ending signals (hello, resync-request) are safe to pass
      // through immediately so the opponent's name updates and resync-requests are handled.
      if (awaitingResyncRef.current && (data.type === 'resign' || data.type === 'timeout' || data.type === 'game-over')) return;
      // For non-rejoin sessions: block all signals until the initial board arrives.
      if (!isRejoin && awaitingResyncRef.current) return;
      const h = handlersRef.current;
      switch (data.type) {
        case 'resign':          h.onResign?.();                                                              break;
        case 'timeout':         h.onTimeout?.();                                                             break;
        case 'rematch':         h.onRematch?.();                                                             break;
        case 'hello':           h.onPeerHello?.(data.payload?.name ?? '');                                  break;
        case 'game-over':       h.onGameOver?.(data.payload?.status ?? '', data.payload?.winner ?? null);   break;
        case 'resync-request':  h.onResyncRequest?.();                                                       break;
      }
    };

    if (isRejoin) {
      // Snapshot existing signal keys, then attach the listener — async-safe.
      get(ref(db, `rooms/${code}/signals`))
        .then((existingSnap) => {
          if (roomCodeRef.current !== code) return; // left the room while get() was in-flight
          const skipKeys = new Set<string>();
          if (existingSnap.exists()) {
            existingSnap.forEach((child) => { if (child.key) skipKeys.add(child.key); });
          }
          const unsubSignals = onChildAdded(ref(db, `rooms/${code}/signals`), (snap) => processSignal(snap, skipKeys));
          unsubsRef.current.push(unsubSignals);
        })
        .catch(() => {});
    } else {
      const unsubSignals = onChildAdded(ref(db, `rooms/${code}/signals`), (snap) => processSignal(snap, new Set()));
      unsubsRef.current.push(unsubSignals);
    }

    // Opponent disconnect — Firebase server sets connected=false after ~60–90s of silence.
    // We give a further 30s grace window (countdown shown on opponent's card) before awarding
    // the win, totalling ~90–120s real-world grace for the opponent to return.
    const RECONNECT_GRACE_MS = 30_000;
    let sawDisconnect = false;
    const unsubConnected = onValue(ref(db, `rooms/${code}/${opponentSeat}/connected`), (snap) => {
      if (!snap.exists()) return;
      const connected = snap.val() as boolean;

      if (!connected) {
        // Opponent dropped — enter reconnecting state and start grace countdown
        sawDisconnect = true;
        setStatus('reconnecting');
        setReconnectDeadline(Date.now() + RECONNECT_GRACE_MS);
        clearReconnectTimer();
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          setReconnectDeadline(null);
          setStatus('connected');
          handlersRef.current.onPeerLeft?.();
        }, RECONNECT_GRACE_MS);
      } else if (sawDisconnect) {
        // Opponent came back (during OR after the countdown) — cancel the countdown
        // if still running, and send them the live board regardless.
        sawDisconnect = false;
        if (reconnectTimerRef.current != null) {
          clearReconnectTimer();
          setReconnectDeadline(null);
        }
        setStatus('connected');
        handlersRef.current.onPeerReconnected?.();
      }
    });
    unsubsRef.current.push(unsubConnected);

    // Self-disconnect detector — Firebase SDK's .info/connected goes false when our own
    // transport drops. Show the player a "Connection lost — reconnect within Xs" countdown
    // so they know how long they have before the opponent claims the win.
    const unsubSelfConnected = onValue(ref(db, '.info/connected'), (snap) => {
      const online = snap.val() === true;
      if (!online) {
        setSelfDisconnectDeadline(Date.now() + RECONNECT_GRACE_MS);
      } else {
        setSelfDisconnectDeadline(null);
        // Re-assert our seat's connected flag so the opponent sees us return.
        set(ref(db, `rooms/${code}/${myRole}/connected`), true).catch(() => {});
        onDisconnect(ref(db, `rooms/${code}/${myRole}/connected`)).set(false).catch(() => {});
      }
    });
    unsubsRef.current.push(unsubSelfConnected);

    // State listener — guest always needs it (state-init + resync from host).
    // Host needs it only on re-join (to receive the live board from the connected guest).
    if (myRole === 'guest' || isRejoin) {
      const unsubState = onValue(ref(db, `rooms/${code}/state`), (snap) => {
        if (!snap.exists()) return;
        const raw = snap.val() as StateSnapshot & { ply: number };
        const { ply, ...snapshot } = raw;
        // During re-join, the initial onValue fires immediately with whatever Firebase holds.
        // If that state is current (ply >= moves replayed so far), accept it and recover
        // in-place. If it is stale (ply < moves replayed), skip it and wait: the guest's
        // onPeerReconnected will write a fresh resync that carries the correct ply.
        if (awaitingResyncRef.current) {
          if (ply < plyRef.current) return; // stale — still waiting for fresh resync
          awaitingResyncRef.current = false;
        }
        if (ply === 0) {
          // state-init (new game / rematch): full reset of move-slot counter.
          plyRef.current       = 0;
          sentPliesRef.current = new Set();
          handlersRef.current.onStateInit?.(snapshot as StateSnapshot, ply);
        } else {
          // resync: advance slot counter to the authoritative ply so the next move
          // goes to the correct key. Do NOT clear sentPliesRef — moves we sent before
          // this ply are still accurately tracked and we must continue filtering them.
          plyRef.current = ply;
          handlersRef.current.onResync?.(snapshot as StateSnapshot, ply);
        }
      });
      unsubsRef.current.push(unsubState);
    }
  };

  // ── host() ────────────────────────────────────────────────────────────────

  const host = (source: MatchSource = 'friend'): string => {
    const myUid = uid();
    if (!myUid) {
      setError('Not connected. Check your internet and try again.');
      setStatus('error');
      return '';
    }

    const code           = generatePasscode();
    roomCodeRef.current  = code;
    myRoleRef.current    = 'host';
    plyRef.current       = 0;
    sentPliesRef.current = new Set();

    setError(null);
    setRoomCode(code);
    setRole('host');
    setStatus('connecting');

    set(ref(db, `rooms/${code}/host`), { uid: myUid, name: '', connected: true })
      .then(() => onDisconnect(ref(db, `rooms/${code}/host/connected`)).set(false))
      .then(() => {
        setStatus('waiting');

        // Watch for guest seat — fires when guest writes their uid
        const unsubGuest = onValue(ref(db, `rooms/${code}/guest/uid`), (snap) => {
          if (!snap.exists()) return;
          unsubGuest(); // stop watching — guest is here
          setStatus('connected');
          attachGameListeners(code, 'host');
          writeReconnectData(code, 'host', source);
          handlersRef.current.onPeerJoined?.();
        });
        unsubsRef.current.push(unsubGuest);
      })
      .catch(() => {
        setError('Failed to open room.');
        setStatus('error');
      });

    return code;
  };

  // ── join() ────────────────────────────────────────────────────────────────

  const join = (code: string, source: MatchSource = 'friend') => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Enter a room code.');
      setStatus('error');
      return;
    }

    const myUid = uid();
    if (!myUid) {
      setError('Not connected. Check your internet and try again.');
      setStatus('error');
      return;
    }

    setError(null);
    setRoomCode(trimmed);
    setStatus('connecting');

    // Read the host seat first — if OUR uid is the host, this is a host re-join
    // (page refresh mid-game). Otherwise proceed as guest.
    get(ref(db, `rooms/${trimmed}/host/uid`))
      .then((hostSnap) => {
        if (!hostSnap.exists()) {
          setError('Invalid room code.');
          setStatus('error');
          resetRefs();
          return Promise.reject('bad-room');
        }

        const isHostRejoin = hostSnap.val() === myUid;

        if (isHostRejoin) {
          // ── Host re-join: reclaim host seat, attach listeners with state ──
          // Two-path recovery:
          //   Fast path — Firebase state already holds a recent resync (ply=N): the state
          //   listener accepts it immediately and closes the modal without waiting for the guest.
          //   Fallback path — Firebase state is stale (ply < N, e.g. clean game with no prior
          //   resync): the state listener skips it; the guest's onPeerReconnected sends a fresh
          //   resync (guests can write /state/ per Firebase rules) and the listener accepts that.
          // Signals are skipped during the rejoin window (awaitingResync=true) to prevent a
          // replayed resync-request from overwriting Firebase state with a stale ply=0 board.
          const myRole: UplinkRole = 'host';
          setRole(myRole);
          roomCodeRef.current = trimmed;
          myRoleRef.current   = myRole;

          return set(ref(db, `rooms/${trimmed}/host/connected`), true)
            .then(() => onDisconnect(ref(db, `rooms/${trimmed}/host/connected`)).set(false))
            .then(() => {
              setStatus('connected');
              attachGameListeners(trimmed, myRole, true);
            });
        }

        // ── Normal guest join ──────────────────────────────────────────────
        setRole('guest');
        roomCodeRef.current = trimmed;
        myRoleRef.current   = 'guest';
        plyRef.current       = 0;
        sentPliesRef.current = new Set();

        return Promise.all([
            get(ref(db, `rooms/${trimmed}/guest/uid`)),
            get(ref(db, `rooms/${trimmed}/guest/connected`)),
          ])
          .then(([guestSnap, guestConnSnap]) => {
            const guestUid = guestSnap.exists() ? guestSnap.val() : null;
            const guestConnected = guestConnSnap.exists() && guestConnSnap.val() === true;
            // Block if a DIFFERENT user holds the guest seat, OR if the same uid is
            // already actively connected (prevents a third tab from hijacking the game).
            if (guestUid && guestUid !== myUid) {
              setError('That room is full.');
              setStatus('error');
              resetRefs();
              return Promise.reject('room-full');
            }
            if (guestUid === myUid && guestConnected) {
              setError('You are already in this game on another tab.');
              setStatus('error');
              resetRefs();
              return Promise.reject('room-full');
            }
            return set(ref(db, `rooms/${trimmed}/guest`), { uid: myUid, name: '', connected: true });
          })
          .then(() => onDisconnect(ref(db, `rooms/${trimmed}/guest/connected`)).set(false))
          .then(() => {
            setStatus('connected');
            attachGameListeners(trimmed, 'guest');
            writeReconnectData(trimmed, 'guest', source);
          });
      })
      .catch((err) => {
        if (err === 'bad-room' || err === 'room-full') return; // already surfaced
        setError('Connection failed.');
        setStatus('error');
        resetRefs();
      });
  };

  // ── leave() ───────────────────────────────────────────────────────────────

  const leave = () => {
    const code   = roomCodeRef.current;
    const myRole = myRoleRef.current;
    const myUid  = uid();

    if (code && myRole && myUid) {
      // Cancel scheduled onDisconnect so it doesn't fire on deliberate leave
      onDisconnect(ref(db, `rooms/${code}/${myRole}/connected`)).cancel().catch(() => {});
      remove(ref(db, `rooms/${code}/${myRole}`)).catch(() => {});
    }

    resetRefs();
    clearReconnectData();
    setStatus('idle');
    setRole(null);
    setRoomCode(null);
    setError(null);
  };

  // ── rejoin() ─────────────────────────────────────────────────────────────
  // Re-join a room after page refresh using the persisted code+role. Avoids
  // the join() validation flow entirely — we already know our seat and role.

  const rejoin = (code: string, myRole: UplinkRole) => {
    const myUid = uid();
    if (!myUid) {
      setError('Not connected. Check your internet and try again.');
      setStatus('error');
      return;
    }

    // Clear any leftover listeners and grace timers from the disconnected session.
    // Without clearListeners(): a non-refresh reconnect stacks a second set of listeners
    // on top of the old ones, bypassing the rejoin guards. Without clearReconnectTimer():
    // a grace countdown started before the disconnect fires onPeerLeft() mid-rejoin.
    clearListeners();
    clearReconnectTimer();

    // Preserve the match source (quick-match vs friend) through the reconnect so the
    // lobby label stays correct and Rematch is correctly suppressed for QM games.
    const reconnectSource: MatchSource = readReconnectData()?.source ?? 'friend';

    setError(null);
    setRoomCode(code);
    setRole(myRole);
    setStatus('connecting');
    roomCodeRef.current = code;
    myRoleRef.current   = myRole;

    // Re-assert connected on our seat; attach listeners in re-join mode
    // (move replay suppressed until the peer's resync arrives).
    set(ref(db, `rooms/${code}/${myRole}/connected`), true)
      .then(() => onDisconnect(ref(db, `rooms/${code}/${myRole}/connected`)).set(false))
      .then(() => {
        setStatus('connected');
        attachGameListeners(code, myRole, true);
        writeReconnectData(code, myRole, reconnectSource);
      })
      .catch(() => {
        setError('Reconnection failed.');
        setStatus('error');
        clearReconnectData();
        resetRefs();
      });
  };

  // ── send() ────────────────────────────────────────────────────────────────

  const send = (msg: GameMessage) => {
    const code  = roomCodeRef.current;
    const myUid = uid();
    if (!code || !myUid) return;

    switch (msg.type) {

      case 'move': {
        const ply = plyRef.current;
        sentPliesRef.current.add(ply);
        set(ref(db, `rooms/${code}/moves/${ply}`), {
          from: msg.from,
          to:   msg.to,
          hash: msg.hash,
          ...(msg.clock     != null ? { clock:     msg.clock     } : {}),
          ...(msg.promotion != null ? { promotion: msg.promotion } : {}),
        }).catch(() => {});
        plyRef.current = ply + 1;
        break;
      }

      case 'state-init':
      case 'resync': {
        const isInit = msg.type === 'state-init';
        // Only reset the move-slot counter on state-init (rematch). For resync the game
        // continues from the current ply — resetting to 0 would write the next move to
        // moves/0 (an existing key) and onChildAdded would not re-fire for it on the peer.
        if (isInit) {
          plyRef.current       = 0;
          sentPliesRef.current = new Set();
        }

        // On rematch (state-init): clear stale moves + signals first.
        // Without this, the !data.exists() per-ply guard blocks new moves at
        // ply "0", "1", … that already exist, and old signals would re-fire
        // on reconnect.
        const cleanup = isInit
          ? Promise.all([
              remove(ref(db, `rooms/${code}/moves`)).catch(() => {}),
              remove(ref(db, `rooms/${code}/signals`)).catch(() => {}),
            ])
          : Promise.resolve();

        cleanup
          .then(() =>
            set(ref(db, `rooms/${code}/state`), {
              ...msg.snapshot,
              ply: isInit ? 0 : msg.ply,
            }),
          )
          .catch(() => {});
        break;
      }

      default: {
        // resign | timeout | rematch | hello | resync-request → signals
        push(ref(db, `rooms/${code}/signals`), {
          type:    msg.type,
          from:    myUid,
          ts:      serverTimestamp(),
          payload: msg.type === 'hello'
            ? { name: msg.name }
            : msg.type === 'game-over'
              ? { status: msg.status, winner: msg.winner }
              : null,
        }).catch(() => {});
        break;
      }
    }
  };

  // Detach Firebase listeners and cancel any reconnect timer on unmount
  useEffect(() => () => { clearListeners(); clearReconnectTimer(); }, []);

  return { status, role, roomCode, error, reconnectDeadline, selfDisconnectDeadline, host, join, rejoin, leave, send };
}
