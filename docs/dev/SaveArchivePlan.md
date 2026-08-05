# Save + Game Archive — Plan (for review)

Status: **DRAFT / not implemented.** This document is a proposal only. No code has been
written except a proposed layout tweak (see §1), which was reverted pending review.

## Goal

1. Move the **"Move History"** label *outside/above* the rounded panel (section-header
   pattern), freeing the header row for more actions.
2. Add a **Save** action beside **Copy** that snapshots the current game into a persistent,
   in-app **Archive**.
3. Add an **Archive page** where the player can browse, load, and manage saved games.

Design bar: modern, S-tier — reuse existing replay infra, no new engine work, graceful
storage limits, accessible, no global-state bloat.

---

## 0. What already exists (verified in code)

- [`MoveHistoryPanel.tsx`](../../src/components/game/panels/MoveHistoryPanel.tsx) already
  produces a portable, self-contained replay via `getReplayJson()` and loads one via
  `onImportReplay(json, fileName)`.
- Import path is security-hardened: `MAX_REPLAY_BYTES` (2 MB pre-read gate) +
  `parseReplay()` + schema `MAX_REPLAY_MOVES` (authoritative). See
  [`ImportReplaySecurity.md`](./ImportReplaySecurity.md).
- Replay serialization/parse lives in [`format.ts`](../../src/lib/chess/format.ts)
  (`GridlockReplay`, `parseReplay`, `renderPositionText`).
- Safe storage helpers exist: [`storage.ts`](../../src/lib/storage.ts)
  (`readJSON`/`writeJSON`, all try/caught — **note: quota failures are silently swallowed**).
- Routing is React Router in [`App.tsx`](../../src/App.tsx) (`/`, `/play`, plus doc routes).
- A position hash already exists in [`protocol.ts`](../../src/lib/net/protocol.ts#L147)
  (`h = 5381 ^ ...`) — reusable for dedupe.

**Implication:** "Save to archive" ≈ *write the same `getReplayJson()` output to
localStorage*; "Load from archive" ≈ *reuse the existing import path*. Most of this is
plumbing, not new logic.

---

## ⚠️ Naming collision to resolve first

The existing **`{ } JSON`** download button *already flashes the text `✓ Saved`* on click
(it means "downloaded to disk"). A new **Save** (archive) button will be confusing next to
it. Options:

- **A (recommended):** Rename the download button's flash to `✓ Downloaded` and reserve the
  word **Save** for the archive. Clearest.
- B: Name the new button **Archive** (verb) instead of Save. Avoids the word entirely.
- C: Use an icon-only 💾 for archive Save. Risk: ambiguous vs the JSON download.

Decision needed: **A / B / C**.

---

## 1. Layout change — label above the card

Restructure the panel's outer JSX from a single `rounded-2xl` card into:

```
<div>                              ← wrapper (no card styling)
  <div header row (px-1 mb-2)>     ← "Move History" + [JSON] [Copy] [Save]
  <div className="rounded-2xl ...">← the existing card: timeline + transport + import
</div>
```

- Title stays `text-[10px] uppercase tracking-widest`.
- Buttons right-aligned, `gap-1`, same pill styling as today.
- No behavioral change to timeline/transport/import.

Risk: **very low** (pure JSX re-nesting). This is the only part I already drafted; it was
reverted so we could review the whole thing together.

---

## 2. Data model — an archive entry

New type (proposed in [`types/game.ts`](../../src/types/game.ts) or a new
`types/archive.ts`):

```ts
export interface ArchivedGame {
  id: string;          // uuid or `${hash}` — see dedupe
  name: string;        // user-editable label; default derived (see below)
  savedAt: number;     // Date.now()
  plies: number;       // moveHistory length at save time
  result: string;      // '1-0' | '0-1' | '1/2-1/2' | '*'  (from replay meta)
  mode: string;        // opponentMode / run-dry tier, for display
  hash: string;        // content hash for dedupe
  replay: string;      // the GridlockReplay JSON (the payload)
}
```

Default `name`: e.g. `"vs OM3GA · 34 moves · Jul 7"` (mode + plies + date). Editable later.

Storage key: `gridlock:archive:v1` → `ArchivedGame[]` (newest first).

---

## 3. Store — `useGameArchive` hook

New hook `src/hooks/useGameArchive.ts` (mirrors the modular style of
[`useProtocolRunDry.ts`](../../src/hooks/useProtocolRunDry.ts)):

```
list: ArchivedGame[]
save(entry): { ok: boolean; reason?: 'duplicate' | 'full' }
remove(id): void
rename(id, name): void
clear(): void
```

- Loads once from `readJSON`, persists via `writeJSON` on each mutation.
- **Dedupe:** compute `hash` from the replay content; if an entry with the same hash
  exists, either no-op or update `savedAt`/`name` (per decision below).
- **Capacity:** enforce a cap (decision below). On overflow: auto-prune oldest, OR reject
  with `reason:'full'` so the UI can warn. Because `storage.ts` swallows quota errors, we
  must cap *proactively* — we can't rely on catching the throw.

Open decisions:
- Save allowed **anytime there are moves** (live + finished) vs **only after game end**?
- Dedupe **update-in-place** vs **allow duplicates**?
- Cap: **50 auto-prune oldest** / **100 block+warn** / **uncapped (quota risk)**?

---

## 4. Save button wiring

- In `MoveHistoryPanel`, add a `Save` button (enabled per §3 decision).
- New prop `onSaveGame: () => void` (panel stays presentational; the actual save lives in
  `LocalGame` which owns game state + `getReplayJson`).
- On click: build `ArchivedGame` from `getReplayJson()` + meta, call `archive.save()`,
  flash `✓ Saved`/`Already saved`/`Archive full` based on the result.

Files: [`MoveHistoryPanel.tsx`](../../src/components/game/panels/MoveHistoryPanel.tsx),
[`LocalGame.tsx`](../../src/components/game/LocalGame.tsx).

---

## 5. Archive page + route

- New route `/archive` in [`App.tsx`](../../src/App.tsx) (game-style layout with Footer).
- New page `src/pages/Archive.tsx` (+ export from [`pages/index.ts`](../../src/pages/index.ts)).
- Renders `archive.list` as cards/rows. Empty state when none.
- Per-entry actions (decision below): **Load**, **Delete**, **Rename**, **Export JSON**,
  (optional) **Copy readable text**.
- Access: **Footer link** (+ optionally a button on the game page). Footer lives in
  [`Footer.tsx`](../../src/components/layout/Footer.tsx).

---

## 6. Load handoff (Archive → game)

Cleanest modern approach without a global store:

- Archive "Load" calls `navigate('/play', { state: { replayJson } })`.
- `LocalGame` reads `useLocation().state?.replayJson` on mount and routes it through the
  **existing** `onImportReplay` path (same validation, one code path).
- Clear the nav state after consuming so a refresh doesn't re-load.

This reuses all import security guards — no second, unvalidated ingestion path.

---

## 7. Security / correctness notes

- Archived replays are our own output, but on **Load** we still run them through
  `parseReplay` + caps (never trust localStorage blindly — a user could hand-edit it).
- No new file-size vector (data already in localStorage), but the **`MAX_REPLAY_MOVES`**
  schema cap still applies on load.
- Proactive capacity cap (see §3) because quota errors are silent.

---

## 8. Tests

- `useGameArchive`: save/dedupe/rename/remove/cap-prune/persistence (mirror
  [`useProtocolRunDry.spec.ts`](../../src/hooks/__tests__/useProtocolRunDry.spec.ts) style).
- `MoveHistoryPanel`: Save button disabled when no moves; calls `onSaveGame`.
- (Optional) Archive page render: empty state + one-entry actions.

---

## 9. Rollout order (proposed)

1. §1 layout tweak (label above card, room for Save). — trivial, reversible.
2. §2–3 data model + `useGameArchive` + tests. — pure logic, no UI risk.
3. §4 Save button wiring + collision rename (§⚠️).
4. §5–6 Archive page + route + load handoff.
5. §8 remaining tests; typecheck + `vitest run`.
6. Update rulebook §7.3 (Move History Panel) + `About.mdx` ("save, share").

---

## Decisions needed before build

1. Collision fix: **A** (rename download flash to "Downloaded") / B (call it "Archive") / C (icon).
2. Save enabled: **anytime with moves** / only after game end.
3. Dedupe: **update-in-place** / allow duplicates.
4. Capacity: **50 auto-prune** / 100 block+warn / uncapped.
5. Per-entry actions: Load + Delete + Rename + Export (+ Copy?).
6. Access: **Footer link (+ game-page button)** / Footer only.
7. `/archive` route confirmed OK.
