// hooks/useQuickMatch.ts — Quick Match: atomic FIFO matchmaking via Firebase RTDB.
//
// Each player writes a queue entry at /queue/{uid}. The hook listens to the queue
// ordered by `since`; when an older unclaimed entry is found, it claims it with an
// RTDB transaction (race-safe). The claimer calls uplink.host(), then writes the
// generated room code to the opponent's entry once the room node is live (uplink
// status transitions 'connecting' → 'waiting'). The opponent watches its own
// roomCode field and calls uplink.join() when the code arrives.
//
// Directional matching: a player only claims entries OLDER than itself (lower `since`,
// or equal `since` with a lower key as a tiebreaker). This makes matching one-directional:
// the newer entrant is always the host, the older entrant is always the guest. It
// eliminates the race where both players simultaneously claim each other and both
// become hosts, leaving neither to join the other's room.
//
// onDisconnect cleanup: the queue entry is registered with Firebase's onDisconnect
// so it is auto-deleted if the tab closes or crashes before the JS cleanup can run.
// This prevents stale entries from matching phantom opponents in future searches.
import { useEffect, useRef, useState } from 'react';
import {
  ref, set, remove, onValue, onDisconnect, runTransaction, serverTimestamp, query, orderByChild,
} from 'firebase/database';
import { db, auth } from '@/lib/net/firebase';
import type { UplinkApi } from './useUplink';

export type QuickMatchStatus = 'idle' | 'searching' | 'matched';

export interface QuickMatchApi {
  status: QuickMatchStatus;
  /** Seconds since entering the queue. */
  elapsed: number;
  /** Number of OTHER players currently in the queue (excluding self). Only populated
   *  while searching — 0 when idle or matched. */
  othersSearching: number;
  enter: () => void;
  cancel: () => void;
}

export function useQuickMatch(uplink: UplinkApi, playerName: string): QuickMatchApi {
  const [qmStatus, setQmStatus]               = useState<QuickMatchStatus>('idle');
  const [elapsed, setElapsed]                 = useState(0);
  const [othersSearching, setOthersSearching] = useState(0);

  const playerNameRef = useRef(playerName);
  useEffect(() => { playerNameRef.current = playerName; });

  const uplinkRef = useRef(uplink);
  useEffect(() => { uplinkRef.current = uplink; });

  const unsubsRef      = useRef<Array<() => void>>([]);
  const timerRef       = useRef<number | null>(null);
  const claimingRef    = useRef(false);            // prevents concurrent transaction attempts
  const claimedUidRef  = useRef<string | null>(null); // opponent uid after we win the transaction
  const pendingCodeRef = useRef<string | null>(null); // room code to deliver once room is live

  const uid = () => auth.currentUser?.uid ?? null;

  // Cancel the server-side onDisconnect handler and immediately remove the queue entry.
  // Call this whenever we deliberately leave the queue (cancel, match found, unmount).
  const removeMyEntry = (myUid: string) => {
    onDisconnect(ref(db, `queue/${myUid}`)).cancel().catch(() => {});
    remove(ref(db, `queue/${myUid}`)).catch(() => {});
  };

  const detach = () => {
    for (const fn of unsubsRef.current) fn();
    unsubsRef.current = [];
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    claimingRef.current = false;
  };

  // Host side: once uplink writes the room node ('waiting'), deliver the room code to
  // the opponent's queue entry so they can call join(). The code was generated in
  // enter() but must not be written until Firebase has persisted the room node —
  // otherwise the guest's join() validation read finds no host seat.
  useEffect(() => {
    if (
      uplink.status === 'waiting' &&
      pendingCodeRef.current !== null &&
      claimedUidRef.current  !== null
    ) {
      const code        = pendingCodeRef.current;
      const opponentUid = claimedUidRef.current;
      pendingCodeRef.current = null;
      claimedUidRef.current  = null;
      set(ref(db, `queue/${opponentUid}/roomCode`), code).catch(() => {});
    }
  }, [uplink.status]);

  // Reset to idle if uplink goes back to idle after a match (game ended or left).
  useEffect(() => {
    if (uplink.status === 'idle' && qmStatus === 'matched') {
      setQmStatus('idle');
    }
  }, [uplink.status, qmStatus]);

  const enter = () => {
    const myUid = uid();
    if (!myUid) return;

    detach();
    setQmStatus('searching');
    setElapsed(0);

    // Write queue entry then register an onDisconnect so Firebase auto-deletes it if
    // the tab closes unexpectedly — prevents stale entries from matching phantom opponents.
    set(ref(db, `queue/${myUid}`), {
      name:        playerNameRef.current,
      since:       serverTimestamp(),
      matchedWith: null,
      roomCode:    null,
    })
      .then(() => { onDisconnect(ref(db, `queue/${myUid}`)).remove().catch(() => {}); })
      .catch(() => {});

    timerRef.current = window.setInterval(() => setElapsed(s => s + 1), 1000);

    // Guest side: watch own roomCode — written by the claimer once their room is live.
    const unsubCode = onValue(ref(db, `queue/${myUid}/roomCode`), (snap) => {
      if (!snap.exists() || !snap.val()) return;
      const code = snap.val() as string;
      removeMyEntry(myUid);
      detach();
      setQmStatus('matched');
      uplinkRef.current.join(code, 'quick-match');
    });
    unsubsRef.current.push(unsubCode);

    // Host side: watch queue ordered by since; claim the oldest unclaimed entry that
    // is STRICTLY OLDER than ourselves (directional matching — see file header).
    const unsubQueue = onValue(
      query(ref(db, 'queue'), orderByChild('since')),
      (snap) => {
        // Count other players in the queue (excluding self) and surface it to the UI.
        let others = 0;
        if (snap.exists()) {
          snap.forEach((child) => { if (child.key !== myUid) others++; });
        }
        setOthersSearching(others);

        if (claimingRef.current || !snap.exists()) return;

        // Wait until our own entry is visible in the snapshot with a resolved timestamp.
        // serverTimestamp() is a placeholder until the Firebase write round-trips.
        const myEntry = snap.child(myUid);
        if (!myEntry.exists()) return;
        const mySince = (myEntry.val() as { since: number | null }).since;
        if (mySince == null) return; // not yet resolved — skip this snapshot

        // If we've already been claimed by someone else, stop trying to claim.
        const myData = myEntry.val() as { matchedWith: string | null | undefined };
        if (myData.matchedWith != null) return; // != covers both null and undefined

        // Find the oldest unclaimed entry that is OLDER than us.
        // Directional rule: theirSince < mySince, or equal with a lower key as tiebreaker.
        // This ensures only one side ever claims the other, eliminating the double-host race.
        let target: string | null = null;
        snap.forEach((child) => {
          if (target !== null) return true;
          if (child.key === myUid) return false;
          const data = child.val() as { matchedWith: string | null | undefined; since: number | null };
          const theirSince = data.since ?? 0;
          const isOlder = theirSince < mySince || (theirSince === mySince && child.key! < myUid);
          if (data.matchedWith == null && isOlder) {
            target = child.key!;
            return true;
          }
          return false;
        });

        if (target === null) return;

        claimingRef.current = true;
        runTransaction(ref(db, `queue/${target}/matchedWith`), (current) => {
          if (current === null) return myUid; // claim it
          return undefined;                   // abort — already claimed by someone else
        })
          .then(({ committed }) => {
            claimingRef.current = false;
            if (!committed) return; // lost the race; wait for next queue change

            const code = uplinkRef.current.host('quick-match');
            if (!code) return;

            // Stash code + opponent uid for the 'waiting' status effect above.
            claimedUidRef.current  = target!;
            pendingCodeRef.current = code;

            removeMyEntry(myUid);
            detach();
            setQmStatus('matched');
          })
          .catch(() => { claimingRef.current = false; });
      },
    );
    unsubsRef.current.push(unsubQueue);
  };

  const cancel = () => {
    const myUid = uid();
    detach();
    if (myUid) removeMyEntry(myUid);
    setQmStatus('idle');
    setElapsed(0);
    setOthersSearching(0);
  };

  useEffect(() => () => {
    detach();
    const myUid = uid();
    if (myUid) removeMyEntry(myUid);
  }, []);

  return { status: qmStatus, elapsed, othersSearching, enter, cancel };
}
