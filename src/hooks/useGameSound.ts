// hooks/useGameSound.ts — Game audio: mute toggle + lazy AudioContext unlock.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getSoundEngine, type SoundEvent } from '@/lib/audio/engine';
import { readString, writeString } from '@/lib/storage';

const STORAGE_KEY = 'gridlock:sound-muted:v1';

function readMuted(): boolean {
  return readString(STORAGE_KEY) === '1';
}

// Seed the process-wide engine with the persisted preference once, at module load,
// so the very first render already reflects the saved mute state.
getSoundEngine().setMuted(readMuted());

// Cross-tab sync: the `storage` event fires only in *other* tabs when localStorage
// changes. Mirror the mute preference into this tab's engine, which notifies every
// useSyncExternalStore consumer — so all open tabs stay in lockstep without a reload.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) getSoundEngine().setMuted(e.newValue === '1');
  });
}

/**
 * Wraps the process-wide SoundEngine. Audio is silent until the first user gesture
 * (browser autoplay policy), at which point the AudioContext is unlocked once.
 * Mute state lives on the engine (single source of truth) and is read reactively via
 * useSyncExternalStore, so every consumer stays in sync — even when multiple mount at
 * once. It is persisted across sessions; defaults ON (audible).
 */
export function useGameSound(): {
  play: (event: SoundEvent, delay?: number) => void;
  muted: boolean;
  toggleMuted: () => void;
} {
  const engine = getSoundEngine();
  const muted = useSyncExternalStore(engine.subscribeMuted, engine.isMuted);
  const unlockedRef = useRef(false);

  // Unlock the AudioContext on the first user gesture, then detach the listeners.
  useEffect(() => {
    const unlock = () => {
      if (unlockedRef.current) return;
      unlockedRef.current = true;
      engine.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [engine]);

  const play = (event: SoundEvent, delay = 0) => {
    engine.play(event, delay);
  };

  const toggleMuted = () => {
    const next = !engine.isMuted();
    writeString(STORAGE_KEY, next ? '1' : '0');
    engine.setMuted(next);
  };

  return { play, muted, toggleMuted };
}
