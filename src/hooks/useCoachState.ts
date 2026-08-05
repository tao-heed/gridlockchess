// hooks/useCoachState.ts — Coach move-recap state bag with auto-reset on new game.
// Extracted from LocalGame.tsx (Phase 2A of LocalGame_Modular_Extraction_Plan.md).

import { useState, useEffect } from 'react';
import type { VectorType, ArchetypeKey } from '@/types/game';

export interface CoachStateReturn {
  humanLastSpend: { vector: VectorType; remaining: number } | null;
  lastMovedType: 'pawn' | 'king' | 'anomaly' | null;
  lastMoveGridlocked: ArchetypeKey | null;
  lastMoveOverride: ArchetypeKey | null;
  lastMovePromoted: boolean;
  setHumanLastSpend: (v: { vector: VectorType; remaining: number } | null) => void;
  setLastMovedType: (v: 'pawn' | 'king' | 'anomaly' | null) => void;
  setLastMoveGridlocked: (v: ArchetypeKey | null) => void;
  setLastMoveOverride: (v: ArchetypeKey | null) => void;
  setLastMovePromoted: (v: boolean) => void;
}

/** Coach move-recap state. All five values are set inside the move-commit effect and
 *  read only by CoachPanel. The hook owns the gameId-keyed reset so adding a new coach
 *  variable has exactly one place to update. */
export function useCoachState(gameId: number): CoachStateReturn {
  const [humanLastSpend, setHumanLastSpend] = useState<{ vector: VectorType; remaining: number } | null>(null);
  const [lastMovedType, setLastMovedType] = useState<'pawn' | 'king' | 'anomaly' | null>(null);
  const [lastMoveGridlocked, setLastMoveGridlocked] = useState<ArchetypeKey | null>(null);
  const [lastMoveOverride, setLastMoveOverride] = useState<ArchetypeKey | null>(null);
  const [lastMovePromoted, setLastMovePromoted] = useState(false);

  useEffect(() => {
    setHumanLastSpend(null);
    setLastMovedType(null);
    setLastMoveGridlocked(null);
    setLastMoveOverride(null);
    setLastMovePromoted(false);
  }, [gameId]);

  return {
    humanLastSpend,
    lastMovedType,
    lastMoveGridlocked,
    lastMoveOverride,
    lastMovePromoted,
    setHumanLastSpend,
    setLastMovedType,
    setLastMoveGridlocked,
    setLastMoveOverride,
    setLastMovePromoted,
  };
}
