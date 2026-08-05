# Sound Interactions — Real Game

Audio design philosophy: **sound encodes game *state*, not piece *identity*.** Every game
event maps to a recorded sample chosen for a gritty, mechanical character. All playback flows
through one shared `SoundEngine` (`src/lib/audio/engine.ts`) via the `useGameSound` hook.

**Source of truth:** the audio block in `src/components/game/LocalGame.tsx` (the *All Sound
Scenarios* table below is the canonical, code-derived reference — all other sections defer to it).

**Signal chain** (verified in `engine.ts`): `BufferSource → per-call GainNode → master
GainNode (MASTER_GAIN = 0.5) → DynamicsCompressorNode (brick-wall limiter) → destination`.
The limiter transparently catches any peak when cues stack, so the mix can never clip.

**Layered cues are micro-staggered, not simultaneous.** When a move triggers more than one
sound, the secondary cues are scheduled a few milliseconds apart on the AudioContext clock
(sample-accurate — no `setTimeout` jitter) so each transient stays distinct. Offsets are
single-sourced from `STAGGER` in `engine.ts`.

**Fires on every *applied* move — not just yours.** The audio effect is keyed off `lastMove`
with no color gate, so a sound is emitted for every move committed to the board: yours, the
bot's, or a remote uplink opponent's.

---

## Event → Sample Map

| Event | Sample file | Gain | Character |
| --- | --- | --- | --- |
| `move` | `move.mp3` | 0.9 | Natural piece-drop |
| `anomalyMove` | `move.mp3` | 0.9 | Same piece-drop (Anomaly move) |
| `capture` | `capture.mp3` | 0.85 | Swing whoosh / impact transient |
| `override` | `override.mp3` | 0.85 | Heavy windy thud — mech lock-in |
| `promotion` | `promotion.mp3` | 0.9 | Metallic clang — Pawn → Omni synthesis |
| `vectorExhausted` | `vector-exhausted.mp3` | 0.85 | Steam hiss — a vector ran dry |
| `gridlock` | `gridlock.mp3` | 0.85 | Heavy powerdown — full lock-up |
| `check` | `check.mp3` | 0.85 | Shotgun rack — danger alert |
| `gameEnd` | `game-end.mp3` | 0.85 | Dramatic falling scream — terminal |
| `modeBalanced` | `mode-balanced.mp3` | 0.85 | Racecar rush — Balanced mode select |
| `modeExact` | `mode-exact.mp3` | 0.85 | Drone whoosh — Exact mode select |

> Per-call gain is multiplied by `MASTER_GAIN = 0.5` at the bus, so an in-isolation `move`
> peaks at `0.9 × 0.5 = 0.45` of full scale.

---

## All Sound Scenarios — Full Progression

Master reference for every audible scenario, in playback order. Offsets are **absolute from
the move (`t = 0`)** and scheduled on the AudioContext clock. Secondary cues are
micro-staggered via `STAGGER` (`engine.ts`): `vector-exhausted` **+30ms**, `check` **+60ms**,
`gridlock` **+200ms**, Gridlock-Death `game-end` **+360ms**.

`(move sound)` = `capture.mp3` if the move captured, otherwise `move.mp3` (the `anomalyMove`
event also uses `move.mp3`). A terminal `game-end` for checkmate / stalemate / draw is the one
exception that plays **synchronously** (`@0ms`).

| # | Scenario | Sound 1 @0ms | Sound 2 | Sound 3 |
| --- | --- | --- | --- | --- |
| 1 | King / pawn quiet move | `move.mp3` | — | — |
| 2 | King / pawn move **+ check** | `move.mp3` | `check.mp3` **+60ms** | — |
| 3 | Capture (any piece) | `capture.mp3` | — | — |
| 4 | Capture **+ check** | `capture.mp3` | `check.mp3` **+60ms** | — |
| 5 | Override (King boards Anomaly) | `override.mp3` | — | — |
| 6 | Override **+ check** | `override.mp3` | `check.mp3` **+60ms** | — |
| 7 | Pawn → Omni promotion | `promotion.mp3` | — | — |
| 8 | Promotion **+ check** | `promotion.mp3` | `check.mp3` **+60ms** | — |
| 9 | Anomaly move, charges remain, none emptied | `move.mp3` | — | — |
| 10 | Anomaly move empties **one** vector, not gridlocked | `move.mp3` | `vector-exhausted.mp3` **+30ms** | — |
| 11 | Anomaly **capture** empties one vector, not gridlocked | `capture.mp3` | `vector-exhausted.mp3` **+30ms** | — |
| 12 | Anomaly move empties one vector **+ check** | `move.mp3` | `vector-exhausted.mp3` **+30ms** | `check.mp3` **+60ms** |
| 13 | Anomaly move drains **last** charge → Gridlock (non-royal) | `move.mp3` | `gridlock.mp3` **+200ms** | — |
| 14 | Anomaly **capture** drains last charge → Gridlock | `capture.mp3` | `gridlock.mp3` **+200ms** | — |
| 15 | **Piloted-King Gridlock Death** (move drains last charge) | `move.mp3` | `gridlock.mp3` **+200ms** | `game-end.mp3` **+360ms** |
| 16 | Piloted-King Gridlock Death via **capture** | `capture.mp3` | `gridlock.mp3` **+200ms** | `game-end.mp3` **+360ms** |
| 17 | Checkmate (delivering move) | *(primary)* | `game-end.mp3` @0ms | — |
| 18 | Stalemate / draw | *(primary)* | `game-end.mp3` @0ms | — |
| 19 | Mode select — Balanced (offline / bot only) | `mode-balanced.mp3` | — | — |
| 20 | Mode select — Exact (offline / bot only) | `mode-exact.mp3` | — | — |

**Notes**

- **Layered cues are perceptually separated.** Secondary cues (`vector-exhausted`, `check`)
  are scheduled +30ms / +60ms after the primary so their transients don't mask each other,
  while staying under the ~80ms threshold where the ear hears them as *sequential* rather
  than *simultaneous feedback*.
- **Gridlock suppresses the steam cue (rows 13–16):** when the last charge drains,
  `vectorExhausted && !gridlocked` is `false`, so `vector-exhausted.mp3` is deliberately
  skipped — `gridlock.mp3` replaces it on the killing move.
- **`game-end` timing differs by cause:** checkmate / stalemate / draw fire `game-end.mp3`
  synchronously (`@0ms`, rows 17–18), but a Gridlock Death fires it at **+360ms** (rows
  15–16) so the order stays move → gridlock → gameEnd.
- **No distinct event** exists for discovered/double check, en passant, or castling — they
  collapse into rows 1–4 (+ optional `check.mp3`).

---

## Verified Behaviour (code-level)

- **Gridlock suppresses the steam cue — verified.** `useGameState.ts` decrements the pool,
  sets `anomaly.isGridlocked = isGridlocked(anomaly)`, **then** commits the piece to the
  board. The audio effect reads `board[lastMove.to]` *after* the commit, so
  `piece.isGridlocked` is already `true` on the draining move — `vectorExhausted &&
  !gridlocked` correctly skips `vector-exhausted.mp3` and `gridlock.mp3` fires instead
  (scenarios 13–16).
- **A gridlocking move can never be a promotion or override.** A promoted Omni is created
  with `isGridlocked: false`, and an Override spends no charge — so the move sound under a
  Gridlock is always `capture.mp3` or `move.mp3`, never `override`/`promotion`.
- **`check` only fires on non-terminal moves.** A checkmating move plays `game-end`, never
  `check` (`if (terminal) { … } else if (inCheck) playSound('check')`).

---

## UI Sounds (outside the move flow)

Fired by `handleModeSwitch`, which **early-returns during an uplink match** (the board is
host-authoritative), so these play only in offline / local / bot games and only when a mode
pick starts a new game.

| Action | Sound |
| --- | --- |
| Select Balanced mode (starts a new game) | `mode-balanced.mp3` |
| Select Exact mode (starts a new game) | `mode-exact.mp3` |

---

## Precedence Rules

- **Primary chain is mutually exclusive**, evaluated top-down:
  `promotion` > `override` > `capture` > `anomalyMove` > `move`.
  - A promotion that also captures plays only `promotion.mp3`.
  - An Override that lands on an enemy plays only `override.mp3`.
- **`vector-exhausted.mp3`** layers only when a *single* vector hits 0 **and** the piece is
  **not** fully gridlocked.
- **Stagger timings** (single-sourced from `STAGGER` in `engine.ts`, scheduled on the audio
  clock) keep every layered cue perceptually distinct:
  - `vector-exhausted`: **+30ms** after the move sound.
  - `check`: **+60ms** after the move sound.
  - Gridlock lock-in: **+200ms** after the move sound.
  - Gridlock-Death scream: **+360ms** after the move sound (160ms after the lock-in).
  - Order is always **move → (steam) → (check) → gridlock → gameEnd**, never overlapping.

---

## Parity with the Rules-page demos

The two interactive Rules demos (`OverrideDemo.tsx`, `VectorChargesDemo.tsx`) reuse the same
**vector / gridlock timing model** (layered steam cue, +200ms lock-in, +360ms death scream).
They intentionally model **only** Anomaly moves + Gridlock — they do **not** emit `capture`,
`check`, `promotion`, or checkmate `game-end`, so their move sound is always literally
`move.mp3`. The real game's move sound is `(move sound)` = `capture.mp3` when the move
captured, else `move.mp3`.

| Surface | Single vector empties | Last charge (Gridlock) |
| --- | --- | --- |
| Real game (`LocalGame.tsx`) | *(move sound)* → 30ms → `vector-exhausted.mp3` | *(move sound)* → 200ms → `gridlock.mp3` |
| OverrideDemo | `move.mp3` → 30ms → `vector-exhausted.mp3` | `move.mp3` → 200ms → `gridlock.mp3` |
| VectorChargesDemo | `move.mp3` → 30ms → `vector-exhausted.mp3` | `move.mp3` → 200ms → `gridlock.mp3` |

> `(move sound)` = `capture.mp3` if the move captured, otherwise `move.mp3`. The demos can't
> capture, so their cells are `move.mp3` by design.

---

## Layered-Cue Micro-Staggering — Implemented

> **Status:** implemented. Layered cues are scheduled sample-accurately on the AudioContext
> clock via `STAGGER` (`engine.ts`), and the output bus runs through a brick-wall limiter.

### The problem this solved

Layered scenarios (rows 2, 4, 6, 8, 10–12) previously fired **two or three one-shot samples
at the same instant**. Firing percussive transients simultaneously is a known game-audio
anti-pattern:

- **Transient masking.** `move`, `capture`, `check`, and `vector-exhausted` all have sharp
  attacks. Two transients on the same millisecond fight for the same moment — the louder one
  masks the quieter, so the player often registered only one. Row 12
  (`move` + `vector-exhausted` + `check`) was the worst case: three attacks at once.
- **Perceptual smearing.** The ear separates events ~20–50ms apart but blends anything
  closer than ~10ms into one smeared hit — which *reduces* the information the layering is
  meant to convey, working against the "sound encodes state" philosophy.
- **Clipping (narrow risk).** With no limiter, a 3-layer stack (row 12: `2.6 × 0.5 = 1.3`)
  could clip if all three transients peaked on the same sample.

### What was implemented

A single-sourced stagger ladder (`STAGGER` in `engine.ts`), scheduled on the audio clock —
each layered cue gets its own moment:

| Layer | Offset | Rationale |
| --- | --- | --- |
| Primary (`move` / `capture` / `override` / `promotion`) | **0ms** | Headline beat |
| `vector-exhausted` | **+30ms** | Steam hiss reads as a *consequence*, not a collision |
| `check` | **+60ms** | Danger alert lands last, clearly separated |
| `gridlock` | **+200ms** | Heavy lock-in |
| `game-end` (Gridlock Death) | **+360ms** | Death scream, 160ms after the lock-in |

Each offset stays well under the ~80ms threshold where the brain starts perceiving cues as
*sequential* rather than *simultaneous feedback* — they still read as "one reaction," just
unsmeared.

Engine hardening (covers the 3-layer case and any future stacking):

- A `DynamicsCompressorNode` brick-wall limiter (`threshold -1 dB`, `knee 0`, `ratio 20`,
  `attack 0.003`, `release 0.05`) sits between the master gain and `destination`, built once
  in `unlock()`, so any simultaneous sum is transparently caught before output.

### Where it lives

- **Offsets:** `STAGGER` constant in `engine.ts` — the single source of truth, imported by
  `LocalGame.tsx`, `OverrideDemo.tsx`, and `VectorChargesDemo.tsx` so they can never drift.
- **Scheduling:** `SoundEngine.play(event, delay?)` offsets `src.start(ctx.currentTime + delay)`
  — sample-accurate, replacing the former `setTimeout` calls (the demos keep a `setTimeout`
  only to drive the *visual* `gridlock-death` phase flip, not the audio).
- **Limiter:** built once in `SoundEngine.unlock()`.
