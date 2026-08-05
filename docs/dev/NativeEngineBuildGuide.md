# Native Engine Build Guide — Fairy-Stockfish inside the Android APK (offline, no server)

> **What this achieves:** a full-strength **Fairy-Stockfish** chess engine, compiled to native ARM
> and bundled inside the Gridlock Chess `.apk`, playing the custom `gridlock` variant **completely
> offline** — no server, no internet, no credit card, no cloud. Proven on-device:
> `bestmove e2e4` on `gridlock-royal`, search **depth 12 @ ~131,000 nodes/sec**.
>
> This is the definitive, replicable recipe. Everything here was **actually executed and verified**
> on a Windows machine on 2026-07-13/14. See [OnDeviceNativeEnginePlan.md](./OnDeviceNativeEnginePlan.md)
> for the decision history; this document is the standalone "how to do it again" guide.

---

## 0. Why this seemed impossible (and the key insight)

A phone app here is a **WebView** (a browser). It has **no Node.js** and **cannot spawn a native
`.exe`**, so the desktop approach (`server.js` spawning `fairy-stockfish.exe`) is impossible on the
phone. We also proved the **threaded WASM engine cannot run** in the Android System WebView — it
needs `SharedArrayBuffer` / cross-origin isolation, which that WebView does not support at all
(three separate spikes confirmed this; see the plan doc).

**The insight that works:** do what real offline chess apps (DroidFish, etc.) do —
1. **Compile the engine's C++ to a native ARM executable** with the Android NDK.
2. **Bundle that executable inside the APK** in the native-library folder (the one place Android 10+
   allows executing a file).
3. **Talk to it over UCI** (plain text stdin/stdout) through a small **Capacitor native plugin**.
4. The game's existing bot logic wraps it with the charge/override/gridlock awareness (pure TS).

---

## 1. Architecture at a glance

```
┌──────────────────── Android APK ────────────────────┐
│  WebView (React app)                                 │
│    bot.ts  → engine.ts.evaluatePosition()            │
│                 │ (isNativeEngineAvailable? → native)│
│                 ▼                                     │
│    nativeEngine.ts  ── UCI text ──►  Engine plugin    │
│       (JS bridge)   ◄── stdout ────  (Java)           │
│                                        │ ProcessBuilder
│                                        ▼               │
│    lib/arm64-v8a/libgridlockfsf.so  (native FSF, UCI) │
│    + variants.ini (custom gridlock variant)           │
└───────────────────────────────────────────────────────┘
```
- The engine is a **normal UCI executable**, just compiled for ARM Android.
- `variants.ini` teaches it the custom `gridlock`/`gridlock-royal` variant at runtime.
- The engine is **depletion-blind** (FEN can't encode charge counts) — charge/override/gridlock
  awareness lives in `bot.ts` + `search.ts` (unchanged), which re-filters the engine's moves.

---

## 2. Requirements / downloads

| Requirement | What / where | Notes (from our run) |
| --- | --- | --- |
| **Windows** host | — | We built on Windows directly. **WSL is NOT required.** |
| **Android NDK (Windows)** | [developer.android.com/ndk/downloads](https://developer.android.com/ndk/downloads) — the `android-ndk-r<ver>-windows.zip` | We used **r29** (`android-ndk-r29-windows.zip`, **~795 MB download → ~2.3 GB extracted**). **r21+ is required** (Makefile comment). The biggest download. |
| **Git for Windows** | [git-scm.com](https://git-scm.com/download/win) | Provides `git` **and Git Bash** (a Unix shell — the Makefile needs one). We had `C:\Program Files\Git\bin\bash.exe`. |
| **`make`** | **Bundled in the NDK** at `prebuilt/windows-x86_64/bin/make.exe` | No separate install — the NDK ships GNU make. |
| **Android SDK + platform-tools** | via Android Studio | Already present for the existing Capacitor build. |
| **Node + the Capacitor app** | this repo | The React app + `android/` project already exist. |
| **Fairy-Stockfish source** | `git clone https://github.com/fairy-stockfish/Fairy-Stockfish` | Cloned fresh; ~a few MB. |

> **Do NOT download the Linux NDK if you build on Windows.** A Windows-hosted NDK cross-compiles to
> Android fine. (And a Windows NDK is useless inside WSL — Linux can't run Windows compilers.)
>
> **These are EXTERNAL downloads — they are NOT stored in this repo, and you don't need to keep the
> local copies.** The **compiled engine** (`android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so`)
> IS committed to the repo, so it ships in every APK. You need the NDK + FSF source **only to
> RE-COMPILE the engine** (upgrade Fairy-Stockfish, or add another ABI such as `armv7`/`x86_64`) —
> **never** just to build the app or the APK. If you deleted the local copies: re-fetch the NDK
> (`android-ndk-r29-windows.zip`, ~795 MB) from the link above and re-`git clone` the FSF source
> (a few MB). That's everything needed to regenerate the engine from scratch.

---

## 3. Part A — Compile the engine for Android ARM64

All in **Git Bash** (Start → "Git Bash"), because the Fairy-Stockfish Makefile uses `uname`/POSIX
shell that Windows `cmd`/PowerShell can't run.

```bash
# 1) Get the source
git clone --depth 1 https://github.com/fairy-stockfish/Fairy-Stockfish.git
cd Fairy-Stockfish/src

# 2) Put the NDK's clang toolchain AND the NDK's bundled make on PATH.
#    Replace <NDK> with your extracted NDK path, in Git-Bash form (/c/... not C:\...).
#    Ours was /c/Users/<you>/Downloads/android-ndk-r29-windows/android-ndk-r29
export NDK="/c/Users/<you>/Downloads/android-ndk-r29-windows/android-ndk-r29"
export PATH="$NDK/toolchains/llvm/prebuilt/windows-x86_64/bin:$NDK/prebuilt/windows-x86_64/bin:$PATH"

# 3) Build. armv8 = 64-bit ARM phones; COMP=ndk is the OFFICIAL Android target;
#    largeboards=yes matches the desktop dev binary and supports our variant board.
make -j build ARCH=armv8 COMP=ndk largeboards=yes
```

Result: **`src/stockfish`** — a native ARM64 executable (**6,918,280 bytes ≈ 6.6 MiB**). **Verify the architecture:**

```bash
file stockfish       # → ELF 64-bit LSB pie executable, ARM aarch64
```
On Windows without `file`, check the ELF header bytes in PowerShell (byte 4 == 2 → 64-bit;
bytes 18–19 little-endian == 183 → AARCH64). **Mind the spaces around the operators:**
```powershell
$b = [IO.File]::ReadAllBytes("stockfish")[0..19]
"64-bit = $($b[4] -eq 2);  AARCH64 = $((($b[18] + ($b[19] -shl 8))) -eq 183)"
# expect: 64-bit = True;  AARCH64 = True
```

### Why these Makefile flags (read from the real `src/Makefile`)
- `COMP=ndk` → sets `CXX=aarch64-linux-android21-clang++`, links `-static-libstdc++ -pie -lm -latomic`,
  `-stdlib=libc++ -fPIE` → a **position-independent executable** (required by modern Android).
- `nnue=no` is the **default** → **classical evaluation**. Correct: our custom `gridlock` variant has
  **no trained NNUE net**, so there's nothing to embed.
- `largeboards=yes` adds `-DLARGEBOARDS -DPRECOMPUTED_MAGICS` (matches the proven desktop binary).

---

## 4. Part B — Bundle the engine into the app

### 4.1 Place the binary in `jniLibs` (the only executable location on Android 10+)
Android 10+ forbids executing a file from app **writable** storage (W^X). The **native-library
directory is the exception**. So the engine must ship there, and **must be named `lib*.so`**:

```
android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so   ← the compiled `stockfish`, renamed
```
```powershell
Copy-Item "<...>/Fairy-Stockfish/src/stockfish" "android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so"
```

### 4.2 Force the `.so` to be EXTRACTED to disk (so it can be exec'd)
By default modern Android keeps `.so` files compressed inside the APK (not real files). To execute
it, it must be extracted to `nativeLibraryDir`. Two switches (belt-and-suspenders):

**`android/app/src/main/AndroidManifest.xml`** — on `<application>`:
```xml
<application android:extractNativeLibs="true" ...>
```
**`android/app/build.gradle`** — inside `android { }`:
```gradle
packagingOptions {
    jniLibs {
        useLegacyPackaging = true
    }
}
```

### 4.3 Ship the variant definition
Put the variant file where the web build carries it into the APK:
```powershell
Copy-Item "variants.ini" "public/variants.ini"   # → dist/variants.ini → assets/public/variants.ini (via cap sync)
```
The plugin copies it out of read-only assets to the app's `filesDir` at runtime so the native engine
(a separate process) can read it by a real path.

---

## 5. Part C — The bridge (native plugin + JS)

> The code blocks below are **abridged** to show the essential shape — the complete, compiling
> source is in the repo files named in each heading (and in the §10 manifest). Don't paste these
> verbatim expecting them to compile; read the real files.

### 5.1 Capacitor native plugin — `android/app/src/main/java/.../EnginePlugin.java`
Execs the bundled binary via `ProcessBuilder` and streams UCI over stdin/stdout:

```java
@CapacitorPlugin(name = "Engine")
public class EnginePlugin extends Plugin {
    private Process engineProcess;
    private BufferedWriter engineStdin;

    @PluginMethod
    public void start(PluginCall call) throws Exception {
        // Copy variants.ini out of assets → filesDir (readable by the engine process).
        File variantsFile = new File(getContext().getFilesDir(), "variants.ini");
        try (InputStream in = getContext().getAssets().open("public/variants.ini");
             FileOutputStream out = new FileOutputStream(variantsFile)) { /* copy bytes */ }

        String enginePath = getContext().getApplicationInfo().nativeLibraryDir + "/libgridlockfsf.so";
        if (engineProcess == null) {
            ProcessBuilder pb = new ProcessBuilder(enginePath);
            pb.redirectErrorStream(true);
            engineProcess = pb.start();
            engineStdin = new BufferedWriter(new OutputStreamWriter(engineProcess.getOutputStream(), UTF_8));
            // reader thread: for each stdout line → notifyListeners("line", { line })
        }
        JSObject ret = new JSObject();
        ret.put("variantsPath", variantsFile.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod public void send(PluginCall call) { /* write call.getString("cmd") + "\n"; flush */ }
    @PluginMethod public void stop(PluginCall call)  { /* "quit"; engineProcess.destroy() */ }
}
```
Register it **before** the web layer boots, in `MainActivity`:
```java
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle s) {
        registerPlugin(EnginePlugin.class);
        super.onCreate(s);
    }
}
```

### 5.2 JS bridge — `src/lib/chess/nativeEngine.ts`
`registerPlugin('Engine')`, plus a small UCI driver that boots once (handshake + load variant +
`Threads`/`Hash`), then runs searches and parses `bestmove`/multipv (mirrors the server's parser):

```ts
export const NativeEngine = registerPlugin<NativeEnginePlugin>('Engine');
export function isNativeEngineAvailable() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}
// ensureReady(): start → uci → uciok → setoption VariantPath / UCI_Variant gridlock-royal
//               → Threads / Hash → isready → readyok   (guarded so it runs once)
// nativeEvaluate(fen, {depth,movetime,multipv,skill}): setoption MultiPV/Skill → position fen →
//               go depth/movetime → collect `info ... multipv/score/pv` → resolve on `bestmove`.
// All operations are serialized (one search at a time).
```

### 5.3 Route the existing transport — `src/lib/chess/engine.ts`
Only two functions change; everything else (`boardToFen`, `parseUciMove`, all of `bot.ts`) is untouched:
```ts
export async function evaluatePosition(fen, options) {
  if (isNativeEngineAvailable()) return nativeEvaluate(fen, options);   // ← APK: native engine
  /* ...existing HTTP fetch for dev/server... */
}
export async function isEngineReady() {
  if (isNativeEngineAvailable()) return nativeIsReady();                // ← APK: native engine
  /* ...existing HTTP status probe... */
}
```
Because the swap is at the transport layer, the entire depletion-awareness pipeline in
`getEngineMove` (charge-legal filtering, Override stripping, `preferSearchMove`) keeps working.

---

## 6. Part D — Build the APK

```powershell
npm run build                     # bundle the web app (tsc + vite)
npx cap sync android              # copy dist + variants.ini into android/, register plugins
cd android; .\gradlew.bat assembleDebug ; cd ..
# → android/app/build/outputs/apk/debug/app-debug.apk
# NOTE: add `--offline` ONLY after the first successful build — it reuses the Gradle cache and
# skips slow/flaky network fetches. The FIRST build must run WITHOUT `--offline` so Gradle can
# download its dependencies.
```
Confirm the engine + variant are actually packaged:
```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead((Resolve-Path "android/app/build/outputs/apk/debug/app-debug.apk").Path)
$zip.Entries | ? { $_.FullName -match "libgridlockfsf|variants" } | % { $_.FullName }; $zip.Dispose()
# expect: lib/arm64-v8a/libgridlockfsf.so  AND  assets/public/variants.ini
```

---

## 7. How to verify on-device (when USB/`adb` is unavailable)

USB was broken for us, so instead of `adb` we shipped a temporary **in-app diagnostic screen** that
starts the engine and prints its raw UCI output (`uciok` → `readyok` → `bestmove`). Pattern:
a Capacitor plugin call sequence wired to a throwaway `/engine-test` React route + a native-only link.
Once the real bot was confirmed, the diagnostic was removed. (If `adb` works, simpler: `adb push`
the binary to `/data/local/tmp`, `chmod +x`, run it, and pipe `uci`/`position`/`go`.)

---

## 8. Gotchas & hard-won lessons (read before you retry)

1. **Windows NDK ≠ WSL.** A Windows NDK can't run inside WSL (Linux can't exec Windows `.exe`). Build
   natively on Windows with Git Bash + the NDK's `make.exe`, OR use the **Linux** NDK inside WSL — never mix.
2. **The Makefile needs a Unix shell.** Pure `cmd`/PowerShell fails on `uname`/`$(shell …)`. Use Git Bash.
3. **`make` is inside the NDK** (`prebuilt/windows-x86_64/bin/make.exe`) — don't hunt for a separate one.
4. **Android W^X:** you can only exec from `nativeLibraryDir`. Name the binary `lib*.so`, put it in
   `jniLibs/<abi>/`, and set `extractNativeLibs=true` / `useLegacyPackaging=true`, or it won't run.
5. **The engine is charge-blind.** FEN can't encode charge counts, so FSF plays as if pieces never
   deplete. All gridlock awareness is the TS layer (`bot.ts`/`search.ts`) re-filtering its moves — do
   NOT expect the native engine to "know" about charges/Override/Gridlock.
6. **Custom variant needs a real file path.** `setoption VariantPath` wants a readable filesystem path;
   copy `variants.ini` from assets to `filesDir` first.
7. **No NNUE for a custom variant** — build `nnue=no` (default); don't chase a `.nnue` net that doesn't exist.
8. **Prove the compile FIRST** (a spike) before writing the plugin/integration. The compile is the
   only high-risk step; everything after is ordinary plumbing.
9. **Debug APK ≠ Play Store release.** This guide builds a **debug** APK for sideload testing. A
   store release needs a **signed release build** (see [AppStorePackagingPlan.md](./AppStorePackagingPlan.md)).
   Also **UNVERIFIED by us:** publishing as an **Android App Bundle (`.aab`)** changes native-lib
   packaging/splitting — re-verify the binary still extracts and executes from a bundletool-built
   APK before relying on it for a store release. The binary is `-static-libstdc++`, so it needs no
   bundled `libc++_shared.so` (self-contained) — good, but confirm this holds if you change flags.

---

## 9. Rebuilding later

- **New engine version:** re-run Part A (`git pull` in the FSF clone, rebuild), re-copy the `.so`, rebuild the APK.
- **32-bit / old devices:** also build `ARCH=armv7` → `jniLibs/armeabi-v7a/libgridlockfsf.so`.
- **Emulator (x86_64):** build a matching `x86_64` binary → `jniLibs/x86_64/`.
- **Tune strength per phone:** the JS driver sets `Threads`/`Hash`; scale `Threads` to the device core
  count instead of a fixed value for best results on varied hardware.

---

## 10. File manifest — everything added/changed for the native engine

| File | Purpose |
| --- | --- |
| `android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so` | The compiled native FSF (ARM64). |
| `android/app/src/main/java/.../EnginePlugin.java` | Capacitor plugin: exec engine, pipe UCI, copy variant. |
| `android/app/src/main/java/.../MainActivity.java` | `registerPlugin(EnginePlugin.class)`. |
| `android/app/src/main/AndroidManifest.xml` | `android:extractNativeLibs="true"`. |
| `android/app/build.gradle` | `packagingOptions.jniLibs.useLegacyPackaging = true`. |
| `public/variants.ini` | Variant definition, carried into the APK assets. |
| `src/lib/chess/nativeEngine.ts` | JS bridge + UCI driver + `isNativeEngineAvailable()`. |
| `src/lib/chess/engine.ts` | Native-vs-HTTP transport branch (2 functions). |

**Untouched (and that's the point):** `bot.ts`, `search.ts`, `boardToFen`, `parseUciMove`,
`DIFFICULTY_CONFIG` — the engine swap is invisible to the game/awareness logic.
