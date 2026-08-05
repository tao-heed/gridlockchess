# PV Depletion Audit — Plan

> **Status:** PROPOSAL / NOT STARTED (measure-first). A contained experiment to give the bot cheap
> depletion-awareness by **auditing Fairy-Stockfish's own predicted line** instead of running a
> second deep search.
>
> **One-line idea:** FSF is battery-blind — its deep "best line" (the Principal Variation) assumes
> every anomaly keeps full fuel forever. **Replay that line through our real charge-aware kernel**
> (`applyMoveToBoard`) to detect when FSF's plan is a *battery lie* (it relies on an anomaly that
> would have depleted / changed shape / gridlocked), and re-rank FSF's candidates accordingly.
>
> **Two variants (pick per goal):** **Option A** — the cheap *audit* (§1–§9): detect battery lies in
> FSF's PV, re-rank. **Charge-Anchored FSF** (formerly 'Option B') — the *charge-anchored FSF search* (§10): when move-time is not a
> constraint (~1 min/move OK), the strongest practical bot short of a rewrite — call FSF many times per
> move, draining charges between calls, so FSF supplies battery-correct moves *and* eval at every node.

---

## 0. Shared understanding (the exact idea, confirmed 2026-07-22)

1. FSF returns its best move **and its Principal Variation (PV)** — the sequence of moves it predicts.
2. We **replay that PV through the real rules kernel** (`move.ts` `applyMoveToBoard`), the same law the
   game uses.
3. For each **anomaly** move in the line we **trace charge depletion + shape-shrink** (Amazon → …
   → Rook/Bishop/Knight → **Dead Stone**), move by move.
4. We flag when FSF's plan **depends on a piece that gridlocks / shrinks / dies** partway through — a
   *battery lie* FSF cannot see (it searched a fixed-piece FEN snapshot).
5. We **re-rank / penalize** FSF's candidate moves toward the plan that survives battery-reality.

> This is an **audit**, not a new engine. See §5 for the honest ceiling before investing.

---

## 1. Why this exists — the gap it targets

Verified in `BotDepletionAwareness.md §1` + code: FSF gets **one FEN snapshot** and treats each piece
as a **fixed** fairy type for its whole search (`server.js` / `engine.ts` send `position fen … ; go`).
So its deep PV can rely on, say, a Rook making its 4th slide when the piece only had 3 orthogonal
charges — under real rules that piece is already a **Dead Stone** by then, and the plan collapses. FSF
never sees it. This audit catches exactly that class of blunder cheaply.

---

## 2. What FSF actually gives us (verified against code)

- FSF streams `info depth N … score cp X … pv <m1> <m2> <m3> …` lines. The **`pv`** is its predicted
  best line at that depth. With **MultiPV** (we already request 3–15 lines) we get the **top-K** lines.
- **Current limitation:** both `nativeEngine.ts` (`nativeEvaluate`) and `server.js` (`getBestMoves`)
  parse the PV with `/\bpv ([a-h][1-8][a-h][1-8][a-z]?)/` — capturing **only the first move**. The full
  line is emitted by FSF but **discarded**. Phase 0 fixes this.

---

## 3. The audit (pure mechanism)

**Input:** the root `board`, side-to-move `color`, and a PV = ordered list of UCI moves.

**Process:** step through the PV, applying each move with `applyMoveToBoard` (which spends the used
vector, recomputes identity, may gridlock, may trigger Gridlock-Death, validates legality). Track, per
anomaly that appears in the line:

- its **charge vector** `(O, D, L)` after each of its moves,
- its **identity** (via the lattice — Amazon → … → Stone),
- **gridlock** (`0/0/0`) and **Gridlock-Death** (piloted royal hitting `0/0/0`).

**Detect (the signal):**

- **Battery lie / collapse ply:** the first PV move that is **illegal under real rules** (`res.valid ===
  false`) — i.e., the piece can no longer make that move because a vector already hit 0. `survivedPlies`
  = how deep FSF's plan holds up before it breaks.
- **Anomaly fates:** which anomalies in the line **gridlock** or **shrink** (and when), and whether a
  **piloted royal** dies (Gridlock-Death) inside FSF's own line.

**Output (verdict):**

```
interface PvAudit {
  survivedPlies: number;        // plies of FSF's PV that are legal under REAL depletion
  totalPlies: number;           // length of the PV we examined
  collapse: null | { ply: number; reason: 'illegal' | 'gridlock-death' };
  anomalyFates: { square: Square; gridlockedAtPly: number | null; endIdentity: string }[];
}
```

The verdict maps to a **penalty** (e.g., a candidate whose PV collapses at ply 2 is much more suspect
than one that survives to ply 8) used only to **re-rank**, never to override on faith.

---

## 4. How the bot uses it (a re-ranker, NOT a new authority)

`getEngineMove` already re-ranks FSF's MultiPV candidates in some branches (`scoreVsPilotedKing`) and
sanity-checks the top pick (the 1-ply fizzle guard). The PV audit slots in the **same way**:

- **Audit each MultiPV candidate's PV.** Prefer the candidate whose plan **survives battery-reality
  longest / doesn't self-gridlock** when its raw engine scores are close.
- **Hard-only override, like `preferForcingWin`:** only re-order when the audit finds a **concrete**
  collapse (an illegal reliance or a self-inflicted Gridlock-Death inside FSF's own line). Never trade
  FSF's positionally-stronger pick for a speculative audit delta.
- **NEVER hand it authority** the way deep mode did. It re-ranks FSF's *own* shortlist; it does not lead.
  (Deep-mode lesson: a weak judge that *leads* marches the king off a cliff — see
  `ChargeNativeSearchModel.md` §11.)

---

## 5. Honest ceiling (read this before investing)

- **It audits FSF's fantasy-optimized lines.** FSF chose its PV *believing* batteries never drain, so
  it optimized for a fantasy. The audit can **reject a collapsing plan**, but it **cannot invent** the
  battery-smart plan FSF never considered. If we throw out FSF's #1 line, its #2 line was picked under
  the *same* fantasy — we're choosing the **least-wrong fantasy**, not a truly battery-aware move.
- **The overlay already does a stronger version.** `search.ts` runs an **independent** charge-accurate
  search and can find moves FSF never proposed. This audit is **cheaper but weaker** — limited to FSF's
  shortlist. It is a complement, not a replacement, and **not** the path to an "ultra" bot (that still
  needs the charge-native deep engine — `ChargeNativeSearchModel.md` §11).
- **It may wash.** Every depletion re-ranker tried so far (override-margin 80, deep mode) washed or
  backfired. The **benchmark gate is mandatory** before shipping.
- **Phone PVs are short.** On a phone FSF often reaches only modest depth in its time budget, so the PV
  may be too short to contain a depletion trap — limiting how often the audit fires.

---

## 6. Implementation phases (measure-first)

- **Phase 0 — capture the full PV.** `nativeEngine.ts` + `server.js`: parse the *entire* `pv` move list
  (not just move 1) into `RankedMove.pv: string[]`; thread it through `engine.ts` so `bot.ts` receives
  it. No behavior change yet. *(tsc + existing tests green.)*
- **Phase 1 — the pure audit.** NEW `src/lib/chess/pvAudit.ts` = `auditPv(board, color, pvMoves)` →
  `PvAudit`. Pure, no engine, fully unit-testable. Add `pvAudit.spec.ts`.
- **Phase 2 — integrate as a re-ranker.** `bot.ts` `getEngineMove`: audit each candidate's PV; apply the
  hard-only re-rank (§4). Flag/tier-gated so it's easy to A/B and OFF by default until proven.
- **Phase 3 — VALID benchmark A/B.** Audit-on vs audit-off, fixed nodes, ≥200 games, on a **trustworthy
  harness** (in-process engine, deterministic seeds, hard-fail on any heuristic fallback — see
  `ChargeNativeSearchModel.md` §11.6). **Gate:** CI excludes 0 → keep; includes 0 → shelve (do not ship
  a wash).

---

## 7. Code touch points (verified files)

| File | Change |
| ---- | ------ |
| `src/lib/chess/nativeEngine.ts` | `nativeEvaluate`: capture the full `pv` (split the moves after `pv `); add `pv?: string[]` to `RankedMove`. |
| `server.js` | `getBestMoves`: same full-PV capture (dev + benchmark parity). |
| `src/lib/chess/engine.ts` | Thread `pv` through the candidate type returned by `evaluatePosition`. |
| `src/lib/chess/pvAudit.ts` **(new)** | Pure `auditPv(board, color, pvMoves): PvAudit` — replays via `applyMoveToBoard`, tracks charges/identity/gridlock, returns the verdict. |
| `src/lib/chess/bot.ts` | `getEngineMove`: run `auditPv` on candidates, hard-only re-rank; flag/tier-gated, default OFF. |

---

## 8. Tests

- `pvAudit.spec.ts` (pure):
  - a PV where an anomaly spends its last charge mid-line → `collapse` / `gridlockedAtPly` at the right
    ply;
  - a PV that relies on an already-depleted vector → `collapse.reason === 'illegal'` at the right ply;
  - a clean PV (kings/pawns only) → `survivedPlies === totalPlies`, no collapse;
  - a PV where a piloted royal dies → `collapse.reason === 'gridlock-death'`.
- `bot.engine.spec.ts` (seeded, engine mocked): FSF's #1 candidate has a battery-lie PV and #2 is
  battery-honest → the audit-on bot prefers #2; audit-off plays #1. (Self-play can't reach this — same
  gating rationale as `preferForcingWin`.)

---

## 9. Risks & discipline

- **Do NOT let the audit lead.** Re-rank FSF's shortlist only; never authority-handoff (deep-mode
  lesson).
- **Perf is a non-issue:** replaying K × ~10 short moves per turn is trivial next to a search.
- **Likely small effect** — treat a wash as the null hypothesis; the Phase-3 gate decides.
- **Keep it flag/tier-gated + default OFF** until a valid benchmark clears 0, exactly like every prior
  depletion experiment.

> **Bottom line:** a cheap, honest patch on FSF's battery-blindness — worth a contained prototype, but
> it audits FSF's fantasy plans rather than curing them, it is weaker than the existing overlay, and it
> ships only if a valid benchmark proves it. It is **not** the ultra-bot; that remains the charge-native
> engine in `ChargeNativeSearchModel.md`.

---

## 10. Charge-Anchored FSF (formerly 'Option B') — charge-anchored FSF search (unlimited-time variant, RECOMMENDED for max strength)

> **When to use:** the user accepts a slow bot (~1 min/move). This is the **strongest practical bot
> achievable without forking/rewriting an engine** — it fixes FSF's battery-blindness *and* the
> overlay's crude eval **at the same time**.

### 10.1 The idea (one loop)

Build a **small battery-accurate search tree** in which **FSF supplies both the candidate moves and the
leaf evaluation**, and **our kernel (`applyMoveToBoard`) applies moves between FSF calls** so every FEN
handed to FSF carries the **correct depleted piece shapes** (`boardToFen` → `pieceToFenChar` re-encodes
current charges — verified). Per node:

1. `boardToFen(board)` (battery-correct shapes) → ask FSF (`MultiPV = K`) for its **top-K moves + score**.
2. For each of the K moves, **apply it through `applyMoveToBoard`** (drains the charge, changes shape,
   may gridlock) → child board.
3. Recurse to depth `D`; at the leaves use **FSF's score** of the (battery-correct) position.
4. **Negamax back up** to pick the root move.

### 10.2 Why this is the strongest non-rewrite option

It is the ONLY configuration that is simultaneously **battery-accurate** (our kernel drains charges
between calls), **strong-eval** (FSF scores the leaves), and **strong move-ordering** (FSF proposes the
branches, so we explore ~K not ~40). It fixes BOTH known weaknesses at once: FSF's depletion-blindness
(§1) and the overlay's crude king-safety-blind eval (`ChargeNativeSearchModel.md` §6).

> **Critical insight:** giving FSF **more time in a single search makes it WORSE** at Gridlock (deeper =
> more battery-lie — the "deep-tree lie", `BotDepletionAwareness.md §1`). The strength gain comes from
> **re-anchoring** (draining charges between many short FSF calls), NOT from longer single searches.

### 10.3 Cost model (computation) — CORRECTED + measured 2026-07-23

Each tree node makes **one FSF call** (top-K move-gen at internal nodes; eval at leaves). A K-ary tree
of depth `D` has **`(K^(D+1) − 1)/(K − 1)` nodes**, NOT `K^D` — the earlier `K^D` figure undercounted
by ~`K/(K−1)` (≈1.5× at K=3). The native engine **serializes** calls (`nativeEngine.ts` `serialize()` —
one search at a time), so wall-time ≈ `nodes × t`.

**Measured latency (desktop, `bin/fairy-stockfish-largeboard_x86-64.exe`, `movetime=300`, MultiPV=5):
`t ≈ 0.31s`/call** (8-sample avg, overhead ~10ms — essentially movetime-bound). Phone is the real cap
and is **unmeasured** — assume ~2× (≈0.7s) until Step 1 measures it.

| K | D | nodes = (K^(D+1)−1)/(K−1) | desktop @0.31s | phone @~0.7s |
| - | - | ------------------------ | -------------- | ------------ |
| 3 | 2 | 13  | 4s  | 9s  |
| 3 | 3 | 40  | 12s | 28s |
| 4 | 3 | 85  | 26s | 60s (at budget) |
| 3 | 4 | 121 | 38s | 85s (too slow) |

So a ~60s phone budget realistically buys **K=3, D=3 (≈28s) — 3-ply battery-perfect lookahead**, or
**K=4, D=3 at the very limit**. **Cheaper variant:** skip the leaf eval call and reuse the parent's
MultiPV score for leaf positions → calls drop to internal-only `(K^D − 1)/(K − 1)` (13 for K=3,D=3), but
the **last ply is not re-anchored**. A **transposition memo** (`FEN → result`) cuts real cost further
(many plies transpose). **Phone latency is the gate — measure `t` first (Step 1).**

### 10.4 Honest limits (no BS)

- **Reduces blindness, doesn't erase it.** The leaf FSF *score* is still battery-blind *beyond the leaf*
  — error is bounded to FSF's horizon from the leaf, not the whole line. Much better than today, not
  perfect.
- **No gridlock-death instinct in FSF's eval** — keep our own terminal checks (mate / gridlock-death /
  the `preferForcingWin` squeeze) layered on, as today.
- **Slow** (accepted per the goal) and **serialized** — 100+ sequential FSF calls per move; if per-call
  latency is high on the phone, feasible depth shrinks.
- **Still not literally "unbeatable."** True superhuman = the charge-native engine
  (`ChargeNativeSearchModel.md`). This is the strongest bot **without** a rewrite — likely enough to beat
  a human consistently, which is the actual goal.
- **Must beat the benchmark.** More principled than deep mode (it fixes the *eval*, the proven
  bottleneck) so it has a real shot — but every depletion idea so far washed; measure before believing.

### 10.5 Prototype phases (measure-first)

0. **Measure per-call latency `t`** on the target phone (from the engine log) → pick feasible `(K, D)`.
1. **Reuse Phase 0/1 from Option A** (full-PV capture is not required here, but the kernel-replay plumbing
   and `boardToFen` re-encode path are). Add a `chargeAnchoredSearch(board, color, K, D)` module that
   orchestrates the FSF calls + negamax backup. Pure-ish (engine calls injected for testability).
2. **Gate it to a single tier first** (e.g., a new "unbeatable"/ASI-plus mode or L9), flag-gated, default
   OFF. Layer the existing terminal checks on top.
3. **VALID benchmark** vs current asi (fixed conditions, in-process engine, hard-fail on fallback —
   `ChargeNativeSearchModel.md` §11.6). Also test a **human gauntlet** (the real goal is beating a human,
   which self-play can't fully capture). **Gate:** clear win → ship on the boss tier; wash → shelve.

### 10.6 Risks

- **Latency blow-up** on the phone (serialized calls) → mitigate with short internal-node movetimes, longer
  only at leaves; cap D dynamically by a wall-clock budget (stop deepening when time is nearly up —
  iterative deepening over D).
- **Narrow-criterion backup** (FSF eval ignores gridlock-death) → keep our terminal layer authoritative.
- **Wash risk** (the null hypothesis) → the benchmark + human gauntlet decides; default OFF until proven.

### 10.7 L9 integration + open design decisions (resolve before/during prototype — audit 2026-07-22)

**How it slots into L9 (`asi`) — REPLACE the overlay, don't stack.** Verified against `bot.ts`
`getEngineMove`: today L9 = FSF single call → `preferSearchMove` (crude-eval overlay veto), plus
`preferForcingWin` when the opponent is piloted. Charge-Anchored FSF is a *stronger* battery-accurate search, so it
**supersedes** the overlay's veto for L9's move choice — running the crude overlay on top would be a
downgrade (weak judge overriding a strong one). **Keep** the terminal-safety rules (Charge-Anchored FSF's negamax
gets them free via `applyMoveToBoard`: self-gridlock-death = loss, enemy-royal capture / gridlock-death =
win) and **optionally keep `preferForcingWin`** layered on top (its depth-8 forced-squeeze reaches deeper
than Charge-Anchored FSF's D=3–4). It is **separate logic that replaces the overlay at L9**, NOT the overlay with
Charge-Anchored FSF bolted on.

**Must-fix design specifics (the audit caught these gaps):**

1. **Own SHORT movetime knob.** Charge-Anchored FSF must NOT reuse `DIFFICULTY_CONFIG.asi.movetime = 4000` (verified)
   per node — 27 calls × 4s = 108s. Use ~200–400ms per internal node (moves only), optionally longer at
   leaves (eval accuracy). This is a new knob, independent of the tier config.
2. **Per-node legality filter + fallback.** FSF's top-K suggestions can be **illegal under our charge
   rules** (FSF is blind). Every node must filter FSF's candidates through `getAllLegalMoves`; if all K
   are illegal, fall back to our own legal moves (mirrors the root-level handling `getEngineMove` already
   does).
3. **Explicit terminal handling** in the negamax. Note: `search.ts` `terminalChildScore` (module-private —
   export or re-implement) covers only **self-gridlock-death** and **enemy-royal-capture**; **checkmate/
   stalemate is a SEPARATE “no legal moves” case**, not part of it. Good news (verified in `variants.ini`):
   the variant sets `extinctionPseudoRoyal=true` / `extinctionPieceTypes=kefghijs`, so FSF **natively**
   treats royal *capture* as loss — only depletion-induced gridlock-death (which FSF can't see) needs our
   layer.
4. **Negamax sign convention** for FSF scores (UCI `score cp` is side-to-move relative) — normalize on
   backup.

**⚠️ The #1 risk — the leaf eval (validate FIRST):** Charge-Anchored FSF leans entirely on **FSF's eval** at the
leaves, but **FSF is charge-blind on MATERIAL** — it values a 1-charge rook like a full rook. Our overlay's
`pieceWorth` (`100 + 55×charges`) is actually *more* charge-accurate on material. So Charge-Anchored FSF trades *the
overlay's charge-accurate material + crude position* for *FSF's good position + charge-blind material*. The
battery-accurate **tree** corrects depletion that happens *inside* it, but the **leaf** eval still
over-values near-dead pieces. **This could neutralize Charge-Anchored FSF's advantage.** Likely fix: a **hybrid leaf
eval** = `FSF_positional_score + our charge-material correction` (reuse `pieceWorth`). **Unverified:** how
FSF values the custom fairy pieces (`e…s`, `m/a/c/q/…`) — would need reading `variants.ini` piece values or
probing FSF. **Phase 0 must measure whether FSF's raw leaf eval is good enough on depleted positions, or
whether the hybrid correction is required.**

**Phase 0 now measures TWO things (not one):** (a) per-call latency `t` on the target phone → feasible
`(K, D)`; (b) FSF leaf-eval quality on depleted positions → raw vs hybrid leaf eval.

### 10.8 Incremental implementation checklist (easiest → hardest — TRACK HERE)

> Ordered so each step is independently verifiable and the two **measurement gates** come first — if
> either fails, STOP (don't build the search on a false premise). Everything is L9-only, flag-gated,
> **default OFF** until the Step 12 benchmark clears. Check items off as they land.

**Gate A — measure before building (no game behavior change):**

- [ ] **1. Latency probe.** Add a dev-only harness that fires N sequential FSF calls at a short movetime
      (~300ms) on a battery-correct FEN and logs each round-trip `t` (reuse the engine log). Read `t` on
      the **target phone** → pick feasible `(K, D)` from the §10.3 table. *Files: `nativeEngine.ts` (or a
      scratch dev route). No bot change.*
- [ ] **2. Leaf-eval probe (#1 risk).** On several **depleted** positions, check whether FSF's `score cp`
      is sane and whether the **charge-count blindness** (a 1-charge amazon == an 8-charge amazon to FSF,
      since `pieceToFenChar` maps by vector *presence*) is materially distorting the eval. Decide **raw vs
      hybrid** leaf eval. NOTE: this is a **smell test, not an objective gate** — there is no ground-truth
      eval for a depleted position without a stronger reference; the real verdict is the Step 14 benchmark.
      *Files: `scripts/fsfProbe.mjs` (desktop) + on-device log.*

**Gate B — build the core search (still default OFF, not wired to play):**

- [x] **3. Own short-movetime knob** — a new config independent of `DIFFICULTY_CONFIG.asi.movetime` (4000).
      ~200–400ms internal nodes, optional longer at leaves. *Files: new `chargeAnchoredSearch.ts`.*
- [x] **4. Single-node "ask FSF" helper** — `boardToFen(board)` (**shape-correct**, NOT charge-count-correct —
      FSF sees which vectors are alive, never how many charges remain) → FSF `MultiPV=K` → top-K
      `{move, score}`. May return **fewer than K** lines (few legal moves — seen in the probe); handle it.
      Engine call **injected** for testability. *Files: `chargeAnchoredSearch.ts`.*
- [x] **5. Per-node legality filter + fallback** — filter FSF's K moves through `getAllLegalMoves`; if all
      K are illegal, fall back to our own legal moves (mirror `getEngineMove`'s root handling). *Files: same.*
- [x] **6. Apply-move-between-calls** — child board via `applyMoveToBoard` (drains charge, reshapes,
      gridlocks); assert `boardToFen` re-encodes the depleted shape for the next call. *Files: same.*
- [x] **7. Depth-1 negamax + sign normalization** — one ply, pick best of K by (normalized) FSF leaf score.
      Verify UCI side-to-move sign convention. *Files: same + `chargeAnchoredSearch.spec.ts`.*
- [x] **8. Explicit terminal handling** — self-gridlock-death = loss, enemy-royal capture = win (both via
      `terminalChildScore` — **module-private, export/extract first**), **plus** no-legal-moves =
      mate/stalemate (a SEPARATE case, not in `terminalChildScore`). *Files: same + spec.*
- [x] **8b. Transposition memo** — `FEN → {moves, score}` cache so repeated positions across the K^D tree
      cost one call, not many (latency is THE constraint). *Files: `chargeAnchoredSearch.ts`.*
- [x] **9. Full depth-`D` negamax** — recurse to `D`, terminal-aware (node count per §10.3). *Files: same + spec.*
- [x] **10. Leaf eval: raw → hybrid toggle** — start raw FSF; add `FSF_positional + pieceWorth` correction
      behind a flag (per Step 2's verdict). NOTE: `pieceWorth` is **module-private in `search.ts` —
      export/extract first**; it is `100 + 55×charges` (verified). *Files: same + spec.*
- [x] **11. Iterative deepening over D + wall-clock budget** — deepen `D=1,2,3,…` until a time cap; return
      the deepest completed. Prevents latency blow-up. *Files: same.*

**Gate C — wire in + prove it (the real gate):**

- [ ] **12. Wire into L9 only, flag-gated, default OFF** — REPLACE the overlay veto for L9's move choice
      (§10.7); keep terminal safety, optionally keep `preferForcingWin` layered on. *Files: `bot.ts` `getEngineMove`.*
- [ ] **13. Unit tests green** — legality filter, terminal scoring, negamax sign, fallback, iterative-deepening
      cutoff (engine mocked). *Files: `chargeAnchoredSearch.spec.ts`.*
- [ ] **14. VALID benchmark vs current asi** — in-process engine, fixed nodes/time, **hard-fail on any
      heuristic fallback** (`ChargeNativeSearchModel.md` §11.6), ≥200 games + a **human gauntlet**.
      **GATE:** clear win → ship on the boss tier; wash → shelve (default OFF stays). *Files: `scripts/selfplay.ts`.*

> **Discipline:** Steps 1–2 are a hard gate — a bad leaf eval or unaffordable latency kills Charge-Anchored FSF before
> any search code. Steps 3–11 never touch live play (default OFF). Only Step 12 exposes it, and only Step 14
> ships it. Same measure-first / reversible / benchmark-gated rules as every prior depletion experiment.

### 10.9 Empirical feasibility validation (2026-07-23 — ran real Fairy-Stockfish)

Ran `scripts/fsfProbe.mjs` against the actual engine (`bin/fairy-stockfish-largeboard_x86-64.exe`) with
`variants.ini` / `UCI_Variant gridlock-royal`. **This is the FIRST runtime validation of FSF acceptance** —
`engine.spec.ts` only unit-tests `boardToFen` *strings* (no engine), so the `variants.ini` "Validated live"
comment was overstated.

**RESULT — the core feasibility premise HOLDS:**

- ✅ **FSF accepts re-anchored depleted-piece FENs.** Drained rook `R`, dead stone `X`, amazon `M`, custom
  `a`/`c`: accepted, 5 MultiPV lines, legal `bestmove`, zero errors.
- ✅ **FSF accepts piloted-royal FENs with NO actual king** (`S`/`E` for White, `e` for Black — the
  post-Override state) — accepted with legal moves. **This was the single biggest unknown → resolved.**
  (`extinctionPseudoRoyal` makes the custom letter the royal.)
- ✅ **Dense depleted midgame → real `cp` scores** (e.g. `cp 1522/1349/…`), not just mate.
- ✅ **Latency `t ≈ 0.31s`/call** desktop @ movetime 300 (8-sample avg) → cost table in §10.3.

**RESULT — risks CONFIRMED (not fatal, but real):**

- ⚠️ **Charge-count blindness is intrinsic.** `pieceToFenChar` (verified) maps by vector *presence*, so a
  1-charge amazon and an 8-charge amazon are the **same glyph** → FSF gives them the **same eval**. The
  per-ply re-anchoring corrects *shape* changes; it does **not** fix within-shape count-blindness at the
  leaf. Hybrid leaf eval (§10.7 #1) is therefore *likely* needed — Step 2 / Step 14 decide.
- ⚠️ **MultiPV can return < K lines** in sparse positions (observed) — the search must handle it.
- ⚠️ **Cost undercount** (§10.3) — corrected to `(K^(D+1)−1)/(K−1)`; realistic phone target is **K=3, D=3**.

**Still unmeasured (the actual gates):** (1) **phone** latency `t` (desktop ≠ phone); (2) whether the
leaf-eval blindness actually costs games (only the Step 14 benchmark can say). Verdict unchanged and now
**evidence-backed: feasible to build; strength unproven.** The mechanism is no longer an assumption.

### 10.10 Build progress (2026-07-23)

- **Core search LANDED (default OFF, nothing in production imports it):**
  `src/lib/chess/chargeAnchoredSearch.ts` — injected `AskEngine`, `boardToFen` re-anchoring,
  legality filter + fallback, `applyMoveToBoard` charge-drain between calls, negamax with
  terminal handling (`terminalChildScore` re-impl + no-legal-moves mate/stalemate) and sign
  normalization, iterative deepening + wall-clock budget, and a `hybridLeafEval` hook (Step 10, not
  yet implemented). Steps 3–9 + 11 done.
- **Unit tests GREEN:** `chargeAnchoredSearch.spec.ts` (10/10) — legality filter, all-illegal fallback,
  negamax sign convention, the Step 10 hybrid leaf correction, and the Step 8b transposition memo
  (no FEN asked twice across iterative-deepening passes), engine mocked.
- **Step 8b memo LANDED** — `(fen,movetime) → candidates` cache; `engineCalls` now counts only real
  (cache-miss) invocations, so cost figures are honest and deeper `D` fits a fixed budget.
- **Step 14 benchmark harness LANDED + pipeline PROVEN:** `docs/dev/scripts/chargeAnchoredBench.ts`
  (`npm run bench:optionb`) — Charge-Anchored FSF (fuel-aware, via `chargeAnchoredSearch` + `AskEngine` wrapping
  `evaluatePosition`) vs plain FSF (fuel-blind, single `evaluatePosition` + `filterLegalCandidates`).
  Reuses selfplay terminal logic. Env knobs `GC_*`; prints W/L/D, score%, ELO Δ ± 95% CI.
  - **Proxy note:** Charge-Anchored FSF fires ~K·D calls/move, so the bench needs the engine proxy started with a
    raised rate limit: `PORT=3006 RATE_LIMIT_MAX=100000 ENGINE_MAX_QUEUE=500 node server.js`, then
    point the bench at it with `VITE_ENGINE_URL=http://localhost:3006`.
  - **First smoke run (2 games, K=2 D=2, intMT=150ms vs plain 300ms/d12):** pipeline runs clean end to
    end. Result A(OptionB) 0W / B(plainFSF) 1W / 1 draw = 0.5/2, ELO Δ −191 ±556 — **error bar includes
    0, NOT significant.** This is a throwaway smoke test (tiny N; Charge-Anchored FSF was also handicapped on
    think-time here), NOT a strength verdict. Strength still UNPROVEN — needs a real overnight run at
    matched budgets.
  - **vs plain FSF at matched-ish time (8 games, K=2 D=2 intMT=250ms vs plain 1600ms/d20):**
    A(OptionB) **8W / 0 / 0 = 100%** (shutout). Fuel-awareness clearly crushes fuel-blind FSF. Expected,
    and only a lower bound on the harder test below.
- **Benchmark upgraded (2026-07-23):** `GC_OPPONENT=overlay` pits Charge-Anchored FSF against the **SHIPPED bot**
  (`chooseBotMove` = FSF + charge-aware overlay) at `GC_OVERLAY_DIFFICULTY` (default `grandmaster`);
  per-move timing + engine-call count now printed per game and in the summary (`GC_VERBOSE=1` for
  per-move lines); a **crash-retry** (`withRetry`, 4 tries w/ backoff) survives transient engine
  `ECONNRESET` (proven: a mid-run reset retried and the move completed instead of aborting). Launcher
  `docs/dev/scripts/run-bench-overlay.ps1` avoids the long inline env chain (terminal `^U` corruption).
  - **Measured full-strength cost (K=3 D=3, intMT=300 leaf=500 depth12 budget60000, hybrid w=12):**
    **~25 s/move steady, ~52 engine calls/move, always reaches full depth 3** (60 s budget never hit).
    Desktop proxy — expect meaningfully higher on-device (Step 1 phone latency still unmeasured).
  - **✅ VERDICT — 20 games, full-strength Charge-Anchored FSF (K=3 D=3, 18.3 s/move, 48.6 calls/move) vs shipped
    `grandmaster` overlay (~2 s/move):** A(OptionB) **17W / B 2W / 1 draw = 17.5/20 = 87.5%**,
    **ELO Δ +338 ±230 (95% CI)** → lower bound +108 > 0, so **STATISTICALLY SIGNIFICANT at 95%**:
    Charge-Anchored FSF is genuinely stronger than the bot we ship, at these settings. avg game 62.5 plies;
    total ~3.7 h. Log: `bench-overlay-fullstrength.log`.
  - **⚠️ NOT a fair-TIME result (the confound):** Charge-Anchored FSF used **~9× the wall-clock/move** (18.3 s vs
    ~2 s). So this proves "my slow premium bot beats my current bot" (a real PRODUCT result the user
    accepts), but does NOT fully isolate fuel-awareness as the *cause* vs raw extra thinking time. The
    clean scientific control (still TODO): give the shipped overlay a matched wall-clock (e.g. `asi`
    tier / higher movetime) and re-run — does the gap hold?
  - **📉 Where it loses (signal for §10.11):** the 2 losses + 1 draw were the **LONGEST games**
    (108, 77, 129 plies) while most wins were short/sharp (27–63 plies). Pattern points to Charge-Anchored FSF's
    **short D=3 horizon + approximate leaf value in long, deep-depletion grinds** — NOT confirmed as
    piloted-royal-specific (no per-position data). Supports the §10.11 measure-first calibration focus
    and a possible horizon/quiescence extension, over any royal special-case.
- **✅ Step 12 DONE (2026-07-23) — wired into L9 (`asi`) behind a graceful fallback.** `bot.ts`
  `getEngineMove`: for `asi` in normal play (`!overrides`), it runs `chargeAnchoredSearch`
  (`cafAsk` wraps `evaluatePosition`; K=3 D=3 intMT300 leaf500 engDepth12 budget60000 hybrid w=12),
  then layers `preferForcingWin` (maxDepth 8) on top of CAF's D=3 pick to keep the deep forced-win
  guarantee (§10.7). Safety: `legalSet` is Override-stripped so a CAF Override pick is rejected
  (never-board preserved); ANY throw (engine down / dev-proxy 429 / timeout) or illegal pick falls
  through to the single-shot overlay path → **can't brick the boss**. Benchmark/experiment path
  (`overrides` set) keeps the single-shot engine so A/B stays valid. L9 is hidden from
  PlaySettings/Sandbox (Run Dry final boss only). Calls are ASYNC (native process) → longer think,
  **no UI freeze**. tsc clean; 39/39 bot+search tests pass (asi forcing-win restored by the layer).
- **NOT done / gates before relying on it:** **phone latency (Step 1)** — CAF is ~18–25 s/move on the
  desktop proxy; on-device (native, ~49 sequential calls) it's UNMEASURED and could be much higher —
  validate on a real phone; and the **fair-TIME control** (shipped bot at matched wall-clock) to
  isolate whether fuel-awareness or extra time drives the +338.

### 10.11 Charge-eval calibration — OPEN, measure-first (audit 2026-07-23)

> **Status:** OPEN QUESTION, not a fix list. This section records a source-grounded audit of Charge-Anchored
> FSF's `hybridLeafEval` and **rejects** two speculative ideas that contradict the one place this was
> actually tuned (`search.ts`). Nothing here is approved. All of it is gated behind the §10.10
> benchmark showing that charge-*misjudgment* actually loses games.

**The defect being discussed.** Charge-Anchored FSF's leaf = FSF's centipawn score `+ hybridLeafEval`, where
`makeChargeMaterialLeafEval` returns `weight × (myCharges − oppCharges)` (default `weight = 12`), summed
over ALL anomalies equally. FSF is charge-COUNT-blind (`pieceToFenChar` maps by vector *presence*, so a
1-charge and 8-charge royal-rook are the same glyph `s`/`S` — verified in `engine.ts`). The hybrid is
the crude correction for that.

**Hard numbers (all read from source, not memory):**
- FSF `EngineMove.score` is **centipawns**, pawn ≈ 100 (`engine.ts`).
- Each anomaly has **exactly 10 charges**; **7 anomalies/side**; army sums to a permutation of
  {24,23,23} = **70 charges/side at start** (`archetypes.ts`, `balancedArmy.ts`).
- `search.ts` tuned constants: fighter charge `CHARGE_VALUE = 55`; **piloted-royal charge
  `ROYAL_RESERVE_VALUE = 8`** (explicitly "far below CHARGE_VALUE … never distorts material trades,
  only breaks ties"); check `±25`.

**Magnitude finding (quantified).** Charges only decrease. A realistic mid-game imbalance of 20–40
charges ⇒ hybrid correction of **240–480 cp (2.4–4.8 pawns)**, which equals or exceeds FSF's typical
positional signal (±50–300 cp). So **weight-12 is NOT the "light nudge" its code comment claims** —
it can dominate FSF's judgment. The comment's "in the spirit of `ROYAL_RESERVE_VALUE = 8`" is
misleading: 8 applies to *one* royal's ≤10 charges (≤80 cp); weight-12 sums across all 7 anomalies
(±480 cp+). **First thing to test: is weight-12 already too high?**

**Two prior suggestions REJECTED against the code:**
- ❌ *"Weight royal charges MORE / nonlinear cliff."* Contradicts `search.ts`, which weights a royal
  charge (8) ~7× *below* a fighter charge (55) on purpose, because a royal's LOSS is already a
  terminal (`terminalChildScore → -(MATE-ply)`). At Charge-Anchored FSF's D=3 a low-charge royal usually reaches
  the real terminal *inside* the search anyway, so a convex cliff term helps only in a narrow
  low-but-alive-just-beyond-horizon band while risking the magnitude domination quantified above.
- ❌ *"Diminishing returns per charge."* Contradicts `search.ts`'s flat-linear `55×charges`. No
  supporting evidence in the codebase; pure hypothesis.

**Why this can't be solved analytically.** FSF returns **one scalar** for the whole position, not
per-piece values — so we cannot subtract "FSF's overvaluation of *that* 1-charge piece" and substitute
the true value. Every additive charge term is a crude GLOBAL proxy whose correct weight/shape can only
be found **empirically**, not derived.

**Subtle behavioral risk found in audit.** The hybrid rewards *having* charges, and every anomaly move
*spends* one (pawn/king moves are free), so within the horizon it creates a **charge-hoarding bias** —
a mild reluctance to use anomalies. Could help (conservation) or hurt (passivity); unknown → must be
measured.

**Validated methodology (the actual plan, all post-benchmark):**
1. **Weight/form sweep** using existing knobs: `GC_WEIGHT ∈ {0,6,12,24}` and `GC_HYBRID=0`, A/B'd vs
   the shipped bot. Directly tests the quantified "weight-12 too strong?" concern.
2. If a royal-specific term is ever warranted, **start from `search.ts`'s tuned 55/8 split**
   (royal-LOW), never the rejected royal-high idea.
3. **One clean structural option:** a *targeted* depth extension on low-royal-charge / in-check lines
   so the real Gridlock-Death terminal resolves inside the tree (exact, no eval guessing, doesn't
   fight FSF) — cost is extra engine calls; measure the strength/time trade.
4. **Gate everything** on the §10.10 result: if Charge-Anchored FSF's losses don't cluster around
   charge-misjudgment, none of this is the priority.

### 10.11.1 Refinement (2026-07-23) — the blindness is NARROWER than §10.11 states, and cannot be fully closed

Source-grounded follow-up (read `variants.ini`, `engine.ts` `pieceToFenChar`, the `chargeAnchoredSearch`
hybrid). This **corrects an over-statement**: §10.11 reads as if FSF is broadly fuel-blind. It is not.

- **Most of the depletion value drop is ALREADY captured by the shape re-encoding.** `pieceToFenChar`
  re-emits the piece's CURRENT shape every ply, so an amazon spent down to one orthogonal charge is
  encoded as glyph `s` (**rook**) and FSF already values it as a rook (~5), not an amazon (~12). The
  amazon→chancellor→rook→dead value collapse is NOT blind. **The only residual blindness is WITHIN a
  single shape:** a 1-charge rook and an 8-charge rook are both glyph `s`, valued identically, even
  though the 1-charge one dies after its next move. So §10.11 is really about this NARROW
  last-charge-within-shape residual — a small error, not a large value gap.

- **It cannot be FULLY closed by any leaf correction.** FSF returns ONE scalar that fuses material +
  mobility + king-safety. We can only ADD to it, never DECOMPOSE it — so a leaf term can approximate the
  MATERIAL slice of the near-death error but CANNOT fix FSF's MOBILITY overvaluation (it still thinks a
  1-charge piece moves freely). Full closure needs a charge-native eval or an NNUE net (the rewrite / ML
  projects), exactly as `ChargeNativeSearchModel.md` §11 concludes. (My earlier "one scalar" note was
  right but incomplete — the mobility slice is the part that's *provably* uncorrectable.)

- **A principled per-piece material correction needs data not in config.** `variants.ini` defines the
  fairy pieces by BETZA only (`m:QN`, `s:R`, `e:QN`, …) with **NO explicit material values** — FSF
  derives them internally. So a "subtract FSF's glyph value, add the charge-scaled value" scheme would
  first require PROBING FSF for those derived values (not yet done), and even then corrects only material.

- **Honest re-ranking of strength levers (challenges the premise that charge-eval is the kicker):**
  **horizon/depth > NNUE >> charge-eval tuning.** The §10.10 losses clustered in LONG games (horizon),
  and the magnitude math says the shipped `weight = 12` (240–480 cp) can DOMINATE FSF's positional signal
  — i.e. the current hybrid may be OVER-correcting and slightly HURTING, not helping. Cheapest high-value
  action stays the `GC_WEIGHT ∈ {0,6,12}` / `GC_HYBRID=0` sweep (is L9 stronger with the hybrid LOWER or
  OFF?). The one principled partial-close aligned with the loss evidence is the **targeted low-charge
  depth extension** (§10.11 point 3): don't fix the leaf — reach the terminal on lines where a piece is
  about to die.

