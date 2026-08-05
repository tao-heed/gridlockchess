# Gridlock Chess — Emoji Docs

**Part 1 — Bot Emoji Expression** is the active implementation plan (below).
**Part 2 — Piece-Set Comparison** (further down) is **reference only** — that piece-art selector was built then reverted.

---

# 🤖 Part 1 — Bot Emoji Expression (Implementation Plan)

> ✅ **BOT ONLY — confirmed.** This feature is exclusively for the **computer opponent (the bot)**. It
> does **NOT** apply to the human player, is **NOT** attached to the King or any board piece, and is
> **NOT** a player-selectable customization. The human never picks or shows an emoji — only the **bot**
> expresses moods, and only in **single-player (vs-bot)** games.

## Scope & goal
Give the bot a lightweight personality: its **player-card avatar** shows a live mood that reacts to the
game. This adds life to single-player — the only mode with a real audience (you). **Online PvP is not
involved** (it isn't functional in the shipped build — `uplinkUrl()` falls back to a non-existent server).
**Pass-and-play is not involved** (no bot there).

## Where — the bot's avatar becomes its face
- Surface: the **bot's PlayerCard** (top card) — `src/components/game/PlayerCard.tsx`.
- The bot's avatar circle (currently shows its initial) instead shows the **live mood emoji**. The human
  keeps their initial. Off the board (no clutter), readable, and exactly where you look to see the opponent.
- NOT on the King glyph: too small, crown-covered, and it vanishes when the King is piloted.

## Which — the mood palette (respectful; never mocks)
| Bot state | Emoji | Code |
|-----------|:-----:|------|
| Thinking (computing its move) | 🤔 | U+1F914 |
| Resting / neutral | 🙂 | U+1F642 |
| You made a strong / surprising move | 😮 → 🤩 | U+1F62E → U+1F929 |
| Bot in check / just lost material | 😅 | U+1F605 |
| Game over — **you win** | 🫡 / 🥲 | U+1FAE1 / U+1F972 |
| Game over — **bot wins** | 🙂 / 🤝 | U+1F642 / U+1F91D |
| Draw | 🤝 | U+1F91D |

**Excluded for the bot:** 😎 (smug when ahead) and 😂 (mocking). The bot admires *your* good moves and
sweats its *own* trouble — it never aims a negative or smug face at the player.

## Guardrails
- **Never mock the player.** When the bot WINS it stays humble (🙂 / 🤝) — never gloats.
- The bot reacts to **its own adversity** (check, losing material) and to **your good moves** (admiration) —
  never to your blunders.

## How often — event-driven, ~once per move, never flickers
- **Event-driven, not timer-driven** — no random flicker (that's what made the reverted feature feel glitchy).
- **At most one change per ply** → naturally about once per turn.
- **Minimum dwell** — a reaction holds ~2–3s, then settles back to the resting face.
- **Resting state** is 🙂 (or 🤔 while the bot is thinking).

## Phases
- **Phase 1 (baseline):** triggers from observable facts only — thinking, bot-in-check, bot piece captured,
  game-over outcome; else resting. No engine evaluation needed. Safe + cheap.
- **Phase 2 (optional):** the 😮 / 🤩 "impressed by your move" reaction, driven by the engine's evaluation
  swing — mapped so it praises your good moves and **never** reacts smugly to your mistakes.

## Rendering — native emoji (no lag)
Uses the **device's own emoji** via a normal text glyph — it just swaps the character. **No bundled SVG
`<image>`** (that caused the lag/glitch in the reverted piece-art feature). Zero performance cost.

## Open items to verify before building
- Confirm which signals `src/components/game/LocalGame.tsx` exposes (`inCheck`, captures, `botThinking`,
  game-over reason) — NOT re-verified yet.
- Bump the avatar emoji to a comfortable size (the current initial is `text-xs`).
- Confirm the bot card is unambiguously the top / opponent card.

---

# Part 2 — Piece-Set Comparison (REFERENCE ONLY)

> ⚠️ The piece-art / emoji-set selector below was built then **REVERTED** (bundled SVGs rendered too small
> and lagged on-device). Kept for reference. **The bot plan above uses device emoji**, so none of these
> bundled sets are involved.

A side-by-side of every emoji used **as a piece** on the board, rendered in different **open** emoji sets
so you can see how the *same* Unicode character looks across styles.

**Columns**
- **Alias** — the in-game name.
- **Emoji** — the raw Unicode character. Renders in **your current device/app font** (Windows/Chrome on the laptop, Samsung/Google on Android), so it changes depending on where you open this file.
- **Twemoji** — X/Twitter's set (CC-BY 4.0).
- **Noto Emoji** — Google's set (Apache/OFL) — closest to what many Androids show.
- **OpenMoji** — the OpenMoji project (CC-BY-SA 4.0) — clean, distinctive outline style.
- **Fluent Emoji** — Microsoft's set (MIT) — modern, colorful.

> ⚠️ The image columns load from the internet, all via **jsDelivr** (Twemoji `jdecked/twemoji`,
> Noto `googlefonts/noto-emoji`, OpenMoji `hfg-gmuend/openmoji`, Fluent `microsoft/fluentui-emoji`).
> They are blank offline. **All four sets are open-licensed** and safe to bundle (with attribution).

---

## King & Pawn

| Alias | Emoji | Twemoji | Noto Emoji | OpenMoji | Fluent Emoji |
|-------|:-----:|:-------:|:----------:|:--------:|:------------:|
| King (Commander) — body | 🦳 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f9b3.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f9b3.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F9B3.svg" width="32" alt="openmoji"> | — |
| Crown (royal marker) | 👑 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f451.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f451.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F451.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Crown/Color/crown_color.svg" width="32" alt="fluent"> |
| Auto Rickshaw (Pawn) | 🛺 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f6fa.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f6fa.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F6FA.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Auto%20rickshaw/Color/auto_rickshaw_color.svg" width="32" alt="fluent"> |

## Anomalies (11 archetypes)

| Alias | Emoji | Twemoji | Noto Emoji | OpenMoji | Fluent Emoji |
|-------|:-----:|:-------:|:----------:|:--------:|:------------:|
| Motorbike | 🏍️ | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f3cd.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f3cd.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F3CD.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Motorcycle/Color/motorcycle_color.svg" width="32" alt="fluent"> |
| Racing Car | 🏎️ | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f3ce.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f3ce.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F3CE.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Racing%20car/Color/racing_car_color.svg" width="32" alt="fluent"> |
| Car | 🚗 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f697.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f697.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F697.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Automobile/Color/automobile_color.svg" width="32" alt="fluent"> |
| Police Car | 🚓 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f693.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f693.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F693.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Police%20car/Color/police_car_color.svg" width="32" alt="fluent"> |
| Ambulance | 🚑 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f691.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f691.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F691.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Ambulance/Color/ambulance_color.svg" width="32" alt="fluent"> |
| Firetruck | 🚒 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f692.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f692.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F692.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Fire%20engine/Color/fire_engine_color.svg" width="32" alt="fluent"> |
| Plane | 🛩️ | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f6e9.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f6e9.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F6E9.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Small%20airplane/Color/small_airplane_color.svg" width="32" alt="fluent"> |
| Airliner | ✈️ | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/2708.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u2708.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/2708.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Airplane/Color/airplane_color.svg" width="32" alt="fluent"> |
| Rocket | 🚀 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f680.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f680.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F680.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Rocket/Color/rocket_color.svg" width="32" alt="fluent"> |
| Chopper | 🚁 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f681.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f681.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F681.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Helicopter/Color/helicopter_color.svg" width="32" alt="fluent"> |
| Mech (promotion only) | 🤖 | <img src="https://cdn.jsdelivr.net/gh/jdecked/twemoji/assets/svg/1f916.svg" width="32" alt="twemoji"> | <img src="https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f916.svg" width="32" alt="noto"> | <img src="https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji/color/svg/1F916.svg" width="32" alt="openmoji"> | <img src="https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji/assets/Robot/Color/robot_color.svg" width="32" alt="fluent"> |

> Note: **Fluent has no 🦳 (white hair)** — it's a component emoji Microsoft doesn't ship, so that cell is "—".

---

## Code-point & filename reference

| Alias | Emoji | Unicode | Twemoji / Noto (lower) | OpenMoji (UPPER) | Fluent folder |
|-------|:-----:|---------|------------------------|------------------|---------------|
| King body | 🦳 | U+1F9B3 | `1f9b3` | `1F9B3` | — |
| Crown | 👑 | U+1F451 | `1f451` | `1F451` | `Crown` |
| Auto Rickshaw | 🛺 | U+1F6FA | `1f6fa` | `1F6FA` | `Auto rickshaw` |
| Motorbike | 🏍️ | U+1F3CD U+FE0F | `1f3cd` | `1F3CD` | `Motorcycle` |
| Racing Car | 🏎️ | U+1F3CE U+FE0F | `1f3ce` | `1F3CE` | `Racing car` |
| Car | 🚗 | U+1F697 | `1f697` | `1F697` | `Automobile` |
| Police Car | 🚓 | U+1F693 | `1f693` | `1F693` | `Police car` |
| Ambulance | 🚑 | U+1F691 | `1f691` | `1F691` | `Ambulance` |
| Firetruck | 🚒 | U+1F692 | `1f692` | `1F692` | `Fire engine` |
| Plane | 🛩️ | U+1F6E9 U+FE0F | `1f6e9` | `1F6E9` | `Small airplane` |
| Airliner | ✈️ | U+2708 U+FE0F | `2708` | `2708` | `Airplane` |
| Rocket | 🚀 | U+1F680 | `1f680` | `1F680` | `Rocket` |
| Chopper | 🚁 | U+1F681 | `1f681` | `1F681` | `Helicopter` |
| Mech | 🤖 | U+1F916 | `1f916` | `1F916` | `Robot` |

> Filename conventions differ per set: **Twemoji/OpenMoji drop the `U+FE0F`** (base code point only; OpenMoji is
> UPPERCASE). **Noto** uses `emoji_u{base}.svg`. **Fluent** is name-based: `assets/{Folder}/Color/{snake_name}_color.svg`.

## Legend / UI emoji (not pieces)

For completeness — these appear in the app but are **not** board pieces:

| Use | Emoji | Unicode |
|-----|:-----:|---------|
| Charge battery (Total Charge, Quick Start) | 🔋 | U+1F50B |
| Charge legend — Orthogonal | ♜ | U+265C |
| Charge legend — Diagonal | ♝ | U+265D |
| Charge legend — Leap | ♞ | U+265E |
