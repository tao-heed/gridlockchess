// hooks/usePlayerName.ts — Persist player name to localStorage
import { useState, useEffect } from 'react';
import { readString, writeString } from '@/lib/storage';

const DEFAULT_NAME = 'Player';

export function usePlayerName(storageKey = 'gridlock-player-name', defaultName = DEFAULT_NAME) {
  const [name, setNameState] = useState<string>(() => {
    // SSR-safe: only read localStorage on client
    if (typeof window === 'undefined') return defaultName;
    return readString(storageKey) || defaultName;
  });

  // Sync to localStorage on change
  useEffect(() => {
    writeString(storageKey, name);
  }, [name, storageKey]);

  const setName = (newName: string) => {
    const trimmed = newName.trim();
    // Enforce reasonable limits: 1-20 chars, fallback to default if empty
    if (trimmed.length === 0) {
      setNameState(defaultName);
    } else if (trimmed.length <= 20) {
      setNameState(trimmed);
    }
  };

  return { name, setName, defaultName };
}
