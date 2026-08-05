// hooks/useGameEndReveal.ts — Cinematic end-of-game reveal timing.
//
// On a decisive mate, hold the board (king topples + dims) for a beat so the player
// *sees* the kill before the result modal slams up. Draws and resigns reveal instantly.
import { useEffect, useState } from 'react';
import { isTerminalStatus, isDecisiveMate } from '@/utils/statusMessage';
import type { GameStatus } from '@/types/game';

export function useGameEndReveal(status: GameStatus) {
  const isGameOver = isTerminalStatus(status);
  const decisiveMate = isDecisiveMate(status);

  const [endRevealReady, setEndRevealReady] = useState(false);
  useEffect(() => {
    if (!isGameOver) { setEndRevealReady(false); return; }
    if (!decisiveMate) { setEndRevealReady(true); return; }
    const id = setTimeout(() => setEndRevealReady(true), 1500);
    return () => clearTimeout(id);
  }, [isGameOver, decisiveMate]);

  return { isGameOver, endRevealReady };
}
