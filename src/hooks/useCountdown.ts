// hooks/useCountdown.ts — Single-second countdown to a deadline timestamp.
// Extracted from LocalGame.tsx (Phase 1C of LocalGame_Modular_Extraction_Plan.md).

import { useState, useEffect } from 'react';

/**
 * Returns the number of whole seconds remaining until `deadline` (ms timestamp),
 * or null when `active` is false. Ticks every second.
 */
export function useCountdown(active: boolean, deadline: number | null): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !deadline) { setSeconds(null); return; }
    const tick = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, deadline]);
  return seconds;
}
