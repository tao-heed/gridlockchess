# Piloted Anomaly Royalty — Implementation Plan & Architecture

> **Status:** §5 (the `checkerSafe` fix) **plus** the §9 value-aware upgrade
> (Fixes 2/3/4) are **IMPLEMENTED and unit-tested** in `app/src/lib/chess/bot.ts`;
> `bot.spec.ts` passes **6/6** (full suite: 93/93). Option A (native FSF royalty,
> §3/§8/§9.2) is a **shelved** future experiment — see §9.2.
> **Verified by:** Vitest unit tests (deterministic) + a live boot check (app
> runs clean on the patched code, no console errors, zero new build errors).
> **NOT yet verified:** a full in-game playthrough vs. the bot (a human, non-
> deterministic test) — see §7. The unit tests prove the scoring logic; they do
> not prove end-to-end feel.
> **Author note:** Every claim below labelled "verified" was read from the
> actual source file or the Fairy-Stockfish wiki during this session. Claims
> labelled "deduction" are logical inferences, not direct quotes — they are
> flagged so they can be challenged.
> **Last verified:** 2026-06-18

---

## 1. The bug, stated precisely

When the human pilots an Anomaly (King boards it via Override, making the Anomaly
royal), the bot **feeds pieces into checks that the piloted king simply captures.**
You saw it as: a checker lands a knight's-leap away from your g1 king, your king
eats it, and the bot keeps doing it.

This is **one symptom with two independent root causes**, living in two different
code paths. A fix that only touches one path leaves the bug alive in the other.

---

## 2. Root-cause analysis (code-grounded)

### 2.1 The engine path — `scoreVsPilotedKing`

**File:** `app/src/lib/chess/bot.ts` — verified by reading lines 44–60.

```ts
const scoreVsPilotedKing = (board, color, m) => {
  const after = applyMove(board, m.from, m.to);
  const opp = opponentOf(color);
  if (isCheckmate(after, opp)) return 1_000_000;   // real mate
  let score = 0;
  if (isInCheck(after, opp)) score += 1_000;       // ANY check  ← the flaw
  const target = board[m.to];
  if (target && target.color !== color) score += 100;   // capture
  if (!isSquareAttacked(after, m.to, opp)) score += 10; // safe square
};
```

**Why it misbehaves:** a check is worth `+1000` **regardless of whether the
piloted king instantly recaptures the checker.** Whether the checking piece
survives is only a `+10` tiebreak — two orders of magnitude too small to matter.
So a suicidal check (`1000`) always outranks a quiet developing move (`10`). The
bot is *engineered* to throw pieces at a royal it cannot actually trap with a
1-move check.

**When this path runs:** `getEngineMove` (bot.ts ~line 145) only re-ranks with
`scoreVsPilotedKing` when `hasPilotedKing(opponentOf(color))` is true, i.e. only
when you are actually piloting. Verified.

> **Caveat on the "g1 / h3" example used in this doc:** those exact coordinates
> come from my recollection of a screenshot you shared, **not** from any code or
> saved file. The *mechanism* (a checker the piloted king can immediately
> recapture being scored `+1000`) is code-verified; the specific squares are
> illustrative and unverified.

**Helpers this fix relies on — verified this session (check.ts):**

- `isRoyal` (line 8) = `king` **or** `anomaly && piloted === true`; `findKing`
  returns whichever exists. So `isInCheck`/`isSquareAttacked`/`getAllLegalMoves`
  all treat a piloted Anomaly as the royal piece. The `checkerSafe` gate is
  therefore meaningful.
- `hasPilotedKing` (bot.ts) checks only `p.type === 'anomaly'`, which is
  sufficient **because** `findKing` only ever returns a king or a *piloted*
  anomaly — a non-obvious dependency worth keeping in mind if `findKing` changes.
- `applyMove` copies the piece with `{ ...piece }`, preserving `piloted`, so the
  king stays royal through simulation. Verified.
- A piloted Anomaly moves by its **vectors**, not king-steps: `getLegalMoves`
  (movement.ts line 243) routes `type === 'anomaly'` to `getAnomalyMoves`. So
  `isSquareAttacked` reflects the king's real recapture reach — including
  returning "safe" when the needed vector is depleted. Verified.

**King-capture is pseudo-legally generated but legally unreachable — verified.**
Every capture generator (`getSlidingMoves` 49–55, `getAnomalyMoves`/`getLeapMoves`
110, `getKingMoves` 165, `getPawnMoves` 211) lists the enemy royal square like any
other enemy piece — **none** special-case royalty. `getAllLegalMoves` filters only
via `wouldBeInCheck` (the *mover's own* safety), never the captured piece. It is
unreachable in legal play only because the opponent's own check-filter forbids
leaving their royal en prise and `isCheckmate` ends the game first. **Latent
quirk (does not affect this fix):** if a king-capture ever did reach
`scoreVsPilotedKing`, after the royal is gone `findKing` returns `null` so
`isInCheck` is `false` (check.ts 55) → it would score only `+100` (capture), not
the mate value. Cannot trigger under legal flow, so the §5 fix deliberately does
not guard against it.

### 2.2 The heuristic path — `heuristicMove`

**File:** `app/src/lib/chess/bot.ts` — verified by reading lines 165–205.

```ts
if (difficulty === 'novice') {
  if (captures.length) return pickRandom(captures);
  if (checks.length)   return pickRandom(checks);   // ← blind random check
  return pickRandom(moves);
}
// "hard" (every tier above novice):
const safeChecks = checks.filter((m) => isSafe(board, color, m));
```

Two findings, both verified:

- **`novice` is blind.** It plays a *random* check with no safety check at all —
  it will hang pieces into a piloted king just like the engine path.
- **Higher tiers are accidentally OK.** `isSafe` calls
  `isSquareAttacked(applyMove(...), m.to, opp)` on **our** board, which *does*
  know the piloted king's true vector mobility. So if the king can recapture the
  checker, `m.to` is "attacked", the check is rejected as unsafe, and it falls
  through to a safe move. The heuristic at `casual`+ is already mostly immune.

**Consequence for the fix:** the engine path (§2.1) is the primary offender at
*all* tiers; the heuristic path needs a patch *only at `novice`* (and `beginner`,
which is intentionally random and we leave alone).

### 2.3 Why Fairy-Stockfish can't fix this itself

**File:** `app/src/lib/chess/engine.ts` — verified by reading `pieceToFenChar`
(lines ~33–60) and `boardToFen`.

```ts
if (piece.type === 'anomaly' && piece.piloted) return 'k'; // piloted = plain king
```

The FEN sent to FSF encodes a piloted Anomaly as a plain 1-square `k`, and the
FEN string carries **no charge counts** (`boardToFen` emits
`"... w - - 0 1"`). Therefore FSF believes your royal is a vanilla king, looks
for ordinary king-hunt checks, and proposes them. The re-rank in §2.1 was *meant*
to correct this but does it wrong.

---

## 3. Verified Fairy-Stockfish capabilities (for the "native royalty" option)

Read from the FSF wiki *Variant-configuration* page this session. Verified
examples:

| Capability | Evidence (real variant) | Verified? |
|---|---|---|
| Pseudo-royalty exists | `extinctionPseudoRoyal = true` (Mounted, Backrank, Two Kings 2) | ✅ verified |
| **Multiple** royal types at once | `extinctionPieceTypes = rp` (Stardust), `kg` (Shaolinking) | ✅ verified |
| Royalty threshold count | `extinctionPieceCount = 1` (Two Kings 2) | ✅ verified |
| Custom pieces via Betza | `customPiece1 = a:mBcpB` (Mounted) | ✅ verified |
| Royalty is **per piece-TYPE**, not per-instance | all examples list whole type letters | ✅ verified |

**What this means for our idea (corrected):**

- My earlier "you can't make one Amazon royal" claim was **too strong and is now
  retracted.** You *can* have several royal types coexist. The real constraint is
  only that royalty attaches to a **type letter**, so a *piloted* Anomaly must be
  a **distinct piece type** from an ordinary Anomaly of the same shape — otherwise
  every Amazon on the board becomes royal.
- So the native route is **viable**, at the cost of bespoke piloted piece types.

**What I did NOT verify (honest gaps — do not treat as settled):**

1. **Asymmetric royalty** — whether White's royal type can differ from Black's
   (bot keeps a normal `k`; you ride a royal `amazon-piloted`). All wiki examples
   are symmetric. *Deduction:* `extinctionPieceTypes` is global to the variant, so
   both colours share the royal-type set — likely workable but unconfirmed.
2. **Mixed single-royal checkmate semantics** — whether check/checkmate resolves
   correctly when one royal piece of a type coexists with non-royal pieces. Not
   confirmed for our exact case.
3. **Charge depletion inside FSF's search** *(deduction, high confidence)* — the
   FEN has no counts, so any royal Betza piece is assumed to keep full mobility
   for the entire searched line. FSF cannot see a vector deplete mid-line.
4. **Gridlock Death** *(deduction, high confidence)* — "last point spent = instant
   loss" is invisible to FSF; it has no count to read.
5. Whether the **WASM build** in `app/server.js` exposes these options identically
   to the native binary.

---

## 4. The two options, weighed honestly

| | **Option A — Native FSF royalty** | **Option B — Our-rules `checkerSafe` fix** ✅ recommended |
|---|---|---|
| Fixes suicidal checks | Yes — deep search, correct root movement | Yes — at 1-ply, both code paths |
| Models charge depletion mid-line | **No** (counts never enter FSF) | **No** — see §4.1 (our sim also freezes vectors) |
| Sees the king's *current* true mobility | Only as a frozen root identity | Yes — reads live vectors at the root |
| Engineering cost | High: ~7 bespoke piloted types, per-position FEN re-encoding to the right royal type, verify gaps §3.1–3.5, manage through proxy/WASM | Low: ~4 lines in `bot.ts`, zero engine/variant change |
| Risk | Unverified semantics (§3) + WASM parity | Contained, testable in isolation |
| Matches design doc §6.1.1 | No | Yes ("genuine path is a small our-rules search") |

**Recommendation: Option B.** It fixes the actual visible bug with a 4-line
change, needs no engine or variant work, and agrees with the conclusion already
recorded in `docs/GridlockChess.md` §6.1.1. Option A is viable but pays a large
integration cost for the same 1-move outcome — and, per §4.1, **neither** option
actually models charge depletion, so Option A's only real edge (deep search) is
narrow.

### 4.1 Honest limit shared by BOTH options — verified

**File:** `app/src/lib/chess/check.ts`, `applyMove` lines 86–93 (read this session):

```ts
if (piece.type === 'anomaly') {
  // Vector consumption is handled in game state, not here
  // This is just for move simulation
}
```

`applyMove` does **not** consume vectors. Every simulated move therefore keeps the
piloted king's charges **frozen at its current values**. Consequences, stated
plainly so this doc never oversells:

- Any multi-ply search built on `applyMove` (ours *or* a hypothetical FSF line)
  over-estimates the king on later plies — the exact blind spot I criticised FSF
  for. Option B is **not** "counts-aware" beyond the root position.
- "Herd the human toward Gridlock Death" is **out of scope** for this fix. It
  would require a new vector-consuming simulation function that **does not exist**
  in the codebase today. I am not claiming Option B delivers it.
- What Option B *does* get right (and FSF cannot): at the **root**, the recapture
  question `!isSquareAttacked(after, m.to, opp)` reads the king's **real current
  vectors** — verified via `getLegalMoves` → `getAnomalyMoves` (movement.ts line
  243). So a depleted vector correctly makes a checker "safe". That 1-ply
  correctness is the whole fix.

---

## 5. Option B — detailed design (minimal)

### 5.1 Core idea

Replace "reward **any** check" with "reward a check **only if the checking piece
is not immediately recapturable** by the piloted side." That single condition is
the entire feeding bug. No reply enumeration, no material model — those were
over-engineering (see §5.4 for why they were dropped).

### 5.2 The change to `scoreVsPilotedKing`

The existing function already computes `after`, `opp`, mate, check, capture, and a
safe-square test. The **only** edit is to gate the check bonus on safety instead
of awarding it unconditionally:

```ts
const scoreVsPilotedKing = (board, color, m) => {
  const after = applyMove(board, m.from, m.to);
  const opp = opponentOf(color);
  if (isCheckmate(after, opp)) return 1_000_000;
  let score = 0;
  // CHANGED: a check counts ONLY if the checker can't be immediately recaptured.
  // isSquareAttacked reads the piloted king's REAL current vectors (movement.ts),
  // so a depleted vector correctly leaves the check standing.
  if (isInCheck(after, opp) && !isSquareAttacked(after, m.to, opp)) score += 1_000;
  const target = board[m.to];
  if (target && target.color !== color) score += 100;     // capture (unchanged)
  // Optional: small penalty for hanging the mover into the piloted king.
  if (isSquareAttacked(after, m.to, opp)) score -= 50;
  return score;
};
```

**Behavioural change vs. current code:** the g1-recollection case (a checker a
knight's-leap from the piloted king, which the king eats) currently scores
`+1000` and gets played; after the fix it scores `0` (no bonus) or `-50` (penalty
if the mover itself hangs), so a quiet move outranks it. The signature is
**unchanged** — no `enPassantTarget`, no `flatten`, no `materialBalance` needed.

### 5.3 Patch the heuristic `novice` path

**File:** `bot.ts`, `heuristicMove`. Make `novice` prefer **safe** checks, mirroring
the higher tiers, so the fallback isn't blind when you're piloting:

```ts
if (difficulty === 'novice') {
  if (captures.length) return pickRandom(captures);
  const safeChecks = checks.filter((m) => isSafe(board, color, m));   // NEW
  if (safeChecks.length) return pickRandom(safeChecks);               // NEW
  if (checks.length) return pickRandom(checks);
  return pickRandom(moves);
}
```

`isSafe` already consults our real board, so this is automatically piloted-aware.
`beginner` stays fully random by design.

### 5.4 Why the reply-search + material model was DROPPED

An earlier draft of this plan proposed a 1-ply reply enumeration plus a
`materialBalance` term, and an "optional 2-ply for top tiers." All three were
removed as over-engineering and/or unsound:

- **2-ply is unsound here.** Because `applyMove` freezes vectors (§4.1), the
  second ply would model the piloted king with **undepleted** charges —
  re-introducing the very over-estimation bug we are fixing. It is *not* a clean
  difficulty-gated add-on; it needs a vector-consuming `applyMove` first, which
  does not exist.
- **The naive material term could make the bot timid.** Scoring material only
  *after* the opponent's reply, with no model of the bot's own recapture, would
  mark a **sound** sacrifice-check (checker defended, bot wins it back) as a pure
  loss — suppressing good moves. The opposite failure to the one we're fixing.
- **It's more than the bug needs.** The feeding bug is fully addressed by the
  one `checkerSafe` condition in §5.2. Reply enumeration is `O(candidates ×
  replies)` cost for no additional correctness at 1-ply.

If deeper tactical play vs. a piloted king is ever wanted, the prerequisite is a
vector-aware simulation function — track that as separate future work, not part
of this fix.

### 5.5 Signature stays the same

The minimal fix does **not** change `scoreVsPilotedKing`'s signature — it still
takes `(board, color, m)` and needs no `enPassantTarget` (no reply generation).
Nothing in `getEngineMove` has to be re-threaded.

---

## 6. Files touched (Option B)

| File | Change | Risk |
|---|---|---|
| `app/src/lib/chess/bot.ts` | Gate the check bonus in `scoreVsPilotedKing` on `!isSquareAttacked` (+ optional −50 hang penalty); add a `safeChecks` line to the `novice` branch of `heuristicMove` | Contained — pure functions, no I/O, signature unchanged |
| *(none else)* | No engine, no `variants.ini`, no `server.js`, no FEN changes | — |

---

## 7. Test plan

No automated test harness for the bot exists today (verified: bot.ts has no
sibling spec). Proposed manual + lightweight checks:

1. **Reproduce first.** Recreate a piloted-king position where a checker can be
   immediately recaptured by the king's current vectors; confirm the current
   build feeds the checker. (Exact squares are your call — the doc's g1/h3 are
   illustrative recollection, not a fixture.)
2. **Unit-style harness (optional, recommended).** Add `bot.spec.ts`: build a
   board where a check is instantly recapturable and assert the patched
   `scoreVsPilotedKing` scores it `≤ 0` (no bonus / hang penalty), below a quiet
   safe move. Add a companion case where the checker is **defended** (king
   *cannot* safely recapture) and assert the `+1000` bonus still fires.
3. **Tier sweep.** Play `novice`, `casual`, `master` against a piloted Amazon;
   confirm no tier hangs pieces into recapture.
4. **Regression.** Play a normal (un-piloted) game at each tier — `hasPilotedKing`
   is false there, so `scoreVsPilotedKing` must not run and strength must be
   unchanged.
5. **Engine-down path.** Stop `server.js`; confirm heuristic `novice` no longer
   plays blind checks into the piloted king.

---

## 8. If we ever choose Option A (native royalty) — prerequisites

Do **not** write `variants.ini` syntax until these are verified (I will not fake
the syntax):

1. Confirm asymmetric / single-royal pseudo-royal checkmate semantics in
   FairyGround (https://fairyground.vercel.app) with a throwaway variant before
   touching ours.
2. Define distinct piloted piece types (e.g. `customPieceN = <letter>:<Betza>`)
   for each Anomaly shape that can be piloted, marked royal via
   `extinctionPieceTypes` + `extinctionPseudoRoyal = true`.
3. Extend `pieceToFenChar` to emit the piloted-type letter (not `k`) for a piloted
   Anomaly, choosing the letter by current lattice node.
4. Accept that depletion/Gridlock Death still need our-rules logic on top — and
   per §4.1, that logic does **not** exist yet (no vector-consuming sim). So
   Option A does **not** remove the need for the §5 `checkerSafe` gate, and adds
   no depletion-awareness of its own.

Conclusion: even the native route still wants the our-rules layer, which is why
the §5 minimal fix is the higher-leverage first step.

---

## 9. Value-aware upgrade + verified FSF syntax (2026-06-19)

### 9.1 What shipped (Fixes 2/3/4, implemented & tested)

The §5 `checkerSafe` gate stopped *suicidal checks* but left two gaps a human
could still exploit: it was **value-blind** (a hanging capture of a pawn scored
`+100 − 50 = +50`, beating a safe quiet move at `0`), and the correction only
re-ranked the engine's already-poisoned shortlist. All three are now in
`app/src/lib/chess/bot.ts` and covered by `bot.spec.ts` (**6/6 passing**):

- **Fix 2 — value-aware `scoreVsPilotedKing`.** Added `pieceCaptureValue`
  (Anomaly = remaining `L+O+D` charges, Pawn = 1, King = 1000, Omni = shared
  pool). When the mover **hangs** (royal can recapture), the move is scored by
  **net material** `(captured − mover) × 10`, which dominates any check bonus
  because that check doesn't stick. So "feed a 10-charge Chopper to grab a pawn
  with check" now scores `(1 − 8) × 10 = −70`, far below a safe quiet `0`. A
  hanging capture that *wins* material (pawn takes Anomaly) still scores positive.
- **Fix 3 — widen the search when the shortlist is poisoned.** In
  `getEngineMove`, if every engine candidate scores negative against the piloted
  royal, fall back to the safest move across the **whole** legal set instead of
  the least-bad sacrifice. Bounded: only runs in that rare all-candidates-hang case.
- **Fix 4 — safety-aware heuristic fallback.** `heuristicMove` (novice + hard)
  no longer plays `pickRandom(captures)` blindly; it prefers safe captures, takes
  an unsafe capture only when `capturesMaterial` holds, then safe checks, then
  any safe move. This closes the engine-down path into the piloted king.

All values read depletion-aware live vectors via `isSquareAttacked`, so this
remains correct as the piloted king's charges deplete.

### 9.2 Option A (native FSF royalty) — SHELVED, with corrected syntax

Investigated the real Fairy-Stockfish source this session (wiki
*Variant-configuration* + the master `src/variants.ini`). Two chatbot-suggested
snippets were **substantially hallucinated**; the real syntax is:

- Royalty for a non-king piece is `extinctionValue = loss` +
  `extinctionPieceTypes = <letter>` + `extinctionPseudoRoyal = true`. Proof: the
  shipped `[maharajah]` variant is a genuine **royal amazon**. (There is **no**
  `royalPieces` option — that flag was invented.)
- A custom *king* movement is real: `[centaurking:chess]` uses `king = k:KN`. But
  royalty comes from the `king =` **slot**, not the `K` atom — `commoner = K`
  uses the same atom and is **not** royal. The claim that a `C` is a "royal
  co-king" is backwards: `C` is the **commoner** (explicitly *non-royal*).

**Why it stays shelved:** a static FSF pseudo-royal piece cannot model the
piloted king's **depleting moveset**, **finite charge budget**, or
**Gridlock Death**. At best it improves engine *candidate quality*; it cannot
replace the depletion-aware TS correction in §9.1. Revisit only with live-engine
validation (`stockfish check variants.ini` / FairyGround) as separate future work.

