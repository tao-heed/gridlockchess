# On-Device Native Engine Plan — Fairy-Stockfish in the .apk (no server, no card, offline)

> **Goal:** Compile Fairy-Stockfish natively for Android ARM, bundle it inside the `.apk`, and
> talk to it in-process over UCI via a Capacitor plugin. Real engine, **offline, no server, no
> credit card** — the true end state. This is how DroidFish and serious offline chess apps work.
>
> **This is the HIGHEST-effort, HIGHEST-risk path we've scoped.** The make-or-break is the
> **compile on a Windows host over a flaky connection** — not the app code. So we prove that
> FIRST with a tight spike before building anything else.
>
> **Outcome: this native path SHIPPED.** It superseded the two earlier approaches — an offline
> pure-TypeScript bot and a hosted engine server — both now abandoned (see **"Abandoned approaches"**
> at the end for why). The step-by-step reproduction lives in
> [NativeEngineBuildGuide.md](./NativeEngineBuildGuide.md).

---

## 0. Verified facts (read, not assumed)

### From the real Fairy-Stockfish `src/Makefile` (fetched 2026-07-13)
- ✅ **Official Android NDK cross-compile exists.** `COMP=ndk` is a documented compiler target
  (`"ndk → Google NDK to cross-compile for Android"`).
- ✅ For `ARCH=armv8` (64-bit phones) it uses `CXX=aarch64-linux-android21-clang++`,
  `STRIP=aarch64-linux-android-strip`, flags `-stdlib=libc++ -fPIE`, link
  `-static-libstdc++ -pie -lm -latomic`. Output is a **PIE executable**.
- ✅ Comment in Makefile: **"To cross-compile for Android, NDK version r21 or later is recommended."**
- ✅ `nnue = no` by default → classical eval (correct: our `gridlock` variant has no NNUE net).
- ✅ `largeboards` is a build flag; the proven dev binary is the *largeboard* build, so match it.

### From this repo (read)
- ✅ `android/` Capacitor project exists (`android/app/`, `build.gradle`, `variables.gradle`, …).
- ✅ Client engine transport = `engine.ts`: `evaluatePosition` → `fetch(ENGINE_URL/api/evaluate)`,
  `isEngineReady` → `fetch(/api/status)`. These are the ONLY two calls to swap for a native bridge.
- ✅ The engine speaks **UCI text** (`position fen …`, `go depth …`, `bestmove …`) — a native
  bundled executable piped over stdin/stdout speaks the exact same protocol (minimal rework).
- ✅ Variant loads via `setoption VariantPath value <path>` + `UCI_Variant value gridlock-royal`
  (server.js confirmed) — identical mechanism works with a native binary + bundled `variants.ini`.

### NOT verified — must check/confirm (no bluffing)
- [x] **Is the Android NDK installed?** → **NO.** Not at `%LOCALAPPDATA%\Android\Sdk\ndk\` (checked
  2026-07-13). Must install (large download — the main friction on a slow link).
- [x] **Build host / WSL?** → **WSL Ubuntu (v2) IS already installed** (checked 2026-07-13). Biggest
  setup hurdle already cleared. Still to confirm: `build-essential` + a Linux NDK inside WSL.
- [ ] **Android 10+ (API 29+) forbids executing a binary from app writable storage (W^X).** The
  standard fix is to ship the engine INSIDE the native lib dir (`jniLibs/arm64-v8a/lib*.so`), which
  Android marks executable. This is platform knowledge, NOT read from our code — **must verify on
  the actual device** during integration.
- [ ] Exact NDK toolchain path / clang name on the installed NDK version.
- [ ] On-device **strength & speed** (classical eval, few threads) — unknown until it runs.

---

## 1. THE SPIKE (do this first — proves the hard part, ~zero app code)

**Spike goal:** get a Fairy-Stockfish `armv8` binary to **compile** AND print **one legal
`bestmove` on the phone** — including the `gridlock` variant. Nothing else.

### Stage A — compile (build host)
> ✅ **DONE + VERIFIED 2026-07-13.** Built on **Windows** (no WSL needed) using the **Windows NDK r29**
> + **Git Bash** + the NDK's bundled `make.exe`. Source cloned to `C:\Users\...\Downloads\Fairy-Stockfish`.
> Command that worked: `make -j build ARCH=armv8 COMP=ndk largeboards=yes`. Output = `src/stockfish`,
> **6.9 MB**, ELF header confirmed **64-bit AARCH64 (ARM64)**. First try, no errors (only harmless
> `-fuse-ld=lld` unused-arg warnings). The hardest/riskiest step is CLEARED.
- [x] ~~WSL~~ → not needed; built natively on Windows with the Windows NDK + Git Bash + NDK `make.exe`.
- [x] NDK on PATH inside Git Bash (`.../toolchains/llvm/prebuilt/windows-x86_64/bin` + `.../prebuilt/windows-x86_64/bin`).
- [x] `git clone --depth 1 https://github.com/fairy-stockfish/Fairy-Stockfish.git`
- [x] `make -j build ARCH=armv8 COMP=ndk largeboards=yes`
- [x] Result = `stockfish` ARM64 executable — verified **AARCH64** via ELF header bytes.

### Stage B — run it on the phone
> **PIVOT 2026-07-13: USB is broken → no `adb`.** Instead of an adb smoke test, the engine +
> a **Capacitor native plugin** + an in-app **`/engine-test` diagnostic screen** were bundled into a
> sideloadable APK so the engine can be proven ON the phone from the UI.
> **APK built + verified-packaged:** `Downloads\GridlockChess-NativeEngine.apk` (11.28 MB). Confirmed
> inside: `lib/arm64-v8a/libgridlockfsf.so` (6.6 MB) + `assets/public/variants.ini`.
>
> What shipped for this diagnostic:
> - `jniLibs/arm64-v8a/libgridlockfsf.so` (the compiled engine) + manifest `extractNativeLibs="true"`
>   + gradle `packagingOptions.jniLibs.useLegacyPackaging = true` (so it extracts to nativeLibraryDir
>   as an executable — Android 10+ W^X).
> - `EnginePlugin.java` (`@CapacitorPlugin name="Engine"`): execs the binary via `ProcessBuilder`,
>   copies `variants.ini` from assets → filesDir, streams stdout lines to JS. Registered in `MainActivity`.
> - `src/lib/chess/nativeEngine.ts` (JS bridge) + `src/pages/EngineTest.tsx` (`/engine-test`) + a
>   TEMPORARY native-only "engine test" link in `App.tsx`.
>
> **PENDING: user sideloads the APK and taps Run Engine Test — reports whether `uciok` / `readyok` /
> `bestmove` appear (standard + gridlock).** This is the on-device proof; agent cannot run it.
- [x] User installed APK → engine test → **`bestmove e2e4` for gridlock-royal, depth 12 @ ~131k nps.**

> ## ✅✅ ON-DEVICE PROOF PASSED (2026-07-14, phone screenshots)
> `exists: true` → `Fairy-Stockfish 130726 LB` → `uciok` → `readyok` →
> `info string variant gridlock-royal files 8 ranks 8 ... startpos rnbqkbnr/...` →
> `classical evaluation enabled` → search to **depth 12 @ ~131,000 nps** → **`bestmove e2e4 ponder d7d5`**.
> Every risk (compile, exec-from-lib W^X, custom variant load, performance, bestmove) CLEARED ON-DEVICE.
> The native offline engine is PROVEN. Server/card path abandoned. Remaining = §2 integration + cleanup.

### Spike verdict
- ✅ **Both pass** → the risky part is DONE. Proceed to §2 integration with confidence.
- ❌ **Compile stuck** (toolchain/NDK hell) or **won't run on phone** → native path is closed;
  fall back to a hosted engine server with no wasted app code. *(Not needed — the spike passed.)*

---

## 2. Integration (ONLY if the spike passes)

### Phase A — bundle the engine in the app
- [ ] Rebuild the binary named for jniLibs, e.g. `libfairystockfish.so`, placed at
      `android/app/src/main/jniLibs/arm64-v8a/libfairystockfish.so` (executable location on Android 10+).
- [ ] (Optional) also build `armeabi-v7a` (`ARCH=armv7`) for old 32-bit devices; `x86_64` for emulators.
- [ ] Ship `variants.ini` as an Android asset; copy to app files dir at first launch and pass its path.

### Phase B — Capacitor native plugin (the bridge)
- [ ] New plugin (Java/Kotlin, `@CapacitorPlugin`): `start()` execs the bundled engine from
      `nativeLibraryDir`; `send(cmd)` writes a UCI line to stdin; streams stdout lines back to JS
      via a plugin event. `stop()` quits the process.
- [ ] JS side: `registerPlugin('GridlockEngine')` wrapper exposing the same shape our code needs.

### Phase C — swap the client transport
- [ ] In `engine.ts`, add a **native transport**: when running in Capacitor (native), route
      `evaluatePosition`/`isEngineReady` to the plugin (send `position`/`go`, collect `bestmove`)
      instead of `fetch`. Keep the HTTP path for web/dev. **`boardToFen`, `parseUciMove`, `bot.ts`
      logic stay unchanged.**
- [ ] Multipv/skill/movetime mapping: reuse the existing `DIFFICULTY_CONFIG` → UCI options.

### Phase D — build, test, verify
- [ ] `npm run cap:sync` → `cd android; .\gradlew.bat assembleDebug`.
- [ ] On device (airplane mode ON): every bot tier + Run Dry plays **real engine** moves fully offline.
- [ ] `npm test` stays green (transport swap must not break the 127 unit tests — they mock/isolate
      `engine.ts`; read `bot.engine.spec.ts` / `bot.heuristic.spec.ts` before editing).
- [ ] Measure per-move latency on the phone; tune threads/movetime/depth per tier.

---

## 3. Honest risks (ranked)
1. **The compile toolchain on Windows.** WSL + NDK setup over a flaky connection is the single most
   likely place to get stuck. The spike exists to find out fast.
2. **Big downloads** (WSL image, NDK ~1 GB+, source) on a slow link — real friction, already bitten us.
3. **Android W^X exec rule** — must run the engine from `jniLibs`, not app data. Verify on device.
4. **On-device performance** — classical eval + few cores; may need lower depth/movetime per tier.
5. **Slow iteration** — each cycle = rebuild APK (7+ min) + install over slow link + on-device test.
6. **I can't run the compile or adb from here** — the user is the hands for build/install/run steps.

## 4. Acceptance criteria
- Spike: `armv8` binary compiles AND prints a legal `bestmove` for both standard and `gridlock` on the phone.
- Integration: offline `.apk`, every bot tier + Run Dry plays real Fairy-Stockfish with no network.
- 127 tests still pass; no server, no card, no domain anywhere in the shipped path.

---

## Abandoned approaches (and why) — history preserved from the deleted plan docs

Two earlier engine strategies were fully planned, then dropped once the native path proved out.
Their standalone plan docs (`OfflineAiEnginePlan.md`, `OnlineEngineServerPlan.md`) were deleted;
the useful essence is preserved here so the decision trail isn't lost.

### A. Offline pure-TypeScript bot (abandoned)
- **Idea:** promote the in-app TS negamax (`search.ts`) to the offline bot, since the strong bot came
  from a Fairy-Stockfish HTTP server (`server.js`) that does not exist in the `.apk`.
- **Why abandoned:** the TS eval is shallow (material + light positional). A known symptom was the
  "a6-shuffle" — a pure-material eval tied all quiet moves at 0, so the bot pushed the a-pawn
  identically at every level. Patchable, but never near real Fairy-Stockfish strength. The native
  engine makes it moot.
- **Kept lesson:** offline weakness root cause = `getEngineMove` returns null with no server → falls
  to the weak `heuristicMove`. The native transport (this plan) fixes it at the source.

### B. Hosted engine server (abandoned)
- **Idea:** host `server.js` publicly and point the app at it via `VITE_ENGINE_URL`; require internet
  for the bot. Considered Oracle Always-Free ARM, Koyeb, and Hugging Face Spaces (the only card-free host).
- **Why abandoned:** viable hosts needed a **credit card** (which the user does not have) or real ops,
  and it made the bot **online-only**. The native engine is offline, free, and card-free — strictly better.
- **Real code that survives this decision:** `server.js` was hardened during that exploration (engine
  **pool + queue** fixing a genuine concurrency bug, `express-rate-limit`, CORS allowlist, `/health`).
  `server.js` is still used for **local dev** (the `localhost:3005` engine proxy) and the **Uplink PvP
  relay**, so that hardening remains useful there. The deploy artifacts made for the abandoned host
  (`Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example`) are now **orphaned** — safe to
  remove unless online PvP hosting is later pursued.
