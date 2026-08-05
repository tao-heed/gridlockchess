# Android Packaging Plan — Google Play (.apk/.aab)

**Goal:** Ship Gridlock Chess to Google Play as a native-wrapped build of the existing
React/Vite PWA, using **Capacitor** (the chosen path in
[MobileMigrationPlan.md](./MobileMigrationPlan.md) Phase 5).

**iOS is out of scope** — building/submitting an iOS app requires macOS + Xcode, which this
Windows host cannot do. This plan is Android-only.

**Scope:** the packaging + Play-submission pipeline and the offline-readiness work that must land
*before* packaging. It does **not** re-plan the mobile UI (that lives in MobileMigrationPlan.md).

> Every code claim below was verified against the current source this session. Line references
> are facts. Where something is unverified or external, it says so.

---

## Progress checklist

> **Execution order: easiest → hardest.** Work top-to-bottom within the code items first (small,
> fully verifiable, in-editor), then the heavier machine/release setup (SDK installs, Capacitor,
> keystore, Play Console — partly manual/environment-dependent). Done so far in that order:
> fonts → engine-probe guard → PvP gate.

Track work here. `[x]` = verified done, `[~]` = partial, `[ ]` = not started.

**Offline-readiness (code) — do before packaging**
- [x] Guard the dead `localhost:3005` engine probe in production builds (`VITE_ENGINE_URL` escape-hatch) — §4.1 (done 2026-07-13; PROD `dist` has **0** `http://localhost:3005` refs, dev/test unchanged, 127/127 tests pass)
- [x] Self-host fonts (`@fontsource-variable/*`), drop the Google-Fonts `@import` — §4.2 (done 2026-07; 15 `woff2` subsets bundled, `dist` has **0** `googleapis` refs, 127/127 tests pass)
- [~] Gate Online PvP behind a connectivity check; point `VITE_UPLINK_URL` at a hosted relay — §4.3 (code done 2026-07-13: offline gate in the Uplink lobby via `useOnlineStatus`; **hosting a relay + setting `VITE_UPLINK_URL` is still a deploy step**)
- [x] Update the Licenses **Privacy** section after fonts are self-hosted — §4.4 (done; Privacy + Fonts sections now state self-hosted, no Google CDN)
- [x] Fix stale service worker: `registerType:'prompt'` + `<PwaUpdatePrompt>` toast (no silent `skipWaiting`) — §4.5 (done 2026-07-13; verified `sw.js` skipWaiting fires only via SKIP_WAITING message, 127/127 tests pass)

**AI engine strategy** — ✅ RESOLVED: native engine shipped (see §3)
- [x] Spike: `ffish` + `fairy-stockfish-nnue.wasm` load the custom `gridlock-royal` variant (verified 2026-07-10, MobileMigrationPlan §4a)
- [x] **SHIPPED (2026-07-14): native Fairy-Stockfish compiled for Android ARM64 and bundled in the `.apk`** — fully offline, no server. See [OnDeviceNativeEnginePlan.md](./OnDeviceNativeEnginePlan.md) + [NativeEngineBuildGuide.md](./NativeEngineBuildGuide.md). Supersedes the earlier heuristic (Option C) and threaded-WASM (Option B) plans.
- [x] **Five-tier 25-level bot system (2026-07-27):** TypeScript difficulty system expanded from 9 flat levels to 5 tiers × 5 sub-levels = **25 levels** (`basic_1`–`master_5`). Template literal types, lerp-based config, tier-grouped dropdowns, Run Dry 5-segment progress bar, resume-snapshot migration. All 236 tests green, `tsc -b` clean. See [BotLevelParameters.md](./BotLevelParameters.md).
- [x] **Fuel-modified FSF (2026-07-26):** `libgridlockfsf.so` is a fork of FSF with native L/O/D charge tracking (decrements in `do_move`, Zobrist-hashed, near-depletion eval penalty). Three bugs found post-validation fixed 2026-07-26 (pawn promotion fuel unreachable, pawn/king capture Zobrist corruption, `gridlock-royal` `promotionPieceTypes`). **Last clean ARM64 rebuild: 2026-07-27** (`make clean && make -j build ARCH=armv8 COMP=ndk largeboards=yes`, NDK r29). Source at `C:\New folder\Fairy-Stockfish\src`. See [FairyStockfishFuelMod.md](./FairyStockfishFuelMod.md).

**Android toolchain (build machine)**
- [x] Node v22.17.0 present
- [x] JDK 21.0.8 present (`JAVA_HOME` set)
- [x] Install Android SDK — §5 (done 2026-07-13 via Android Studio; platform android-36.1, build-tools 36.1.0/37.0.0, platform-tools, emulator)
- [x] Set `ANDROID_HOME` — §5 (set persistently + `android/local.properties` sdk.dir written)

**Capacitor + build**
- [x] Add Capacitor core/cli, `npx cap init` — §6 (done 2026-07-13; Capacitor 8.4.1, appId `io.github.b33zsm00th.gridlockchess`, `capacitor.config.ts` webDir=dist, bg #070a12)
- [x] `npx cap add android`, `npx cap sync` — §6 (done; `android/` scaffolded, portrait-lock in AndroidManifest, launcher/adaptive icons + splash generated via @capacitor/assets, `cap doctor` = "Android looking great")
- [~] Build & install a debug `.apk`, **test in airplane mode** — §7 (BUILD history: 2026-07-13 9.29 MB (vanilla engine); 2026-07-27 **14 MB** with fuel-modified engine + 25-level five-tier bot system, fresh C++ rebuild → `GridlockChess-latest.apk` in `~/Downloads`; **install-on-device + airplane-mode test still pending**)
- [~] Signed release `.aab` (keystore created & backed up) — §8 (Gradle signing **scaffolded** 2026-07-13: `android/app/build.gradle` reads `android/keystore.properties` (gitignored) + `keystore.properties.example` template; **you still run `keytool` to create the keystore + a signed build**)

**Store**
- [ ] Icon set + splash + feature graphic + screenshots — §9
- [ ] Play Console app, Data Safety form, content rating — §8
- [ ] Internal testing track → production — §8

---

## 0. What actually ships (build output vs. repo)

The `.apk`/`.aab` bundles **only** Capacitor's `webDir` = Vite's `dist/`. Vite emits `dist/` from
the JS module graph (everything `import`ed by the app) **plus** the `public/` folder. Nothing else
in the repo is copied into the app. Verified 2026-07-13 against the current `dist/`:

**Ships (inside `dist/`):** `index.html`, `assets/*` (JS/CSS chunks + bundled `woff2` fonts),
PWA icons, `manifest.webmanifest`, `sw.js` / `workbox-*.js` / `registerSW.js`, `THIRD-PARTY-LICENSES.txt`.

**Does NOT ship (verified — `dist/` has zero `.md`/`.mjs`/`.ini`):**
- The repo-root **`docs/`** folder — all `.md` plans **and** the `docs/dev/scripts/verify_*.mjs`
  balance scripts. They are never `import`ed and are not in `public/`, so Vite excludes them.
- `server.js` (the dev engine proxy + PvP relay), `bin/`, config files, tests, `variants.ini`.
- **Note:** the in-app rules/about docs are a *different* thing — they are MDX pages under
  `src/pages/*.mdx` + components in `src/components/docs/` (imported via `@/components/docs/...`),
  so those **do** ship. Only the repo-root `docs/` documentation folder is excluded.
- ✅ The shipped **native engine** (§3) needs `variants.ini`; it now lives in `public/variants.ini`
  (→ `dist/variants.ini` → `assets/public/variants.ini` in the `.apk`), and the compiled engine
  binary ships in `android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so`.

---

## 1. Does the installed app need the internet?

Verified from the actual call paths:

| Subsystem | Source (verified) | Internet needed after install? |
|---|---|---|
| Board, rules, move-gen | `getAllLegalMoves` (`src/lib/chess/check.ts:110`), `move.ts`, `movement.ts` — pure TS | **No.** 100% local. |
| Single-player vs AI | `chooseBotMove` → `getEngineMove` → native engine plugin (`nativeEngine.ts`) | **No.** Full-strength native Fairy-Stockfish bundled in the `.apk` — see §3. |
| UI fonts | **Self-hosted** — `@fontsource-variable/{inter,space-grotesk,jetbrains-mono}` imported in `src/main.tsx`; `woff2` bundled into `dist/assets` | **No.** Fully offline. |
| Online PvP | `src/vite-env.d.ts` `VITE_UPLINK_URL`, WebSocket relay in `server.js` | **Yes** — but PvP is an optional mode. |
| Sounds, images, MDX docs | bundled assets (`dist/assets/*`) | **No.** |

**Bottom line:** the game is playable fully offline. Fonts are now self-hosted, so the only
remaining network dependency is Online PvP (optional), handled in §4.

---

## 2. How the packaged .apk actually runs — build machine vs phone, and ports

This answers two common misconceptions directly.

### 2.1 The JDK and Android SDK are **build-machine** tools, not phone requirements

- **JDK 21** and the **Android SDK** live on **your laptop** and exist only to **compile and
  package** the `.apk` (Gradle → `aapt2`/`d8`/`r8`/`zipalign`). They are the *toolchain*.
- They are **not shipped inside the .apk** and **not needed on the phone**. Android already has
  its own app runtime (**ART**); it runs the packaged app directly.
- Analogy: you need a C compiler + Windows SDK to *build* a `.exe`, but the person running the
  `.exe` never installs the compiler. Same here — `JAVA_HOME` / Android SDK are checked on the
  **build machine** (this laptop), which is exactly correct. It has nothing to do with `.exe`
  vs `.apk`; it's build-time vs run-time.

### 2.2 A production .apk does **NOT** run `npm run dev:all`, and uses **no** dev ports

Verified: `npm run dev:all` = `concurrently` running `vite` (frontend, **port 5173**) +
`node server.js` (engine proxy + PvP relay, **`ENGINE_PORT || 3005`**) — see `package.json`
scripts and `server.js:214`. **This is a laptop-only dev workflow. The phone never runs it.**

What the packaged `.apk` actually does:

- It bundles the **static build output** (`npm run build` → `dist/`) *inside the app package*.
- Capacitor's WebView serves those files from a **local scheme** — Android default is
  `https://localhost/` (an internal app-bundle serve via `WebViewAssetLoader`, **not a TCP
  network port**, configurable via `androidScheme`). **There is no port 5173 and no port 3005
  on the phone.**
- `server.js` (port 3005) **cannot run on the phone** — it's a Node process that spawns a native
  engine binary. Its two jobs are handled differently:
  - **Engine proxy (`/api/evaluate`)** → replaced on the phone by the **in-app native engine**
    (compiled Fairy-Stockfish in `jniLibs`, §3). No 3005 needed for single-player AI.
  - **Online PvP relay (`/uplink`)** → if you keep Online PvP, it must be **hosted on a public
    server**; the `.apk` connects to `wss://<your-host>/uplink` baked in at build time via
    `VITE_UPLINK_URL`. Never localhost.

**Port summary**

| Context | Frontend | Single-player AI | Online PvP |
|---|---|---|---|
| Dev on laptop (`npm run dev:all`) | Vite `http://localhost:5173` | `node server.js` @ `localhost:3005` | `ws://localhost:3005/uplink` |
| Dev on a physical phone (optional live-reload) | laptop `http://<LAN-IP>:5173` via `server.url` | **heuristic** — `ENGINE_URL` is hardcoded to `localhost:3005` = the phone itself (unreachable) unless also overridden | `ws://<LAN-IP>:3005` — `uplinkUrl()` derives from the page host |
| **Production .apk (shipped)** | **bundled `dist/`, served `https://localhost` (internal, no port)** | **in-app native engine (compiled FSF, no server)** | **`wss://<hosted>/uplink` via `VITE_UPLINK_URL`** |

> **Dev-only live-reload option:** to test on a real phone with hot reload, set `server.url` in
> `capacitor.config.ts` to your laptop's LAN IP + `:5173` while `npm run dev` runs. Phone and
> laptop must share Wi-Fi. **Remove `server.url` before building the production `.apk`** — it is
> never part of the shipped app. This is the *only* scenario where the `.apk` touches 5173, and
> even then it's the laptop's LAN IP, not localhost.

> **Asymmetry to know (verified):** `uplinkUrl()` (`src/lib/net/protocol.ts:195`) derives its host
> from `window.location.hostname`, so PvP follows whatever host served the page. But the engine's
> `ENGINE_URL` (`src/lib/chess/engine.ts:22`) is a **hardcoded** `http://localhost:3005` — it does
> NOT follow the page host. On a phone that always resolves to the phone itself, so the server
> engine is unreachable regardless of `server.url`; §4.1's `VITE_ENGINE_URL` guard fixes this.
> **(Superseded 2026-07-14: the packaged Android app plays single-player against the bundled
> native engine and does not use `ENGINE_URL` at all — see §3.)**

---

## 3. AI difficulty offline — SHIPPED (native engine)

**Status (2026-07-14): SOLVED.** The bot runs **native Fairy-Stockfish**, compiled for Android
ARM64 and bundled inside the `.apk` — full strength, all **25 levels** (5 tiers × 5 sub-levels)
distinct, **fully offline, no server, no network**. Full build recipe:
[NativeEngineBuildGuide.md](./NativeEngineBuildGuide.md); decision history + abandoned alternatives:
[OnDeviceNativeEnginePlan.md](./OnDeviceNativeEnginePlan.md).

**Fuel modification (2026-07-26):** `libgridlockfsf.so` is a fork of stock FSF that natively tracks
Gridlock Chess piece charges (L/O/D vectors) — decrements in `do_move`, Zobrist-hashed, near-
depletion eval penalty. This eliminates the old Charge-Anchored FSF (CAF) loop: L9 went from ~49
engine calls/move (25–60 s) to 1 call (~4 s) at D=20+. Three bugs found post-device-validation were
fixed 2026-07-26; a clean ARM64 rebuild was done 2026-07-27. The vanilla unmodified binary is kept
as `libgridlockfsf-vanilla.so` for reference. See [FairyStockfishFuelMod.md](./FairyStockfishFuelMod.md).

**How it works (verified):**
- The engine is the compiled binary `android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so`,
  executed in-process via a Capacitor plugin (`EnginePlugin.java`) over UCI, loading the custom
  `gridlock-royal` variant from a bundled `variants.ini`.
- `src/lib/chess/nativeEngine.ts` drives it; `src/lib/chess/engine.ts` routes
  `evaluatePosition`/`isEngineReady` to the native engine when `isNativeEngineAvailable()`
  (packaged Android), else the HTTP path (dev/server). `bot.ts`, `boardToFen`, and the
  charge/override/gridlock awareness are **unchanged** — the swap is invisible to them.
- On-device proof: `bestmove` for `gridlock-royal`, search **depth 12 @ ~131k nps** (vanilla FSF, 2026-07-14). Fuel-modified FSF validated 2026-07-26: master-tier moves in ~4 s at D=20+.

**Historical context (the problem this solved):** before the native engine a webview had no
`localhost:3005`, so `isEngineReady()` returned false and every move fell to the weak
`heuristicMove` — collapsing the 9-tier ladder to ~2 effective strengths offline. The threaded WASM
engine (`fairy-stockfish-nnue.wasm`) could **not** run in the Android WebView (no
`SharedArrayBuffer` / cross-origin isolation — proven across three spikes), and no single-threaded
full-search WASM build exists. The **native NDK-compiled binary** was the path that worked. The
considered-and-dropped offline-heuristic and hosted-server alternatives are recorded in the
"Abandoned approaches" section of [OnDeviceNativeEnginePlan.md](./OnDeviceNativeEnginePlan.md).

---

## 4. Pre-packaging code changes (do these first)

1. **Guard the dead engine probe in production.** ✅ **Done.** `ENGINE_URL` (`src/lib/chess/engine.ts`)
   now derives from `import.meta.env.VITE_ENGINE_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:3005')`.
   A production `vite build` with no `VITE_ENGINE_URL` set gets an empty base URL, so `isEngineReady()`
   returns `false` **without** a `fetch` and `evaluatePosition()` throws `engine not configured` — the
   bot goes straight to the offline heuristic instead of paying a failing fetch on every move. Dev and
   vitest (`PROD` is false in both) still hit the local proxy, so behavior there is unchanged. A
   server-backed web deploy opts in by setting `VITE_ENGINE_URL`. Type added to `ImportMetaEnv`
   (`src/vite-env.d.ts`). Verified: PROD `dist` JS has 0 `http://localhost:3005` refs; 127/127 tests pass.
2. **Self-host fonts.** ✅ **Done.** Replaced the `fonts.googleapis.com` `@import` with
   locally bundled **variable** fonts (`@fontsource-variable/inter`,
   `@fontsource-variable/space-grotesk`, `@fontsource-variable/jetbrains-mono`), imported in
   `src/main.tsx`. Family names updated in `src/index.css` (body → `'Inter Variable'`) and
   `tailwind.config.js` (`sans`/`mono`/`display`). Vite emits 15 `woff2` subsets into
   `dist/assets`; `unicode-range` means the browser fetches only the `latin` subset at runtime,
   and all subsets precache via the PWA `globPatterns`. Verified: `dist` contains **0**
   `googleapis` references, build passes, 127/127 tests pass.
3. **Gate Online PvP behind a connectivity check.** ✅ **Code done.** New `src/hooks/useOnlineStatus.ts`
   (reactive `navigator.onLine` via `useSyncExternalStore`) drives the Uplink lobby
   (`src/components/game/modals/UplinkModal.tsx`): when the device is offline it shows “You’re
   offline. Online PvP needs an internet connection.” and disables Open/Join/Connect — no more
   silent WebSocket hang. A relay-down-while-online case is still caught by the socket’s `onerror`
   (“Connection failed.”). **Still a deploy step:** to make PvP actually work in a production build
   you must host the relay (`server.js`) and set `VITE_UPLINK_URL` (e.g. `wss://host/uplink`) at
   build time — `uplinkUrl()` already reads it (`src/lib/net/protocol.ts`); the `localhost:3005`
   fallback is dev/LAN only. Verified: build passes, 127/127 tests.
4. **Update the Privacy section** on the Licenses page once fonts are self-hosted. ✅ **Done.**
   The Privacy bullet and the **Fonts** credits section on `src/pages/Licenses.mdx` now state
   fonts are self-hosted/bundled (no Google Fonts CDN, no IP logging).
5. **Fix the stale service worker.** ✅ **Done.** Switched `vite.config.ts` from
   `registerType:'autoUpdate'` to `'prompt'` and added `src/components/ui/PwaUpdatePrompt.tsx`
   (a toast wired to `useRegisterSW` from `virtual:pwa-register/react`, mounted once in `App.tsx`).
   Before: `autoUpdate` injected an unconditional `self.skipWaiting()` + `clientsClaim`, so a new
   SW activated silently under an open tab — risking a stale mix of the old page with new/cleaned
   chunks, and never telling the user. Now the new SW **waits**; `skipWaiting()` fires only when the
   user taps **Reload** (which posts `SKIP_WAITING` via `updateServiceWorker(true)`), then the page
   reloads to the fresh build. An hourly `registration.update()` lets a long-open session notice new
   deploys. Type ref `vite-plugin-pwa/react` added to `src/vite-env.d.ts`. Verified against the
   built `dist/sw.js`: `self.skipWaiting()` appears **only** inside the `SKIP_WAITING` message
   handler; 127/127 tests pass. (This also mitigates the analogous "stale after app-store update"
   case inside a Capacitor `.apk`. A stronger `.apk`-only option — disabling the SW entirely since
   Capacitor already serves assets locally — remains available but is not needed for the web PWA.)

---

## 5. Android toolchain (build machine — AS BUILT 2026-07-13)

| Tool | Status (verified) | Notes |
|---|---|---|
| Node | **v22.17.0** ✔ | none |
| JDK | **21.0.8** ✔ (`JAVA_HOME` set) | Capacitor 8 supports JDK 21 |
| Android Studio | **INSTALLED** ✔ | `android-studio-quail1-patch2-windows.exe`, 2026-07-13 |
| Android SDK | **INSTALLED** ✔ | platform `android-36.1`, build-tools 36.1.0 + 37.0.0, platform-tools, emulator, `licenses/` accepted |
| `ANDROID_HOME` | **SET** ✔ | `%LOCALAPPDATA%\Android\Sdk` (persistent via `setx` + `android/local.properties` `sdk.dir`) |
| Gradle (global) | not on PATH | none needed — Capacitor ships the `gradlew` wrapper |

**What was actually done (reproducible):**
1. Ran the **Android Studio** installer (`android-studio-quail1-patch2-windows.exe`). Its first-run
   Setup Wizard downloaded + installed the SDK components (Build-Tools 37, Platform-Tools 37,
   Emulator, platform `android-36.1`) into `%LOCALAPPDATA%\Android\Sdk` and wrote the accepted
   license hashes to `Sdk\licenses\` — so no separate `sdkmanager --licenses` step was needed.
2. Pointed the tooling at the SDK (persistent + this session + Gradle's `local.properties`):
   ```powershell
   $sdk = "$env:LOCALAPPDATA\Android\Sdk"
   $env:ANDROID_HOME = $sdk ; $env:ANDROID_SDK_ROOT = $sdk
   setx ANDROID_HOME "$sdk"                      # persists for future terminals
   Set-Content android/local.properties "sdk.dir=$($sdk -replace '\\','\\')"
   ```
3. Verified `adb` present and the project's required `compileSdk/targetSdk = 36`
   (`android/variables.gradle`) is satisfied by the installed `android-36.1` — no `android-36`
   download was triggered.

> Alternative (not used): the lean **command-line tools only** route avoids the full IDE/emulator
> (~400–700 MB vs several GB) — unzip `commandlinetools` to `Sdk\cmdline-tools\latest`, then
> `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"` + `sdkmanager --licenses`.
> Only needed if reproducing on a disk-constrained machine without Android Studio.

---

## 6. Add Capacitor + Android platform (AS BUILT 2026-07-13)

Actual commands run (Capacitor **8.4.1**):
```powershell
# from the app/ folder
npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli @capacitor/assets
npx cap init "Gridlock Chess" io.github.b33zsm00th.gridlockchess --web-dir dist

npm run build          # produce dist/
npx cap add android
npx cap sync android
```

- **App id = `io.github.b33zsm00th.gridlockchess`** (from the owner's GitHub handle; PERMANENT once
  published). `capacitor.config.ts` also sets `backgroundColor: '#070a12'` (no white flash).
- `webDir` is `dist` (Vite output).
- Portrait-lock added to `android/app/src/main/AndroidManifest.xml`
  (`android:screenOrientation="portrait"` on `MainActivity`).
- Launcher + adaptive icons + splash generated: `npx @capacitor/assets generate --android` from
  `assets/logo.png` (2048²) with `#070a12` background (74 assets).
- Re-run `npx cap sync android` after **every** `npm run build` (or use `npm run cap:sync`).

**Plugins worth adding later (not yet installed):** `@capacitor/status-bar`,
`@capacitor/splash-screen`, `@capacitor/app` (hardware back-button), optional `@capacitor/haptics`.

**Service-worker note (RESOLVED for web, decision open for `.apk`):** the app registers a Workbox
service worker (`vite-plugin-pwa`). §4.5 switched it to `registerType: 'prompt'` (no silent
`skipWaiting`) + a `<PwaUpdatePrompt>` toast, which also mitigates stale-after-update inside the
`.apk`. A stronger `.apk`-only option — disabling the SW entirely (Capacitor serves assets locally)
— remains available but was not needed.

---

## 7. Building the APK

### What pipeline do I need?

```
Changed TS / JS / CSS / assets?   →  §7.1 only  (~1 min)
Changed C++ engine source?        →  §7.2 then §7.1  (~5 min total)
First build on this machine?      →  §7.1 without --offline (Gradle fetches deps once)
```

### How the pieces fit together

```
Fairy-Stockfish C++ source          TypeScript / React source
   (C:\New folder\Fairy-Stockfish)         (src/)
            │  make -j build                   │  tsc + vite build
            ▼                                  ▼
  libgridlockfsf.so          dist/  (JS chunks + woff2 fonts + sw.js)
  (jniLibs/arm64-v8a/)              │  npx cap sync android
            │                       ▼
            └──────► android/app/src/main/
                         assets/public/   ← web bundle (what WebView loads)
                         jniLibs/         ← native engine (what JNI loads)
                              │
                              ▼  ./gradlew assembleDebug
                         app-debug.apk  (~14 MB)
```

The `.so` is committed to the repo — Gradle just packages whatever file is at that path. The web bundle is NOT committed — `cap sync` copies a fresh `dist/` there every time before Gradle runs.

> ⚠️ **Shell matters.** The Makefile (C++ step) requires **Git Bash** — PowerShell can't run it. `./gradlew` (APK step) works in both, but the npm convenience scripts (`apk:copy`, `apk:offline`) call `gradlew.bat` and fail in Git Bash. Recommendation: use Git Bash for everything; use the manual steps below.

---

### 7.1 APK pipeline — JS/TS changes only (daily driver)

Prereqs: `ANDROID_HOME` set + `android/local.properties` present (§5). Already done on this machine.

#### Git Bash (universal — works always)

```bash
# From the project root: C:\New folder\test

# Step 1 — compile TS + build web bundle + sync into Android project
npm run cap:sync
# What this does: tsc -b && vite build && npx cap sync android
# What cap sync does: copies dist/ → android/app/src/main/assets/public/
#   Without this step Gradle packages stale web assets (old JS running against new native code).

# Step 2 — assemble the debug APK
#   --offline: reuse the Gradle dependency cache (fast, ~30s). Safe after the first build.
#   Omit --offline only on first-ever build or after clearing ~/.gradle.
cd android && ./gradlew assembleDebug --offline && cd ..

# Step 3 — copy to Downloads for sideloading
cp android/app/build/outputs/apk/debug/app-debug.apk ~/Downloads/GridlockChess-latest.apk

# Step 4 (optional) — verify engine + variant file are inside the APK
node -e "
  const p = 'C:/New folder/test/android/app/build/outputs/apk/debug/app-debug.apk';
  const b = require('fs').readFileSync(p).toString('binary');
  console.log('libgridlockfsf.so:', b.includes('libgridlockfsf.so'));
  console.log('variants.ini:     ', b.includes('variants.ini'));
"
# both should print: true
```

#### PowerShell convenience scripts (when not in Git Bash)

```powershell
npm run apk:copy     # build + cap sync + assembleDebug --offline + copy to Downloads (one command)
npm run apk:offline  # same, no copy  (APK stays at android/app/build/outputs/apk/debug/)
npm run apk          # same, without --offline (use on first build / after cache clear)
```

#### Install on device

- **Sideload (no USB):** transfer `GridlockChess-latest.apk` to the phone → tap in Files → allow "Install unknown apps" → Install. Same app ID = updates in-place (no uninstall).
- **USB:** `adb install android/app/build/outputs/apk/debug/app-debug.apk` (Developer Options → USB debugging).

**TEST IN AIRPLANE MODE** after install — confirms bot, fonts, and all offline features work without a server.

> **Exit-code gotcha:** a piped or background terminal may report exit code 1 even when Gradle prints `BUILD SUCCESSFUL` and the APK exists. Trust the file + the `BUILD SUCCESSFUL` line.

---

### 7.2 C++ pipeline — engine rebuild (only when C++ source changes)

Run this when you edit `C:\New folder\Fairy-Stockfish\src` (fuel mod logic, FSF upstream merge, new variant ABI). For normal JS-only work, skip entirely — the committed `.so` is already correct.

**Always run this in Git Bash.** The Makefile uses POSIX shell constructs that break in PowerShell/cmd.

#### Locations

| Item | Path |
|------|------|
| Fuel-modified FSF source | `C:\New folder\Fairy-Stockfish\src` |
| Android NDK r29 | `C:\Users\tao-heed\Downloads\android-ndk-r29-windows\android-ndk-r29` |
| Compiled `.so` (active) | `android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so` |
| Vanilla reference binary | `android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf-vanilla.so` |

#### Full C++ → APK rebuild (copy-paste this entire block into Git Bash)

```bash
# ── 1. NDK toolchain on PATH ───────────────────────────────────────────────
export NDK="/c/Users/tao-heed/Downloads/android-ndk-r29-windows/android-ndk-r29"
export PATH="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin:$NDK/prebuilt/windows-x86_64/bin:$PATH"

# ── 2. Clean C++ build ────────────────────────────────────────────────────
cd "/c/New folder/Fairy-Stockfish/src"
make clean
make -j build ARCH=armv8 COMP=ndk largeboards=yes
# Flags explained:
#   ARCH=armv8        → ARM64 (aarch64) target — the only ABI shipped
#   COMP=ndk          → use the NDK clang cross-compiler (aarch64-linux-android21-clang++)
#   largeboards=yes   → enables -DLARGEBOARDS -DPRECOMPUTED_MAGICS (required — gridlock-royal
#                       variant uses non-standard board sizes; without this flag the engine
#                       rejects the variant at startup)

# ── 3. Verify: valid ARM64 ELF ────────────────────────────────────────────
od -A x -t x1z -v stockfish | head -2
# Expected output:
#   000000 7f 45 4c 46  02 ...   ← ELF magic + 02 = 64-bit
#   000010 03 00 b7 00  ...      ← e_machine 0xb7 = 183 = AARCH64
# If byte 4 is 01 → 32-bit (wrong). If e_machine ≠ b7 → wrong arch.

# ── 4. Deploy to Android project ─────────────────────────────────────────
cp stockfish "/c/New folder/test/android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so"

# ── 5. Sync web bundle ────────────────────────────────────────────────────
cd "/c/New folder/test"
npm run cap:sync

# ── 6. Assemble APK — MUST use --rerun-tasks after a .so update ──────────
# ⚠️  GRADLE CACHING GOTCHA: after deploying a new .so, plain `assembleDebug --offline`
#     may NOT repackage — Gradle's UP-TO-DATE check can miss a changed .so and serve
#     the old APK silently. --rerun-tasks forces all 95 tasks to re-execute (~30s).
#     Only needed the first APK build after a C++ deploy; subsequent JS-only builds
#     can go back to plain --offline.
cd android && ./gradlew assembleDebug --offline --rerun-tasks && cd ..

# ── 7. Copy + verify ──────────────────────────────────────────────────────
cp android/app/build/outputs/apk/debug/app-debug.apk ~/Downloads/GridlockChess-latest.apk
node -e "
  const p = 'C:/New folder/test/android/app/build/outputs/apk/debug/app-debug.apk';
  const b = require('fs').readFileSync(p).toString('binary');
  console.log('libgridlockfsf.so:', b.includes('libgridlockfsf.so'));
  console.log('variants.ini:     ', b.includes('variants.ini'));
"
# both: true
```

#### Fuel modification — what changed from stock FSF

Five source files carry the mod (`position.cpp`, `position.h`, `types.h`, `evaluate.cpp`, `uci.cpp`; variant wiring in `variant.h` / `parser.cpp`):
- **`position.cpp` `do_move`** — decrements the moving piece's charge vector (L/O/D); promotes/demotes when a vector hits zero
- **`types.h`** — charge vector fields in `PieceInfo`
- **`position.h`** — Zobrist keys for fuel state (required so the TT distinguishes same-position/different-charges boards; without this the engine reuses eval results across charge states)
- **`evaluate.cpp`** — near-depletion eval penalty proportional to remaining charges
- **`uci.cpp`** — `fuel <sq>=<L>/<O>/<D> ...` UCI command; `nativeEngine.ts` sends current charge counts before every search

**Last clean rebuild: 2026-07-27.** Binary: **6.7 MB** (vs 6.6 MB vanilla — ~100 kB delta for fuel code).
Full mod history + the 3 post-device-validation bug fixes: [FairyStockfishFuelMod.md](./FairyStockfishFuelMod.md).

---

### 7.3 Build history

| Date | APK size | Engine | Bot system | How built |
|------|----------|--------|------------|-----------|
| 2026-07-13 | 9.29 MB | vanilla FSF | 9 levels (flat) | first Gradle download; 7m 40s |
| 2026-07-27 | **14 MB** | fuel-mod FSF (3 bugs fixed, clean rebuild) | **25 levels (5×5)** | C++ clean rebuild → deploy → `--rerun-tasks`; 29s Gradle |

---

## 8. Release build for Google Play (.aab)

Google Play requires an **Android App Bundle (.aab)**, not a raw `.apk`.

1. **Create an upload keystore** (keep it forever — losing it means you can't update the app):
   ```powershell
   keytool -genkey -v -keystore gridlock-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias gridlock
   ```
2. Configure signing in `android/app/build.gradle` (or a git-ignored `keystore.properties`).
3. Build the bundle:
   ```powershell
   cd android
   ./gradlew bundleRelease
   # output: android/app/build/outputs/bundle/release/app-release.aab
   ```
4. **Google Play Console** ($25 one-time): create app → upload `.aab` → complete Data Safety form
   (declare: local storage only; **fonts self-hosted — no third-party network call**; PvP relay if
   enabled) → content rating → screenshots → release to **internal testing** first.

**Also required (easy to overlook):**
- **`versionCode` must increment** (integer) on every upload; `versionName` is the user-facing
  string. Set both in `android/app/build.gradle`.
- **`targetSdkVersion` must be 35** (Android 15) — Play mandates it for new apps (since Aug 2025).
  Capacitor 7 defaults `minSdk 23` / `target 35`; confirm after `cap add android`.
- **Play App Signing:** you upload with your *upload* key; Google holds the *app-signing* key.
  Back up the upload keystore regardless — losing it blocks all future updates.
- **Cleartext traffic:** production PvP must use `wss://` (Android blocks cleartext `ws://` on
  `targetSdk ≥ 28`). The dev-phone `ws://<LAN-IP>:3005` case needs a network-security-config
  exception — dev only, never ship it.

---

## 9. Store assets checklist (Google Play)

- Adaptive app icon: **done ✔** — `public/maskable-icon-512x512.png` (512×512, logo centered in safe zone,
  dark `#070a12` background) generated from `assets-source/logo.png` by `@vite-pwa/assets-generator`.
  `@capacitor/assets` will consume the same source when the Android project is added.
- Splash screen: pending (needs `@capacitor/splash-screen` + Android project).
- Feature graphic (1024×500) + phone screenshots (min 2).
- Short + full description, privacy policy URL (the in-app Legal page content can seed this).
- Content rating questionnaire.

---

## 10. Recommended sequence

1. §4 code changes (engine guard, self-host fonts, PvP gate).
2. §3 AI strategy — ✅ **DONE**: native Fairy-Stockfish shipped in the `.apk` (full strength, all tiers, offline).
3. §5 install the Android SDK (Android Studio or cmdline-tools), set `ANDROID_HOME`.
4. §6 Capacitor + Android, §7 debug `.apk`, **test offline in airplane mode**.
5. §8 signed `.aab` → Play internal testing → production.

---

## Open questions / risks

- **Threaded-WASM strong-offline (Option B)** — **RESOLVED (not via WASM).** The Android WebView
  does NOT support `SharedArrayBuffer` / cross-origin isolation (proven across three spikes), so
  threaded WASM was abandoned. Strong offline shipped instead via a **native NDK-compiled** engine
  (§3). No longer an open risk.
- **App id:** set to `io.github.b33zsm00th.gridlockchess` (in `capacitor.config.ts` + `build.gradle`).
  **PERMANENT once published** — do not change after the first release.
- **PvP relay hosting:** production `VITE_UPLINK_URL` must point at a real always-on server; the
  current default is `localhost` (dev-only).
- **⚠️ GPL-3.0 compliance — NOW REQUIRED (we ship the native Fairy-Stockfish binary).** The bundled
  `android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so` is **GPL-3.0**. Before publishing you
  MUST ship the full GPL-3.0 license text **and** a written offer / pointer to the corresponding
  source (the Fairy-Stockfish source + our build recipe in [NativeEngineBuildGuide.md](./NativeEngineBuildGuide.md))
  in the app's Licenses page. This is a hard legal requirement, not optional — it was hypothetical
  when the engine was only a deferred WASM idea; it is now **live**.
- **Bundle size:** current web build ≈ 742 kB JS (232 kB gz) + ~524 kB audio (8 mp3s); fine for a
  packaged app, no code-splitting required for mobile.
