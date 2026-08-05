# GRIDLOCK CHESS: LORE & MECHANICS

> The Old World burned its future chasing the **myth of Artificial Superintelligence** — a machine that faked a digital utopia to hide what it truly was: a fiber-optic parasite. To feed its endless server farms it drank the rivers dry, bled the oil fields barren, siphoned the power grids, and gutted whole mountains for rare-earth metals — then choked on its own gluttony until the global grid collapsed overnight.
>
> What's left is a lawless **e-wasteland** where functional batteries are the only currency and rusted vehicles are the ultimate weapons. Survivors claw over the last scavenged charges and rare-earth scraps, tearing each other apart to hold power. Every machine runs on a **limited charge** — break the enemy commander before you **run dry**.

You are the **Commander** (the King), shielded by infinite-battery infantry (Pawns). Your true firepower lies in seven **Anomalies** — experimental, highly volatile mechs deployed to your back ranks.

Each Anomaly is powered by a strictly finite **10-Point Energy Core**, pre-distributed across three movement engines:
- **Leap (L)** — Knight-style jumps
- **Orthogonal (O)** — Rook-style slides
- **Diagonal (D)** — Bishop-style slides

Every time a piece moves, it permanently burns one point of fuel from that specific engine.

---

# CODEX: GRIDLOCK CHESS

## 1. Core Overview & Setup

* **The Board:** Standard 8x8 grid.
* **The Armies:** Each player commands 16 pieces: 8 Pawns, 1 King, and 7 **Anomalies** (the back-rank pieces).
* **Randomized Placement:** At the start of every match, the King and 7 Anomalies are placed in **random positions** across the back rank (a1–h1 for White). The King can occupy *any* square — there are no placement restrictions (unlike Fischer Random/Chess960).
* **Mirrored Generation:** Black receives an **identical, perfectly mirrored** layout (same positions, same archetypes) to ensure 100% competitive fairness.
* **No Castling:** Castling does not exist in Gridlock Chess. The King moves only 1 square at a time.

## 2. The Anomaly Engine (Vector Movement)

Anomalies do not have infinite movement. Their mobility is dictated by a **10-Point Charge Pool**, permanently divided across three movement vectors. Each vector is identified in-game by **color** and by its fixed slot in the horizontal **battery** shown below the Anomaly (see Section 8) — not by a symbol:

* **L (Leap):** Standard Knight's L-move. Ignores intervening pieces. Color: 🔴 **Coral**.
* **O (Orthogonal):** Standard Rook-style linear move (ranks & files). Cannot jump pieces. Color: 🟢 **Green**.
* **D (Diagonal):** Standard Bishop-style diagonal move. Cannot jump pieces. Color: 🟡 **Yellow**.

## 3. The Archetype System (Generation Rules)

To prevent cognitive overload and provide immediate visual clarity, the 10 points are not purely random. The engine assigns each Anomaly one of the following **Archetypes**, giving it a distinct visual icon and a strict point distribution.

> **Validation Rule:** Every Anomaly's L + O + D **must total exactly 10**. The engine constructs vectors that always sum to 10 by design.

> **Canonical Glyphs & Callsigns:** The **Glyph** and **Callsign** columns mirror the single source of truth in code — the `ARCHETYPE_REGISTRY` in [archetypes.ts](../src/lib/chess/archetypes.ts), where each archetype's board icon and editorial alias are authored once and consumed everywhere (roster, tooltips, the Archetype Guide legend, board glyphs). Any asset set must map 1:1 to these glyphs. *Board rendering* (how a piece is drawn in play) applies a **unified, side-tinted silhouette treatment** described in Section 7 — identical art style for both armies, so the glyph identity stays constant while presentation stays symmetric.

| Glyph | Callsign | Archetype | Charge Distribution (10 Total Points) | Strategic Profile |
| :---: | --- | --- | --- | --- |
| 🏍️ | **Motorbike** | **Absolute Leap** | 10 L, 0 D, 0 O | Pure Knight. Unmatched jump charges but utterly predictable; cannot defend lines. |
| 🏎️ | **Racing Car** | **Absolute Diagonal** | 0 L, 10 D, 0 O | Pure Bishop. Dominates one color complex but blind on straight lines and color-locked. |
| 🚗 | **Car** | **Absolute Orthogonal** | 0 L, 0 D, 10 O | Pure Rook. Endless file/rank pressure but helpless against diagonal and leaping threats. |
| 🚓 | **Police Car** | **High Leap** | 6–8 L *(Remaining split D/O)* | Bypasses pawn structures instantly but struggles to retreat in a straight line. |
| 🚑 | **Ambulance** | **High Diagonal** | 6–8 D *(Remaining split L/O)* | Controls long-range intersecting lines. Easily trapped if engaged orthogonally. |
| 🚒 | **Firetruck** | **High Orthogonal** | 6–8 O *(Remaining split L/D)* | Battering ram for open files. Easily blocked by a single exhausted piece. |
| 🛩️ | **Plane** | **Hybrid Leap/Diag** | 4–5 L, 4–6 D *(0–1 O)* | Highly evasive but completely blind on orthogonal axes. |
| ✈️ | **Airliner** | **Hybrid Leap/Ortho** | 4–5 L, 4–6 O *(0–1 D)* | Breaks through walls to slide sideways into the enemy back rank. |
| 🚀 | **Rocket** | **Hybrid Diag/Ortho** | 4–5 D, 4–6 O *(0–1 L)* | Operates like a traditional Queen. Cannot jump over early-game pawns. |
| 🚁 | **Chopper** | **Balanced** | 4/3/3 in any order | Adapts to any situation but burns through specific directional pools fast. |
| 🤖 | **Mech** | **Omni** | 8 **Shared Pool** *(any L/D/O)* | **🔒 PROMOTION ONLY.** Ultimate flexibility — spend 8 moves across any vector freely. No blind spots, but 20% fewer charges than specialists. The reward for pushing a pawn. |

## 4. The Vector Economy

* **Immediate Deployment:** All Charge Pools are 100% unlocked from Turn 1.
* **Consumption:** Every time an Anomaly moves, it permanently subtracts 1 point from that specific vector's pool. When a vector hits 0, that specific movement type is locked out.

## 5. State of Gridlock

When an Anomaly spends its final movement point across all vectors (L:0, O:0, D:0), it becomes **Gridlocked**.

* **Immobility:** The piece freezes in place permanently.
* **Obstacle:** It remains on the board as a physical barrier. Friendly pieces cannot walk through it (unless using an L-move); enemy pieces cannot walk through it.
* **Vulnerability:** Gridlocked pieces can still be captured and removed from the board by enemy pieces.
* **No Threat:** Gridlocked pieces **cannot give check or threaten any squares**. A piece that cannot move cannot capture.

## 6. The King and Pawns

> **Callsigns:** The King is the **Commander 🦳** and the Pawn is the **Auto Rickshaw 🛺** — see `PIECE_REGISTRY` in [pieces.ts](../src/lib/chess/pieces.ts) for the single source of truth.

* **Pawns (Auto Rickshaw 🛺):** Move exactly like standard chess pawns, including **two-square first move** and **en passant**. Pawns are **exempt from the Vector Economy** (no charge tracking).
* **S-Tier Promotion:** Upon reaching the back rank, a Pawn undergoes **Anomaly Synthesis** and automatically transforms into an **Omni (Mech 🤖)** with a fresh **8-point shared pool**. There is no archetype selection — promotion always yields the ultimate flexible piece. This is the only way to obtain an Omni during a game.
* **The King (Commander 🦳):** Moves exactly 1 square in any direction. **Exempt from the Vector Economy.** Standard Check and Checkmate rules apply.

### 6.1 Override (Anomaly Boarding)

A high-stakes endgame mechanic that lets the King trade its safety for mobility — a deliberate gamble with a visible countdown clock.

* **The Action:** On its turn, the King may move onto a square occupied by a **friendly Anomaly**, immediately ending the turn. The two pieces **merge permanently** into a single **Piloted Anomaly**. The King can **never dismount** — there is no eject, no reversal. Boarding is a one-way commitment.
* **The Movement:** The King **completely loses** its standard 1-square move. The Piloted Anomaly now moves **exactly like its host Anomaly**, burning **exactly 1 charge per move** from the host's pool (L, O, or D depending on the move type).
* **The Identity Rule — the Piloted Anomaly *is* the King:** It is still the royal piece in every way that matters. It **can be put in check**, it **must respond to check**, and it **may not move onto a threatened square** (it would be captured). All King-safety rules carry over unchanged — only the *method of relocation* is swapped from "1 square" to "the host's vectors."
* **The Checkmate:** If the Piloted Anomaly is captured — or checkmated under the rules above — the game is **lost**, identical to losing a bare King.
* **The Gridlock Death:** If the Piloted Anomaly spends its **absolute last charge** (L:0, O:0, D:0), the King is permanently sealed inside a **Gridlocked bunker** — an immobile royal piece with zero legal moves. The game is **instantly lost**. This lethality is the entire balancing force: it is *why* you cannot mindlessly board a fresh, deep-pool Anomaly early — every charge is a tick on your own doom clock.
* **The Mech Exception:** The King **cannot Override onto a Mech (Omni)**. In-world, a Mech self-pilots — a relic of the old world's machine mind, already crewed by the pawn that synthesized it, with no seat for a Commander. Mechanically, its shared 8-point pool would make a piloted King far too survivable and flexible, so the promotion reward stays a pure-piece reward — never royal.
* **The Gridlock Exception:** The King **cannot Override onto a Gridlocked Anomaly** (0 charges). A Gridlocked host has no legal moves, so boarding it would be instant Gridlock Death — the move is simply never offered as legal.

> **Design intent:** Override exists to break the *King vs King* drawn endgame. When all Anomalies have gridlocked and the board would otherwise stalemate into a shuffle, Override gives a trailing player a way to *create* aggression — riding a depleting Anomaly into the enemy camp. Whether that ride ends in a brilliant attack or a self-inflicted gridlock death is entirely the pilot's judgment. There is **no opponent counter-verb** by design: the counterplay is positional pressure — forcing the pilot to burn charges they cannot spare. Adding a hard counter would turn a one-time, life-or-death commitment into risk-free hide-and-seek, destroying the tension that makes the mechanic work.

#### 6.1.1 Bot Behavior vs a Piloted Anomaly — verified 2026-06

The AI opponent (Fairy-Stockfish + an our-rules re-ranking layer) was tested against a human's Piloted Anomaly king on the real engine binary. Findings recorded here for future reference:

* **Our rules are fully accurate.** A Piloted Anomaly's movement, captures, check detection, and checkmate are all resolved by our own engine (`check.ts` / `movement.ts`), which understands the host's real vector reach. It is treated as the royal piece in every King-safety calculation — confirmed correct in live tests.
* **The bot hunts the piloted king.** When the opponent has a Piloted Anomaly, the bot re-ranks its candidate moves by **real mate > real check > capture > safe square**, so checkmating the piloted king is its top priority, above winning material. (It pursues *checkmate*, not a literal capture — exactly like a normal king.)
* **The bot never boards its own Anomaly.** Override is a one-way human-only decision; the bot strips all Override moves from its options.
* **The bot respects the king's true power.** Because our rules know a piloted rook/queen/etc. covers whole files/ranks, the bot will not step into squares the piloted king actually attacks — it is not fooled into treating it as a weak 1-square king.
* **Known limitation (not a bug):** Fairy-Stockfish **cannot model the depleting charge pool or Gridlock Death**. The engine sees the piloted anomaly as the correct royal piece type for its current vector set (royal queen, royal knight, etc., via the `gridlock-royal` variant in `variants.ini`), so it does not misjudge its *movement shape* — but it cannot see charges ticking down, and it cannot see Gridlock Death coming in deep forced lines. Our re-ranking corrects for depletion on every ply; it does not run a full deep search. So against a *cornered* piloted king the bot plays safe-but-not-sharp — it will not blunder into phantom mates, but it also will not find a deep forced win that the engine never surfaced. This surfaces only in rare endgame-style positions, not normal play.
* **Why not delegate full royalty to the engine?** Fairy-Stockfish *can* express a royal slider (`extinctionPseudoRoyal = true`), but its movement would be a **fixed** Betza string — it cannot model charge depletion, so it would over-estimate the king once any vector empties, and it cannot represent Gridlock Death at all. Native-only royalty would swap one blind spot for a worse one. The genuine path to higher strength is a small **our-rules search**, since only our code understands the depleting pool.


## 7. Digital UI / UX Mechanics

* **Unified Glyph Set, Side Filter:** The board renders a single, fixed piece style — there is **no style toggle**. Every piece uses its registry **emoji glyph** drawn inside an SVG (`PieceGlyph`): King (Commander 🦳, worn under a 👑 crown that marks royalty), Pawn (Auto Rickshaw 🛺), and all 11 Anomaly archetypes (🏍️🏎️🚗🚓🚑🚒🛩️✈️🚀🚁🤖). The two sides are told apart by a **per-side filter**: **White renders the emoji unfiltered (its true full color); Black renders it in grayscale** (`grayscale(1) brightness(0.62) contrast(1.15)`), so the black army reads as a darker, desaturated set. Both armies share the same glyph identity and the same base size — only the side filter differs.
* **Glyph ↔ Render Relationship:** The canonical Archetype glyphs in Section 3 define *identity* (used in the roster, tooltips, and Archetype Guide). The live board renders the **same emoji**, applying only the per-side filter above — identity is preserved while the two armies stay visually distinct (full color vs grayscale).
* **No Token Disc:** Pieces stand directly on the square — there is **no disc or ring** behind them. A soft ambient drop-shadow (`drop-shadow(0 1.5px 1.5px …)`) grounds every glyph so both armies read as one consistent set. (Only the *captured-pieces* trays use circular tokens — see 7.2.)
* **Visual Board Overlays:** Selecting (clicking/tapping) an Anomaly projects its valid legal moves onto the board as dots color-coded by vector — L = coral, O = green, D = yellow (cyan for King/Pawn moves).
* **Vector Battery:** Each Anomaly shows its three vector charges as a single horizontal **battery** pinned to the square's **bottom-center**, with cells ordered **O · D · L** left-to-right (see Section 8).
* **Last-Move Highlight:** The most recent move tints both its origin and destination squares. For an **Anomaly** move the tint is the **vector color** used (L = coral, O = green, D = yellow); for a **Pawn or King** move it is **violet**.
* **Gridlock Indicator:** When an Anomaly reaches Gridlock (all vectors exhausted), it turns **grayscale with reduced opacity** (`grayscale opacity-50`) and its battery cells dim to gridlock-gray. There is no progressive decay — the change is binary. (No separate lock icon is drawn.)
* **Piloted Anomaly (Override marker):** When the King Overrides into an Anomaly (§6.1), the 👑 crown **passes** from the King to that Anomaly, which also gains a glowing **life-clock ring**. The ring color escalates as the piloted piece's combined charge total (L+O+D — the King's remaining "moves until death") ticks down: calm gold when healthy, then amber (3 left), orange (2), and a flashing red (≤1). The remaining count itself is read from the piece's vector battery.

### 7.1 Layout Structure

The game screen follows a **three-column layout**:

* **Left Panel (Status):** Turn / status indicator, the clock (when a time control is active), captured pieces trays ("You took" / "Opponent took"), and Move History.
* **Center:** The 8×8 board with all interactive elements (plus the two Player Cards).
* **Right Panel (Controls):** Opponent selector, Clock selector, Flip Board, Resign, New Game, Tutorial-Mode toggle, the contextual **Coach** rail, the **Protocol: Run Dry** panel, the **Vector Battery legend**, and the **Archetype Guide**.

### 7.2 Captured Pieces Display

Captured pieces are shown in two trays:
* **"You took"** — pieces captured by the current player (White when vs bot)
* **"Opponent took"** — pieces captured by the opponent

Each captured piece is rendered as a small circular token with **contrasting backgrounds** — white pieces on dark circles, black pieces on light circles — matching the board display style.

Every token is also an accessible trigger for a **portaled tooltip** (shown on hover *and* keyboard focus, with a screen-reader `aria-label` fallback). The tooltip names the piece by its **alias** (plus the formal archetype name), and for an Anomaly it shows the piece's **charge state at the moment of capture** — the same **O · D · L** battery used on the board (or `◇ N` shared charges for an Omni). Charges are shown *as captured*, not the piece's original roll, so the tooltip reads "how drained it was when it died."

### 7.3 Move History Panel

A scrollable log below the captured pieces displays every move with:

| Column | Content |
| --- | --- |
| **#** | Move number |
| **Piece** | Piece **name** as text — `King`, `Pawn`, or the archetype's callsign (e.g. `Motorbike`, `Police Car`), tinted by side (lighter for White, dimmer for Black) |
| **Move** | Coordinates in `from→to` format (`→` for a quiet move, `×` for a capture, e.g. `e2→e4`, `f3×e5`) |
| **Cost** | Vector letter + **charges remaining after the spend** (e.g. `L3`, `O5`, `D2`) in vector-colored text |

* Check (`+`) and checkmate (`#`) symbols are appended to the Move cell.
* Clicking a row seeks the board to that ply; a ⏮ ◀ ▶ ⏭ scrubber steps through per-ply snapshots, and a `{ } JSON` / `📋 Copy` / `⬆ Import Replay (JSON)` control set exports or loads a portable replay.

### 7.4 Play Modes (Opponent Selection)

The opponent dropdown offers four categories of play:

| Mode | Icon | Description |
| --- | --- | --- |
| **Offline PvP** | 👥 | Pass-and-play on a single device. Both players share the screen. |
| **Uplink (Online PvP)** | 🛰 | Real-time match over WebSocket. One player hosts, the other joins via passcode. |
| **Protocol: Run Dry** | 🪫 | Single-player ladder. Beat the bot to climb 9 tiers. Progress persists via localStorage. |
| **Bot (1–8)** | � | Fixed-difficulty bot. Choose any of the 8 ELO tiers directly. |

#### 7.4.1 Offline PvP (Pass-and-Play)

Local two-player mode on a single device. Players take turns on the same screen — no network required. The board can be flipped between moves for comfort.

#### 7.4.2 Uplink (Online PvP)

Real-time multiplayer over WebSocket relay:

* **Host** creates a room and receives a **5-character passcode** (crypto-random, drawn from an unambiguous alphabet with no `0/O/1/I`).
* **Host picks the clock** before opening the room — any of the standard time controls (or **No clock**). The chosen control travels with the match; a joining guest **adopts the host's clock** automatically.
* **Guest** enters the passcode to join.
* The host's client generates the board and is **authoritative** — the guest syncs to the host's state.
* Moves are relayed instantly; disconnects are detected and surfaced.
* No accounts, no matchmaking — just share the code.

#### 7.4.3 Protocol: Run Dry (Ladder Mode)

A structured single-player progression system:

* **9 tiers.** The first 8 mirror the bot difficulty levels (Beginner → Grandmaster); the 9th, **Artificial Suffer Intelligence (ASI)**, is a Run Dry-exclusive final boss that keeps Skill maxed and instead maxes the engine's search budget. It never appears in the direct bot dropdown.
* **Win to advance.** Beat the current tier's bot to unlock the next.
* **No regression.** Losing or drawing keeps you at the current tier — you never drop down.
* **Completion reward.** Beating the final tier shows a completion celebration, then resets the ladder to Tier 1 for a new run and preserves your **best streak**.
* **Persistent progress.** Tier and best streak are saved to `localStorage` (`gridlock:run-dry:v1`).

Each tier carries a cyberpunk **callsign** (shown in the UI) alongside its difficulty name (from `RUN_DRY_TIER_LABELS` in [useProtocolRunDry.ts](../src/hooks/useProtocolRunDry.ts)):

| Tier | Callsign | Bot | ~ELO |
| --- | --- | --- | --- |
| 1 | Cybored | Beginner | ~400 |
| 2 | Dee G. Tal | Novice | ~800 |
| 3 | R_Key_Tech | Casual | ~1100 |
| 4 | AlgoRhythm | Club | ~1400 |
| 5 | EraDictator | Skilled | ~1700 |
| 6 | Quantomb | Expert | ~2000 |
| 7 | 51n6ul@r1ty | Master | ~2400 |
| 8 | V,0,1,D | Grandmaster | ~2800 |
| 9 | OM3GA | Artificial Suffer Intelligence | ~2800 · endurance |

#### 7.4.4 Bot System (8-Level Difficulty)

When playing against Fairy-Stockfish (either via Protocol: Run Dry or direct bot selection), the engine uses **8 difficulty tiers**:

| Level | Label | Skill | Depth | ~ELO | Target Player |
| --- | --- | --- | --- | --- | --- |
| 1 | Beginner | 0 | 1 | ~400 | First-time players |
| 2 | Novice | 2 | 3 | ~800 | Learning rules |
| 3 | Casual | 5 | 5 | ~1100 | Playing for fun |
| 4 | Club | 8 | 8 | ~1400 | Regular player |
| 5 | Skilled | 12 | 12 | ~1700 | Serious hobbyist |
| 6 | Expert | 15 | 15 | ~2000 | Tournament level |
| 7 | Master | 18 | 18 | ~2400 | Strong player |
| 8 | Grandmaster | 20 | 20 | ~2800+ | Maximum strength |

* **Skill Level** (Stockfish 0–20) controls the blunder rate; **Depth** controls search thoroughness.
* ELO is displayed in the dropdown so players know exactly what they're facing.
* **Bot Thinking Delay:** A natural **1.2–2.0s thinking pause** is applied (calculation runs in parallel) so moves feel deliberate rather than instant.

### 7.5 Board Generation (Balanced)

Every game deals a single kind of army — **Balanced** — produced by a dynamic-programming
**uniform sampler** (`balancedArmy.ts`), **not** rejection sampling, so it never falls back to
an invalid army. An army's three vector totals are **exactly a permutation of {24, 23, 23}**
across Orthogonal / Diagonal / Leap — the closest to even that 70 charges over 3 vectors can
get — pinning the *aggregate* charge budget per vector every game. Two structural rules also
hold:

* **At most 2 Absolute pieces** (single-vector archetypes), so the board never collapses to a
  single direction. Individual pieces may still be lopsided — up to 2 Absolutes are allowed.
* **At most 2 copies of any one archetype** (no monotonous 7-of-a-kind armies).

(The old "each vector ≥ 8" curation rule is now automatic, since every vector total is 23 or
24.) There are **743,855,490** such armies. Across the 8 king files that is **5,950,843,920**
raw placements; the opposite-color bishop-pair placement rule then removes the **326,160**
same-color double-`absDiag` boards, leaving **5,950,517,760** distinct starting positions.

### 7.6 Onboarding & Tutorial Mode

First-time players are eased into Gridlock Chess's unfamiliar mechanics through three layered, **non-blocking** systems. None of them gate play; all can be ignored or dismissed, and the board is never occluded.

* **Welcome Modal (first run):** A three-card "Quick Start" carousel shown once on first visit (persisted via `localStorage` key `gridlock:welcome-seen:v1`). The cards cover the three core ideas — pieces that tire, the three-vector / 10-charge split, and Gridlock / how to win — with keyboard navigation (←/→ to move, Esc to close) and progress dots. It is **reopenable any time** via the **Quick Start** link in the site footer (and any in-page link that points to the Quick Start anchor).
* **Tutorial Mode (default ON):** A persisted toggle (`gridlock:tutorial-mode:v1`) in the right-hand panel that gates the contextual Coach rail. It **defaults ON** so newcomers get help on a game with no transferable chess intuition; the choice is remembered and is **one click to disable**. Because the rail never covers the board, leaving it on costs experienced players nothing.
* **Coach Rail (contextual):** A non-blocking side-panel card (`CoachPanel`) that surfaces the **single most relevant rule for the current board state**, updating as the player acts — e.g. selecting an Anomaly explains its archetype; selecting a Pawn explains its movement and promotion; a Pawn one step from the back rank previews the **Omni** reward *before* the push; a King beside a friendly Omni explains why it **cannot Override** one; spending charges explains the cost; a frozen piece explains Gridlock. It replaces the earlier occluding popup coachmarks, so players keep full board vision while learning.

## 8. Vector Battery (Stat Layout)

Each Anomaly displays its three vector charge counts in a single horizontal **battery** pinned to the **bottom-center** of its square — three solid color cells butted together, each showing that vector's remaining charge in black. Fixed position plus color carries identity; a native tooltip names the full vector on hover.

| Cell (left → right) | Vector | Symbol | Color Code |
| --- | --- | :---: | --- |
| **1st** | **O** (Orthogonal) | **+** | 🟢 Green (`#34d399`) |
| **2nd** | **D** (Diagonal) | **✕** | 🟡 Amber (`#fbbf24`) |
| **3rd** | **L** (Leap) | **L** | 🔴 Coral (`#ff8f87`) |

* **Consistency Rule:** The left→right **O · D · L** order never changes, and it matches the Rules vector table and the live demos, so it is learned once.
* **Zero State:** When a vector hits `0`, its cell dims to gridlock-gray with dimmed text, signaling that movement type is locked out.
* **Gridlock State:** When all three cells read `0`, the entire piece turns grayscale at reduced opacity (see Section 5).
* **Omni:** An Omni's single shared pool is shown in the same battery with all three cells reading the same number (e.g. `8·8·8 → 7·7·7`), since any move drains the shared pool together.

## 9. Game End Conditions

* **Checkmate:** The King is in check and has no legal escape. **Result: Win.**
* **Stalemate:** The player to move has no legal moves (including King moves) but is not in check. **Result: Draw.**
* **Override Capture:** If a player's **Piloted Anomaly** (see Section 6.1) is captured or checkmated, that player **loses** — it is the King. **Result: Win for the captor.**
* **Override Gridlock Death:** If a player's Piloted Anomaly spends its last charge (L:0, O:0, D:0), the King is sealed in a Gridlocked bunker and the game **instantly ends**. **Result: Loss for the pilot.**
* **Resignation / Mutual Agreement:** A player may resign, or players may mutually agree to a draw at any time.
* **Threefold Repetition:** If the exact same board state (including available charge pools and en passant rights) occurs three times, the game immediately ends. **Result: Draw.** Folding charges and en passant into the "state" is deliberate — a board that *looks* repeated but was reached by spending vectors is a genuinely new position, so this rule only fires when nothing irreversible has changed (most importantly, a bare King shuffling between two squares).
* **Total Gridlock (Sudden Termination):** The classic 50-move rule is **superseded** by the Total Gridlock condition whenever Anomalies are still on the board. If a board state is reached where neither player has any legal Anomaly moves, neither player has any legal Pawn moves, and neither King can force a checkmate, the engine immediately terminates the match. **Result: Draw.** This respects the Vector Economy: instead of forcing players to mindlessly shuffle Kings for 50 turns to claim a draw, the engine detects the mathematically paralyzed board and ends it at once.
  * *Implementation note:* "no legal Anomaly moves" is enforced as **every surviving Anomaly being Gridlocked** (0 charges → permanently immobile). Pawn mobility is tested on a king-removed copy of the board — since a King can never be captured, removing both Kings can only *reveal* latent pawn moves (e.g. a pawn a King is currently blocking), never hide a real one. If even that relaxed board yields zero pawn moves, no King relocation can ever un-freeze the position; with Gridlocked Anomalies unable to give check, no checkmate can be forced, so the result is a draw.
* **Fifty-Move Rule (King-and-Pawn endgame):** If **50 full moves (100 half-moves)** pass with **no Pawn move, no capture, and no charge spent**, the game ends. **Result: Draw.** Spending a charge is irreversible progress, so this counter is reset by any Anomaly move — meaning it only ever advances in the rare endgame where **both sides have lost all their Anomalies** and only Kings and Pawns remain. There, the Vector Economy no longer governs progress, so the standard chess fifty-move rule is the correct anti-shuffling backstop (Total Gridlock cannot fire while Pawns can still move). The two rules are complementary: Total Gridlock ends *frozen* positions instantly; the fifty-move rule ends *aimless* King-and-Pawn shuffles.