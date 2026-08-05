# Balanced Army Generator

**Status: Shipped.** Single generation mode (`'balanced'`) — a DP-uniform sampler that
guarantees every army's charges sum to exactly a permutation of **{24, 23, 23}** across the
three vectors (Leap / Orthogonal / Diagonal). All numbers below are machine-verified.

**Source of truth:**
- Generator: [`src/lib/chess/balancedArmy.ts`](../../src/lib/chess/balancedArmy.ts)
- Placement: [`src/lib/chess/generator.ts`](../../src/lib/chess/generator.ts)
- Tests: [`src/lib/chess/__tests__/balancedArmy.spec.ts`](../../src/lib/chess/__tests__/balancedArmy.spec.ts) (16 tests, all passing)
- Verification scripts: [`docs/dev/scripts/verify_balance.mjs`](scripts/verify_balance.mjs), [`docs/dev/scripts/verify_exact_balance.mjs`](scripts/verify_exact_balance.mjs), [`docs/dev/scripts/verify_bishop_rule.mjs`](scripts/verify_bishop_rule.mjs)

---

## Generation rules

These three rules are the **single source of truth** for what constitutes a valid starting
army. They supersede the old `CURATION` / `isValidArmy` / `generateCuratedArmy` rejection
sampler (gone).

| # | Rule | Enforcement |
|---|------|-------------|
| **1** | **Exact vector sum:** the 7-piece army's combined charges equal exactly a permutation of {24, 23, 23} over L / O / D. | `isExact242323()` in `balancedArmy.ts`; the DP only counts armies that satisfy this. |
| **2** | **≤ 2 Absolutes:** at most two single-vector pieces (absLeap / absOrtho / absDiag). | `if (abs > 2) return 0` in `completions()`. |
| **3** | **≤ 2 duplicates:** at most two copies of any one archetype. | Structural — the DP enumerates only 0 / 1 / 2 copies per archetype. |
| **4** | **Split bishops (placement):** if an army rolls exactly two `absDiag` pieces, they are placed on opposite-parity files so each side gets a genuine light + dark bishop pair. | Applied in `generator.ts` after sampling; the DP army count is unaffected — only 326,160 placements are removed. |

> **Old rule 3 ("each vector total ≥ 8") is gone** — it is provably redundant once rule 1
> is in force, since every total is exactly 23 or 24 ≥ 8. Keeping it would be dead code.

Both armies are **mirrored** (`generateInitialBoard` in `generator.ts`): White's rolled army
is copied directly to Black's files. All macro-fairness guarantees therefore apply to both
sides identically.

---

## Algorithm — DP uniform sampler

Rejection sampling is non-viable for the exact target: a raw 7-piece roll satisfies the
rules only **0.4437%** of the time (~225 rolls per hit), so `maxTries: 400` would ship an
invalid army in **~1 in 6 games** — silently, with no crash. The live engine uses a DP
instead.

**One-time table build** — `completions(i, slots, L, O, abs)` is memoised and computes the
number of ordered ways to fill the remaining `slots` to a valid army using archetypes
`i … N`. This is the same count that `balancedArmyCount()` returns and that
`docs/dev/scripts/verify_exact_balance.mjs` cross-checks independently.

**Per-draw** — walk the table forward, choosing each archetype's copy-count and its concrete
build with probability proportional to the completion counts they lead to. The result is
**exactly uniform** over the 743,855,490 valid ordered armies — no rejection, no fallback,
no invalid outcome possible.

**Complexity** — O(archetypes × builds) per draw after the one-time table build, which
happens lazily and is cached.

### Rule 4 — opposite-color bishop pair (placement)

Applied in `generator.ts` *after* the army is sampled:

If an army contains exactly two `absDiag` pieces (D=10, zero L/O — the only genuinely
color-locked archetype), they are forced onto **opposite-parity files** on the back rank so
each side fields a true light + dark bishop pair. Any other archetype can spend an L or O
charge to switch color complex, so none of them need this treatment.

This rule excludes 326,160 same-color-pair positions from the reachable set, bringing the
final distinct opening count from 5,950,843,920 to **5,950,517,760**.

---

## Verified numbers

All figures are machine-verified by the scripts in `docs/dev/scripts/`. No magic numbers.

| Metric | Value | Script |
|--------|-------|--------|
| Distinct starting builds per Anomaly | **36** | `verify_balance.mjs` |
| Valid ordered armies (rules 1–3) | **743,855,490** | `verify_exact_balance.mjs` (T2); pinned in `balancedArmy.spec.ts` |
| Distinct opening positions (×8 king files, pre-bishop rule) | 5,950,843,920 | derived |
| Distinct opening positions (post opposite-color bishop rule) | **5,950,517,760** | `verify_bishop_rule.mjs` |
| N_eff under uniform sampling | **5,950,517,760** | every position equiprobable |
| ~50% repeat horizon | **~90,796 games** | `1.177 × √N_eff` |
| Exact hit rate under raw 7-roll | **0.4437%** (~225 rolls per hit) | `verify_exact_balance.mjs` (T1) |
| Fallback rate if rejection sampling used (400 tries) | **~16.9%** | `verify_exact_balance.mjs` (T1) |

> The old headline was ~372 billion openings from the retired rejection-sampling Balanced
> mode. That figure was for the unconstrained ≤2-dup space (46.4B ordered armies × 8 files,
> ×59.3% acceptance). Exact 24/23/23 is a stricter slice: **1.60%** of that space —
> still 5.95 billion distinct positions, far beyond any human play horizon.

---

## Archetype build space — 36 distinct starting builds

Every non-Omni archetype rolls exactly **10 charges** distributed across (L, O, D). The 36
distinct builds are enumerated at runtime by `enumerateBuilds()` in `balancedArmy.ts` and
cross-checked against each archetype's live `generate()` by the drift-guard tests in
`balancedArmy.spec.ts`.

| Archetype | Constraint | Builds |
|-----------|-----------|--------|
| absLeap (Motorbike) | (10, 0, 0) | 1 |
| absDiag (Racing Car) | (0, 0, 10) | 1 |
| absOrtho (Car) | (0, 10, 0) | 1 |
| highLeap (Police Car) | L ∈ {6,7,8}, O ≥ 1, D ≥ 1, O+D = 10−L | 6 |
| highDiag (Ambulance) | D ∈ {6,7,8}, L ≥ 1, O ≥ 1, L+O = 10−D | 6 |
| highOrtho (Firetruck) | O ∈ {6,7,8}, L ≥ 1, D ≥ 1, L+D = 10−O | 6 |
| hybridLD (Plane) | L ∈ {4,5}, O ∈ {0,1}, D = 10−L−O | 4 |
| hybridLO (Airliner) | L ∈ {4,5}, D ∈ {0,1}, O = 10−L−D | 4 |
| hybridDO (Rocket) | D ∈ {4,5}, L ∈ {0,1}, O = 10−D−L | 4 |
| balanced (Chopper) | one axis = 4, other two = 3 (any assignment) | 3 |
| **Total** | | **36** |

---

## Design rationale

### Why exact {24, 23, 23} and not a band?

A band (e.g. each vector ∈ [22, 25]) would preserve more openings but introduces a tunable
with no principled bound and a weaker fairness guarantee. Exact 24/23/23 is the **least-skewed
integer split of 70 that exists** (70/3 = 23.33), provides a single clean invariant trivial
to state and test, and eliminates all macro-resource RNG — like standard chess where starting
material is fully known. Both armies are mirrored, so there is zero material asymmetry.

### Why not keep old rule 3 ("each vector total ≥ 8")?

Under rule 1, every vector total is exactly 23 or 24. Rule 3 can never fire. Keeping it
ships a rule that provably never triggers, which is misleading to any future maintainer.

### Which vector gets the 24?

The archetype set is **invariant under permuting L/O/D** (each High is symmetric over the
other two axes; each Hybrid omits a different axis; Absolutes and Balanced are symmetric).
Uniform sampling therefore gives each vector an equal 1/3 chance of being the 24 — no
explicit weighting is needed. Because both armies are mirrored, fairness holds regardless of
which vector leads.

### Why not rejection sampling?

See the algorithm section. The 0.4437% hit rate means ~225 rolls per success. A 400-try cap
leaves a 16.9% fallback probability — approximately **1 in 6 games** would silently ship a
non-24/23/23 army. The DP sampler has zero fallback risk by construction.

### What happened to Wild / `'pure'` mode?

The old `'pure'` mode (each Anomaly an independent unconstrained roll, maximum variance) was
retired and replaced by the exact generator. `GenerationMode` is now a single value,
`'balanced'`. Legacy `'pure'` replays are normalized to `'balanced'` on load.

---

## Tests

[`balancedArmy.spec.ts`](../../src/lib/chess/__tests__/balancedArmy.spec.ts) — 16 tests:

- **Enumeration:** `balancedArmyCount()` equals exactly 743,855,490 (pins the DP against the
  independently verified `docs/dev/scripts/verify_exact_balance.mjs` result).
- **Drift guard:** for every archetype, every output of the live `generate()` is an
  enumerated build and every enumerated build is reachable (4,000 samples each).
- **Invariants:** 1,000 live-generated armies each satisfy rules 1–3; plus a live 600-draw
  test that all three vectors each take the "24" at least once (symmetric sampling sanity).
- **Seeded χ² (deterministic):** 9,000 draws under a fixed-seed mulberry32 PRNG; verifies
  that each vector takes the "24" with equal 1/3 frequency (χ² < 13.816, df=2, 0.1%
  significance). Also asserts `balancedArmyCount() % 3 === 0` (exact-thirds by symmetry).
- **Shared-ref regression:** mutating a returned army's `vectors` in place must not corrupt
  future draws (guards against the bug where BUILDS table objects were returned directly
  instead of cloned — 300 draws after destruction must all still satisfy 24/23/23).
