# Gridlock Chess

A chess variant where every piece carries **vector charges** (Leap, Orthogonal, Diagonal) and spends one each time it moves. When a charge hits zero the piece permanently loses that movement axis — a piece that starts moving like an Amazon can degrade to Chancellor, then Rook, then an immovable Stone. Each side's army is built from **11 Archetypes**, each defining a different starting charge distribution. This single mechanic — **depletion** — creates a game where the board's balance shifts with every move.

## Key mechanics

- **Vector Charges** — each piece starts with a set of L/O/D charges. Every move costs one charge of the axis used.
- **Gridlock** — a piece that runs out of all charges becomes a Stone: immovable, permanently blocking its square (but enemies can still capture it).
- **Override** — replaces castling. The King steps onto an adjacent friendly Anomaly and permanently boards it, merging into the host and inheriting its movement. No dismount. One-way commitment.
- **Gridlock-Death** — if a Piloted Anomaly (a piece the King is riding) depletes to Stone, the King is sealed inside. Instant loss.

## Quick start

```bash
# Install dependencies
npm install

# Run the web app (UI only — no bot opponent)
npm run dev

# Run the web app + Fairy-Stockfish engine proxy (required for vs-bot play)
npm run dev:all
```

The app opens at `http://localhost:5173`. The engine proxy runs on port `3005`.

### Engine binary (vs-bot only)

The native Fairy-Stockfish binary is **git-ignored** and must be obtained separately. See [`bin/README.md`](bin/README.md) for download instructions and expected file names. The engine is not needed for Pass & Play or Uplink (online PvP).

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Vite dev server (hot reload) |
| `npm run dev:server` | Fairy-Stockfish engine proxy only |
| `npm run dev:all` | Both of the above, concurrently |
| `npm run build` | Type-check (`tsc -b`) then production build |
| `npm run test` | Run all Vitest tests |
| `npm run lint` | ESLint |
| `npm run apk` | Build + sync + assemble Android debug APK |
| `npm run apk:offline` | Same as `apk` but Gradle runs offline |
| `npm run apk:copy` | Build APK and copy to `~/Downloads/` |

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 19, TypeScript 5.8, Tailwind CSS 3, Framer Motion |
| Board interaction | dnd-kit (drag-and-drop) |
| Routing | React Router 7 |
| Documentation | MDX (remark-gfm, rehype-slug) |
| Validation | Zod |
| Engine (vs-bot) | Fairy-Stockfish (fuel-modified native binary) via HTTP proxy (`server.js`) |
| Engine (Android) | Fairy-Stockfish compiled for ARM64, bundled in APK via Capacitor plugin |
| Online PvP | Firebase Realtime Database |
| Android shell | Capacitor 8 |
| Build | Vite 6 |
| Testing | Vitest, Testing Library |

## Project structure

```
src/
  components/
    board/          Board, Square, Piece rendering + drag-and-drop
    docs/           MDX layout, table of contents, interactive demos
    game/
      LocalGame.tsx Main game screen (orchestrates all game state)
      modals/       End-game, confirm, Uplink lobby, welcome modals
      panels/       Move history, captured pieces, clock, coach, settings
      sandbox/      Position editor UI
    pieces/         Piece glyph rendering, vector badge
    ui/             PWA update prompt, engine log
  constants/        Archetypes, brand identity, time controls, UI tokens
  hooks/            Game state, clock, sound, persistence, online presence,
                    bot ladder (Run Dry), Uplink, replay tracking
  lib/
    audio/          Sound engine
    chess/          Core game logic — move generation, bot AI, charge-aware
                    search, engine interface, outcome detection, archetypes,
                    balanced army generator, repetition tracking
      sandbox/      Sandbox position validation + charge editing
    net/            Firebase client, room protocol, cleanup
    storage.ts      localStorage wrapper
  pages/            Home, Rules, About, Licenses, Changelog, Sandbox
  types/            Game type definitions
  utils/            Status message formatting

server.js           Fairy-Stockfish engine HTTP proxy (dev + hosted)
variants.ini        Custom variant definition loaded by Fairy-Stockfish
bin/                Engine binaries (git-ignored) + README
android/            Capacitor Android project (APK build)
docs/dev/           Design documents, implementation plans, scripts
```

## Android build

Requires the [Android SDK](https://developer.android.com/studio) and a JDK. The Capacitor project lives in `android/`.

```bash
# Full pipeline: build web → sync to Capacitor → assemble debug APK
npm run apk

# Copy the APK to Downloads for easy sideloading
npm run apk:copy
```

The APK bundles a native ARM64 Fairy-Stockfish binary — the bot works offline with no server.

## Bot difficulty

25 levels across 5 tiers. Advanced and above are **fuel-aware** (the engine receives real charge state via a custom UCI `fuel` command).

| Tier | Levels | Fuel-aware |
|------|--------|------------|
| Basic | 1–5 | No |
| Intermediate | 6–10 | No |
| Advanced | 11–15 | Yes |
| Expert | 16–20 | Yes |
| Master | 21–25 | Yes |

## Online PvP (Uplink)

Player-vs-player over Firebase Realtime Database. Supports private room codes and Quick Match. Requires a Firebase project — set the `VITE_FIREBASE_*` env vars (see below).

## Environment variables

Create a `.env.local` file in the project root. All `VITE_` vars are compile-time (baked into the build by Vite).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_FIREBASE_API_KEY` | For Uplink | — | Firebase project API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | For Uplink | — | Firebase auth domain |
| `VITE_FIREBASE_DATABASE_URL` | For Uplink | — | Firebase RTDB URL |
| `VITE_FIREBASE_PROJECT_ID` | For Uplink | — | Firebase project ID |
| `VITE_FIREBASE_APP_ID` | For Uplink | — | Firebase app ID |
| `VITE_ENGINE_URL` | No | — | Override engine proxy URL (dev only) |
| `PORT` / `ENGINE_PORT` | No | `3005` | Engine proxy listen port (`server.js`) |
| `ENGINE_VARIANT` | No | `gridlock-royal` | Variant name passed to Fairy-Stockfish |

Uplink (online PvP) will not work without the Firebase vars. Everything else (vs-bot, Pass & Play, Sandbox) works without them.

## Docker (engine server only)

A `Dockerfile` and `docker-compose.yml` are provided for deploying the Fairy-Stockfish engine proxy (`server.js`) to a Linux host. The image ships only the backend — not the React app.

```bash
# Build (pass the engine binary download URL for your target arch)
docker build --build-arg FSF_URL="<fairy-stockfish-release-url>" -t gc-engine .

# Run
docker run -p 3005:3005 gc-engine
```

See the `Dockerfile` header comments for details on architecture selection (x86-64 vs ARM64).

## Dev docs

In-depth design documents, implementation plans, and scripts live in [`docs/dev/`](docs/dev/). Key references:

- [`FairyStockfishFuelMod.md`](docs/dev/FairyStockfishFuelMod.md) — the fuel UCI modification
- [`NativeEngineBuildGuide.md`](docs/dev/NativeEngineBuildGuide.md) — compiling FSF for Android ARM64
- [`BotDepletionAwareness.md`](docs/dev/BotDepletionAwareness.md) — how the bot handles charge depletion
- [`SecurityChecklist.md`](docs/dev/SecurityChecklist.md) — security audit and checklist
- [`DevStandards.md`](docs/dev/DevStandards.md) — coding standards

## License

Proprietary. All rights reserved. See [`LICENSE`](LICENSE) and the in-app [Licenses page](src/pages/Licenses.mdx) for third-party attribution.
