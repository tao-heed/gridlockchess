# Architecture

High-level map of Gridlock Chess. For deep dives on specific systems, see the linked docs in [`docs/dev/`](docs/dev/).

## System overview

```mermaid
graph TB
    subgraph Browser
        UI[React UI<br/>Vite + Tailwind + Framer Motion]
        GS[Game State<br/>useGameState + hooks]
        CL[Chess Logic<br/>move gen · outcome · charges]
        BOT[Bot AI<br/>heuristic + charge-aware search]
        ENG_CLIENT[Engine Client<br/>engine.ts]
        FB[Firebase Client<br/>net/firebase.ts]
    end

    subgraph Server["Engine Proxy (server.js)"]
        PROXY[HTTP API<br/>POST /api/evaluate<br/>GET /api/status]
        FSF[Fairy-Stockfish<br/>native binary + variants.ini]
    end

    subgraph Firebase["Firebase RTDB"]
        ROOMS[Game Rooms<br/>room codes + Quick Match]
    end

    subgraph Android["Android APK (Capacitor)"]
        CAP_ENGINE[Native Engine Plugin<br/>ARM64 FSF binary]
    end

    UI --> GS
    GS --> CL
    GS --> BOT
    BOT --> CL
    BOT --> ENG_CLIENT
    ENG_CLIENT -->|HTTP| PROXY
    PROXY --> FSF
    GS -->|Uplink| FB
    FB -->|realtime sync| ROOMS
    UI -.->|installed app| CAP_ENGINE
    CAP_ENGINE --> FSF
```

## Game state flow

```mermaid
flowchart LR
    INPUT[Player Move<br/>or Bot Move] --> VALIDATE[Move Validation<br/>generator.ts]
    VALIDATE --> APPLY[Apply Move<br/>update board + spend charge]
    APPLY --> DEPLETION{Charge<br/>depleted?}
    DEPLETION -->|yes| MORPH[Movement Profile Changes<br/>lost axis removed]
    DEPLETION -->|no| OUTCOME
    MORPH --> GRIDLOCK{All charges<br/>zero?}
    GRIDLOCK -->|yes| STONE[Become Stone<br/>immovable + uncapturable]
    GRIDLOCK -->|no| OUTCOME
    STONE --> DEATH{King<br/>piloting?}
    DEATH -->|yes| LOSS[Gridlock-Death<br/>instant loss]
    DEATH -->|no| OUTCOME[Check Outcome<br/>outcome.ts]
    OUTCOME --> NEXT[Next Turn]
```

## Bot AI pipeline

The bot has two paths: a fast **heuristic fallback** (no engine needed) and the **engine path** (calls Fairy-Stockfish for deep search, then overlays charge-aware corrections).

```mermaid
flowchart TD
    TURN[Bot's Turn] --> ENGINE_UP{Engine<br/>available?}
    ENGINE_UP -->|no| HEURISTIC[Heuristic Fallback<br/>random / safe captures]
    ENGINE_UP -->|yes| FUEL{Fuel-aware<br/>tier?}
    FUEL -->|yes| FSF_FUEL[Call FSF with fuel<br/>charge state sent via<br/>UCI fuel command]
    FUEL -->|no| FSF_PLAIN[Call FSF without fuel<br/>battery-blind search]
    FSF_FUEL --> CANDIDATES[Ranked Candidates<br/>multi-PV moves + scores]
    FSF_PLAIN --> CANDIDATES
    CANDIDATES --> OVERLAY[Charge-Aware Overlay<br/>search.ts]
    OVERLAY --> CORRECTIONS[Re-rank moves<br/>penalize depletion traps<br/>value charge preservation]
    CORRECTIONS --> PICK[Pick Move<br/>skill-scaled noise]
    HEURISTIC --> PICK
```

## Component tree (game screen)

```mermaid
graph TD
    APP[App] --> WP[WelcomeProvider<br/>renders WelcomeModal]
    WP --> ROUTER[BrowserRouter + Routes]
    ROUTER --> LG[LocalGame]

    LG --> BOARD[Board<br/>+ Square + Piece + DnD]
    LG --> PANELS[PanelDeck]
    LG --> MODALS[GameModals]

    PANELS --> MOVE_HIST[MoveHistoryPanel]
    PANELS --> CAPTURED[CapturedPiecesPanel]
    PANELS --> CLOCK[ClockPanel]
    PANELS --> COACH[CoachPanel]
    PANELS --> PLAY_SET[PlaySettings<br/>opponent + time control]
    PANELS --> VECTOR[VectorLegend]
    PANELS --> ARCHETYPE[ArchetypeGuide]

    MODALS --> END_MODAL[GameEndModal]
    MODALS --> CONFIRM[ConfirmModal]
    MODALS --> RUN_DRY[ProtocolRunDryModal]
    MODALS --> UPLINK[UplinkModal]
```

## Engine communication

### Development (Windows/Linux/macOS)

```mermaid
sequenceDiagram
    participant UI as React App
    participant ENG as engine.ts
    participant SRV as server.js
    participant FSF as Fairy-Stockfish

    UI->>ENG: evaluatePosition(fen, options)
    ENG->>SRV: POST /api/evaluate
    SRV->>FSF: UCI: position fen ...<br/>UCI: go depth N
    Note over SRV,FSF: fuel command sent<br/>for fuel-aware tiers
    FSF-->>SRV: bestmove + info lines
    SRV-->>ENG: { moves: [{move, score}] }
    ENG-->>UI: candidate moves
```

### Android APK (installed app)

```mermaid
sequenceDiagram
    participant UI as React App
    participant NE as nativeEngine.ts
    participant CAP as Capacitor Plugin
    participant FSF as FSF ARM64

    UI->>NE: requestMove(fen, config)
    NE->>CAP: plugin.evaluate(...)
    CAP->>FSF: UCI over stdin/stdout
    FSF-->>CAP: bestmove + info
    CAP-->>NE: result
    NE-->>UI: candidate moves
```

## Online PvP (Uplink) protocol

```mermaid
sequenceDiagram
    participant P1 as Player 1 (Host)
    participant FB as Firebase RTDB
    participant P2 as Player 2 (Guest)

    P1->>FB: Create room (code + seat + onDisconnect)
    P2->>FB: Join room (claim seat)
    FB-->>P1: Guest joined (realtime listener)

    loop Game turns
        P1->>FB: Write move to /moves
        FB-->>P2: Move received (realtime)
        P2->>FB: Write move to /moves
        FB-->>P1: Move received (realtime)
    end

    Note over P1,P2: onDisconnect sets<br/>connected=false on seat<br/>→ opponent-left detection
```

## Key directories → docs/dev/ map

| Area | Source | Design doc |
|------|--------|------------|
| Bot AI + charge awareness | `src/lib/chess/bot.ts`, `search.ts` | [`BotDepletionAwareness.md`](docs/dev/BotDepletionAwareness.md) |
| Bot difficulty (25 levels) | `src/lib/chess/bot.ts` | [`BotLevelParameters.md`](docs/dev/BotLevelParameters.md) |
| Engine fuel modification | `server.js`, `variants.ini` | [`FairyStockfishFuelMod.md`](docs/dev/FairyStockfishFuelMod.md) |
| Native ARM64 build | `android/` | [`NativeEngineBuildGuide.md`](docs/dev/NativeEngineBuildGuide.md) |
| Online PvP (Firebase) | `src/lib/net/` | [`OnlineMultiplayerPlan.md`](docs/dev/OnlineMultiplayerPlan.md) |
| Piloted Anomaly (Override) | `src/lib/chess/bot.ts` | [`PilotedRoyalFix.md`](docs/dev/PilotedRoyalFix.md), [`BotOverrideAwareness.md`](docs/dev/BotOverrideAwareness.md) |
| Android packaging | `android/`, `capacitor.config.ts` | [`AppStorePackagingPlan.md`](docs/dev/AppStorePackagingPlan.md) |
| Sandbox mode | `src/lib/chess/sandbox/`, `src/components/game/sandbox/` | [`SandboxModePlan.md`](docs/dev/SandboxModePlan.md) |
| Security | — | [`SecurityChecklist.md`](docs/dev/SecurityChecklist.md) |
| Coding standards | — | [`DevStandards.md`](docs/dev/DevStandards.md) |
