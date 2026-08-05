# LocalGame.tsx — Modular Extraction Plan

**Status:** COMPLETE — all phases 1A–2C implemented and verified 2026-08-03.
**Last updated:** 2026-08-03 (corrections applied after re-reading file)
**File:** `src/components/game/LocalGame.tsx` (1706 lines as of this writing)

> Every claim about code structure was verified by reading the file directly.
> Line numbers are approximate — they shift as earlier extractions land.

---

## Why this exists

`LocalGame.tsx` is 1706 lines. The heavy logic is already in hooks
(`useGameState`, `useUplinkGame`, `useChessClock`, `useProtocolRunDry`, etc.).
What remains is the wiring layer — glue code, effects, and JSX. That's expected
for a page-level component. The file is long because the *game* is complex.

However, several cohesive groups of state + effects live inline that belong in
dedicated hooks. Leaving them inline creates specific hidden risks:

1. **Copy-paste drift**: the two reconnect countdown effects are near-identical
   inline. If one is updated, the other is easily missed.
2. **Dep-array omission**: long inline effects accumulate deps that are easy to
   accidentally drop (already happened with `statusForReveal` / `status` bugs).
3. **The peerResult `engineStatus` footgun is now structurally protected** (done
   as of 2026-08-03), but new state added inside LocalGame can still re-introduce
   the pattern if it's not in a clearly bounded hook.
4. **Discoverability**: resume persistence logic, replay tracking, and coach state
   all live in the same 1700-line scroll. Hard to find, easy to touch accidentally.

---

## Scope boundaries (do NOT do these)

| Tempting but wrong | Why |
|---|---|
| Split the JSX render | Reads 30+ local variables. Sub-components require prop-drilling all of them. Worse, not better. |
| Move `describePlayer` / `withTurnStatus` outside component | Both are closures over 10+ variables. As standalone functions they'd need 10-param signatures. No gain. |
| Extract `handleDraftOpponent` and sibling handlers | Tightly coupled to `opponentMode`, `resetGame`, `uplinkGame`. Cannot be cleanly separated. |
| Extract the move-commit `useEffect([lastMove])` | ~120 lines, touches coach state + audio + replay + uplink. Would need ~15 params. Spreads, doesn't reduce complexity. |

---

## Phase 1 — EASY (pure functions / trivial hooks, zero risk)

### 1A. `computeVectorCharges(board, youColor)` — pure function

**Currently:** An IIFE at `~line 1396`:
```ts
const vectorCharges = (() => {
  const sumAnomalyCharges = (b: typeof board) => { ... };
  const charges = sumAnomalyCharges(displayBoard);
  return { ...charges, you: vectorChargeYou };
})();
```

**Extract to:** `src/lib/chess/vectorCharges.ts` (or inline at module level above
`LocalGame`), as a pure function:
```ts
export function computeVectorCharges(
  board: Board,
  youColor: PieceColor,
): { white: VectorSums; black: VectorSums; you: PieceColor }
```

**Why it matters:** Pure computation — no state, no side effects. Moving it out of
the render function makes it independently testable and removes an inner function
that is re-created on every render.

**Risk:** Zero. Drop-in replacement.

---

### 1B. `computeMoveGhost(...)` — pure function

**Currently:** An IIFE at `~line 1418` (similar pattern to 1A).

**Extract to:** Same file as `computeVectorCharges`, or its own module if the
signature is complex. Determine exact params by reading the IIFE's closure
variables at implementation time.

**Risk:** Zero.

---

### 1C. `useCountdown(deadline: number | null)` — tiny hook, used twice

**Currently:** Two near-identical `useEffect` + `useState` blocks at `~lines 789–807`:
```ts
// Opponent reconnect countdown
const [reconnectSeconds, setReconnectSeconds] = useState<number | null>(null);
useEffect(() => {
  if (!reconnecting || !reconnectDeadline) { setReconnectSeconds(null); return; }
  const tick = () => setReconnectSeconds(Math.max(0, Math.ceil(...)));
  tick();
  const id = window.setInterval(tick, 1000);
  return () => window.clearInterval(id);
}, [reconnecting, reconnectDeadline]);

// Self-disconnect countdown (identical structure)
const [selfReconnectSeconds, setSelfReconnectSeconds] = useState<number | null>(null);
useEffect(() => { ... }, [selfDisconnected, selfDisconnectDeadline]);
```

**Extract to:** `src/hooks/useCountdown.ts`
```ts
/**
 * Returns the number of whole seconds remaining until `deadline` (ms timestamp),
 * or null when `active` is false. Ticks every second.
 */
export function useCountdown(active: boolean, deadline: number | null): number | null
```

**Usage after:**
```ts
const reconnectSeconds    = useCountdown(reconnecting, reconnectDeadline);
const selfReconnectSeconds = useCountdown(selfDisconnected, selfDisconnectDeadline);
```

**Hidden bug prevented:** The two effects are currently near-identical. If the
interval cleanup logic is ever updated in one, it's trivially forgotten in the
other. A single hook eliminates the drift.

**Risk:** Very low. The hook has a single, obvious contract.

---

## Phase 2 — MEDIUM (cohesive state groups, bounded I/O)

### 2A. `useCoachState()` — coach move-recap state

**Currently:** Five state variables in one consecutive block at `lines 315–330`,
plus a one-line cleanup effect at `~line 995`:
```ts
const [humanLastSpend, setHumanLastSpend] = useState<...>(null);
const [lastMovedType, setLastMovedType]   = useState<...>(null);
const [lastMoveGridlocked, ...]           = useState<...>(null);
const [lastMoveOverride, ...]             = useState<...>(null);
const [lastMovePromoted, ...]             = useState(false);
// ... cleared on gameId change (line ~995):
useEffect(() => {
  setHumanLastSpend(null); setLastMovedType(null); ...
}, [gameId]);
```

These are all SET inside the move-commit effect (`useEffect([lastMove])`) and READ
only by `CoachPanel`. They have no logic of their own — they're just a state bag
with a reset.

**Extract to:** `src/hooks/useCoachState.ts`
```ts
export interface CoachStateReturn {
  humanLastSpend: HumanLastSpend | null;
  lastMovedType: PieceType | null;
  lastMoveGridlocked: ArchetypeKey | null;
  lastMoveOverride: ArchetypeKey | null;
  lastMovePromoted: boolean;
  setHumanLastSpend: (v: HumanLastSpend | null) => void;
  setLastMovedType: (v: PieceType | null) => void;
  setLastMoveGridlocked: (v: ArchetypeKey | null) => void;
  setLastMoveOverride: (v: ArchetypeKey | null) => void;
  setLastMovePromoted: (v: boolean) => void;
}

export function useCoachState(gameId: number): CoachStateReturn
```

The hook owns the state and the `gameId`-keyed reset internally. LocalGame
destructures the return and passes setters into the move-commit effect.

**What moves:** ~20 lines (5 state declarations with comments + one-line gameId reset effect).

**Hidden bug prevented:** The reset effect (`[gameId]`) is currently easy to miss
when adding a new coach variable — you must remember to add it to the effect body.
Inside the hook, it's one place to maintain.

**Risk:** Low. Clear inputs (just `gameId`), clear outputs (state + setters).

---

### 2B. `useGamePersistence(...)` — resume save/restore

**Currently:** Two effects totalling ~97 lines:
1. Mount-only effect (~76 lines at `line 619`) — handles **two distinct concerns**
   in sequence:
   - **Sandbox handoff** (lines 630–663): reads `location.state.loadSandbox`,
     calls `parseReplay` / `replayTo`, sets `moveHistory`, `opponentMode`,
     `bothBots`, `generationMode`, `humanColor`, `boardAngle`, `fromSandbox`,
     `replayFocusSignal`, `loadState`, then calls
     `navigate(location.pathname, { replace: true, state: null })` to clear
     the router state. Uses `location` and `navigate` (router deps).
   - **RESUME_KEY restore** (lines 665–694): reads `RESUME_KEY` from
     localStorage, validates + replays the snapshot, calls `loadState` /
     `setOpponentMode` / `setHumanColor` etc.
2. Persist effect (~21 lines at `~line 702`) — writes snapshot on every
   `replayMoves` change.

Plus the `didRestoreRef` and `pendingImportLoadRef` coordination refs.

> **IMPLEMENTATION NOTE:** The `didRestoreRef.current = true` guard (line 621)
> sits at the TOP of the mount effect and covers BOTH paths. If the hook only
> takes the RESUME_KEY portion, the guard must be carefully split — a likely
> source of bugs. The safest extraction takes the entire mount effect, including
> the Sandbox handoff, requiring `location` and `navigate` as hook params.

**Extract to:** `src/hooks/useGamePersistence.ts`

Interface (exact params determined at implementation time by reading closure deps):
```ts
export function useGamePersistence(params: {
  // Router — needed for Sandbox handoff path
  location: Location;
  navigate: NavigateFunction;
  // Persist path
  isUplink: boolean;
  opponentMode: OpponentMode;
  humanColor: PieceColor;
  generationMode: GenerationMode;
  engineStatus: GameStatus;
  timeControlId: TimeControlId;
  replayMoves: GridlockMove[];
  capturedPieces: CapturedPieces;
  gameId: number;
  startPosRef: RefObject<GridlockPosition | null>;
  clockSnapshot: (() => ClockRemaining) | null;
  pendingImportLoadRef: RefObject<GridlockReplay | null>;
  // Called by the mount effect's RESUME_KEY path with the parsed snapshot
  onRestore: (snapshot: ResumeSnapshot) => void;
  // Called by the mount effect's Sandbox handoff path
  onSandboxLoad: (handoff: SandboxHandoff) => void;
}): void
```

**What moves:** ~97 lines + refs.

**Hidden bugs prevented:**
- The restore effect has a subtle ordering guard (`if (!didRestoreRef.current) return`)
  that prevents the persist effect from overwriting the just-loaded game. This guard
  is non-obvious and easy to break when touching either effect in isolation. Inside the
  hook, both effects are co-located and the guard is self-contained.
- The `MIGRATE_OPPONENT_MODE` application is inside the restore path. If someone adds
  a new old-mode string to migrate, there's exactly one place to update it.

**Risk:** Medium–High. The hook has ~15 params. Read the entire mount effect
carefully before extracting — it handles two concerns behind one `didRestoreRef`
guard. Verify every closure variable becomes an explicit param or callback. Do not
use `useCallback` wrappers for the callbacks; plain function props are fine.

---

### 2C. `useReplayTracking(...)` — move history, replay, scrub

**Currently:** The following live inline in LocalGame:
- State: `moveHistory`, `replayMoves`, `viewPly`, `saveGameplayPly`, `saveGameplayError`
- Refs: `startPosRef`, `replayStateRef`, `pendingImportLoadRef`
- Effects: new-game snapshot effect (`[gameId]`), scrub cursor effect
- Computed: `replay`, `isScrubbing`, `scrubState`, `displayBoard`, `displayTurn`,
  `displayInCheck`, `displayKingSquare`, `displayDefeatedSquare`,
  `displayLastMove`, `displayLastMoveVectorType`
- Handlers: `seekPly`, `handleSaveGameplay`

These are all tightly cohesive — they all exist to track the game's move history
and support scrubbing the board to any past position.

**Extract to:** `src/hooks/useReplayTracking.ts`

```ts
export interface ReplayTrackingReturn {
  moveHistory: MoveHistoryEntry[];
  replayMoves: GridlockMove[];
  viewPly: number | null;
  scrubState: ReplayState | null;
  displayBoard: Board;
  displayTurn: PieceColor;
  displayInCheck: boolean;
  displayKingSquare: SquareType | null;
  displayDefeatedSquare: SquareType | null;
  displayLastMove: { from: SquareType; to: SquareType } | null;
  displayLastMoveVectorType: VectorType | null;
  isScrubbing: boolean;
  replay: GridlockReplay | null;
  saveGameplayPly: number | null;
  saveGameplayError: string | null;
  startPosRef: RefObject<GridlockReplay['start'] | null>;
  replayStateRef: RefObject<ReplayState | null>;
  pendingImportLoadRef: RefObject<GridlockReplay | null>;
  setMoveHistory: Dispatch<...>;
  setReplayMoves: Dispatch<...>;
  setViewPly: Dispatch<...>;
  setSaveGameplayPly: Dispatch<...>;
  seekPly: (ply: number) => void;           // was mistakenly named handleScrubbingPlyChange
  handleSaveGameplay: (name: string) => void;
}

export function useReplayTracking(params: {
  // Live board state (fallback when not scrubbing)
  board: Board;
  turn: PieceColor;
  inCheck: boolean;
  kingSquare: SquareType | null;
  enPassantTarget: Square | undefined;
  // For `replay` meta construction
  generationMode: GenerationMode;
  playerName: string;
  player2Name: string;
  status: GameStatus;      // display status (statusForReveal), used in replay outcome
  drawReason: DrawReason | undefined;
  // For displayLastMove / displayLastMoveVectorType
  lastMove: { from: SquareType; to: SquareType } | null;
  lastVectorSpend: { vector: VectorType } | null;
  gameId: number;
}): ReplayTrackingReturn
```

> **NOTE on `replay` construction:** The `replay` object (line 1272–1283) reads
> `generationMode`, `playerName`, `player2Name`, `status`, and `drawReason` in
> addition to `replayMoves` and `startPosRef.current`. All five must be explicit
> params or the hook cannot construct it.

**What moves:** ~120 lines of state + computed values + effects.

**Hidden bugs prevented:**
- `setViewPly(null)` is called in multiple new-game handlers to ensure
  `isReviewMode = false` on the first render. These are currently scattered across
  `plainNewGame`, `applyDraftAndNewGame`, `handlePlayAgain`, `handleNextTier`. With
  the hook, `setViewPly` is still called from those handlers, but the value's
  relationship to `isScrubbing` is self-documenting inside the hook.
- `replayStateRef` is an incremental cursor that must be seeded at game start
  and advanced one ply at a time. If a new-game path is added that forgets to
  reset it (via `pendingImportLoadRef` or the gameId effect), the replay cursor
  desyncs. Co-locating state + effects makes this omission obvious.

**Risk:** Medium–High. This hook has the most return values and touches the most
state. Extract after 2A and 2B are stable. Verify by scrubbing history on all
modes (offline, bot, run dry) after extraction.

---

## Phase 3 — DO NOT ATTEMPT (yet)

These were assessed and rejected. Revisit only if a specific bug or test infrastructure
justifies the risk.

| Candidate | Why deferred |
|---|---|
| Move-commit `useEffect([lastMove])` | ~120 lines, touches coach state + audio + replay + uplink. ~15 deps. Moving it would make the param list longer than the effect body. |
| Bot turn driver `useEffect([turn, botActive, ...])` | Tight coupling to `botBoardRef`, `botEpRef`, `makeMoveRef`. Extracting to a hook would need to expose mutable refs, breaking the single-owner contract that prevents stale-read desync. |
| King mood effects | Already delegate to pure functions (`computeLiveKingMoods`, `computeScrubKingMoods`). The shell effects are only ~15 lines each. Not worth the hook overhead. |

---

## Implementation rules (apply to every phase)

1. **One extraction per PR/commit.** Do not combine Phase 1C with Phase 2A.
2. **Read the closure deps before writing the interface.** For each effect being
   moved, list every variable it reads. Each one becomes a param or is owned by
   the hook. No globals, no implicit captures.
3. **Preserve dep arrays exactly.** Do not silently drop or add deps when
   transcribing into the hook. If ESLint reports a missing dep, understand why
   before adding it.
4. **No behavior changes.** The extraction is a pure refactor. If the hook adds
   memoization, new state, or changes timing — stop and re-evaluate.
5. **Verify after each extraction:**
   - Offline game: play a full game, confirm sounds, coach, replay scrub.
   - Bot game: play to checkmate, confirm king mood, end modal.
   - Uplink: join, play, rematch, leave — confirm countdowns, peerResult fallback.
   - Run Dry: win a tier, confirm progression + completion modal.

---

## Expected outcome

| Extraction | Lines removed from LocalGame |
|---|---|
| 1A + 1B (pure functions) | ~25 |
| 1C (`useCountdown`) | ~20 |
| 2A (`useCoachState`) | ~20 |
| 2B (`useGamePersistence`) | ~97 |
| 2C (`useReplayTracking`) | ~120 |
| **Total** | **~282 lines** (~17% reduction) |

Target: LocalGame.tsx ≈ 1425 lines. The remaining ~1425 lines are the irreducible
wiring layer — they are NOT a sign of poor structure. They are the main game screen.
