# GRIDLOCK CHESS: Development Standards
## Shared Standards for All Phases

> 📌 **This document defines coding principles, tech stack, and conventions that apply to ALL implementation phases.** Reference this from any phase-specific implementation plan.
>
> See `GridlockChess.md` for full game rules and mechanics.

---

# CODING PRINCIPLES

**System rules — apply to every code change:**

0. **Be brutally honest, direct, and skeptical.** Provide accurate, non-sycophantic, non-hallucinated, no-BS answers. Avoid unnecessary verbosity or overconfidence.
1. **Problem-first**: Before writing any code, state what specific problem it solves. No code without a clear reason.
2. **Simplicity by default**: Latest, most modern solution — zero over-engineering, no unnecessary/redundant/duplicate code.
3. **Justified complexity**: May only provide a complex solution if it's the *absolute only way* to fix the problem. Must explicitly explain why the simple approach fails (perf, security, scalability, or long-term maintainability).
4. **Strict honesty**: Verify answers. If unsure or mistaken, admit it immediately — never make up information.
5. **Respect existing patterns**: Follow them when clear, consistent, and aligned with rules 1–3. Diverge only with a concrete, well-justified reason.

---

# TECH STACK (May 2026 Executive Stack)

> ⚠️ **Version Lock:** These are the exact production-grade versions. Do not downgrade.

| Layer | Technology | Version | Notes |
|-------|------------|---------|-------|
| **Runtime** | Node.js | v24.15.0 LTS (Krypton) | Active LTS. Do NOT use v25.x Current in production. |
| **Language** | TypeScript | v6.0.3 | Requires `typescript-eslint` v8+. Use strict config. |
| **Frontend** | React | v19.2.5 | React 19 with compiler. No Redux/Zustand—use built-in hooks. (Patch released April 8, 2026) |
| **Build** | Vite | v8.0.10 | Native ESM, fastest HMR. |
| **Package Manager** | npm | v11.11.x | Ships with Node 24. |
| **Routing** | React Router | v7.x | Breaking changes from v6. |
| **Validation** | Zod | v3.24+ | Runtime validation for game state. |
| **Animation** | Framer Motion | v12.x | Declarative, powerful. |
| **Styling** | Tailwind CSS | v3.4.x | Utility-first, rapid UI. |
| **Components** | Shadcn UI | Latest | Copy/paste components. You own the code. |
| **Real-time** | PartyKit | Latest | Serverless WebSockets, built for games. |
| **Drag & Drop** | @dnd-kit | Latest | Touch-friendly, accessible. |
| **Audio** | Howler.js | v2.2.x | Cross-browser audio. |

---

# 💰 Financial Reality: $0 Stack

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   THE EXECUTIVE STACK IS 100% FREE                      │
│                                                         │
│   ✅ Core Infrastructure (Free Forever):                │
│      Node.js, TypeScript, React, Vite, npm              │
│      → Open-source public goods. Zero licensing fees.   │
│                                                         │
│   ✅ Styling Engine:                                    │
│      Tailwind CSS → 100% Free                           │
│      ⚠️ AVOID: Tailwind UI ($$$) — pre-built premium   │
│                                                         │
│   ✅ Component Library:                                 │
│      Shadcn UI → 100% Free, looks better than paid      │
│      → Copy/paste components, YOU own the code          │
│      → No subscription, no paywall, no telemetry        │
│      → Built as open-source rebellion against paid libs │
│                                                         │
│   TOTAL INFRASTRUCTURE COST: $0                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

# NAMING CONVENTIONS

- Use `??` and `?.` for safe access with fallback defaults
- Named exports + bracket imports everywhere — no default exports (exception: framework config files like `vite.config.ts` that require it)

```typescript
// ✅ CORRECT
export { GameLobby };
import { GameLobby } from './GameLobby';
const playerName = data?.player?.name ?? 'Unknown';

// ❌ WRONG
export default GameLobby;
import GameLobby from './GameLobby';
```

---

# STATE MANAGEMENT

Always use React 19 compiler. **NO Redux/Zustand/Jotai.**

React 19 built-ins ONLY:

| Hook | Purpose |
|------|---------|
| `useState()` | Local component state |
| `useActionState()` | Form actions |
| `useOptimistic()` | Instant UI feedback |
| `use()` | Async data — **NO `useEffect` for data fetching** |

**`useEffect()` is correct and intentional for:**
- Synchronizing state with other state
- Reacting to state changes
- Triggering imperative actions when conditions are met

### React 19 Compiler — NO Manual Memoization

The **React Compiler is enabled** (`babel-plugin-react-compiler` in `vite.config.ts`). It
auto-memoizes components, values, and functions at build time. Manual memoization is therefore
**redundant and forbidden** — it adds noise, can fight the compiler, and signals the codebase
predates the compiler.

| ❌ Do NOT use | ✅ Instead |
|--------------|-----------|
| `useMemo(() => expr, deps)` | `const x = expr;` — compiler memoizes |
| `useCallback(fn, deps)` | `const fn = () => {...};` — compiler memoizes |
| `memo(Component)` / `React.memo(...)` | Plain `function Component()` — compiler memoizes |

**Enforced by `eslint.config.js`** via `no-restricted-syntax` (errors on `useMemo`/`useCallback`/
`memo`) plus the `react-compiler/react-compiler` rule. Never add `// eslint-disable` for
`react-hooks/*` rules — the compiler skips optimizing any component where React rules are disabled.

> `useState`, `useRef`, `useEffect`, and dnd-kit's `useSensor`/`useSensors` are **not** memoization
> and remain correct.

---

# TYPESCRIPT STRICT CONFIG

Active `tsconfig.json` options that affect valid code:

| Option | What It Blocks |
|--------|----------------|
| `erasableSyntaxOnly` | No `const enum`, `namespace`, or decorators |
| `noUnusedLocals` / `noUnusedParameters` | No unused variables or params |
| `noFallthroughCasesInSwitch` | All switch cases must break/return |
| `noUncheckedSideEffectImports` | Side-effect imports must be intentional |
| `strict` | `noImplicitAny` + `strictNullChecks` enforced |

```json
{
  "compilerOptions": {
    "strict": true,
    "erasableSyntaxOnly": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  }
}
```

---

# ESLINT CONFIG (May 2026)

**Modern practice:** ESLint v9+ with flat config. The `.eslintrc.*` format is deprecated.

| Requirement | Version | Notes |
|-------------|---------|-------|
| ESLint | v9.x+ | Flat config only (`eslint.config.js`) |
| typescript-eslint | v8.x+ | Required for TypeScript 6 support |

### Philosophy
- **TypeScript strict mode is primary** — it catches most issues
- **ESLint adds only what TS can't** — React hooks rules, HMR safety, React Compiler enforcement
- **No formatting rules** — editor/Prettier handles formatting, ESLint handles logic

### Actual `eslint.config.js`

```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import reactCompiler from 'eslint-plugin-react-compiler';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'bin/**', 'server.js'] },
  {
    // Scope to first-party app source; Node scripts/config files are excluded.
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts', 'vitest.config.ts'],
    // `recommended` (syntactic), NOT `strictTypeChecked`: this codebase was never
    // linted, and strictTypeChecked floods it with type-aware findings that bury the
    // Hooks/Compiler rules we care about. `tsc --strict` already enforces type safety.
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'react-compiler': reactCompiler,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // React Compiler: flags components it cannot safely auto-memoize. Error → so a
      // silent compiler bailout never slips through.
      'react-compiler/react-compiler': 'error',

      // No manual memoization — the compiler handles it. The compiler rule does NOT
      // ban these, so forbid them syntactically to prevent regressions.
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='useMemo']",
          message: 'React Compiler is enabled — drop useMemo.' },
        { selector: "CallExpression[callee.name='useCallback']",
          message: 'React Compiler is enabled — drop useCallback.' },
        { selector: "CallExpression[callee.name='memo']",
          message: 'React Compiler is enabled — drop memo().' },
        { selector: "MemberExpression[object.name='React'][property.name='memo']",
          message: 'React Compiler is enabled — drop React.memo.' },
      ],

      '@typescript-eslint/no-unused-vars': 'off', // tsconfig noUnusedLocals handles this
    },
  },
);
```

### Why Minimal?
| What | Who Handles It |
|------|----------------|
| Unused variables | TypeScript (`noUnusedLocals`) |
| Type safety | TypeScript (`strict`) |
| Formatting | Editor / Prettier |
| React hooks rules | ESLint (`react-hooks`) |
| HMR compatibility | ESLint (`react-refresh`) |
| No manual memoization | ESLint (`no-restricted-syntax` + `react-compiler`) |

---

# TESTING STRATEGY

| Development Stage | Test Type | Coverage |
|-------------------|-----------|----------|
| **Early Milestones** | Unit + Visual | Components render correctly |
| **Mid Milestones** | Integration | State transitions, interactions |
| **Late Milestones** | E2E | Full phase flows |
| **Final Polish** | Manual QA | Edge cases, polish |

### Universal Test Scenarios
- [ ] Position generator creates valid 8-piece layouts (King + 7 Anomalies)
- [ ] All 10 Archetypes generate correct L/H/D distributions (sum = 10)
- [ ] Vector consumption decrements correct pool on each move
- [ ] Gridlock state triggers when L:0, H:0, D:0
- [ ] Gridlocked pieces block movement but can be captured
- [ ] Pawn promotion offers all 11 Archetypes (including Omni)
- [ ] Check detection works with all vector types
- [ ] Checkmate detection accounts for Gridlocked pieces
- [ ] Drag & drop works on desktop and mobile touch
- [ ] Disconnect/reconnect syncs full board state

---

# ROUTING (React Router v7)

React Router v7 is the standard for React SPAs. Use these patterns:

### URL-as-State (Primary Pattern)
The URL is the **single source of truth** for navigation state. Never store route-derivable data in React state.

```typescript
// ✅ CORRECT: URL is truth, derive from params
function WaitingRoom() {
  const { roomCode } = useParams<{ roomCode: string }>();
  // roomCode comes from URL, not useState
}

// ❌ WRONG: Duplicating URL state
const [roomCode, setRoomCode] = useState('');
navigate(`/room/${roomCode}`); // Now you have two sources of truth
```

### When to Use What

| Scenario | Use | Why |
|----------|-----|-----|
| Page-level data | `loader` + `useLoaderData` | Loads before render, better UX |
| URL params | `useParams()` | Built-in, type-safe |
| Query strings | `useSearchParams()` | Filters, pagination |
| Side effects on mount | `useEffect()` | WebSocket connections, subscriptions |
| Form submissions | `action` + `useActionState` | Server mutations |

### Route Organization

```typescript
// App.tsx - Keep routes flat and scannable
<Routes>
  <Route path="/" element={<Homepage />} />
  <Route path="/play" element={<LocalGame />} />
  <Route path="/play/:gameId" element={<OnlineGame />} />
  <Route path="/lobby" element={<GameLobby />} />
  <Route path="/rules" element={<RulesPage />} />
  <Route path="*" element={<NotFound />} />
</Routes>
```

---

# COMPONENT ARCHITECTURE

### Folder Structure (Feature-Based)

```
src/
├── components/
│   ├── board/          # Chess board rendering
│   │   ├── Board.tsx
│   │   └── Square.tsx
│   ├── pieces/         # Piece components with stat badges
│   │   ├── Piece.tsx
│   │   ├── VectorBadge.tsx
│   │   └── PieceGlyph.tsx
│   ├── game/           # Game flow components
│   │   ├── LocalGame.tsx         # Screen orchestrator (owns board state, wires hooks → panels)
│   │   ├── PlayerCard.tsx        # Seat card (name / color / editable)
│   │   ├── panels/               # All panel UI — leaf panels + composite rails
│   │   │   ├── index.ts          # Barrel export
│   │   │   ├── GameStatusPanel.tsx
│   │   │   ├── CapturedPiecesPanel.tsx
│   │   │   ├── MoveHistoryPanel.tsx
│   │   │   ├── VectorLegend.tsx
│   │   │   ├── ArchetypeGuide.tsx
│   │   │   ├── GameInfoPanel.tsx     # Left rail (composes status/captures/history)
│   │   │   ├── GameSetupPanel.tsx    # Right rail (opponent/coach/setup/actions)
│   │   │   └── CoachPanel.tsx        # Contextual help rail (Tutorial Mode)
│   │   └── modals/               # All overlay dialogs
│   │       ├── index.ts              # Barrel export
│   │       ├── GameModals.tsx        # Modal stack orchestrator (end / confirm / import / uplink)
│   │       ├── GameEndModal.tsx
│   │       ├── ConfirmModal.tsx
│   │       ├── ProtocolRunDryModal.tsx
│   │       ├── PromotionModal.tsx
│   │       ├── UplinkModal.tsx
│   │       └── WelcomeModal.tsx
│   ├── docs/           # In-app rule book site (MDX reference + interactive demos)
│   │   ├── reference.tsx
│   │   ├── DocLayout.tsx
│   │   ├── TableOfContents.tsx
│   │   ├── mdxComponents.tsx
│   │   ├── VectorChargesDemo.tsx
│   │   ├── OverrideDemo.tsx
│   │   ├── archetypeMeta.ts
│   │   └── index.ts
│   └── layout/         # Page chrome
│       └── Footer.tsx
├── hooks/              # Custom React hooks
│   ├── useGameState.ts          # Board state owner; move mechanics delegated to lib/chess/move.ts
│   ├── useGameSound.ts
│   ├── useTutorialMode.ts
│   ├── useProtocolRunDry.ts
│   ├── usePlayerName.ts
│   ├── useUplink.ts             # Raw WebSocket relay connection
│   ├── useUplinkGame.ts         # P2P match orchestration (color roll, lockstep guards)
│   ├── useBoardDnD.ts           # Drag-and-drop sensors + handlers
│   └── useGameEndReveal.ts      # Defeat-beat hold before the end modal
├── constants/          # Static data (no React)
│   └── archetypes.ts            # ARCHETYPE_GUIDE data
├── utils/              # Pure functions (no React)
│   └── statusMessage.ts         # getStatusMessage()
├── lib/                # Non-React utilities
│   ├── audio/
│   │   └── engine.ts            # Web Audio synthesis
│   ├── chess/
│   │   ├── engine.ts            # Fairy-Stockfish client (board→FEN, proxy transport)
│   │   ├── archetypes.ts        # ARCHETYPE_REGISTRY (single source of truth) + createOmniAnomaly
│   │   ├── movement.ts          # L/O/D move validation + isGridlocked
│   │   ├── move.ts              # applyMoveToBoard — pure "what one move does to the board" kernel (shared by hook + replay)
│   │   ├── generator.ts         # Position randomizer
│   │   ├── random.ts            # Shared randomness helpers (Fisher–Yates shuffle) for generation
│   │   ├── bot.ts               # Bot opponent (ranks engine moves, re-filters by rules)
│   │   ├── check.ts             # Royalty (King/Piloted) + legal-move generation + check/checkmate (rules authority)
│   │   ├── outcome.ts           # evaluateOutcome — checkmate/stalemate/draw/gridlock-death resolution
│   │   ├── repetition.ts        # repetitionKey — internal threefold-repetition hash
│   │   └── format.ts            # Portable position + replay: serialize / parse / replayTo (Zod-validated)
│   └── net/
│       └── protocol.ts          # Uplink message types + board hashing
├── types/              # TypeScript type definitions
│   └── game.ts
└── App.tsx
```

### Component Rules

| Rule | Rationale |
|------|-----------|
| One component per file | Easier imports, clearer ownership |
| Named exports only | Consistent imports, better refactoring |
| Colocate tests | `Button.tsx` + `Button.test.tsx` in same folder |
| Derive state at render | Never duplicate what can be computed |

### Derive, Don't Duplicate

```typescript
// ✅ CORRECT: Derive at render time — the React Compiler memoizes automatically
const displayNames = getDisplayNames(players);

// ❌ WRONG: Storing derived data in state
const [displayNames, setDisplayNames] = useState<Map<string, string>>();
useEffect(() => {
  setDisplayNames(getDisplayNames(players));
}, [players]);
```

---

# MODULAR ARCHITECTURE (S-TIER DRY PRINCIPLES)

> **Goal:** No file exceeds ~250 lines. Extract early, extract often. Code should be scannable in a single screen.

### The 250-Line Rule

When a component grows beyond 250 lines, it's a signal to extract. Apply this hierarchy:

| Lines | Action |
|-------|--------|
| **< 100** | ✅ Perfect — single responsibility |
| **100–250** | ⚠️ Watch it — consider extraction |
| **250–500** | 🔴 Extract now — god component forming |
| **> 500** | 🚨 Emergency — mandatory decomposition |

### Extraction Priority (Easiest → Hardest)

When refactoring a bloated component, follow this order:

| Priority | What to Extract | Risk | Example |
|----------|-----------------|------|---------|
| **1. Constants** | Static data arrays, config objects | 🟢 Zero | `ARCHETYPE_GUIDE`, `BOT_TIERS` |
| **2. Types** | Interfaces, type aliases | 🟢 Zero | `MoveHistoryEntry`, `GameStatus` |
| **3. Pure Utils** | Functions with no React dependencies | 🟢 Zero | `getStatusMessage()`, `formatTime()` |
| **4. Display Components** | UI with props only, no hooks | 🟢 Low | `VectorLegend`, `ArchetypeGuide` |
| **5. Stateful Components** | UI with local state | 🟡 Medium | `MoveHistoryPanel`, `GameControls` |
| **6. Custom Hooks** | Reusable stateful logic | 🟠 Higher | `useBotPlayer`, `useMoveHistory` |

### File Organization Patterns

#### Constants → `constants/`
```typescript
// constants/archetypes.ts
export const ARCHETYPE_GUIDE: ArchetypeGuideSection[] = [
  { group: 'Absolute', hint: 'All 10 in one vector', items: [...] },
  // ...
];

// constants/botTiers.ts
export const BOT_TIERS: BotDifficulty[] = [
  'beginner', 'novice', 'casual', 'club', 'skilled', 'expert', 'master', 'grandmaster'
];
```

#### Pure Functions → `utils/`
```typescript
// utils/statusMessage.ts
export function getStatusMessage(status: GameStatus, turn: PieceColor, ...): string {
  if (status === 'checkmate') return `Checkmate — ${winner} wins`;
  // ...
}
```

#### Panel Components → `components/game/panels/`
```typescript
// components/game/panels/VectorLegend.tsx
export function VectorLegend() {
  return (
    <div className="pt-4 border-t border-white/5">
      {/* L/O/D color legend */}
    </div>
  );
}

// components/game/panels/index.ts (barrel export)
export { VectorLegend } from './VectorLegend';
export { ArchetypeGuide } from './ArchetypeGuide';
export { GameStatusPanel } from './GameStatusPanel';
// ...
```

#### Custom Hooks → `hooks/`
```typescript
// hooks/useBotPlayer.ts
export function useBotPlayer(options: UseBotPlayerOptions): UseBotPlayerReturn {
  const [botThinking, setBotThinking] = useState(false);
  // Bot turn detection, Fairy-Stockfish integration
  return { botThinking, botActive, activeBotDifficulty };
}
```

### The Orchestrator Pattern

After extraction, the parent component becomes a **thin orchestrator**:

```typescript
// ✅ S-TIER: LocalGame.tsx (~250 lines) — orchestrates, doesn't implement
export function LocalGame() {
  // Hooks (state + logic)
  const gameState = useGameState();
  const botPlayer = useBotPlayer({ ... });
  const moveHistory = useMoveHistory({ ... });
  const dragDrop = useDragAndDrop({ ... });
  
  // Render (composition only)
  return (
    <div className="game-layout">
      <GameStatusPanel status={gameState.status} turn={gameState.turn} />
      <CapturedPiecesPanel pieces={gameState.capturedPieces} />
      <MoveHistoryPanel history={moveHistory.entries} />
      
      <Board {...gameState} {...dragDrop} />
      
      <GameControlsPanel 
        onModeSwitch={handleModeSwitch}
        onResign={gameState.resign}
      />
    </div>
  );
}
```

### Hook Composition Rules

| Rule | Rationale |
|------|-----------|
| **Single responsibility** | One hook = one concern (bot logic, move history, drag/drop) |
| **Accept callbacks** | Pass `playSound`, `makeMove` as params — don't import globals |
| **Return minimal API** | Only expose what consumers need |
| **Colocate effects** | Keep related `useEffect` calls in the same hook |

```typescript
// ✅ CORRECT: Hook accepts dependencies via options
export function useMoveHistory({
  board,
  lastMove,
  playSound,
}: UseMoveHistoryOptions) {
  // All move tracking logic lives here
}

// ❌ WRONG: Hook imports global dependencies
export function useMoveHistory() {
  const { board, lastMove } = useGameState(); // ❌ Tight coupling
  const { play } = useGameSound();            // ❌ Can't mock in tests
}
```

### Barrel Exports

Use `index.ts` files for clean imports:

```typescript
// components/game/panels/index.ts
export { VectorLegend } from './VectorLegend';
export { ArchetypeGuide } from './ArchetypeGuide';
export { GameStatusPanel } from './GameStatusPanel';
export { CapturedPiecesPanel } from './CapturedPiecesPanel';
export { MoveHistoryPanel } from './MoveHistoryPanel';
export { GameControlsPanel } from './GameControlsPanel';

// Usage in LocalGame.tsx
import { 
  VectorLegend, 
  ArchetypeGuide, 
  GameStatusPanel,
  // ...
} from './panels';
```

### When NOT to Extract

| Scenario | Keep Inline |
|----------|-------------|
| Used exactly once | If truly single-use, extraction adds indirection |
| < 20 lines | Too small to justify a file |
| Tightly coupled to parent state | If it needs 10+ props, reconsider the split |
| Temporary/experimental | Extract when pattern stabilizes |

---

# ERROR HANDLING

### Error Boundaries

Wrap feature sections in error boundaries to prevent full-app crashes:

```typescript
import { ErrorBoundary } from 'react-error-boundary';

function App() {
  return (
    <ErrorBoundary fallback={<ErrorFallback />}>
      <Routes>
        {/* routes */}
      </Routes>
    </ErrorBoundary>
  );
}

function ErrorFallback() {
  return (
    <div className="error-screen">
      <h1>Something went wrong</h1>
      <Button onClick={() => window.location.reload()}>
        Refresh
      </Button>
    </div>
  );
}
```

### Graceful Loading with useTransition

```typescript
// ✅ CORRECT: Non-blocking state updates
const [isPending, startTransition] = useTransition();

const handleJoin = () => {
  startTransition(() => {
    joinRoom(roomCode, playerName);
  });
};

return (
  <Button disabled={isPending}>
    {isPending ? 'Joining...' : 'Join Game'}
  </Button>
);
```

---

# ACCESSIBILITY (a11y)

Accessibility is **not optional**. Games must be playable by everyone.

### Keyboard Navigation

| Requirement | Implementation |
|-------------|----------------|
| All buttons focusable | Use `<button>`, not `<div onClick>` |
| Tab order logical | Natural DOM order, or `tabIndex` |
| Enter/Space activates | Native with `<button>` |
| Escape closes modals | Add `onKeyDown` handler |

### Dynamic Content Announcements

```typescript
// Use aria-live for real-time updates (player joins, timer)
<div aria-live="polite" className="sr-only">
  {`${playerName} joined the room`}
</div>

// Visible timer should also be announced
<div role="timer" aria-live="assertive">
  {formatTime(secondsRemaining)}
</div>
```

### Focus Management

```typescript
// Focus the first interactive element on route change
useEffect(() => {
  document.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}, []);

// In component:
<input data-autofocus type="text" />
```

### Checklist

- [ ] All interactive elements are keyboard accessible
- [ ] Color is not the only indicator (add icons/text)
- [ ] Contrast ratio ≥ 4.5:1 for text
- [ ] Screen readers announce dynamic changes
- [ ] Focus visible on all interactive elements

---

# REAL-TIME CONVENTIONS (PartyKit)

### Message Type Safety

All WebSocket messages **must** be type-safe. Use discriminated unions:

```typescript
// types/game.ts
type ClientMessage =
  | { type: 'join'; payload: { gameId: string; playerName: string } }
  | { type: 'leave'; payload: { playerId: string } }
  | { type: 'move'; payload: { from: Square; to: Square } }
  | { type: 'promote'; payload: { square: Square; archetype: ArchetypeKey } }
  | { type: 'resign' };

type ServerMessage =
  | { type: 'game-state'; payload: GameState }
  | { type: 'player-joined'; payload: Player }
  | { type: 'move-made'; payload: { from: Square; to: Square; vectorUsed: VectorType } }
  | { type: 'piece-gridlocked'; payload: { square: Square } }
  | { type: 'promotion-required'; payload: { square: Square } }
  | { type: 'check'; payload: { kingSquare: Square } }
  | { type: 'game-over'; payload: { result: 'checkmate' | 'stalemate' | 'resignation' | 'draw'; winner?: 'white' | 'black' } }
  | { type: 'error'; payload: { message: string } };
```

### Optimistic Updates

Update UI immediately, reconcile when server responds:

```typescript
// ✅ CORRECT: Optimistic UI
const handleStartGame = () => {
  // Immediate UI feedback
  setIsStarting(true);
  
  // Send to server
  sendMessage({ type: 'start-game' });
  
  // Server will broadcast room-state with status: 'starting'
  // which will trigger navigation
};
```

### Reconnection Handling

```typescript
// usePartyRoom.ts pattern
useEffect(() => {
  // On reconnect, server re-sends full room-state
  // UI automatically reconciles — no special handling needed
  
  // For extended disconnects, show reconnecting state
  if (!isConnected && wasConnected) {
    setReconnecting(true);
  }
}, [isConnected, wasConnected]);
```

### Message Validation (Optional but Recommended)

```typescript
import { z } from 'zod';

const VectorPoolSchema = z.object({
  L: z.number().min(0).max(10),
  H: z.number().min(0).max(10),
  D: z.number().min(0).max(10),
}).refine(v => v.L + v.H + v.D <= 10, {
  message: 'Vector pool cannot exceed 10 total points',
});

const OmniPoolSchema = z.object({
  shared: z.number().min(0).max(8),
});

const PieceSchema = z.object({
  type: z.enum(['king', 'pawn', 'anomaly']),
  color: z.enum(['white', 'black']),
  archetype: z.string().optional(),
  vectors: VectorPoolSchema.optional(),
  isGridlocked: z.boolean().optional(),
});

const GameStateSchema = z.object({
  gameId: z.string(),
  board: z.record(z.string(), PieceSchema), // square -> piece
  turn: z.enum(['white', 'black']),
  status: z.enum(['waiting', 'playing', 'checkmate', 'stalemate', 'resigned', 'draw']),
  inCheck: z.boolean(),
});

// In message handler
const parsed = GameStateSchema.safeParse(message.payload);
if (!parsed.success) {
  console.error('Invalid game-state:', parsed.error);
  return;
}
setGameState(parsed.data);
```

---

# GIT CONVENTIONS

### Commit Messages

Use conventional commits for clear history:

```
feat: add player kick functionality
fix: clear error on successful room join
refactor: extract display name logic to function
docs: add real-time conventions to dev standards
```

### Branch Naming

```
feature/board-rendering
feature/vector-economy
fix/gridlock-detection
refactor/move-validation
```

---

# GRIDLOCK CHESS: DOMAIN TYPES

Core type definitions for the Vector Economy and game state.

### Vector Economy

```typescript
// types/game.ts

/** Movement vector types */
type VectorType = 'L' | 'O' | 'D';

/** Charge pool for standard Anomalies (always sums to 10 at creation) */
interface VectorPool {
  L: number;  // Leap (Knight-style)
  O: number;  // Orthogonal (Rook-style)
  D: number;  // Diagonal (Bishop-style)
}

/** Shared pool for Omni archetype (promotion only) — 8 points, any vector */
interface OmniPool {
  shared: number;  // starts at 8, decrements on ANY move type
}

/** The 11 Archetypes (Omni is promotion-only) */
type ArchetypeKey =
  | 'highLeap'      // 🚁 6-8 L
  | 'highDiag'      // 🚀 6-8 D
  | 'highOrtho'     // 🚅 6-8 O
  | 'hybridLD'      // 🥷 4-5 L, 4-5 D
  | 'hybridLO'      // ✈️ 4-5 L, 4-5 O
  | 'hybridDO'      // 🚓 4-5 D, 4-5 O
  | 'balanced'      // 🛸 4/3/3
  | 'absLeap'       // ♞ 10 L
  | 'absDiag'       // ♝ 10 D
  | 'absOrtho'      // ♜ 10 O
  | 'omni';         // ♾️ 8 shared (PROMOTION ONLY)

interface Archetype {
  key: ArchetypeKey;
  name: string;
  icon: string;
  generate: () => VectorPool;
}
```

### Board & Piece Types

```typescript
/** Chess square notation (a1-h8) */
type Square = `${'a'|'b'|'c'|'d'|'e'|'f'|'g'|'h'}${'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'}`;

type PieceColor = 'white' | 'black';

interface BasePiece {
  color: PieceColor;
}

interface King extends BasePiece {
  type: 'king';
  icon: '♔';
}

interface Pawn extends BasePiece {
  type: 'pawn';
  icon: '♙' | '♟';  // ♙ white, ♟ black
  hasMoved: boolean;
}

interface Anomaly extends BasePiece {
  type: 'anomaly';
  archetype: Exclude<ArchetypeKey, 'omni'>;
  icon: string;
  vectors: VectorPool;
  isGridlocked: boolean;  // true when L:0, H:0, D:0
}

interface OmniAnomaly extends BasePiece {
  type: 'anomaly';
  archetype: 'omni';
  icon: '♾️';
  vectors: OmniPool;
  isGridlocked: boolean;  // true when shared:0
}

type Piece = King | Pawn | Anomaly | OmniAnomaly;

/** Board state: sparse map of occupied squares */
type Board = Partial<Record<Square, Piece>>;
```

### Move Validation

```typescript
interface MoveResult {
  valid: boolean;
  vectorUsed?: VectorType;        // Which pool to decrement
  capture?: Piece;                // Captured piece, if any
  causesCheck?: boolean;          // Would put opponent in check
  causesGridlock?: boolean;       // Would deplete last vector point
  requiresPromotion?: boolean;    // Pawn reached back rank
  error?: string;                 // Why move is invalid
}

/** Validate a move attempt */
function validateMove(
  board: Board,
  from: Square,
  to: Square,
  turn: PieceColor
): MoveResult;

/** Get all legal moves for a piece */
function getLegalMoves(
  board: Board,
  square: Square
): Square[];
```

### Corner Badge Layout

Per `GridlockChess.md` Section 8, vector stats display in fixed corners:

| Corner | Vector | Color |
|--------|--------|-------|
| Lower-Right | L (Leap) | 🟢 Green |
| Upper-Right | O (Orthogonal) | 🔴 Light Red |
| Lower-Left | D (Diagonal) | 🟠 Amber |

```typescript
// CSS variable convention (match GridlockChess_Generator.html)
const VECTOR_COLORS = {
  L: 'var(--leap)',   // #ff8f87 - coral
  O: 'var(--ortho)',  // #34d399 - green
  D: 'var(--diag)',   // #fbbf24 - amber
} as const;
```

---

*"Every move costs energy, and batteries do not recharge."*
