# Sandbox Mode — Implementation Plan (DRAFT — for review before any code)

> Status: **PROPOSAL / NOT STARTED.** This document exists to be red-lined. Nothing here is
> built yet. Sections marked **⚠️ UNVERIFIED** are assumptions that must be proven before we
> commit to the design; sections marked **✅ VERIFIED** were confirmed by reading the code on
> 2026-07-16 (file references inline).

---

## 1. Goal & user story

A **Sandbox** — a free-form position editor — lets the player build any board by hand and then
play it (hot-seat and, if the engine cooperates, vs the bot).

> *"As a player, I tap **Sandbox** on the home screen, get an empty board, drag out any pieces I
> want (kings, pawns, the 11 anomalies), set each anomaly's charges, then press **Play** to start
> a match from exactly that position."*

**Why it's worth building (the strategic case):** Sandbox is not just a mode — it's the
**foundation** that makes later modes cheap. A *puzzle* is a saved position + a solution; a
*tutorial* is a scripted position + prompts; *reproducing an engine blunder* becomes trivial.
Build the editor once; reuse it everywhere. This is the single highest-leverage new feature.

---

## 2. Scope

### In scope (MVP)
- New **Sandbox** entry point on the Home screen → `/sandbox` route.
- Empty 8×8 board (reuses `Board`/`Square`).
- Piece palette: **White Pieces** / **Black Pieces** toggles, each revealing 1× King, 1× Pawn,
  and the archetype anomalies.
- Drag a palette piece onto any square; drag to move/remove placed pieces.
- Per-anomaly **charge editor** (pick one of the archetype's legal builds).
- **Validate → Play** button that hands the built position to the existing game.
- Local persistence of the in-progress sandbox (so a refresh doesn't wipe it).

### Out of scope (explicitly NOT in MVP — see §14)
- Tutorial / Puzzle / RPG / Survival / new variants. (Roadmap only.)
- Saving/sharing sandbox positions as files (until replay export UI is re-enabled).
- Undo/redo history, symmetry tools, FEN paste. (Nice-to-haves, phase 2+.)

---

## 3. The hard parts & real risks (read this first)

The drag-and-drop and palette are the easy 20%. The risk lives here:

### 3.1 ⚠️ UNVERIFIED — Does the native engine accept an arbitrary hand-built position?
The bot is native Fairy-Stockfish running the `gridlock-royal` variant, fed a **custom Gridlock
FEN** (see [GridlockFEN.md](./GridlockFEN.md)). It is **not proven** that the engine will accept
*any* legal-looking position — especially with unusual charge counts or piece placements.
- **Verification task (do FIRST, before building UI):** hand-craft 3–4 positions, encode them to
  the gridlock FEN, feed via `nativeEvaluate` / the engine-test path, and confirm `uciok →
  bestmove` without error. If it rejects some positions, "Play vs bot" from Sandbox is limited to
  hot-seat, or we constrain the editor.

### 3.2 ✅ DECIDED (2026-07-17) — Charges = one of the 36 legal BUILDS (discrete pick) · IMPLEMENTED
**Decision:** the Sandbox does **NOT** use free-form sliders. A placed anomaly's charges must be one of
its archetype's **enumerated legal builds** — the discrete outputs its `generate()` can actually roll.
Across the 10 standard archetypes that is exactly **36 builds** — the same "36 builds" the
[Rules page](../../src/pages/Rules.mdx) cites (base of the `36^7` opening count). Omni is a shared **8**.

**Why a discrete pick, not sliders** (the reason the earlier "range-respecting sliders" idea failed):
the per-vector ranges are **coupled**, not independent — e.g. High Leap = `L∈[6,8]`, then `O≥1, D≥1,
O+D=10−L`. Independent steppers clamped to per-vector min/max would happily build `L8/O3/D3` (total 14),
which is illegal. Enumerating the discrete legal set dissolves the problem: the editor offers a **pick**
from each archetype's builds (**≤6 each**: Absolute ×1, High ×6, Hybrid ×4, Balanced ×3; Omni shared-8).

**Build counts** (✅ enumerated from each `generate()`; **generate()-sampling verified**):

| Group | Archetypes | Builds each |
|---|---|---|
| Absolute | Leap / Ortho / Diag | 1 |
| High | Leap / Ortho / Diag | 6 |
| Hybrid | L·D / L·O / D·O | 4 |
| Balanced | 4/3/3 perms | 3 |
| **Standard total** | | **36** |
| Omni | shared 8 (promotion-only; sandbox exception) | 1 |

**✅ IMPLEMENTED (Stage 1, part 1):** `lib/chess/sandbox/charges.ts` (`archetypeBuilds` · `canonicalCharges`
· `isLegalBuild` · `TOTAL_BUILDS`) + `charges.spec.ts`. **DRY:** it does NOT re-enumerate the builds —
it delegates to the pre-existing **`enumerateBuilds` in balancedArmy.ts** (the army generator's single
source of truth, already drift-guarded against each archetype's live `generate()` by balancedArmy.spec.ts).
`TOTAL_BUILDS` derives to 36; canonical = each archetype's index-0 build. tsc + tests green.

**Consequence:** every anomaly totals 10 (Omni 8), so a **0/0/0 gridlocked piece cannot be placed** — add
an explicit exception later if a puzzle needs one. §10 Q1 (strictness) is now RESOLVED by this decision.

### 3.3 Position legality (the real engineering)
A hand-built board can be illegal. We need a **pure `validateSetup()`** (testable, in
`lib/chess/`, styled like [outcome.ts](../../src/lib/chess/outcome.ts)) returning
`{ ok: boolean; errors: string[] }`. Rules to enforce (draft — confirm against the rulebook):
- Exactly **one King per side** (the royal). *(Piloted anomalies complicate "royal" — MVP:
  disallow placing piloted anomalies; every side's royal is a plain King.)*
- **No pawns on rank 1 or rank 8.**
- The side **NOT** to move must **not be in check** (you can't start with the mover already
  having "captured" — mirrors standard editors). Reuses `isInCheck` ([check.ts](../../src/lib/chess/check.ts)).
- At least the minimum pieces to be a legal game (both kings present).
- Each anomaly's charges must be **one of its archetype's legal builds (§3.2)** — the discrete outputs
  `generate()` can roll (standard = total 10; Omni = shared 8). Enforced via `isLegalBuild`; a 0/0/0
  gridlocked piece therefore can't occur.
- **Play is disabled** with a readable reason until `validateSetup().ok`.

---

## 4. Architecture (reuse, don't reinvent)

### ✅ VERIFIED building blocks already in the codebase
- **Position model + (de)serialization:** `GridlockPosition` schema + `serializePosition` /
  `parsePosition` / `positionToBoard` ([format.ts](../../src/lib/chess/format.ts) ~L44). A Sandbox
  just needs to **produce a `GridlockPosition`** — the rest of the game already consumes it.
  Shape: `{ v, turn, enPassant, halfmoveClock, fullmove, board: { [square]: piece } }` where a
  piece is `{ t:'king'|'pawn'|'anomaly', c, a?, v?:{L,O,D}|{shared}, piloted? }`.
- **Archetype source of truth:** `ARCHETYPE_REGISTRY` = **11 entries = 10 placeable (back-rank)
  archetypes + Omni** (`promotionOnly: true`, shared 8-charge pool), verified in
  [archetypes.ts](../../src/lib/chess/archetypes.ts). The palette is a `.map()` over this registry —
  no hard-coded list. **Note:** Omni is normally promotion-only, so "11 in the palette" means "10
  placeable + Omni (sandbox-only exception)".
- **Drag-and-drop LIBRARY only:** the app uses **dnd-kit** (`@dnd-kit/core`, verified in
  [useBoardDnD.ts](../../src/hooks/useBoardDnD.ts)). ⚠️ **`useBoardDnD` itself is NOT reusable** — it is
  hard-wired to in-game square-to-square **legal moves** (`makeMove(from,to)`, `legalMoves`,
  `humanCanInteract`) and dragging an *existing* board piece. The Sandbox needs its OWN dnd wiring
  (palette-source drags, place/remove, no legal-move gate), reusing only the dnd-kit primitives +
  `<DndContext>` pattern. **This is NEW work, not reuse.**
- **Rendering:** `PieceGlyph` renders any `king|pawn|anomaly` already. ⚠️ But `Board`/`Square` are
  **game-coupled** (they expect `legalMoves`, `lastMove`, highlights, game click/dnd handlers): the
  *grid + glyphs* reuse, the *interaction layer* does not — the editor adapts those props or uses a
  thin editor-mode board wrapper.
- **The Play handoff already exists:** LocalGame loads a custom position via
  `pendingImportLoadRef` + `loadState(...)` ([LocalGame.tsx](../../src/components/game/LocalGame.tsx)
  L538, L1118), and `location.state` is already used for cross-route handoff
  (`revealHeader`, L198; Home's Play CTA passes `state`).

### New pieces to build
| Piece | Kind | Notes |
|---|---|---|
| `src/pages/Sandbox.tsx` (route `/sandbox`) | Page | Palette + board + charge editor + Play. |
| `src/hooks/useSandbox.ts` | Hook | Editor state: placed pieces, side-to-move, selected palette piece, charge draft. Persist to `localStorage 'gridlock:sandbox:v1'`. |
| `src/lib/chess/sandbox/setupValidation.ts` | Pure fn | `validateSetup(board, turn) → {ok, errors}`. Fully unit-tested. |
| `src/components/game/sandbox/PalettePanel.tsx` | Component | White/Black tabs → piece chips. |
| `src/components/game/sandbox/ChargeEditor.tsx` | Component | **Build picker** — pick one of the placed anomaly's legal builds (§3.2; ≤6 options). No sliders. |
| Opponent-dropdown option + `/sandbox` route + `Sandbox.tsx` | Wiring | ✅ DONE — see §5. |

> **Full file tree, contracts (types/signatures), and data flow: see §13.**

**Stack conventions (✅ from repo memory / DevStandards):** React 19 + **React Compiler ON** →
**no** manual `useMemo`/`useCallback`/`memo`; module-store + `useSyncExternalStore` for any shared
reactive state; Zod for any parsed input; mobile-only full-bleed layout; path alias `@`.

---

## 5. Entry point & routing — ✅ DONE (2026-07-17; per user: NOT a Home button)
The Sandbox launches from the **Opponent dropdown** in the Header "Play" menu, as an entry **below
"Protocol: Run Dry"**:
- [PlaySettings.tsx](../../src/components/game/panels/PlaySettings.tsx): an
  `<option value={SANDBOX_OPTION}>🧪 Sandbox · build a position</option>` in the "Modes" optgroup. It is an
  **ACTION, not an opponent** — `SANDBOX_OPTION` is a sentinel; the select's `onChange` intercepts it and
  calls a new `onOpenSandbox()` prop (instead of `onOpponentChange`), so it never becomes a stored
  `opponentMode`.
- [LocalGame.tsx](../../src/components/game/LocalGame.tsx) passes `onOpenSandbox={() => navigate('/sandbox')}`.
- `<Route path="/sandbox" element={<SandboxPage/>} />` in [App.tsx](../../src/App.tsx); `SandboxPage`
  exported from `pages/index.ts`.
- ⚠️ UX note: navigating from a `<select>` option is slightly unconventional (selects set values; this one
  navigates). Accepted per user's explicit request; a plain link under the dropdown is a trivial alternative.

---

## 6. UX / interaction (mobile-first)
- **Layout:** empty board fills width (reuse `Board`). **No PanelDeck** (per request). Below the
  board: the **palette** (White/Black tabs) and the **Play** button.
- **Placing:** tap a palette chip to "arm" it, then tap a square (tap-to-place is more reliable on
  mobile than drag); ALSO support drag via the existing dnd. Tapping a placed piece selects it
  (opens Charge editor for anomalies); drag it off-board or a "trash" target to remove.
- **Charge editor:** compact popover showing the selected anomaly's archetype's **legal builds (§3.2)**
  as pickable options (each rendered as its O · D · L battery; ≤6 options; Omni = shared 8). Picking one
  sets the charges. Every option is legal by construction, so there is nothing to "warn" about.
- **Side to move:** a White/Black toggle (defaults White) — the *position's* mover.
- **Opponent (in `SandboxToolbar`):** **Hot-seat** vs **vs Bot**; when *vs Bot*, a **Level** picker
  (the 8 selectable tiers) + **your side** (default You = White → **Bot = Black**, with a swap).
  Reuse the game's single source `RUN_DRY_TIERS` + `RUN_DRY_TIER_LABELS` and the same `asi`-excluded
  filter `PlaySettings` uses ([PlaySettings.tsx](../../src/components/game/panels/PlaySettings.tsx)
  L88–96); optionally extract `SELECTABLE_BOT_TIERS = RUN_DRY_TIERS.filter(t => t !== 'asi')` so both
  surfaces share one list. ⚠️ **vs Bot needs the engine → gated by §3.1.**
- **Play:** disabled with an inline reason (from `validateSetup`) until the position is legal.
- **Accessibility:** chips are buttons with aria-labels (`"White Absolute Leap anomaly"`); the build
  options are `role="radio"` in a `radiogroup`; validation errors announced via `aria-live`.

---

## 7. Play handoff (Sandbox → game)
1. On **Play**, build a `GridlockPosition` from the editor board (reuse `serializePosition` shape).
2. Wrap as a minimal `GridlockReplay`: `{ v, meta, start: <position>, moves: [] }`.
3. Hand off — **two options, pick one in review:**
   - **(a) `location.state`** (matches Home's existing pattern): `navigate('/play', { state: {
     loadSandbox: replay } })`; LocalGame's mount-restore reads it FIRST (like the old Archive
     load) → `pendingImportLoadRef` → `loadState`. Simple, but state must stay serializable.
   - **(b) module store** (`pendingSandboxRef`, `useSyncExternalStore` pattern): Sandbox sets it,
     LocalGame reads+clears on mount. Avoids router-state size concerns; matches the app's
     established store pattern. **Recommended.**
4. **The payload carries opponent config, not just the board:** `{ replay, opponentMode, humanColor }`.
   LocalGame's mount-restore applies them with the SAME setters the resume path already uses
   ([LocalGame.tsx](../../src/components/game/LocalGame.tsx) L580: `setOpponentMode` / `setHumanColor`
   / `setPerspective`), then treats the replay like an import with zero moves → the game begins from
   that board. `opponentMode` = `'offline'` (hot-seat) or a `BotDifficulty` (the level); the bot plays
   `opponentOf(humanColor)`.
5. **`perspective = humanColor`** (you sit at the bottom) — resolves §10 Q7.
6. **Bot-moves-first is automatic:** the bot plays its colour whenever it's that colour's turn, so if
   Bot = Black and the built position's side-to-move is Black it moves immediately; otherwise you do.

---

## 8. Testing strategy (s-tier = the logic is pure and tested)
- **`setupValidation.spec.ts`** — exhaustive: one/zero/two kings per side, pawn on back rank,
  wrong-side-in-check, and **charge-build legality (§3.2)** — e.g. any charges that aren't one of the
  archetype's 36 legal builds (checked via `isLegalBuild`) is rejected. (Pure fn → trivial
  to test, like `outcome.spec.ts`.)
- **Round-trip test:** editor board → `serializePosition` → `positionToBoard` → identical board
  (ids aside). Guards the handoff.
- **Engine-acceptance harness (manual/spike):** the §3.1 verification, kept as a short note.
- Keep all editor *decision* logic in pure functions so it's testable without rendering (same
  functional-core/imperative-shell approach used for the King-mood feature).

---

## 9. Phasing (ship in thin slices)
1. **Spike (½ day):** §3.1 engine-acceptance check on 3–4 hand FENs. **Go/no-go for "vs bot".**
2. **M1 — Editor skeleton:** `/sandbox` route + Opponent-dropdown entry + empty board + palette (place/remove,
   pieces drop at their archetype's **canonical default charges**) + side-to-move toggle. Hot-seat Play.
3. **M2 — Charge editing:** build-picker ChargeEditor (§3.2) + `useSandbox` persistence.
4. **M3 — Validation:** `validateSetup` + gated Play + inline errors + tests.
5. **M4 — Polish:** trash target, empty-state hints, "Sandbox = unbalanced lab" note, a11y pass.

---

## 10. Open questions (need your decisions)
1. ✅ **RESOLVED (2026-07-17) — charges = a discrete pick from the archetype's 36 legal builds** (§3.2),
   not sliders. Supersedes the earlier "how strict (a/b)" sub-decision — the coupled per-vector ranges made
   independent sliders unworkable, so we enumerate the legal builds instead. **Default charges** = the
   archetype's deterministic canonical (index-0) build (no random roll) so placement is predictable.
   ✅ IMPLEMENTED in `charges.ts` + tests.
2. **Omni:** `ARCHETYPE_REGISTRY` includes **Omni**, which is **promotion-only** in the real game.
   Include it in the palette (sandbox-only), or exclude it? *(You said "11 anomalies" — confirm
   whether that count includes Omni.)*
3. **Piloted royals:** allow placing a piloted anomaly (a King fused into an anomaly), or MVP =
   plain Kings only? (Piloted royals complicate the "one royal per side" check.)
4. ✅ **DONE (2026-07-17) — vs Bot wired** via `SandboxToolbar` (Hot-seat / vs Bot + level + your side;
   reuses `SELECTABLE_BOT_TIERS = RUN_DRY_TIERS − asi`). Handoff passes `sandboxOpponent` (BotDifficulty
   or 'offline') + `sandboxColor`. Low code risk — the bot already plays arbitrary boards every move,
   with heuristic fallback on engine error. ⚠️ The §3.1 engine-*strength* question (does it play well
   from unusual hand-built positions?) is still **on-device-unverified** — degrades gracefully, never blocks.
5. ✅ **RESOLVED (2026-07-17) — Opponent dropdown action-option** (below Protocol: Run Dry), per user;
   not a Home CTA. See §5.
6. **Placement model:** is the palette an infinite **template** (place as many of each as you like;
   validation catches illegals) or a one-each **inventory** (drag the single shown piece)? Standard
   editors use infinite templates. *(Affects the palette UI and `validateSetup`.)*
7. ✅ **DECIDED — `perspective = humanColor`** (you sit at the bottom); the handoff carries it (§7).
8. **Default opponent & level:** default to **vs Bot · Bot = Black · You = White**; default **level** = ?
   (recommend a mid tier like `club` ~1400, or **remember last-used** in `localStorage`). Confirm the
   default tier + whether to persist it. Reuse `RUN_DRY_TIERS` / `RUN_DRY_TIER_LABELS` (asi excluded).

---

## 11. Broader mode roadmap — honest guidance (NOT part of this build)
You mentioned Tutorial, Puzzle, RPG, Survival, and new variants. Straight talk:
- **Build Sandbox first; it's the enabler for most of these.** Don't scaffold five modes at once —
  modern practice is ship one deep thing, learn, expand. Five shallow modes < one polished mode.
- **Puzzles** are the cheapest, highest-value follow-on (a puzzle = saved position + solution +
  checker). Natural M-next after Sandbox.
- **Tutorial** ≈ scripted positions + Coach prompts (the Coach system already exists).
- **⚠️ Survival was already BUILT and DELIBERATELY REMOVED** (the whole Survival gauntlet + charge
  system, 2026-07-09). Re-adding it re-opens a decision you already made — revisit *why* first.
- **RPG** is an order of magnitude larger than everything else combined (progression, content,
  story). That's a different product, not a "mode." Park it.
- **Variants within Gridlock** depend entirely on engine variant support — a separate spike.

**Recommendation:** Sandbox (this plan) → **Puzzles** → reassess. Ignore RPG/Survival for now.

---

## 12. File touch list (summary) — full tree + contracts in §13
- **New (UI):** `pages/Sandbox.tsx`;
  `components/game/sandbox/{SandboxBoard,PalettePanel,PaletteChip,ChargeEditor,SandboxToolbar}.tsx`.
- **New (hooks):** `hooks/useSandbox.ts`, `hooks/useSandboxDnD.ts` (editor-specific dnd — NOT `useBoardDnD`).
- **New (pure logic + tests):** `lib/chess/sandbox/{charges,setupValidation,buildSandboxReplay}.ts` +
  `lib/chess/sandbox/__tests__/*.spec.ts`.
- **Edit:** `App.tsx` (route), `pages/index.ts` (export), `pages/Home.tsx` (Sandbox CTA),
  `components/game/LocalGame.tsx` (read the sandbox handoff on mount).
- **Reuse (no change):** `PieceGlyph`, `format.ts` (position model), `archetypes.ts`, `check.ts`,
  the **dnd-kit** library primitives.
- **Reuse WITH adaptation (not as-is):** `Board`/`Square` (game-coupled props → editor-mode
  `SandboxBoard`). **NOT reusable:** `useBoardDnD` (in-game legal-move dragging only).

---

## 13. Architecture detail (reference) — s-tier structure & contracts

**Stance:** *functional core / imperative shell.* All rules live in **pure, React-free,
unit-tested** modules under `lib/chess/sandbox/`; React files are thin shells. Editor state is
**page-local** (`useReducer` in `useSandbox`), NOT a global module store — correct because the state
never leaves the Sandbox subtree (contrast `useKingMood`, which is global *because* it crosses
Board→Square→Piece).

### 13.1 File layout
```
src/
  pages/Sandbox.tsx                      # route page; owns useSandbox + useSandboxDnD; Play handoff
  hooks/
    useSandbox.ts                        # editor state via useReducer + action creators
    useSandboxDnD.ts                     # NEW dnd-kit wiring: palette→board, board→board, →trash
  components/game/sandbox/
    SandboxBoard.tsx                     # editor-mode board (editable squares; NO legalMoves/lastMove)
    PalettePanel.tsx                     # White/Black tabs → chips (maps ARCHETYPE_REGISTRY)
    PaletteChip.tsx                      # one draggable palette entry
    ChargeEditor.tsx                     # build PICKER — one of the selected anomaly's legal builds
    SandboxToolbar.tsx                   # side-to-move toggle · Clear · Play (+ inline validity)
  lib/chess/sandbox/
    charges.ts                           # ✅ DONE: archetypeBuilds() · canonicalCharges() · isLegalBuild()
    setupValidation.ts                   # validateSetup(board, turn) → { ok, errors[] }
    buildSandboxReplay.ts                # editor board → GridlockReplay (start + [] moves)
    __tests__/{charges,setupValidation,buildSandboxReplay}.spec.ts
```

### 13.2 Contracts (signatures — the real design)
```ts
type PaletteItem =
  | { kind:'king';  color:PieceColor }
  | { kind:'pawn';  color:PieceColor }
  | { kind:'anomaly'; color:PieceColor; archetype:ArchetypeKey };

// lib/chess/sandbox/charges.ts (PURE) — ✅ IMPLEMENTED + generate()-sampling verified
export function archetypeBuilds(key: StandardArchetypeKey): readonly VectorPool[]; // the archetype's legal builds (≤6)
export function canonicalCharges(key: ArchetypeKey): VectorPool | OmniPool;   // deterministic default (index-0 build; Omni = shared 8)
export function isLegalBuild(key: StandardArchetypeKey, v: VectorPool): boolean; // membership in archetypeBuilds
export const TOTAL_BUILDS: number; // 36

// lib/chess/sandbox/setupValidation.ts (PURE, unit-tested)
export interface SetupError { code:string; message:string }
export function validateSetup(board: Board, turn: PieceColor): { ok:boolean; errors:SetupError[] };

// lib/chess/sandbox/buildSandboxReplay.ts (PURE)
export function buildSandboxReplay(board: Board, turn: PieceColor): GridlockReplay; // { v, meta, start, moves:[] }

// handoff payload (Sandbox → LocalGame, applied via the resume-path setters)
interface SandboxHandoff { replay: GridlockReplay; opponentMode: OpponentMode; humanColor: PieceColor }

// hooks/useSandbox.ts (imperative shell over the pure core)
interface SandboxState {
  board:Board; turn:PieceColor;                 // the position (turn = its mover)
  opponentMode:OpponentMode;                    // 'offline' (hot-seat) | BotDifficulty (level)
  humanColor:PieceColor;                        // bot plays opponentOf(humanColor); perspective = humanColor
  selected:Square|null; armed:PaletteItem|null; // editor UI
}
type SandboxAction =
  | { type:'place';  square:Square; item:PaletteItem }        // anomalies → canonicalCharges()
  | { type:'remove'; square:Square }
  | { type:'move';   from:Square; to:Square }
  | { type:'setCharges'; square:Square; vectors:VectorPool|OmniPool }  // must be a legal build (isLegalBuild)
  | { type:'setTurn'; turn:PieceColor }
  | { type:'setOpponent'; opponentMode:OpponentMode }   // Hot-seat / bot level
  | { type:'setHumanColor'; humanColor:PieceColor }     // which side you play (bot = the other)
  | { type:'select'; square:Square|null }
  | { type:'arm';    item:PaletteItem|null }
  | { type:'clear' };
```
**Key reuse:** the editor state's `board` IS the game's `Board` type, so `buildSandboxReplay` →
`serializePosition` needs zero conversion and the Play-handoff is the exact proven resume path.

### 13.3 Data flow (unidirectional)
```
Palette (arm / drag) ┐
Board tap / drag     ├─▶ useSandbox reducer ─▶ SandboxState.board
ChargeEditor(clamp)  ┘                               │
                                                     ▼
                     validateSetup(board,turn) ─▶ Play enabled? + inline errors
                                                     │
              Play ─▶ buildSandboxReplay ─▶ handoff (module ref) ─▶ /play ─▶ LocalGame mount-restore
```

### 13.4 Why this is s-tier
- Rules are **pure functions** → testable without rendering (same pattern as the King-mood refactor).
- **New dnd isolated** in `useSandboxDnD` (never touches the game's `useBoardDnD`).
- **React-Compiler-clean** (reducer + pure selectors; no `useMemo`/`useCallback`).
- **Local hook, not a global store** — right tool for page-scoped state.
- Reuses the verified position model + Play-handoff; only genuinely-new surfaces (`SandboxBoard`, the
  editor dnd, the charge/validation logic) are built fresh.

---

## 14. Implementation checklist (easiest → hardest — tick as we go)

> **STATUS (2026-07-18): CORE FEATURE COMPLETE + SHIPPED.** Stages 0–3 + vs-Bot + persistence are
> built, tested, and in the APK. Whole project green: tsc 0, lint 0 errors, **186 tests** (4 sandbox
> spec files: charges/setupValidation/buildSandboxReplay/useSandbox-reducer+persistence), build ok.
> Not visually verified on-device (agent screenshots blank) — user tests on phone. REMAINING (optional
> polish, non-blocking): drag-and-drop, dedicated trash target, fuller a11y pass. vs-Bot engine
> *strength* from unusual positions is the only genuine on-device unknown (degrades gracefully).

> Ordered to ship visible progress early and hit the risky/hard parts last. Everything before Stage 6
> is **hot-seat** and has **no unknowns**. The **bot** path is gated by the engine spike (Stage 6) —
> pull that spike earlier if you'd rather de-risk "vs Bot" before investing in the editor.

### Stage 0 — Scaffolding (easiest; no logic)
- [ ] `/sandbox` route in `App.tsx` + `pages/Sandbox.tsx` stub + export in `pages/index.ts`
- [ ] **Sandbox** secondary CTA on `Home.tsx` → `/sandbox`
- [ ] `SandboxBoard.tsx` renders an empty 8×8 grid (reuse `Square` visuals; no pieces yet)

### Stage 1 — Pure logic (easy; fully unit-tested, no UI)
- [x] `lib/chess/sandbox/charges.ts` — `archetypeBuilds` · `canonicalCharges` · `isLegalBuild` (36 builds)
- [x] `charges.spec.ts` — per-archetype counts + **generate()-sampling equality** + canonical defaults (9 tests green)
- [ ] `lib/chess/sandbox/setupValidation.ts` — `validateSetup(board, turn)`
- [ ] `setupValidation.spec.ts` — kings, back-rank pawns, wrong-side-in-check, charge legality
- [ ] `lib/chess/sandbox/buildSandboxReplay.ts` + round-trip spec (board → replay → board)

### Stage 2 — Editor core (medium)
- [ ] `useSandbox.ts` reducer — place / remove / move / setTurn / clear
- [ ] `PalettePanel.tsx` + `PaletteChip.tsx` — White/Black tabs mapping `ARCHETYPE_REGISTRY` + King/Pawn
- [ ] Tap-to-place / tap-to-remove wiring (no drag yet)
- [ ] Side-to-move toggle

### Stage 3 — Charges & validation UI (medium)
- [ ] `ChargeEditor.tsx` — build PICKER (`archetypeBuilds`) → `setCharges`
- [ ] Wire `validateSetup` → Play enabled/disabled + inline error reason

### Stage 4 — Hot-seat Play (medium; NO engine needed)
- [ ] Handoff store (`pendingSandbox`) + `LocalGame` mount-restore branch that consumes it
- [ ] `SandboxToolbar` Play → `buildSandboxReplay` → handoff → game starts (hot-seat)
- [ ] `useSandbox` persistence to `localStorage 'gridlock:sandbox:v1'`

### Stage 5 — Drag-and-drop (harder; NEW dnd)
- [ ] `useSandboxDnD.ts` — palette→board, board→board, →trash (dnd-kit primitives, NOT `useBoardDnD`)

### Stage 6 — Opponent + Bot (hardest; ⛔ gated)
- [ ] **Opponent control** in `SandboxToolbar` — Hot-seat / vs Bot + Level (reuse `RUN_DRY_TIERS`, `asi` excluded) + your-side
- [ ] ⛔ **ENGINE SPIKE (§3.1)** — verify the native engine accepts a hand-built position → **go/no-go for vs Bot**
- [ ] Handoff carries `opponentMode` + `humanColor` → `LocalGame` applies via resume setters → **vs Bot plays**

### Stage 7 — Polish & ship
- [ ] Empty-state hints + "Sandbox = unbalanced lab" note + a11y pass (aria-labels · `spinbutton` · `aria-live`)
- [ ] `npm run build` + `npx vitest run --pool=forks` green
- [ ] APK via `npm run apk:copy` + on-device check

> **Blocking decisions to close before/while starting (from §10):** strict-vs-total charges,
> Omni in palette, piloted royals, placement model, entry-point styling, default bot level.
</content>
</invoke>
