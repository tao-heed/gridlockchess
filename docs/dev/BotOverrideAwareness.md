# Bot Override-Awareness — Analysis & Future-Implementation Reference

**Status:** NOT implemented (deliberately). The bot never Overrides. This document is a
code-grounded reference for *if/when* someone decides to implement scored bot Override.
**Scope:** the Gridlock Chess bot (`src/lib/chess/bot.ts`), the move kernel
(`src/lib/chess/move.ts`), move generation (`src/lib/chess/movement.ts`), and royalty/legal
enumeration (`src/lib/chess/check.ts`).

> Every claim below is cited to the source line it came from. Line numbers drift as code
> changes — treat the **function names + quoted snippets** as the durable anchors.

---

## 0. TL;DR

- **Can the bot Override its own Anomaly?** Mechanically **yes** — the kernel is
  color-agnostic. Behaviourally **no** — `bot.ts` strips every Override before it can be
  chosen, in **both** the engine and heuristic paths.
- **Should we enable it?** Not cheaply. A naive "delete the filter" change is a **strength
  regression**, not an enhancement. Doing it *well* is a real, multi-file, guarded feature.
- **Why keep the analysis?** Override has a narrow but real upside (desperation escape /
  endgame king activity). If a future contributor wants it, this doc saves them the
  re-investigation and lists the exact traps.

---

## 1. What "Override" is (in code)

Override = a King steps onto an adjacent square occupied by a **friendly, non-Omni,
non-Gridlocked Anomaly** and boards it permanently. The King is consumed; the host Anomaly
becomes `piloted: true` and is now the side's royal piece.

**Move generation** — `getKingMoves` in [movement.ts](../../src/lib/chess/movement.ts):

```ts
} else if (
  occupant.type === 'anomaly' &&
  occupant.archetype !== 'omni' &&
  !isGridlocked(occupant)
) {
  // Override target — board a friendly Anomaly.
  moves.push(sq);
}
```

**Kernel execution** — the `res.isOverride` branch in
[move.ts](../../src/lib/chess/move.ts) (`applyMoveToBoard`):

```ts
if (res.isOverride) {
  const host = board[to] as Anomaly;
  delete next[from];                       // King consumed
  next[to] = { ...host, piloted: true };   // host becomes the royal
  // ...irreversible: true, no un-board path exists anywhere
}
```

This branch is **not color-restricted** — it will execute a bot/black Override exactly as a
human/white one. So the rules layer already supports it.

---

## 2. Why the bot does NOT do it today

The block is entirely in `bot.ts`, not in the rules.

**`isOverrideMove` + `withoutOverrides`** — [bot.ts](../../src/lib/chess/bot.ts):

```ts
const isOverrideMove = (board, m) => {
  const mover = board[m.from];
  const target = board[m.to];
  return (
    !!mover && mover.type === 'king' &&
    !!target && target.type === 'anomaly' &&
    target.color === mover.color && target.archetype !== 'omni'
  );
};
// "The bot never boards — it is a one-way, life-or-death human decision;
//  random boarding would be self-destructive."
```

**Applied in BOTH bot paths:**

| Path | Call site (function) | Effect |
|------|----------------------|--------|
| Engine (Fairy-Stockfish) | `getEngineMove`: `withoutOverrides(board, getAllLegalMoves(...))` | Override never enters `legalSet`, so an engine candidate matching it is rejected. |
| Heuristic fallback | `heuristicMove`: `flatten(withoutOverrides(board, getAllLegalMoves(...)))` | Override never enters the move pool. |

**Second, independent barrier (engine tier only):** `getEngineMove` only ever *plays moves the
engine proposed* — it parses each UCI move with `parseUciMove` and keeps it only if
`legalSet.has(`${from}${to}`)`. It never injects a move Fairy-Stockfish didn't emit. An
Override is "King → friendly-occupied square," which is not a legal move in standard from→to
semantics, so the engine essentially never emits it. Therefore Override could only *ever*
originate from the heuristic path — which is also filtered. Net: **unreachable in both paths.**

These moves **are** generated upstream — `getAllLegalMoves`
([check.ts](../../src/lib/chess/check.ts)) routes every king through `getLegalMoves` →
`getKingMoves` and only drops moves failing `wouldBeInCheck`. So the bot receives Override
targets and then explicitly discards them.

---

## 3. Strategic case FOR bot Override

The entire upside rests on one code fact: **a King and a Piloted Anomaly move completely
differently.**

- **King** — `getKingMoves` ([movement.ts](../../src/lib/chess/movement.ts)): adjacent
  squares only (1-square mobility).
- **Piloted Anomaly** — still `type: 'anomaly'`, so `getLegalMoves`
  ([movement.ts](../../src/lib/chess/movement.ts)) dispatches it to `getAnomalyMoves`, which
  grants full vector reach gated by presence: `v.L > 0` → 8 knight leaps, `v.O > 0` →
  full-range orthogonal slides, `v.D > 0` → full-range diagonal slides. A `4/3/3` royal moves
  like an **Amazon**.

Given that upgrade, the only genuine motives are:

1. **Desperation escape.** A 1-square king in a mating net cannot run; a long-range royal can
   flee across the board and may break an otherwise-forced mate.
2. **Endgame king activity.** In sparse positions a long-range royal defends and attacks
   simultaneously — a slow king cannot.
3. **Zugzwang / mobility relief.** More legal moves when every king step is into check.

This upside is **narrow** — mostly desperation and endgames.

---

## 4. Strategic case AGAINST (why cheap enablement REGRESSES strength)

All three liabilities are code facts, not opinions.

### Liability A — the death clock
`applyMoveToBoard` ([move.ts](../../src/lib/chess/move.ts)):

```ts
const movedNowPiloted = moved.type === 'anomaly' && (moved as Anomaly).piloted === true;
const gridlockDeath = movedNowPiloted && isGridlocked(moved);
```

Every move the piloted royal makes spends a charge; at `0/0/0` it is **Gridlock Death — an
instant loss**. A standard King has no such clock. Override trades an immortal-until-mated King
for a royal the opponent can **hound to death** by repeated checks until it depletes. This is a
brand-new losing condition.

### Liability B — you lose your spare royal, permanently
`isRoyal` ([check.ts](../../src/lib/chess/check.ts)) counts a piloted anomaly as royal. Before
Override, the Anomaly is a disposable attacker you can sacrifice freely; after, it **is** your
only royal. `move.ts` does `delete next[from]` with `irreversible: true` and there is **no
un-board code path anywhere** — the decision cannot be undone.

### Liability C — the bot has no DEPLETION awareness for its own royal (decisive, bot-specific)
**Precision (corrected):** the engine is **not** blind to the piloted royal's *shape* anymore.
The Bug-2 fix (`gridlock-royal` variant + subset-letter FEN in `pieceToFenChar`,
[engine.ts](../../src/lib/chess/engine.ts)) is **color-agnostic** — it emits the royal's true
reach glyph (`e/f/g/h/i/j/s`) for a piloted anomaly of *either* side (white just upper-cases the
same letter). So after boarding, Fairy-Stockfish sees the bot's own royal as the correct
Amazon/Queen/etc. for its current vectors, **not** a 1-square `k`. The remaining gap is
**depletion**, not mobility.

What is genuinely missing for the bot's OWN royal:

1. **The engine is depletion-blind for both colors.** It sees the current shape but cannot model
   the charge the move spends or Gridlock Death (`docs/dev/BotDepletionAwareness.md` §3 "Honest
   limit"). So the engine can steer the bot's royal toward `0/0/0` without seeing the cliff.
2. **The only dedicated 1-ply depletion correction is OPPONENT-gated.** `getEngineMove`
   ([bot.ts](../../src/lib/chess/bot.ts)) runs `scoreVsPilotedKing` **only** under
   `hasPilotedKing(board, opponentOf(color))` — scoring moves *against* an enemy piloted royal.
   There is **no `hasPilotedKing(board, color)` self-mirror**, so nothing re-ranks the bot's own
   royal moves for depletion at 1 ply.
3. **Stage-2 search covers it only partially.** When the bot itself is piloted the opponent is
   not, so `getEngineMove` falls through to the non-piloted branch and *does* run
   `preferSearchMove` ([search.ts](../../src/lib/chess/search.ts)). That search steps every node
   through `applyMoveToBoard`, so `terminalChildScore` scores a move that spends the royal's last
   charge as `-(MATE)` and **avoids walking off the cliff within its horizon**. BUT: it is **off
   on the easy tiers** (`maxDepth: 0`), **margin-gated** (only overrides the engine by
   ≥`OVERRIDE_MARGIN`), horizon-limited (depth ~3-4 in practice), and by §5 it **does not value
   conserving royal charges** — it only penalizes the actual death-move, not a slow squeeze
   toward it.

Net: the instant the bot boards, its single most important piece is steered primarily by a
depletion-blind engine with **no self-side depletion correction on easy tiers** and only a
shallow, margin-gated safety net on strong tiers. It won't play illegal moves or step into check
(those come from the color-agnostic `getAllLegalMoves`), but it can fritter charges and eventually
Gridlock-Death itself, and it has no evaluator that treats "becoming a death-clocked royal" as the
liability it is.

### Verdict
- **Cheap enablement (delete `withoutOverrides`) → weaker bot.** Override would surface only in
  the heuristic fallback as an *unscored* move (`heuristicMove` picks randomly within its
  filtered buckets), and even when boarded, Liability C means the engine misplays the result.
- The failure modes (death-clock, single point of failure, engine self-blindness) are exactly
  what makes a bot look **dumber**, not smarter.

---

## 5. What a CORRECT implementation would require

If a future contributor implements scored bot Override, it is a deliberately-scoped feature,
**not** a flag flip. Minimum work:

1. **Inject Override as a synthetic candidate.** It won't come from the engine (§2), so add it
   explicitly to the candidate set *past* `withoutOverrides` (or gate the filter behind a
   config flag) — only in positions where boarding is plausibly justified.
2. **Score "becoming a piloted royal."** No such evaluation exists today. Needs a model that
   weighs the mobility gain against Liabilities A/B — e.g. only consider Override when the King
   is otherwise lost, or the resulting royal delivers/defends a decisive line.
3. **Symmetric engine-correction for the bot's OWN piloted royal.** Mirror the
   `hasPilotedKing` / `scoreVsPilotedKing` machinery for `color` (self), so post-board play
   isn't blind. Without this, §4-C alone sinks the feature.
4. **Death-clock lookahead.** Never board into a forced depletion loss — the search
   (`src/lib/chess/search.ts`) must see the `gridlockDeath` terminal and avoid boarding lines
   that get hounded to `0/0/0`.
5. **Tests.** Regression cases proving: bot boards only in the intended desperation/endgame
   spots; never boards into Gridlock Death; ELO ladder for the easy tiers is unchanged.

**Risk:** touches move selection, evaluation, and the engine interface — genuine regression
risk to the current ELO ladder. Ship behind a flag and A/B against the current bot before
making it default.

---

## 6. One-line summary for `bot.ts` future-readers

> The bot deliberately never Overrides (`withoutOverrides`). Enabling it well requires a new
> self-royal evaluation + death-clock lookahead; enabling it naively makes the bot weaker.
> See `docs/dev/BotOverrideAwareness.md`.
