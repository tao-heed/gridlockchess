# Gridlock Chess — Engine Move Mapping & Decomposition Plan

> **Status:** Design plan. **Not yet implemented.** No code is changed by this document.
> **Scope:** How to drive a *standard* Stockfish (the binary currently in `app/bin/stockfish.exe`)
> to produce strong moves for Gridlock Chess's **compound** Anomaly pieces, given that standard
> Stockfish has no notion of Archbishop / Chancellor / Amazon — and no notion of **charge
> degradation**.
> **Companion:** Read [FairyCounterparts.md](./FairyCounterparts.md) first. This document assumes
> its 8-state lattice and the rule *"identity = which vectors are `> 0`, not how many points remain."*

---

## 0. TL;DR

- The user's proposal — *encode a compound piece as each of its standard components, ask Stockfish
  for each, take the highest-scoring move* — is **correct in spirit and fixes the crash**, and is
  strictly better than my earlier single-Queen stand-in because it **recovers the knight-jump moves**.
- But the **naive "compare the two raw scores" step is not sound**: the two scores come from **two
  different board encodings**, so they are not directly comparable (apples-to-oranges).
- This plan keeps the user's decomposition idea for **move generation (coverage)** and adds a
  **single-canonical post-move evaluation** step for **scoring (comparability)**. That refinement
  also makes Stockfish *implicitly aware of degradation*, because a move that burns a vector to `0`
  re-encodes the piece as a weaker lattice node in the position it evaluates.
- The genuinely "correct tool" remains **Fairy-Stockfish** (native compound pieces in one pass).
  We compare both honestly in §7 so the choice is informed.

---

## 1. The Problem Restated

Standard Stockfish only understands `K Q R B N P`. Gridlock's compound nodes have no standard
glyph:

| Lattice node | Vectors live | Real movement | Standard glyph? |
| ------------ | ------------ | ------------- | --------------- |
| **Amazon**     | L + H + D | Queen + Knight (`N`+`B`+`R`) | ❌ none |
| **Archbishop** | L + D     | Knight + Bishop (`N`+`B`)    | ❌ none |
| **Chancellor** | L + H     | Knight + Rook (`N`+`R`)      | ❌ none |
| **Queen**      | H + D     | Bishop + Rook                | ✅ `Q` |
| **Knight**     | L         | Knight                       | ✅ `N` |
| **Bishop**     | D         | Bishop                       | ✅ `B` |
| **Rook**       | H         | Rook                         | ✅ `R` |
| **Dead Piece** | —         | immobile, blocks, capturable | ❌ none |

The current code in `pieceToFenChar` ([engine.ts](../app/src/lib/chess/engine.ts)) emits the
**invalid FEN characters** `a` (Archbishop), `c` (Chancellor), `x` (Dead). Standard Stockfish
**rejects the whole FEN**, so any board containing a Leap+slider compound silently falls through
to the heuristic bot. **Only 3 nodes actually need help** (Amazon, Archbishop, Chancellor); the
other 5 are already single standard pieces.

---

## 2. The Decomposition Principle (user's proposal)

Each compound node is the **union of two standard pieces' move sets**:

| Node | = | Component A (slider) | + | Component B (leaper) |
| ---- | - | -------------------- | - | -------------------- |
| **Archbishop** (L+D) | = | **Bishop** (`B`) | + | **Knight** (`N`) |
| **Chancellor** (L+H) | = | **Rook**   (`R`) | + | **Knight** (`N`) |
| **Amazon** (L+H+D)   | = | **Queen**  (`Q`) | + | **Knight** (`N`) |

> Note the slider component of the Amazon is the **Queen** (which is itself Bishop+Rook), so the
> Amazon only needs a **two-way** split (Queen ∥ Knight), not three — consistent with the user's table.

Because standard Stockfish can render `B`, `R`, `Q`, and `N` natively, we run the piece **as each
component** and the union of the two move sets reproduces the full compound move set. This is the
key win: the **knight-jump branch is no longer invisible** to the engine.

---

## 3. Canonical Node → Encoding Table (all 8 nodes)

This is the single source of truth for FEN encoding under the decomposition scheme.

| Node | Pass **A** (sliders) | Pass **B** (leapers) | Notes |
| ---- | -------------------- | -------------------- | ----- |
| Amazon (L+H+D)     | `Q` | `N` | dual-encode |
| Archbishop (L+D)   | `B` | `N` | dual-encode |
| Chancellor (L+H)   | `R` | `N` | dual-encode |
| Queen (H+D)        | `Q` | `Q` | identical both passes |
| Knight (L)         | `N` | `N` | identical both passes |
| Bishop (D)         | `B` | `B` | identical both passes |
| Rook (H)           | `R` | `R` | identical both passes |
| **Dead Piece**     | blocker (see §5.4) | blocker | never moves; re-filter discards |
| King               | `K` | `K` | unchanged |
| Pawn               | `P` | `P` | unchanged |

Only the three compound nodes differ between Pass A and Pass B. Everything else is encoded
identically, so the **two passes differ only at the compound squares** — important for §5.1.

---

## 4. Method 1 — Naive Dual-Score (the proposal, verbatim)

For a single compound piece:

1. Encode the board with that piece as **Component A** → ask Stockfish → best move + score `S_A`.
2. Encode the board with that piece as **Component B** → ask Stockfish → best move + score `S_B`.
3. Pick the move whose score is higher; play it (after re-filtering through real legal moves).

This **works and never crashes**. It is a strict improvement over the single-Queen stand-in.

### 4.1 Why it is *not* fully sound — be honest

> **The two scores are evaluations of two different positions.** `S_A` is "how good is the board
> when this square is a Bishop"; `S_B` is "...when this square is a Knight." A Knight and a Bishop
> have different static value, different threats, different king-safety implications. So
> `max(S_A, S_B)` conflates **"which move is better"** with **"which piece-type I pretended it was
> is worth more."**

Concretely: a quiet board where the piece sits passively will usually score higher in the
"Bishop/Queen" pass simply because Stockfish counts a Bishop/Queen as worth more material than a
Knight — even when the *knight move* is tactically superior. The raw-score comparison is biased
toward the slider component.

**Other latent inaccuracies (all inherited from "standard SF doesn't know our rules"):**

1. **Magnitude is invisible.** SF values a Bishop the same whether it has **1** diagonal move left
   or **8** (FairyCounterparts §6.3). A nearly-dead piece is over-valued.
2. **Phantom & missed checks.** Encoded as a Queen, a Chancellor (L+H) appears to give **diagonal**
   check it cannot really give (phantom); encoded as a Bishop, an Archbishop's **knight-check** is
   invisible (missed). SF's mate/king-safety reasoning is therefore distorted.
3. **Degradation cost ignored.** A move that spends the **last** point of a vector silently
   **collapses the piece to a lower lattice node** (e.g. Amazon → Queen). SF sees no cost; it
   thinks the Amazon is still an Amazon next move.
4. **Dead-piece encoding.** `x` is illegal FEN; needs a real blocker glyph (§5.4).

These are exactly the accuracy gaps the degradation model in FairyCounterparts warns about. Method 1
ignores all of them.

---

## 5. Method 2 — Decompose-to-Generate, Canonically-Evaluate (recommended)

Keep the user's decomposition for **coverage**, but fix the comparability flaw by **never comparing
scores across different pre-move encodings.** Instead, evaluate every candidate by the position it
**produces**, all rendered with one consistent encoding.

### 5.1 Algorithm

```
choose_move(board, color):
  # 1. GENERATE candidates (coverage) — union of both decomposition passes
  fenA = encode(board, color, pass=SLIDER)   # Amazon→Q, Arch→B, Chan→R
  fenB = encode(board, color, pass=LEAPER)   # Amazon→N, Arch→N, Chan→N
  rawA = stockfish.multipv(fenA, k)          # k candidate moves + scores
  rawB = stockfish.multipv(fenB, k)
  candidates = union(rawA.moves, rawB.moves)

  # 2. RE-FILTER through the real rules (single source of truth)
  legal = getAllLegalMoves(board, color, enPassant)     # check.ts
  candidates = [m for m in candidates if m in legal]    # drops phantom moves
  if candidates is empty: return heuristic_fallback()

  # 3. EVALUATE each candidate by its RESULT, one canonical encoding
  for m in candidates (cap at top-N):
     next = applyRealMove(board, m)          # real charge burn + node transition
     fenN = encode(next, opponent(color), pass=CANONICAL)
     score[m] = -stockfish.eval(fenN)        # negamax: good-for-us = bad-for-them
     score[m] += degradationDelta(board, next, m)   # §6, optional within-node term

  # 4. PICK
  return argmax(score)
```

### 5.2 Why this is sound

- **Comparability restored.** Every candidate is scored by evaluating the **post-move position**,
  and all post-move positions use the **same** `CANONICAL` encoding. We are comparing
  *"how good is the resulting position"* across moves — the correct question — not *"which
  fictional piece-type is worth more."*
- **Degradation becomes visible — for free.** `applyRealMove` performs the **real vector burn**.
  If a move drops the Amazon's last `H` to `0`, the post-move board encodes that square as a
  **Queen** (node transition per FairyCounterparts §2). Stockfish then evaluates a position that is
  genuinely materially weaker, so the **cost of collapsing a piece is reflected automatically.**
  This is the single most important accuracy gain and it requires **no custom engine eval.**
- **Knight branch preserved.** Because candidates are the **union** of both passes, knight-jumps
  (which the slider pass can't propose) are still in the pool and get a fair, canonical evaluation.
- **Real rules win.** The re-filter in step 2 means we can never play a phantom (illegal) move,
  regardless of what SF hallucinated.

### 5.3 What it still cannot do (honest residuals)

- **Within-node magnitude.** A Knight with 1 vs 8 leaps still encodes as `N`; the post-move eval
  can't tell them apart. Handled *approximately* by the optional decay term in §6.
- **Phantom checks during the search tree.** SF's *internal* lookahead still uses the wrong piece
  picture; we only correct the **root** position (pre-move via decomposition, post-move via
  canonical). Deep tactical lines involving compound pieces remain approximate. Only Fairy-Stockfish
  fixes this (§7).
- **Cost.** Method 2 is `2` generation calls + `N` evaluation calls (cap `N`, e.g. 6–10). With
  `movetime` per call this is heavier than Method 1's 2 calls. Tune `N`, `depth`, `movetime` per
  difficulty tier (the tiers already exist in `DIFFICULTY_CONFIG`, [bot.ts](../app/src/lib/chess/bot.ts)).

### 5.4 Dead-piece encoding decision

There is **no immobile standard piece**. Options, with the recommendation:

| Option | Behavior | Verdict |
| ------ | -------- | ------- |
| Encode Dead as `P` (own color) | Blocks the square; SF may "move" it but step-2 re-filter discards | ⚠ pawns on rank 1/8 are illegal FEN in strict parsers |
| Encode Dead as `N`/`B` (own color) | Blocks correctly; bogus mobility discarded by re-filter | ✅ simple, robust — but inflates own material in eval |
| Encode Dead as a **King-adjacent neutral** | not expressible in standard FEN | ❌ |
| **Recommended:** encode Dead as its **last-living single-vector glyph** (`N`/`B`/`R`) | Blocks; any move from it is discarded by re-filter; material slightly overstated | ✅ pragmatic; document the known minor eval inflation |

> Whatever is chosen, **correctness is preserved by the step-2 re-filter** (a Dead Piece has zero
> legal moves in `getAllLegalMoves`, so SF can never actually move it). The only effect is a small,
> bounded **evaluation inflation** from counting a dead piece as live material. Accept and document,
> or subtract its value in the §6 correction.

---

## 6. Degradation-Aware Value Correction (optional refinement)

Method 2 already captures **node transitions**. To also capture **within-node magnitude** (1 vs 8
leaps) and the **dead-material inflation** from §5.4, apply a post-engine additive correction:

For each of our pieces $p$ on the post-move board, let

- $V_{\text{node}}(p)$ = fairy base value of its current lattice node (approximate centipawns):

$$
V_{\text{node}} \approx \{\, N{:}\,320,\; B{:}\,330,\; R{:}\,500,\; Q{:}\,900,\; \text{Arch}{:}\,860,\; \text{Chan}{:}\,920,\; \text{Amazon}{:}\,1250,\; \text{Dead}{:}\,0 \,\}
$$

- $s(p)$ = remaining charges (sum of live vectors, or the Omni `shared` pool),
- $s_{\text{ref}}$ = a normalization constant (≈ the typical starting sum, e.g. `10`),
- $a \in [0,1]$ = a floor so a low-charge piece keeps *some* value (it can still make a threat).

Define an effective value

$$
V_{\text{eff}}(p) = V_{\text{node}}(p)\cdot\Big(a + (1-a)\cdot\min\!\big(1,\; s(p)/s_{\text{ref}}\big)\Big).
$$

Then the correction added to a candidate's canonical engine score is

$$
\Delta = \sum_{p\,\in\,\text{ours}} \big(V_{\text{eff}}(p) - V_{\text{node}}(p)\big)\; -\; \sum_{q\,\in\,\text{theirs}} \big(V_{\text{eff}}(q) - V_{\text{node}}(q)\big).
$$

Interpretation:

- A piece near death ($s\to 0$) contributes a **negative** $V_{\text{eff}}-V_{\text{node}}$,
  i.e. we *discount* the over-valued material SF counted. This nudges the bot to **use a piece
  before it dies** and to **avoid relying on soon-dead pieces** — exactly the strategic texture
  FairyCounterparts describes ("which vector you exhaust last is a player decision").
- Subtracting a Dead Piece's inflated glyph value (§5.4) is just the $s=0$ case.

> **Honesty:** this is a **heuristic** correction layered on top of an engine that fundamentally
> can't see charges. It improves realism but is not a substitute for a real charge-aware evaluator.
> Keep $a$, $s_{\text{ref}}$, and the base values in one config block so they're tunable.

---

## 7. Method 3 — Fairy-Stockfish (the "correct tool"), honest comparison

Fairy-Stockfish natively supports compound pieces via **Betza notation** and **custom variants**,
so all three problem nodes evaluate correctly **in a single pass with correct checks**:

| Node | Betza | Fairy-Stockfish |
| ---- | ----- | --------------- |
| Amazon     | `QN` | native custom piece |
| Archbishop | `BN` | native (`archbishop`) |
| Chancellor | `RN` | native (`chancellor`) |

### Comparison

| Concern | Method 1 (naive) | Method 2 (recommended) | Method 3 (Fairy-SF) |
| ------- | ---------------- | ---------------------- | ------------------- |
| Crashes on compounds | ❌ fixed | ✅ fixed | ✅ fixed |
| Recovers knight-jumps | ✅ | ✅ | ✅ (native) |
| Score comparability | ❌ biased | ✅ canonical post-move | ✅ native |
| Correct checks/mate at root | ❌ | ⚠ root only | ✅ |
| Correct checks inside search | ❌ | ❌ | ✅ |
| Sees node **transitions** (vector→0) | ❌ | ✅ via post-move encode | ⚠ needs piece-swap-on-move modeling |
| Sees **magnitude** (1 vs 8 left) | ❌ | ⚠ via §6 heuristic | ❌ (no pool concept) |
| Engine calls / move | 2 | 2 + N | 1 |
| New binary required | no | no | **yes** (download Fairy-SF) |

> **Key truth:** *No* off-the-shelf engine — not even Fairy-Stockfish — models a **depleting
> per-vector pool**. Magnitude/degradation is unique to Gridlock and must be layered on by us (§6)
> regardless of engine. Fairy-SF wins on **check correctness and single-pass simplicity**; Method 2
> wins on **node-transition awareness without a new binary** and reuses the engine you already have.

---

## 8. Recommendation

1. **Adopt Method 2** as the default with the current standard Stockfish:
   - Decompose-to-generate (the user's insight, union of slider+leaper passes) → fixes the crash
     **and** recovers knight moves.
   - Canonically-evaluate post-move → fixes the score-comparability flaw **and** makes degradation
     **node-transitions** visible for free.
   - Add the §6 value correction for **within-node magnitude** + dead-material cleanup.
2. **Keep Fairy-Stockfish (Method 3) as a future option** behind the same `engine.ts` interface;
   it would replace only the encoding + single-call path and give correct in-search checks. The
   §6 charge correction stays either way.
3. **Re-filtering through `getAllLegalMoves` stays the inviolable final authority** in every method.

---

## 9. Implementation Checklist (when approved — not done here)

- [ ] `engine.ts`: replace invalid `a`/`c`/`x` with the §3 dual-pass encoder
      (`encode(board, color, pass)` with `SLIDER | LEAPER | CANONICAL`).
- [ ] `engine.ts`: add `evaluateOnce(fen)` (single static-ish eval at shallow depth) for step 3.
- [ ] `bot.ts`: replace `getEngineMoveFiltered` body with the §5.1 generate→filter→evaluate→pick flow.
- [ ] `bot.ts`: implement `degradationDelta` (§6) behind a tunable config block.
- [ ] Decide & document the §5.4 Dead-piece glyph.
- [ ] Tier tuning: map `easy/medium/hard` to `(k, N, depth, movetime)` in `DIFFICULTY_CONFIG`.
- [ ] Tests: assert knight-jump candidates appear for an Archbishop; assert a move that kills a
      vector scores lower than an equivalent move that preserves it.
- [ ] Keep heuristic fallback for engine-down / no-legal-candidate cases.

---

## 10. Open Questions

1. **Dead-piece glyph** (§5.4) — accept material inflation, or always subtract via §6?
2. **Base fairy values** (§6) — adopt the listed approximations or calibrate by self-play?
3. **Per-tier cost budget** — how many candidate evaluations `N` is acceptable for "hard" before
   the 450 ms UX delay feels sluggish?
4. **Promotion** — Omni is auto-created (Amazon); engine promotion suffixes are stripped to
   `from/to`. Confirm no further handling needed.
5. **Eventually adopt Fairy-Stockfish?** If yes, do it now (one encoder rewrite) or after Method 2
   ships?
