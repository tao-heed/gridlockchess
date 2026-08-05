// hooks/useOnlinePresence.ts — Firebase presence tracking.
//
// Writes a node under /presence/{uid} when called and schedules its removal via
// .onDisconnect() so Firebase's server cleans it up when the connection drops
// (~60–90s after the client goes offline). Counts /presence/ children to derive
// the live online player count.
//
// Note: .onDisconnect() fires after ~60–90s of silence — the count can lag by
// up to that amount after a player leaves. The UI labels it "~N online" to signal
// this is approximate, not a live second-by-second number.
import { useEffect, useRef, useState } from 'react';
import { ref, set, remove, onValue, onDisconnect, serverTimestamp } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '@/lib/net/firebase';

export function useOnlinePresence(playerName: string): number {
  const [onlineCount, setOnlineCount] = useState(0);
  const presenceWrittenRef = useRef(false);
  // Snapshot playerName at mount — presence names are informational and not updated on
  // rename (same design choice as useUplink player identity). Not updated after mount.
  const playerNameRef = useRef(playerName);
  // Stores cleanup for the count listener + presence removal, swapped each time
  // onAuthStateChanged fires (should only fire once with anonymous auth).
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // onAuthStateChanged fires synchronously if auth is already resolved (common case:
    // signInAnonymously() in firebase.ts resolves before the component mounts), and
    // reactively when it resolves later (slow network on first launch). This replaces the
    // previous `auth.currentUser?.uid` dep which was read at render time and would never
    // re-run if auth resolved after mount — auth state is not React state.
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      if (!user) return;

      const presenceRef = ref(db, `presence/${user.uid}`);

      // Write presence node; schedule removal on disconnect.
      set(presenceRef, {
        name:   playerNameRef.current.trim() || 'Player',
        online: true,
        since:  serverTimestamp(),
      })
        .then(() => {
          presenceWrittenRef.current = true;
          return onDisconnect(presenceRef).remove();
        })
        .catch(() => {});

      // Count all /presence/ children — each child = one online player
      const unsubCount = onValue(ref(db, 'presence'), (snap) => {
        setOnlineCount(snap.exists() ? Object.keys(snap.val() as object).length : 0);
      });

      cleanupRef.current = () => {
        unsubCount();
        // Remove presence immediately on intentional unmount (page close / nav away)
        if (presenceWrittenRef.current) {
          onDisconnect(presenceRef).cancel().catch(() => {});
          remove(presenceRef).catch(() => {});
          presenceWrittenRef.current = false;
        }
      };
    });

    return () => {
      unsubAuth();
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return onlineCount;
}
