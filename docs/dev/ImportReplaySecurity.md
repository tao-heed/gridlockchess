# Import Replay (JSON) — Security & Validation

This document describes every protection applied when a user clicks **Import Replay (JSON)**
and hands the app a `.json` file. It lists each layer in the order a file passes through it,
with both the technical detail and a plain-English ("layman's") explanation.

**Mental model:** importing a file is like a stranger handing a package to a security desk at
a building. Each layer below is one guard between the front door and your live game.

## The full gauntlet (7 layers)

### 1. File-size gate — reject before reading
**Where:** `onFile` in `src/components/game/panels/MoveHistoryPanel.tsx`
**Technical:** Before the file is read, `file.size > MAX_REPLAY_BYTES` (2 MB) is rejected. A
hostile multi-hundred-MB file is turned away without ever calling `file.text()`, so it can't
exhaust memory. This is the only check that happens *before* reading — the cheap first gate.
It is kept deliberately looser than the schema move cap so it never rejects a legal file.

**Layman's:** "Is the package too big to even carry?" The guard checks the weight before
opening the box. A giant crate (over 2 MB) is refused at the door — nobody wastes effort
dragging it inside. A real game file is a few kilobytes, so this never bothers you.

### 2. Input reset — clear the slot
**Where:** `onFile` (`e.target.value = ''`)
**Technical:** The file input is cleared immediately, so the same file can be re-imported and
a stale selection can't linger.

**Layman's:** "Clear the desk for the next person." The moment a file is picked, the slot is
cleared so you can hand over the same file again and there's no leftover confusion.

### 3. Safe parsing — no code execution
**Where:** `parseReplay` in `src/lib/chess/format.ts`
**Technical:** The text is turned into data with `JSON.parse`, **not `eval`**. A malicious file
is inert data — it cannot run code.

**Layman's:** "Open it carefully — don't let it run." The box is opened by *reading* what's
inside, not by plugging it in and turning it on. A malicious file is treated as lifeless
paper, not a program. It literally cannot execute anything on your machine.

### 4. Strict schema validation — Zod
**Where:** `gridlockReplaySchema` in `src/lib/chess/format.ts`
**Technical:** Every field must match an exact shape or the whole import is rejected:
- Version must equal the expected `REPLAY_VERSION`.
- **Move count capped** at `MAX_REPLAY_MOVES` (40,000) — the authoritative anti-DoS bound.
- Every square must match `/^[a-h][1-8]$/` — this also **blocks prototype pollution** (no
  `__proto__`-style keys can slip into the board object).
- Every piece must be a known king/pawn/anomaly with a valid archetype and vector pool;
  numbers must be non-negative integers.

Anything unexpected is thrown, caught, and surfaced as a single generic error.

**Layman's:** "Does everything on the packing list match?" The guard runs a checklist: right
kind of document? a sane number of pages (the 40,000-move cap — no phone-book-sized files)?
real chess squares like "e4", not gibberish or sneaky labels designed to trick the system?
real pieces with legal stats? If **anything** is off, the whole thing is rejected — no partial
acceptance.

### 5. Full rules re-simulation — replay every move
**Where:** `handleImportReplay` → `replayTo` in `src/components/game/LocalGame.tsx`
**Technical:** `replayTo(replayIn)` re-applies every move through the actual game engine. If
any move is illegal, it throws. A file can't smuggle in an impossible board — the engine, not
the file, decides what's valid. (This is also why per-move effects/glyphs aren't stored: they
are re-derived here.)

**Layman's:** "Replay the whole game to make sure it's real." Even if the paperwork looks
perfect, the guard plays the entire game out move by move using the real rulebook. If move #47
is illegal, the file is thrown out. Nobody can fake an impossible board — the engine gets the
final say on what's true.

### 6. One safe error channel
**Where:** `setImportError` in `src/components/game/LocalGame.tsx`
**Technical:** Any failure in layers 3–5 lands in a single `catch` that shows the same neutral
message: *"That file isn't a valid Gridlock replay…"* No stack traces, no file contents, and
no attacker-controlled text is ever rendered — React escapes output anyway, so **no XSS**.

**Layman's:** "One polite rejection slip." If the file fails any check, you just see one
neutral message. Nothing from the file itself is ever shown back to you, so a booby-trapped
file can't sneak a nasty message onto your display.

### 7. Human confirmation before it touches your game
**Where:** `pendingImport` → `confirmImport` in `src/components/game/LocalGame.tsx`
**Technical:** A valid file does **not** auto-load. It's parked in `pendingImport` and a
confirmation modal appears. Only when the user clicks confirm does `confirmImport` load the
board. Nothing is overwritten silently.

**Layman's:** "You have to sign for it." Even a perfectly valid file doesn't take over your
game. A pop-up asks *"Load this game?"* and nothing changes until **you** click confirm.

## What it also cannot do (by design)
- **No network.** Import never sends anything anywhere; it forces `offline` mode. No server
  can be attacked through it.
- **No file writes.** It only reads the one file you pick.

## Honest caveats (known gaps)
1. **`replayTo` does not enforce game termination.** It replays moves even *past* a
   checkmate/draw, as long as each is individually legal. So the 40,000-move cap (not the
   game's natural end) is the real length bound. Harmless but sloppy.
2. **`confirmImport` is destructive to Uplink.** It sets `offline` mode, so importing
   during Uplink abandons the live game. A UX safety gap, not a security hole.

## Key constants
| Constant | Value | Location | Purpose |
| --- | --- | --- | --- |
| `MAX_REPLAY_BYTES` | 2,000,000 (2 MB) | `MoveHistoryPanel.tsx` | Cheap pre-read file-size gate |
| `MAX_REPLAY_MOVES` | 40,000 | `format.ts` | Authoritative move-count cap (schema) |

> Sizing note: the engine force-draws at `halfmoveClock >= 100` (a 50-full-move rule), and the
> clock resets on every progress move — capture, pawn advance, override, **or a spent vector
> charge** (`irreversible = capture || enPassant || pawn || vectorUsed`). With 140 charges
> (70/side) plus pawns/captures/overrides, a pathological but fully legal game reaches
> ~28,000 plies; 40,000 leaves clear headroom above any rules-terminated game.
