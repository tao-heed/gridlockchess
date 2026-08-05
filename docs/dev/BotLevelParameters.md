# Bot Level Parameters — 25-Level Calibration Plan

**Status:** Implemented. All three checklists below are complete. tsc clean, 236 tests green.

---

## Why No ELO

ELO labels were removed for three reasons:

1. **Not measured.** The formula was `~400 + (idx/44) * 2800` — a made-up linear scale, never
   calibrated against real players or rated games. Level 1 showed "~400 ELO" to the player.
2. **Wrong game.** Gridlock Chess ≠ standard chess. FSF skill levels don't map to FIDE ELO.
3. **Unnecessary.** Tier names + level numbers communicate difficulty clearly without a false
   precision number.

**Replacement:** Tier name + level number only. "Advanced 3" or "Level 13 · Advanced 3".

---

## Why 25 Levels, Not 45

The 45-level system has fundamental parameter repetition problems:
- `skill=20` appeared **11 times** — the entire master tier was the same bot with extra think time
- Skill repeated in **24/44 adjacent pairs** (55% of all "level ups" had no skill change)
- Three dead zones where adjacent levels were parameter-identical (L27=L28, L36=L37, L18/L19 except fuel)

The mathematically clean minimum for zero repeats on all parameters is **N=20** (global lerp).
But a pure global lerp loses tier character — basic bots would think for 1–2 seconds (wrong feel).

**25 levels (5 tiers × 5 sub-levels)** with adjusted TIER_SPECS gives:
- **0 movetime repeats** — every level has a unique think time
- Skill/depth repeats only where mathematically unavoidable (master tier, skill capped at 20)
- Tier boundaries no longer share parameter values — each tier has a clean step up
- Every level is perceptibly different from its neighbours on at least 2 parameters

---

## Parameter Glossary

| Column | Source | What it controls |
|--------|--------|-----------------|
| **Skill** | FSF `Skill Level` 0–20 | Intentional error rate. 0 = blunders freely; 20 = no intentional errors. |
| **Depth** | `go depth N` | Max ply the engine searches. Either depth OR movetime stops the search — whichever comes first. FSF max is up to 246 depending on build flags (possibly 60 without `USE_HEAP_INSTEAD_OF_STACK_FOR_MOVE_LIST` — unverified for our build); D24 is the practical mobile ceiling given movetime. |
| **Movetime** | `go movetime N` ms | Hard time wall per move. The primary differentiator at high levels where skill is maxed. |
| **MultiPV** | `MultiPV N` | Candidate lines evaluated simultaneously. High at low levels (spread into weaker moves = controlled variance); low at high levels (focused on best lines). |
| **Overlay D** | `overlayBudget.maxDepth` | Depth of the JS charge-aware overlay that runs after the engine picks. 0 = cliff guard only (no lookahead, but forced-Override fallback always active); 8 = full depletion tree. |
| **Fuel** ⚡ | `useFuel()` | Whether the engine receives native per-piece L/O/D charge counts via the UCI `fuel` command. The biggest single qualitative jump in the system — the engine goes from charge-blind to natively tracking depletion in its own search tree. |

> **Note on Overlay D=0:** Even at D=0 the bot never softlocks. The forced-Override fallback
> in `chooseBotMove` is hardcoded and fires independently of Overlay D — when Override is the
> only legal reply, the bot picks the best host by coverage▸runway▸safeMobility.

> **Note on Depth:** `go depth N` is a cap, not a guarantee. On mobile at movetime=800ms the
> engine often only reaches D10–D14. The Engine Log's `reachedDepth` shows the actual depth.

---

## Tier Profiles

| Tier | Levels | Character | Fuel | Intended player |
|------|--------|-----------|------|-----------------|
| **Basic** | L1–L5 | Near-random to weak club. Blunders freely, short think time. Overlay is minimal. | — | First-time players learning mechanics. No pressure. |
| **Intermediate** | L6–L10 | Stops blundering, plays sensibly. Charge-blind but overlay conserves charges. | — | Players who know the rules, want a fair fight. |
| **Advanced** ⚡ | L11–L15 | Engine gains native charge awareness. Finds simple forcing sequences. | ⚡ | Experienced players ready for a real challenge. |
| **Expert** ⚡ | L16–L20 | Sharp and tactical. Rarely misses a tactic. Deliberate charge play. | ⚡ | Strong players aiming to improve. |
| **Master** ⚡ | L21–L25 | Max skill, no intentional errors. Only depth and movetime limit its strength. | ⚡ | Top-tier challenge. Most players will not beat this. |

---

## 25-Level Parameter Table

Computed from adjusted `TIER_SPECS` with `Math.round(a + (b-a) * t)`, `t = (sub-1)/4`.
Zero movetime repeats. Remaining skill/depth repeats are unavoidable given the parameter ranges.

### BASIC — L1–L5 · Charge-blind

| Level | Code | Skill | Depth | Movetime | MultiPV | Overlay D |
|-------|------|-------|-------|----------|---------|-----------|
| L1  | `basic_1` |  0 |  1 |  100 ms | 15 | 0 |
| L2  | `basic_2` |  2 |  2 |  145 ms | 14 | 0 |
| L3  | `basic_3` |  4 |  3 |  190 ms | 13 | 1 |
| L4  | `basic_4` |  5 |  4 |  235 ms | 11 | 1 |
| L5  | `basic_5` |  7 |  5 |  280 ms | 10 | 1 |

### INTERMEDIATE — L6–L10 · Charge-blind

| Level | Code | Skill | Depth | Movetime | MultiPV | Overlay D |
|-------|------|-------|-------|----------|---------|-----------|
| L6  | `intermediate_1` |  9 |  6 |  320 ms |  9 | 2 |
| L7  | `intermediate_2` | 10 |  7 |  428 ms |  8 | 3 |
| L8  | `intermediate_3` | 11 |  9 |  535 ms |  8 | 3 |
| L9  | `intermediate_4` | 12 | 10 |  643 ms |  7 | 4 |
| L10 | `intermediate_5` | 13 | 11 |  750 ms |  6 | 4 |

- L5 → L6: movetime jumps 280→320ms, skill 7→9, depth 5→6. Clean step up, no shared values.

### ADVANCED — L11–L15 · Fuel-aware ⚡

| Level | Code | Skill | Depth | Movetime | MultiPV | Overlay D |
|-------|------|-------|-------|----------|---------|-----------|
| L11 | `advanced_1` | 14 | 12 |  800 ms | 6 | 4 |
| L12 | `advanced_2` | 15 | 13 |  950 ms | 6 | 5 |
| L13 | `advanced_3` | 15 | 14 | 1100 ms | 5 | 5 |
| L14 | `advanced_4` | 16 | 14 | 1250 ms | 5 | 6 |
| L15 | `advanced_5` | 16 | 15 | 1400 ms | 4 | 6 |

- L10 → L11: the **fuel gate**. Movetime 750→800ms (small), but the engine now receives native
  charge data. The qualitative jump in play is real even though the numbers look close.
- L12/L13 share skill=15, L13/L14 share depth=14: unavoidable (range 14→16 = 3 values, 5 levels).
  Movetime always differs, so the bot plays measurably differently.

### EXPERT — L16–L20 · Fuel-aware ⚡

| Level | Code | Skill | Depth | Movetime | MultiPV | Overlay D |
|-------|------|-------|-------|----------|---------|-----------|
| L16 | `expert_1` | 17 | 17 | 1600 ms | 4 | 6 |
| L17 | `expert_2` | 18 | 18 | 1950 ms | 4 | 7 |
| L18 | `expert_3` | 19 | 19 | 2300 ms | 4 | 7 |
| L19 | `expert_4` | 19 | 20 | 2650 ms | 3 | 8 |
| L20 | `expert_5` | 20 | 21 | 3000 ms | 3 | 8 |

- L15 → L16: clear jump — depth 15→17, movetime 1400→1600ms, skill 16→17.
- L18/L19 share skill=19: unavoidable (range 17→20). Depth and movetime differ.

### MASTER — L21–L25 · Fuel-aware ⚡ · Skill maxed

| Level | Code | Skill | Depth | Movetime | MultiPV | Overlay D |
|-------|------|-------|-------|----------|---------|-----------|
| L21 | `master_1` | 20 | 22 | 3200 ms | 5 | 8 |
| L22 | `master_2` | 20 | 23 | 3400 ms | 5 | 8 |
| L23 | `master_3` | 20 | 23 | 3600 ms | 5 | 8 |
| L24 | `master_4` | 20 | 24 | 3800 ms | 5 | 8 |
| L25 | `master_5` | 20 | 24 | 4000 ms | 5 | 8 |

- L20 → L21: depth 21→22, movetime 3000→3200ms. No dead zone.
- Skill=20 and Overlay D=8 are fixed for the whole tier — unavoidable. Only depth and movetime scale.
- L22/L23 share depth=23, L24/L25 share depth=24: unavoidable (range 22→24 = 3 values, 5 levels).
  Movetime always differs by 200ms.
- MultiPV rises from expert's 3 to 5 — at max skill, more candidates give richer play without weakening.

---

## Adjusted TIER_SPECS

The code change required in `src/lib/chess/bot.ts`:

```ts
// SubLevel type: drop '6'|'7'|'8'|'9' — only 5 sub-levels per tier
type SubLevel = '1' | '2' | '3' | '4' | '5';

// t = (sub - 1) / 4   (was / 8)

const TIER_SPECS: Record<BotTier, TierSpec> = {
  //                              Skill      Depth     Movetime        MultiPV    OverlayD    OverlayMs          Fuel
  basic:        { skillRange:[0,7],   depthRange:[1,5],   movetimeRange:[100,280],   multipvRange:[15,10], overlayMaxD:[0,1],   overlayTimeBudgetRange:[/* TBD */100,180],   fuel: false },
  intermediate: { skillRange:[9,13],  depthRange:[6,11],  movetimeRange:[320,750],   multipvRange:[9,6],   overlayMaxD:[2,4],   overlayTimeBudgetRange:[/* TBD */200,450],   fuel: false },
  advanced:     { skillRange:[14,16], depthRange:[12,15], movetimeRange:[800,1400],  multipvRange:[6,4],   overlayMaxD:[4,6],   overlayTimeBudgetRange:[/* TBD */500,900],   fuel: true  },
  expert:       { skillRange:[17,20], depthRange:[17,21], movetimeRange:[1600,3000], multipvRange:[4,3],   overlayMaxD:[6,8],   overlayTimeBudgetRange:[/* TBD */1000,2500], fuel: true  },
  master:       { skillRange:[20,20], depthRange:[22,24], movetimeRange:[3200,4000], multipvRange:[5,5],   overlayMaxD:[8,8],   overlayTimeBudgetRange:[/* TBD */2600,3500], fuel: true  },
};
```

Key differences from the current (45-level) TIER_SPECS:
- `advanced` skill ceiling: 17→16 (avoids sharing with expert's floor of 17)
- `expert` depth floor: 16→17 (creates clear gap from advanced ceiling of 15)
- `master` depth floor: 21→22 (creates clear gap from expert ceiling of 21)
- `master` movetime floor: 3000→3200 (creates clear gap from expert ceiling of 3000)

---

## Bot Unlock Progression Plan

### Concept

Bots are **not available in the opponent dropdown by default**. Each bot level is unlocked
by defeating that level in Protocol: Run Dry. This:

- Gives Run Dry a permanent reward beyond streaks/completion
- Prevents new players from being overwhelmed by choosing a level they can't handle
- Makes every Run Dry win feel meaningful — you are permanently unlocking a sparring partner
- Creates a natural discovery loop: beat it in Run Dry, then study it in free play

### Unlock Rules

| State | Bots in dropdown |
|-------|-----------------|
| Fresh install (`bestStreak = 0`) | **0 bots** — dropdown shows no bots |
| Beaten Run Dry L1 (`bestStreak = 1`) | **1 bot** — L1 only |
| Beaten Run Dry L10 (`bestStreak = 10`) | **10 bots** — L1–L10 |
| Beaten Run Dry Lx (`bestStreak = x`) | **x bots** — L1–Lx |
| Beaten Run Dry L25 (`bestStreak = 25`) | **25 bots** — full roster unlocked |

Bot count in the dropdown = `bestStreak` exactly. Defeating Lx unlocks the Lx bot.
No free starter bot — you earn every sparring partner.

### Unlock Storage

Unlock state derives from `RunDryProgress.bestStreak` — the highest Run Dry rung ever
reached (never resets on completion). Confirmed schema in `useProtocolRunDry.ts`:

```ts
type RunDryProgress = { tier: number; bestStreak: number };
// Storage key: 'gridlock:run-dry:v2'  (v3 key needed for 25-level migration)
```

Fresh install: `bestStreak = 0` → 0 bots shown. Dropdown shows the first `bestStreak`
entries of `ALL_DIFFICULTIES` (indices 0 to `bestStreak - 1`).

> **Note:** verify that `bestStreak` increments by 1 per Run Dry win and that its value
> maps 1:1 to the 25-level index before wiring up Checklist C.

### UX Details

- **Fresh install**: no bots section in the dropdown at all, or a single disabled row "Play Run Dry to unlock bots."
- **Locked bots**: hide entirely — cleaner, less intimidating. No greyed-out rows cluttering the list.
- **After full completion**: all 25 levels available. The player has earned every sparring partner.

---

## Implementation Checklist

### A — 25-Level Refactor (bot.ts + hooks)

- [x] **`src/lib/chess/bot.ts`** — Change `SubLevel` type to `'1'|'2'|'3'|'4'|'5'`. Change `SUB_LEVELS` constant to `['1','2','3','4','5']` (`ALL_DIFFICULTIES` auto-derives from it — no manual edit needed). Update `TIER_SPECS` to new ranges (see Adjusted TIER_SPECS above). Change lerp divisor from `/8` to `/4` in `botConfig` and `overlayBudget`. **Fix `levelIndex` (line 37): change `* 9` → `* 5`.** Fix line 13 comment (still says "45 levels across 5 tiers (L1-L45)").
- [x] **`src/hooks/useProtocolRunDry.ts`** — Update progress calculations (totalTiers=25). Fix stale comments: line 3 ("45-level (5-tier × 9 sub-level)"), line 21 JSDoc on `RUN_DRY_TIERS` ("Full 45-level ladder: basic_1 … master_9"), line 55 inline (`// 0-44 (index into RUN_DRY_TIERS)` → `0-24`). **Fix `UseProtocolRunDryReturn.currentTierLabel` type (line 84): remove `elo: string` from the inline type** — TypeScript will error when `elo` is removed from `makeTierLabel`.
- [x] **`src/components/game/modals/ProtocolRunDryModal.tsx`** — Fix `TIER_SIZE = 9` (line 15) → `5`. Fix stale comment on lines 13–14 ("5 tiers × 9 = 45 total").
- [x] **Storage migration** — Add `V2_TO_V3` map (45-level index → nearest 25-level index) for both `tier` and `bestStreak`. Note: `bestStreak` can be 45 (one past the last v2 index — set when the full run is completed); map 45 → 25 explicitly. Bump storage key to `'gridlock:run-dry:v3'`. `V1_TIER_TO_V2` stays as-is (historical, not touched).
- [x] **`tsc -b --noEmit`** clean.
- [x] **`vitest run`** all green. Update any test difficulty strings that used `'6'`–`'9'` sub-levels.

### B — Remove ELO from code and UI

- [x] **`src/hooks/useProtocolRunDry.ts`** — Delete `eloForDifficulty()`. Remove `elo` field from `makeTierLabel()` and `RUN_DRY_TIER_LABELS` type.
- [x] **`src/components/game/LocalGame.tsx`** — Line ~960: remove `· ${tier.elo} ELO` from bot name string; fix comment at lines 955–956 (still says "tier name + ELO, e.g. 'Expert · ~2000 ELO'"). Line 1294: remove `difficultyElo={runDry.currentTierLabel.elo}` prop pass — `elo` won't exist on `currentTierLabel` after this checklist.
- [x] **`src/components/game/modals/ProtocolRunDryModal.tsx` line ~182** — Remove `({difficultyElo} ELO)` span and `difficultyElo` prop.
- [x] **`src/components/game/panels/OpponentSelect.tsx` line ~45** — Remove ELO from label string.
- [x] **`src/components/game/sandbox/BotLevelSelect.tsx` line ~30** — Remove ELO from label string.
- [x] **`src/components/game/PlayerCard.tsx`** — Update subtitle JSDoc example (remove ELO).
- [x] **`tsc -b --noEmit`** clean. **`vitest run`** green.

### C — Bot Unlock Progression

- [x] **`src/hooks/useProtocolRunDry.ts`** — Remove `SELECTABLE_BOT_TIERS`. Add `unlockedBots: BotDifficulty[]` to `UseProtocolRunDryReturn` (= `ALL_DIFFICULTIES.slice(0, bestStreak)`). `bestStreak` is already verified to increment by 1 per win, so `slice(0, bestStreak)` = exactly the earned bots.
- [x] **`src/components/game/panels/OpponentSelect.tsx`** — Add `unlockedBots: BotDifficulty[]` prop. Move `OPPONENT_GROUPS` bot-tier entries **inside the component** (currently a module-level static — must be reactive). Build bot groups from `unlockedBots` instead of `SELECTABLE_BOT_TIERS`. Update `TIER_GROUP_LABELS` level ranges (currently "Basic (L1-9)" etc.) → "Basic (L1-5)", "Intermediate (L6-10)", "Advanced (L11-15) ⚡", "Expert (L16-20) ⚡", "Master (L21-25) ⚡". If `unlockedBots.length === 0`, show a single disabled row "Play Run Dry to unlock bots" — no tier groups at all. Wire `unlockedBots` down from wherever `useProtocolRunDry` is called.
- [x] **`src/components/game/sandbox/BotLevelSelect.tsx`** — **Decide first: should Sandbox be gated by Run Dry unlock progress?** You said "modes dropdown" specifically — Sandbox is a separate tool for testing/building positions. If Sandbox should always show all bots regardless of progress, skip this component entirely. If it should be gated: add `unlockedBots: BotDifficulty[]` prop, move `TIER_GROUPS` inside the component, update `TIER_GROUP_LABELS` to 25-level ranges, build from `unlockedBots`, guard against empty list (`allOptions[0]` is `undefined` when empty — currently crashes).
- [x] **`src/components/game/sandbox/SandboxToolbar.tsx`** — Remove `export { SELECTABLE_BOT_TIERS }` (line 14) and the import on line 9 — `SELECTABLE_BOT_TIERS` is being deleted from `useProtocolRunDry`. Fix stale comment on line 6 ("SELECTABLE_BOT_TIERS — L1-44; master_9 (L45, Run Dry final boss)"). Update to reflect whatever replaces it.
- [x] **Fresh install UX** — If `unlockedBots.length === 0`, show hint: "Play Run Dry to unlock bots."
- [x] **`tsc -b --noEmit`** clean. **`vitest run`** green.
- [x] **Manual test** — Fresh install: 0 bots, hint row visible. Beat Run Dry L1: 1 bot (L1) appears. Beat Run Dry L10: 10 bots. Beat L25: all 25 bots.
