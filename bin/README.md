# `bin/` — Engine binary & verification scripts

## Fairy-Stockfish engine binary (NOT in git)

The native Fairy-Stockfish binary is **git-ignored** (see [`.gitignore`](../.gitignore)) and
must be obtained separately. It is not produced by `npm install` or `npm run build`.

### Why it's not committed
- **Platform-specific native binary** — a Windows `.exe` will not run on a Linux/macOS host.
- **Not needed for Uplink PvP** — the online player-vs-player relay only shuttles human moves
  and never invokes the engine. The engine is required **only for solo-vs-bot** play.
- Committing native binaries bloats git history (every version is stored forever).

### What the app expects
`server.js` searches these paths, in order (`ENGINE_CANDIDATES`), and uses the first found:

```
bin/fairy-stockfish-largeboard_x86-64.exe   <- current Windows build (~1.8 MB)
bin/fairy-stockfish_x86-64.exe
bin/fairy-stockfish.exe
bin/fairy-stockfish-largeboard_x86-64        <- Linux/macOS (no extension)
bin/fairy-stockfish
```

It loads the custom variant from [`variants.ini`](../variants.ini) as `gridlock-royal`
(see `VARIANT_NAME` in `server.js`).

### How to obtain it
1. Download a Fairy-Stockfish build for your platform from the official project:
   <https://github.com/fairy-stockfish/Fairy-Stockfish/releases>
   - The committed reference binary is the **largeboard** build
     (`fairy-stockfish-largeboard_x86-64`). The Gridlock variant is standard **8x8**
     (see [`variants.ini`](../variants.ini)), so board size does not require largeboard;
     use a build that can load a custom `variants.ini` and matches your platform.
2. Place the executable in `bin/` using one of the names above that matches your OS.
3. On Linux/macOS, make it executable: `chmod +x bin/fairy-stockfish-largeboard_x86-64`.
4. Verify: start the server (`npm run dev:server`) and hit `GET /api/status` — it should
   report `{ "ready": true, ... }`.

> **Deploy note:** A Linux VPS needs a **Linux** binary, not the Windows `.exe`.
> A PvP-only host does not need the engine at all.

## Verification scripts

The army-balance verification scripts have moved to
[`docs/dev/scripts/`](../docs/dev/scripts/):

- [`docs/dev/scripts/verify_balance.mjs`](../docs/dev/scripts/verify_balance.mjs)
- [`docs/dev/scripts/verify_exact_balance.mjs`](../docs/dev/scripts/verify_exact_balance.mjs)
- [`docs/dev/scripts/verify_bishop_rule.mjs`](../docs/dev/scripts/verify_bishop_rule.mjs)
