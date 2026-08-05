// hooks/useOnlineStatus.ts — reactive `navigator.onLine` via useSyncExternalStore.
//
// The correct way to read browser state that changes outside React: subscribe to the
// `online`/`offline` events and let React re-render on change. Used to gate Online PvP
// (Uplink) so an offline/airplane-mode device shows a clear message instead of firing a
// WebSocket that silently hangs until it times out.
import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

// No SSR in this app, but a static "online" default keeps the hook safe if prerendered.
function getServerSnapshot(): boolean {
  return true;
}

/** Reactive online/offline status. `true` when the device reports a network connection. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
