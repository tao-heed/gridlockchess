# Deep Depletion Engine — Plan

> **Goal:** a bot search that understands **all** Gridlock mechanics — charge depletion,
> anomaly shape-changing, gridlock, Gridlock-Death, and Override — **deeply** (not the
> current shallow overlay), in a **single search** where both the moves *and* the evaluation
> are mechanic-aware.
>
> **Status:** ⛔ **GATE FAILED (2026-07-22).** The Phase-0 deep prototype (the overlay-as-boss
> *authority handoff*) was tested **on-device** and FAILED — with `deepMode` forced on, the L8 bot
> **marched its King straight up rank 1 → 8**: the king-safety-blind overlay eval, handed the wheel,
> walked the King to its death. Deep mode is reverted to **default OFF**; the safe, always-on parts
> (transposition table + repetition + `positionKey`) are kept as pure upgrades. **Conclusion: the
> bottleneck is the overlay's EVALUATION, not its search depth.** Do not evolve the overlay into the
> boss until a proper positional/NNUE eval exists (or reconsider forking FSF, which already has a good
> evaluator). See §0 and `ChargeNativeSearchModel.md` §11.

---

## 0. Honest framing (read this first)

Prior depletion refinements in this codebase — §12 #1 (forcing-win planner), #2 (override
margin 80 vs 150), and the overlay margin A/B — all came out **statistical washes** in self-play
(#2: 114 games, +12 ELO ±~65). The earlier `b^d` analysis also shows depletion errors bite
hardest at a **shallow** horizon. So:

> **The expected real-world strength gain from a *deep* depletion engine is, by our own evidence,
> uncertain and possibly small.** This plan therefore front-loads a **measure-before-build** proof
> step. If the prototype can't beat the current bot outside the noise band, we STOP.

> **UPDATE (2026-07-22) — the proof step ran and returned a hard NO.** Deep mode (overlay-as-boss) was
> force-enabled on-device: the L8 bot marched its King rank 1 → 8. Handing the crude, king-safety-blind
> overlay eval authority produces a *weaker*, not stronger, bot — extra depth did not save it. **We STOP
> here:** the **eval, not depth, is the bottleneck.** Kept the safe parts (TT, repetition); reverted deep
> mode to default OFF. Next effort belongs on a real positional (ideally NNUE) eval, or Option B.

---

## 1. Where we are today (verified against code)

- **FSF (Fairy-Stockfish)** — external C++ binary, reached over HTTP ([engine.ts](../../src/lib/chess/engine.ts) → `fetch`; [server.js](../../server.js)). We can only send it a **FEN + `depth/movetime/multipv/skill/nodes`**. It is **depletion-blind**: inside its own search a piece is a *fixed* fairy type.
  - **Eval path:** `server.js` sets `Threads/Hash/MultiPV/Skill/go` but **no `EvalFile`** → for the custom `gridlock` variant (no bundled net) FSF uses its **classical** evaluation, not NNUE. (Relevant to the fork option below.)
  - Per-turn snapshot accuracy is handled by `pieceToFenChar` (current fairy letter each turn), incl. the new `immobile = x` dead-stone (see `variants.ini`).
- **Overlay** — [search.ts](../../src/lib/chess/search.ts): a hand-written **negamax + quiescence** that steps through the **real kernel** ([move.ts](../../src/lib/chess/move.ts)) at every node, so depletion / shape-change / gridlock / Gridlock-Death are **exact**. Limits:
  - **Shallow** (`maxDepth ≤ 8`, JS, full-width branching ~40–60, time-boxed).
  - **No transposition table** (only a history heuristic).
  - **Evaluation is crude**: material-by-charges (`100 + 55·charges`, dead = 0), a `+8/charge` piloted-royal reserve, and a `±25` check term. No positional understanding.
  - **Override is EXCLUDED from the tree for both sides** (matches the bot's "never board, don't speculate the human will" policy).
- **The law:** [move.ts](../../src/lib/chess/move.ts) `applyMoveToBoard` already implements every mechanic (depletion, shape-change, gridlock, Gridlock-Death, Override). Any new search rides on it.

**The tension:** depth lives in FSF (mechanic-blind); mechanic-truth lives in the overlay (shallow). No single search today is *both* deep and mechanic-aware.

---

## 2. Options considered

| Option | Deep + all-mechanics in one search? | Strength ceiling | Cost / risk |
| --- | --- | --- | --- |
| **A. Evolve the overlay** into a real engine (TT + modern pruning + mechanic-aware eval + override-in-tree; later port to Rust/C++ → **WASM**) | ✅ Yes — we own moves *and* eval | High (bounded by our eval quality + WASM speed) | Large, but **incremental** and prototypable in TS first. **Recommended.** |
| **B. Fork Fairy-Stockfish C++** — add depleting pools to move-gen + Zobrist + eval + override | ✅ Yes | Highest raw depth (reuses FSF search) | Very large: mutable per-square charge state vs bitboards, **Zobrist/TT must fold in charges**, override move-gen, C++ expertise, **forever fork maintenance**. Classical eval *is* extendable (no NNUE retrain needed — mild plus). |
| **C. New engine from scratch** | ✅ Yes | Depends on effort | Huge — reinventing decades of FSF. Rejected. |

**Recommendation: lean Option A, but the choice is genuinely close** — closer than my first draft
implied. Option A's appeal is that the overlay already models every mechanic correctly and we own
the evaluation. **The catch I under-weighted:** "owning the evaluation" means *building* a competitive
general chess evaluation (king safety, piece activity, piece-square tables, pawn structure) — the
single hardest, most open-ended part of an engine — because the overlay's eval today is **essentially
material only** (charges + royal-reserve + a ±25 check term). Option B (fork FSF) *inherits* FSF's
mature classical eval and only adds charge terms, skipping that hardest part. So: **A** = cleaner
mechanic-native design but a large eval-building burden; **B** = skips the eval burden but demands deep
C++ surgery (charge state vs bitboards, Zobrist, override move-gen) + permanent fork maintenance.
**Phase 0 below is deliberately eval-path-agnostic**, so its measured result informs the A-vs-B
commitment instead of my prior gut call.

---

## 3. Recommended path — measure before you build

### Phase 0 — TS prototype + proof (LOW RISK, do this first)
Extend `search.ts` **in TypeScript** (no rewrite, no WASM yet) and A/B it against the current bot
via the existing self-play harness ([selfplay.ts](./scripts/selfplay.ts)).

1. **Transposition table** keyed by a hash that **includes charges** (two boards with same
   placement but different pools are different positions). Store depth, flag (exact/lower/upper),
   best move. Expected: deeper effective search in the same time budget.
2. **Override-in-tree** — allow Override moves in the search for the **opponent** (model that a
   human *may* board), and optionally for the bot behind a flag. Uses `move.ts` (already applies
   Override). Note: enabling the bot to board is a **policy** change, gate it off by default.
3. **Depletion-aware eval terms** (small, additive, tunable):
   - imminent-gridlock awareness for **non-royal** anomalies (a 1-charge fighter about to die is
     worth less than its raw charge value suggests, in the wrong spot),
   - Override value (king-anomaly survivability — `coverage ▸ runway ▸ safeMobility`, already
     computed in [bot.ts](../../src/lib/chess/bot.ts) `hostSurvivability`),
   - keep the existing `ROYAL_RESERVE` / check terms.
4. **Depletion extension** — extend the search a ply or two along lines where a piece spends its
   **last** charge (becomes a stone) or a piloted royal nears Gridlock-Death.
5. **Authority handoff (CRITICAL — do not skip).** Today the overlay may overrule FSF only when it
   beats FSF by ≥ 150 cp (`preferSearchMove` in [bot.ts](../../src/lib/chess/bot.ts)), a gate that
   rarely fires — so a *smarter* overlay behind the *same* gate would likely benchmark as another
   wash (a better brain nobody listens to). For the experiment to mean anything, flip the roles on
   the deep path: **make the deep overlay the primary decider and FSF the advisor/move-orderer**
   (lower or remove the margin there; use FSF's list to seed ordering). The A/B **must** compare
   "FSF-decides (today)" vs "deep-overlay-decides" — not two gated overlays.

**Kill criteria (hard):** run `GC_A=asi GC_B=asi` (prototype vs current), fixed nodes, ≥ 200 games.
If the score CI **includes 0** (no measurable gain), **STOP** — do not proceed to WASM. The whole
point is to avoid a months-long port for a wash.

### Phase 1 — deepen (only if Phase 0 beats the noise band)
6. Add **killer moves, late-move reductions, aspiration windows** to reach ~12–16 ply in TS.
7. Re-benchmark. Confirm the gain scales with depth.

### Phase 2 — port for real depth (only if Phase 1 still pays)
8. Port the **proven** search + eval to **Rust or C++ → WASM** (runs in the Capacitor webview).
   Expect 20–50× over JS → several more plies. Keep the TS version as the reference oracle for
   differential testing (WASM and TS must agree move-for-move on a fixed suite).
9. Wire the WASM engine behind the same `chooseBotMove` seam; keep FSF as fallback/advisor.

---

## 4. Architecture note — how FSF and the deep overlay coexist

Even with a deep depletion engine, **keep FSF** as a strong *advisor / move-orderer*:
- Seed the deep search's **root ordering** with FSF's ranked candidates (better ordering → harder
  alpha-beta cutoffs → more depth per second). This is the genuine "combine the arsenals" synergy.
- FSF remains the fallback when the deep engine times out or is unavailable (offline builds).

**This is a role reversal from today.** Right now FSF *decides* and the overlay only *vetoes* (rarely,
behind the 150 cp gate). The end state flips that: **the deep overlay decides; FSF advises + orders +
backstops.** Both brains stay on the team — the steering wheel just moves to the brain that understands
the mechanics. That handoff (not just a smarter overlay) is what makes the experiment meaningful
rather than another wash — see the Phase-0 "Authority handoff" item.

So the end state is: **FSF proposes + orders; the deep depletion engine decides**, and it
understands every mechanic in both its moves and its evaluation.

---

## 5. Risks & open questions

- **ROI is unproven** (see §0). Phase 0's kill criteria exist precisely for this.
- **TT correctness** — charges MUST be in the hash key; a bug here silently corrupts search.
  Mitigate with a TT-on vs TT-off differential test (same best move, fewer nodes).
- **Override policy** — searching the bot boarding itself changes long-standing behavior; keep it
  flag-gated and benchmarked separately.
- **WASM in the webview** — memory/threading limits on phones; measure before committing.
- **Fork option (B)** remains available if WASM depth is insufficient; its classical-eval
  extendability (no NNUE retrain) is a mild point in its favor, but core surgery + maintenance are not.

---

## 6. Immediate next action

Build **Phase 0** in `search.ts` (TT with charge-aware key + override-in-tree flag + depletion eval
terms + depletion extension), then run the ≥200-game A/B. Report the CI. Proceed only if it clears 0.

> Do not port to WASM, and do not fork FSF, until Phase 0 proves the deep design beats the current
> bot outside the noise band. Build-measure-then-scale.

---

## 7. Progress checklist

> **⛔ OUTCOME (2026-07-22): Phase 0 was built, tested on-device, and FAILED (see Status banner).** The
> **deep-specific** items below — depletion eval terms / escape-coverage, the gridlock extension, and
> the authority handoff — were **REMOVED**; their `[done]` marks are now *historical*. The **safe
> infrastructure** items — charge-aware hash (`positionKey`), transposition table, repetition
> detection, and override-in-tree — were **KEPT** and remain in `search.ts`. See
> `ChargeNativeSearchModel.md` §11 and `BotDepletionAwareness.md` §13.

### Phase 0 — prototype + proof (TS only)
- [ ] **Re-verify harness validity FIRST** — engine round-trip probe + mid-run fallback counter == 0
      (an INVALID benchmark makes the whole gate meaningless; this bit us earlier this session).
- [x] Charge-aware position **hash key** — placement + side-to-move + **per-piece charges** + EP
      target + piloted flags; must be **incremental** (rehashing the whole board per node negates gains).
      **[done 2026-07-22]** `positionKey` in `search.ts` (fixed-order, order-independent; string key —
      NOT yet incremental, flagged for Phase 1). Unit-tested (order-independence, charge/side/EP sensitivity).
- [x] **Transposition table** (store depth / bound flag / best move) + **TT-on vs TT-off differential
      test** (identical best move, fewer nodes) to prove correctness. **[done 2026-07-22]** non-mutating
      probe + TT-move ordering + mate-safe store; `setTranspositionEnabled` test seam; differential test
      passes (same move + same score, ≤ nodes). 14/14 search specs green; `tsc -b` clean.
- [~] **Draw detection inside the search** — repetition + total-gridlock + fifty-move (a deep search
      blind to draws will misevaluate "winning" lines that are actually drawn). **[repetition done
      2026-07-22]** within-search path-repetition → draw (0), reusing `positionKey`; 14/14 specs green
      (no false draws in winning/mate lines). **Total-gridlock + fifty-move deferred** — rare within the
      shallow horizon and cost per-node board scans / halfmove threading; revisit if the A/B pays.
- [x] **Override-in-tree** (opponent side), flag-gated; decide the self-board symmetry policy.
      **[done 2026-07-22]** `setSearchOverrides` seam; overrides enter the tree ONLY for the opponent
      (`color !== searchRootColor`), **default OFF** (no behavior change); bot never boards its own royal.
- [~] **Depletion eval terms** — imminent-gridlock for non-royal anomalies, Override/host-survivability
      (reuse `bot.ts` `hostSurvivability`); keep royal-reserve + check terms. **[partial 2026-07-22]**
      piloted-royal escape-coverage term added (deep-gated). **Non-royal imminent-gridlock deferred**
      (speculative / needs a positional signal we don't have cheaply).
- [x] **Depletion extension** — reconcile with the EXISTING quiescence check-extension (no double-extend).
      **[done 2026-07-22]** +1 ply when a move spends a piece's LAST charge (gridlock); deep-gated;
      bounded (a piece gridlocks once). Separate mechanism from quiescence — no double-extend.
- [x] **Authority handoff (CRITICAL)** — flip the deep path so the overlay DECIDES and FSF advises/orders
      (lower/remove the 150 cp margin there); otherwise a smarter-but-muzzled overlay benchmarks as a wash.
      **[done 2026-07-22]** `deepMode` → `overrideMargin: 0` on the quiet path (overlay decides).
      All deep behavior is behind `BotOverrides.deepMode` / `SearchOptions.deep`, **default OFF**.
- [x] **A/B — SUPERSEDED by a decisive on-device result (2026-07-22).** Before a valid A/B could run
      (proxy flaky), `deepMode` was force-enabled on the phone: the L8 bot **marched its King rank 1 → 8**
      — the authority handoff let the overlay's king-safety-blind eval lead into a suicidal king walk.
      That is a definitive **FAIL**; no 200-game run needed. (The earlier 200-game proxy A/B was invalid.)
- [x] **GATE → STOP.** Overlay-as-boss is **not viable until a proper positional eval exists** (§6
      "honest gap" in `ChargeNativeSearchModel.md`). Deep mode reverted to **default OFF**; temp
      `LocalGame.tsx` force-on hack removed. KEEP the safe, always-on parts (TT, repetition, `positionKey`).
      Redirect: build a real positional (ideally NNUE) eval FIRST — or reconsider Option B (FSF already
      has a good evaluator). See `ChargeNativeSearchModel.md` §11.

### Phase 1 — deepen (TS, only if Phase 0 pays)
- [ ] Killer moves + late-move reductions + aspiration windows (target ~12–16 ply).
- [ ] Re-benchmark; confirm the gain **scales with depth**.
- [ ] **Low-tier strength-limiting** — a deep engine has no `Skill` knob; keep L1–L4 beatable if it's
      used on those tiers (today the ladder relies on FSF depth/skill).

### Phase 2 — port for depth (only if Phase 1 still pays)
- [ ] Choose target (Rust vs C++) → **WASM**; keep the TS search as a reference oracle.
- [ ] **Differential test:** WASM ≡ TS move-for-move on a fixed position suite.
- [ ] Measure **on-device** (phone webview) time + memory; confirm acceptable "thinking" latency.
- [ ] Wire behind `chooseBotMove`; FSF as fallback + **root-ordering seed**.

---

## 8. Self-audit — confidence & gaps (brutally honest)

**Confidence in the *factual* claims about current code: HIGH** — all read directly this session:
FSF-is-external-and-FEN-only ([engine.ts](../../src/lib/chess/engine.ts), [server.js](../../server.js)),
**no `EvalFile` → classical eval** (grep of `server.js` returned nothing), overlay has **no TT / only a
history heuristic** and **excludes Override from the tree** ([search.ts](../../src/lib/chess/search.ts)),
eval constants (`100 + 55·charges`, dead = 0, `+8/charge` reserve, `±25` check), and `move.ts` owning
every mechanic. One hedge: FSF *could* auto-use a default net for *standard* chess, but for the custom
`gridlock` variant with no matching net and no `EvalFile`, classical eval is what runs.

**Confidence in the *recommendation* (A vs B): LOW–MEDIUM.** I initially favored A too quickly. See the
eval-building correction in §2 — B may well be better precisely because the **evaluation is the real
bottleneck**, and FSF already has a decent one.

**Confidence in the *ROI* (that deep depletion helps at all): LOW.** #1/#2/margin were all washes; this
is the single biggest reason for the Phase-0 kill gate.

**Gaps / things I initially missed or under-stated (now folded into the checklist):**
1. **Eval-building burden** (Option A) — the hardest part of an engine, previously glossed as "we own
   the eval." Corrected in §2.
2. **Transposition rarity** — charges only deplete (never refill), so the state space is more DAG-like;
   real transpositions may be **rarer** than in standard chess → TT gains possibly smaller than assumed.
3. **Incremental hashing** — a per-node full rehash including charges could *slow* the search and negate
   the TT. Must be incremental.
4. **Draw detection in-search** — the overlay's negamax only knows mate/stalemate/terminal; it does NOT
   model repetition / total-gridlock / fifty-move. A *deep* search without these will misjudge draws.
5. **Low-tier strength-limiting** — no `Skill` analog for a hand-rolled deep engine.
6. **On-device latency** — deeper search = longer bot "thinking" on a phone.
7. **Harness validity is a prerequisite**, not an afterthought (added as the first Phase-0 item).
8. **"20–50× WASM over JS" is an estimate**, not a measured figure — treat as a hypothesis to verify in
   Phase 2, not a promise.
9. **Override-in-tree asymmetry** — modeling the opponent boarding but not the bot is inconsistent and
   could bias eval; needs a deliberate decision.

**Have I validated the plan end-to-end?** No — it is a *plan*, not tested code. Every current-state
claim is code-checked; every *future* claim (TT gains, depth reachable, WASM speedup, strength gain) is
a **hypothesis** the phased gates exist to test. The honest through-line: **build the cheapest thing
that can produce a real ELO number, and let that number — not this document — decide the rest.**
