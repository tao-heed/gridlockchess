# Bot Strength Enhancement — Plan (DRAFT — for review before any code)

> Status: **PROPOSAL / NOT STARTED.** This is for red-lining and brainstorming. Nothing here is
> built. Claims are tagged:
> - **✅ VERIFIED** — confirmed by reading this repo's code on 2026-07-16 (file refs inline).
> - **📊 FROM LOG** — measured from the on-device Engine Log the user captured (L9/ASI game).
> - **📐 DERIVED** — arithmetic from VERIFIED/LOG numbers (shown, not asserted).
> - **🌐 INDUSTRY** — general engine knowledge, NOT measured for *this* variant. Treat as a
>   hypothesis to be benchmarked, not fact.
> - **❓ NEEDS VALIDATION** — an assumption we must prove before relying on it.

---

## 1. Goal & honest expectation reset

**Goal:** make the top-tier bot(s) genuinely stronger *on the phone*, using the latest sensible
practice — without chasing myths.

**Myths to kill up front:**
- **🌐 There is no downloadable "3000 / 4500 ELO Fairy-Stockfish."** ELO is not a property of a
  binary; it is `f(eval quality × search depth reached × hardware speed × time/move)`. Published
  "3000+" figures are desktop, long time-control numbers.
- **🌐 4500 ELO does not exist anywhere.** Standard Stockfish 17 (strongest chess entity) is
  ~3600 on strong desktop hardware. On a phone, at a custom high-branching variant, with classical
  eval, realistic *effective* strength is far lower.
- **✅ Skill is already maxed.** `grandmaster` and `asi` both use `skill: 20`
  ([bot.ts](../../src/lib/chess/bot.ts) `DIFFICULTY_CONFIG`) — **zero** headroom from the skill knob.

**Honest target:** a *legitimately measured* on-device improvement (e.g. +150–400 effective ELO in
self-play), NOT a mythical 3000/4500. Any number we put in the UI should be re-benchmarked or softened.

---

## 2. Verified current state

**Difficulty config** ✅ ([bot.ts](../../src/lib/chess/bot.ts) `DIFFICULTY_CONFIG`):

| Tier (level) | depth | movetime | multipv | skill | UI ELO label |
|---|---|---|---|---|---|
| grandmaster (L8) | 20 | 1500 ms | 3 | 20 | ~2800+ |
| asi (L9, Run-Dry only) | 24 | 4000 ms | 5 | 20 | ~3000+ |

- **✅ Engine = native Fairy-Stockfish, `gridlock-royal` variant, CLASSICAL eval (no NNUE net).**
  Confirmed at runtime: nativeEngine.ts sends only VariantPath / UCI_Variant / Threads / Hash / Skill /
  MultiPV — **no `EvalFile` or `UCI_UseNNUE` setoption**, so no net is loaded (build is `nnue=no`).
  (I did not disassemble the binary; the claim is "no net is wired at runtime," which is what matters.)
- **✅ Move selection flow** ([bot.ts](../../src/lib/chess/bot.ts) `getEngineMove`): build `legalSet`
  from `getAllLegalMoves` (the real charge-aware authority) → `evaluatePosition(fen, cfg)` returns
  `multipv` moves engine-ranked → keep those in `legalSet` as `candidates` → depletion-aware
  re-ranking (fizzle guard, `scoreVsPilotedKing`) → `preferSearchMove` charge-aware overlay may
  override. If **no** candidate is legal → `null` → weak heuristic fallback.
- **✅ App-side charge-aware overlay** exists ([search.ts](../../src/lib/chess/search.ts)
  `preferSearchMove` + negamax `evaluate`): patches the engine's blindness to the charge economy
  (piloted royal scored at 0 material), gated by `OVERRIDE_MARGIN`, force-enabled when self-piloted.

**On-device measurement** 📊 (L9/ASI log, 31 moves):
- skill 20, target depth 24 every move, movetime 4000 ms every move.
- **Depth reached ≈ 10–12 / 24 in the midgame** (amber). Only endgame moves (few pieces) hit 24/24.
- nps ≈ 345k–746k, mostly ~400k. One endgame move showed 17k nps at 24/24 (tiny tree / near-mate).

---

## 3. Diagnosis — where the ceiling actually is (with math)

Two independent walls. Both must be understood before choosing work.

### Wall A — Depth (nodes), and it is HARD 📐
- Nodes/move = nps × time = 400,000 × 4 s ≈ **1.6M nodes**. 📊/📐
- Self-consistent EBF from the log (solve `EBF^depth = 1.6M`): the observed 10–12 ply gives
  **EBF ≈ 3.3 (at d12) … 4.0 (at d10)**, ≈ **3.7 at the median d11** (`1.6M^(1/11) ≈ 3.67`). 📐
  > ⚠️ **CORRECTION to the first draft**, which paired "d11" with "EBF 3.3" — inconsistent, since
  > `3.3^11 ≈ 0.5M ≠ 1.6M`. The self-consistent value at d11 is ~3.7. (Standard chess SF EBF ≈ 2–2.5;
  > this variant's amazon-class move counts make it markedly bushier.)
- Cost of more depth (EBF ≈ 3.7 ⇒ ×3.7² ≈ **13.5×** per +2 ply): 📐
  - depth 13 ≈ `3.7² × 1.6M` ≈ **22M nodes → ~55 s/move**
  - depth 15 ≈ `3.7⁴ × 1.6M` ≈ **290M nodes → ~12 min/move**
- **Every +2 ply ≈ 11–16× more wall-clock** (EBF² across the 3.3–4.0 range). The corrected numbers
  make the wall **worse**, not better: desktop-class depth on a phone is arithmetically impossible at
  any acceptable move time. A "newer/higher-ELO binary" does NOT move this wall.

### Wall B — Evaluation quality (classical, no NNUE) 🌐
- Modern engine strength comes largely from NNUE. **Classical eval at equal depth is ~500–800 ELO
  weaker** (🌐 industry estimate; NOT measured for this variant).
- The `gridlock-royal` variant runs classical HCE, and that HCE is **blind to the charge economy**
  (piloted royal = 0 material). The app already partially patches this with the `search.ts` overlay.

**Conclusion:** strength is limited by **depth × eval quality**, not by engine version or skill.
There is no shortcut binary.

---

## 4. Levers, ranked by (impact ÷ effort) — brutally honest

### Lever 1 — First MEASURE, then maybe improve, the app-side overlay (`search.ts`) 🥇
- **✅ Verified current behavior:** `preferSearchMove` runs a **depth-8 (asi) / depth-6 (gm)**
  charge-aware negamax whose eval is **material-by-charges + a light check term + royal-reserve, with
  NO positional term** (search.ts header + `pieceWorth` / `CHARGE_VALUE=55` / `ROYAL_RESERVE_VALUE=8`;
  the old centrality term was rolled back). It **overrides the engine's move only when ≥150cp better
  by its own reckoning** (`OVERRIDE_MARGIN`), or authoritatively (margin 0) when self-piloted.
- **⚠️ The uncomfortable question the first draft under-weighted:** a shallow, positionally-blind eval
  that can override a deeper classical engine is **double-edged**. It *fixes* the engine's charge
  blindness (good), but could also *replace* a positionally-strong engine move with a material-greedy
  depth-8 move (bad). Whether it is net-positive **on the strong tiers** is **unmeasured** — the
  docstring merely *asserts* it "doesn't weaken positional play."
- **Cheapest experiment (do this FIRST, before any eval work):** self-play **asi with the overlay ON
  vs OFF** (toggle `SEARCH_BUDGET.asi.maxDepth` → 0). If OFF ties or wins, the cheapest strength gain
  is to **restrict** the overlay to its proven depletion-specific jobs (self-piloted Gridlock-Death
  avoidance + fizzle guard) and let the engine own quiet play. Only if ON wins is "enrich the eval"
  justified.
- **Effort:** the ON/OFF test is cheap; enriching the eval is medium. **Risk:** medium — `evaluate`
  changes shift tactical specs; keep bot/search specs green + mutation-check binding terms.
- **Expected gain:** ❓ unknown *sign* until measured — which is exactly why it is Phase 1's first test.

### Lever 2 — Rework the `multipv` legality/depletion shortlist ⚠️ NOT the free win I first implied
- **Correction (✅ from reading `getEngineMove`):** `multipv` here is **not** just legality
  insurance. The candidate list is *consumed* by app logic: (a) legality filter vs `getAllLegalMoves`,
  (b) the **fizzle guard** (find a candidate that genuinely checks on the real depleted board),
  (c) `scoreVsPilotedKing` re-ranking. **Dropping multipv to 1 would degrade (b) and (c), not just
  legality.**
- **What (revised):** instead of blindly lowering multipv, restructure to *exclude-and-re-search*:
  keep a small multipv for the depletion guards, but when the engine's top move is illegal, issue a
  focused re-search excluding it rather than paying wide multipv on every move. Net: recover some
  depth on clean positions without losing the depletion shortlist.
- **Effort:** medium. **Risk:** medium — touches the proven Bug 5/6 depletion paths; needs the full
  bot.engine/heuristic/search specs green + on-device check.
- **Expected gain:** ❓ modest depth recovery (📐 ~1 ply on clean positions), **conditional** on not
  regressing the depletion corrections. Prove with benchmarking (§6) before shipping.

### Lever 3 — Dynamic time management (replace fixed 4000 ms)
- **What:** spend more time on tactically dense positions, far less on near-forced/recapture moves,
  keep average think-time ~constant.
- **Why:** better depth *where it matters* for the same felt latency.
- **Effort:** medium. **Risk:** low–medium (UX: variance in "thinking" time). **Gain:** ❓ modest.

### Lever 4 — Train an NNUE network for `gridlock-royal` 🌟 biggest strength, 🧱 biggest effort
- **What:** generate self-play training data with the classical engine, train a variant net with
  `nnue-pytorch` (Fairy-Stockfish variant support), embed the `.nnue`, rebuild ARM64
  (see [NativeEngineBuildGuide.md](./NativeEngineBuildGuide.md)).
- **Why:** attacks Wall B at the root — **🌐 potentially +500–800 ELO** at equal depth.
- **Honest costs / risks:**
  - Multi-week project; **GPU compute (days)**; data-gen pipeline; trainer adaptation for a bespoke
    variant (❓ needs validation that nnue-pytorch supports gridlock-royal's board/piece topology).
  - **🌐 NNUE eval is slower per node → fewer nps → less depth** (Wall A gets slightly worse). The
    per-node accuracy gain usually dominates, but on a phone the net trade must be **measured**, not
    assumed.
  - Rebuild + re-validate the whole native pipeline.
- **Expected gain:** ❓ large but unproven for this variant on this hardware. Highest ceiling, lowest
  certainty, highest cost.

### Lever 5 — Longer `movetime` (dumb but direct)
- Direct depth, but 📐 +2 ply ≈ 11× time, and the bot visibly freezes ("thinking" lag). Diminishing,
  UX-negative. Use only as a tunable, not a strategy.

### Lever 6 — Update Fairy-Stockfish to latest release
- Marginal. Minor search improvements; does **not** touch classical-eval or phone-depth walls. Low
  priority; do it opportunistically during any rebuild.

### Already maxed / non-levers (don't waste time) ✅/📐
- **Skill:** already 20. No headroom.
- **Hash:** 128 MB (✅ nativeEngine.ts). 📐 1.6M nodes/move ≪ ~8M TT entries in 128 MB → table not
  saturated within a single 4 s move → raising Hash gives **negligible** single-move depth (minor
  cross-move reuse aside). Effectively already sufficient.
- **Threads:** auto 2–6. Phone-core limited; diminishing + heat.

---

## 5. The measurement problem (READ THIS — everything above is unproven without it)

**We currently have NO way to claim an ELO gain.** The UI numbers (2800/3000+) are aspirational.
Before/after any change, we must MEASURE, or we are guessing.

Proposed benchmark harness (❓ to design):
- **Engine-vs-engine self-play** at **fixed nodes** (not fixed time — removes DVFS/thermal noise 📊):
  e.g. old-config vs new-config, N games from varied openings, report win/draw/loss + score.
- **⚠️ Feasibility gap (✅ verified):** the engine interface exposes only `{ depth, movetime, multipv,
  skill }` (nativeEngine.ts / engine.ts) — **no `nodes` parameter.** Fixed-nodes benchmarking needs a
  new `go nodes N` path added first (small, but not free). Until then, fixed-*movetime* on a
  thermally-settled desktop is the fallback (noisier, but available now).
- Convert score to ELO delta: `Δ = -400 · log10(1/p − 1)` where `p` = score fraction. 📐
- Run on desktop for speed/repeatability, then a smaller on-device confirmation run (thermal reality).
- Gate every lever on a **statistically meaningful** result (enough games that the ELO delta's error
  bar excludes 0), not vibes.
- Reuse the existing Engine Log surface ([EngineLogModal](../../src/components/ui/EngineLogModal.tsx))
  for on-device depth/nps evidence.

**Principle:** no strength claim ships without a self-play number behind it.

---

## 6. Proposed phased roadmap (for debate)

- **Phase 0 — Measurement first.** Build the fixed-nodes self-play harness + ELO-delta calc. Baseline
  the current asi/grandmaster. *Nothing else proceeds without this.*
- **Phase 1 — Cheap, in-app, no rebuild.** FIRST: self-play the **overlay ON vs OFF** on asi/gm
  (Lever 1's cheap test) — it may be a free win by *restriction*, not addition. THEN, only if ON wins,
  enrich the overlay eval; plus Lever 3 (time mgmt). Benchmark each independently; ship only measured
  winners.
- **Phase 2 — Careful engine-side.** Lever 2 (multipv rework) with full depletion-spec coverage +
  self-play gate. Optionally Lever 6 during a rebuild.
- **Phase 3 — Moonshot.** Lever 4 (variant NNUE), only if Phases 1–2 don't reach the desired feel and
  we accept the GPU/time cost. Spike the trainer-supports-the-variant question FIRST.

---

## 7. Open questions / brainstorm prompts

> Note: since §9 was added, several of these are no longer fully open — **Q3** (fixed-nodes) is now
> action #1, **Q4** (re-derive ELO labels) is action #5, and **Q6** (L8≈L9) is action #4. Kept here
> for the original reasoning trail.

1. What is the *actual* target? A stronger single top bot, or a wider, better-separated ladder
   (L1–L9 that *feel* distinct)? These pull design differently.
2. Is the ~2000–2400 realistic ceiling acceptable, or is NNUE (Phase 3) a hard requirement?
3. Fixed-nodes vs fixed-time for the ladder itself? Fixed-nodes would make levels
   hardware-independent (a level plays the same on every phone) — arguably more honest than the
   current time-based tiers that vary with CPU/thermal. ❓ worth considering.
4. Should the UI ELO labels be re-derived from self-play (honesty) or left aspirational?
5. Appetite/budget for GPU training (Lever 4)? If zero, we scope to Phases 0–2 only.
6. Is the current "L9 ≈ L8 on phone" (both skill-20, both depth-capped) actually a *problem* to
   solve, or just a labeling issue to communicate?

---

## 8. What NOT to do (anti-patterns)

- ❌ Don't hunt for a "higher-ELO Fairy-Stockfish binary." It doesn't exist (§1).
- ❌ Don't bump `movetime` alone and call it stronger (diminishing, UX-negative, unmeasured).
- ❌ Don't lower `multipv` naively — it feeds the depletion guards (§4 Lever 2).
- ❌ Don't ship any strength claim without a self-play number (§5).
- ❌ Don't raise Hash expecting depth (§4 non-levers).

---

## 9. S-tier improvement checklist (prioritized — post-log-analysis)

> Distilled after reading the **full Level 1–9 on-device logs** (24 captures) and
> [BotDepletionAwareness.md](./BotDepletionAwareness.md). This refines §4's lever ranking with two
> corrections the earlier draft lacked:
>
> - **📊 The depth wall is exponential, not a throttle.** Confirmed across tiers: L8→L9 gives
>   **2.67× movetime for ≈ +1 ply** (1500 ms→4000 ms, median reached depth ~10→~11). 📐 Doubling raw
>   nps (the optimistic ceiling from lifting the `Threads` clamp `max(2,min(6,cores−2))` /
>   `Hash 128` in [nativeEngine.ts](../../src/lib/chess/nativeEngine.ts)) buys only
>   `log(2)/log(EBF) ≈ log(2)/log(3.5) ≈ **0.55 ply**` — and would *overheat → throttle → lower
>   sustained nps* on a long game. The clamp is deliberate and near-costless; unleashing it is not a lever.
> - **✅ The bot already UNDERSTANDS the mechanics.** Per BotDepletionAwareness.md, **Bugs 1–6 are
>   shipped**: 3-vector reach (subset-letter FEN), charge depletion (charge-aware kernel search),
>   Gridlock Death (terminal refusal), and Piloted-Anomaly play (offensive + defensive). The gap is
>   NOT understanding — it is that this "helper" is **shallow (eff. depth ~3–4), thin-eval
>   (material + check + royal-reserve, no positional term), partially-scoped, and UNMEASURED for
>   real strength** (that doc's own §5 / caveat #3).
>
> **Depth-cap starts at L4/L5, not just L8/L9** 📊: reached-depth ladder ≈ `1,3,5,7,8,8,9,10,11` vs
> nominal `1,3,5,8,12,15,18,20,24`. From L5 up, **skill (12/15/18/20/20) separates the ladder, not
> depth**; L8/L9 share skill 20 → nearly identical.
> *(Caveat: the ladder and the ~10→~11 medians are eyeballed from the log screenshots, not per-move
> transcriptions — treat the integers as approximate. The L8→L9 ≈ +1 ply direction is the robust part.)*

### 🥇 #1 — MEASURE first (self-play harness + fixed-nodes path)
- [x] **DONE** — `go nodes N` path added to [engine.ts](../../src/lib/chess/engine.ts),
      [nativeEngine.ts](../../src/lib/chess/nativeEngine.ts), and [server.js](../../server.js):
      an optional `nodes` budget makes the search node-bounded (`go nodes N`), so a position
      searches identically on every machine regardless of CPU/thermal. Normal play unchanged.
- [x] **DONE** — self-play harness [docs/dev/scripts/selfplay.ts](./scripts/selfplay.ts) (`npm run selfplay`):
      drives the REAL bot + engine, mirrors the app's move/repetition/gridlock bookkeeping, swaps
      colors each game, and prints an ELO delta `Δ = −400·log10(1/p − 1)` with a 95% CI +
      significance warning. Bot config injected via `BotOverrides` (`engineNodes`, `searchMaxDepth`).
      Smoke-tested end-to-end (plays full games, detects gridlock-death/draws). Requires
      `npm run dev:server`.
- [ ] **NEXT** — run the actual baseline: enough asi-vs-grandmaster (and fixed-nodes) games that
      the ELO delta's error bar excludes 0. *(Tooling ready; the run itself is pending — asi's
      depth-8 overlay makes each game slow, so a meaningful sample takes real wall-clock.)*
- **Why:** nothing about strength is measured today; every item below is a guess without this.
- **Effort:** small–medium. **Gates everything else.**

### 🥈 #2 — Prove, then enrich, the charge-aware helper (`search.ts` overlay)
- [x] Self-play the overlay **ON vs OFF** on asi/gm (toggle `searchMaxDepth`→0). *(First run done — see result.)*
- [ ] If ON wins: add a **light positional term** (king-safety / mobility) so a shallow override of a
      deeper engine move isn't purely material-greedy (the eval gap BotDepletionAwareness.md §5 flags).
- [ ] If OFF ties/wins: **restrict** the overlay to its proven depletion jobs and let the engine own quiet play.
- **Why:** the only lever that dodges Wall A (improves *understanding*, at fixed cost).
- **Effort:** cheap to test, medium to enrich.

> **📊 Measured (2026-07-20) — overlay ON vs OFF at grandmaster, fixed 150k nodes, colors swapped.**
> *Generated by the self-play harness [docs/dev/scripts/selfplay.ts](./scripts/selfplay.ts)* — e.g.
> `GC_A=grandmaster GC_B=grandmaster GC_B_MAXDEPTH=0 GC_NODES=150000 GC_GAMES=200 GC_PROGRESS=progress.log npm run selfplay`
> (A = overlay ON, B = `searchMaxDepth:0` = overlay OFF; requires `npm run dev:server`).
> Two runs, same setup:
> - **30 games:** ON 13 – OFF 17 → Δ = **−47 ±125** (noise; error bar huge).
> - **200 games:** ON **105** – OFF **88**, 7 draws (54.3%) → Δ = **+30 ±48 ELO (95% CI).**
>
> **Read:** the point estimate *flipped* from −47 (30 games) to **+30** (200 games) as the sample
> grew — classic regression toward the truth. The 200-game result leans **slightly positive** (the
> overlay helps a little) and **rules out "it hurts."** It is **still not statistically significant**
> (CI −18…+78 spans 0), but the actionable conclusion is clear: **keep the overlay ON — it is
> neutral-to-slightly-helpful, not dead weight and not harmful.** The effect is *small* (~+30, ≤ +78),
> so **"enrich the overlay" is a low-value, uncertain bet** — proving +30 significant would need
> ~500 games (~15 h) for diminishing return. Caveats unchanged: 150k nodes is weaker than production;
> the overlay only fires on a minority of moves, so the true effect is inherently small.

### 🥉 #3 — Close the real coverage gap: enemy-royal multi-move planning
- [ ] Route the **opponent-only-piloted** branch of `getEngineMove` through the charge-aware search
      (today it re-ranks with 1-ply `scoreVsPilotedKing`, so it **cannot plan a multi-move
      Gridlock-Death squeeze** on an enemy royal — BotDepletionAwareness.md caveat #5).
- **Why:** a concrete, code-identified hole; the doc calls it "a clean future extension."
- **Effort:** medium (touches tested depletion paths — gate on #1).
- **→ Tracked plan (checklist + touch points, L9-only):** [BotDepletionAwareness.md](./BotDepletionAwareness.md) §12 #1.

### #4 — Give Level 9 a genuine identity vs Level 8
- [ ] Redefine asi as the **"flawless depletion tactician"** (helper always-on, tuned) instead of
      "gm but longer" — 📊 the logs prove the extra 2.5 s buys ~1 imperceptible ply.
- **Effort:** low–medium (reuses #2).
- **→ Tracked plan (checklist + touch points, L9-only):** [BotDepletionAwareness.md](./BotDepletionAwareness.md) §12 #2.

### #5 — Fix the UI ELO labels (2800/3000…)
- [ ] Re-derive from #1's self-play, or soften. They are unmeasured today, and L8/L9 are near-identical.
- **Effort:** trivial once #1 exists.

### #6 — Moonshot: variant NNUE
- [ ] Only if #1–#4 don't reach the desired feel. Self-play data-gen → GPU training (days) → ARM64
      rebuild. **Spike "does nnue-pytorch support gridlock-royal" FIRST.**
- **Effort:** huge, unproven for this variant. Highest ceiling, lowest certainty.

### ❌ Rejected (with reason — don't retry)
- [x] ~~Unleash full CPU/RAM~~ → 📐 ~0.55 ply per 2× nps + heat/throttle/battery. Not a lever.
- [x] ~~Think longer (bump `movetime` alone)~~ → 📊 2.67× time = +1 ply. Dead end.
- [x] ~~Bigger depth number on asi (24)~~ → cosmetic; 📊 only reached in trivial endgames.
- [x] ~~More Hash for depth~~ → ✅ table not saturated within one move (§4 non-levers).

**Optional / low-yield — NOT rejected:** Dynamic time management (see §4 Lever 3 + §6 Phase 1).
Concentrating time on tactically dense positions *does* buy depth **where it matters** — a real but
modest gain — it simply cannot raise *average* depth or substitute for #1–#3. Keep it as a
post-#1, measured tunable, not a headline lever. *(Corrects an earlier draft of this list that wrongly
filed it under "rejected.")*
