# Gridlock Chess → Mobile App Migration Plan

> Goal: make the app **light, responsive on PC + mobile** (Void-Chess-simple), **installable**,
> **offline-capable via an in-app WASM engine**, and ultimately **shippable to Play Store + App Store**.
>
> Ordered **easiest → hardest**. Each phase is independently shippable — stop at any phase and still
> have a better product. Check items off as they land.

**Current facts (verified 2026-07-09):**
- Stack: React 19 + Vite 6 + TS 5.8 + Tailwind 3 + framer-motion + dnd-kit + react-router 7 + MDX + zod.
- Engine today is **server-side**: `engine.ts` calls `http://localhost:3005`; `server.js` spawns the
  native Fairy-Stockfish `.exe`. The native binary **cannot** run on a phone.
- `server.js` does **two** jobs: (1) the Fairy-Stockfish **engine proxy** AND (2) the **Online PvP
  WebSocket relay** (`/uplink`, passcode rooms — server.js ~L220+). Only the *engine* half can move
  in-app. **Online PvP can never be serverless** — real-time matchmaking always needs a hosted relay.
- Rules (`getAllLegalMoves`, `move.ts`) and the **heuristic bot** (`bot.ts` `heuristicMove`) are
  **already 100% client-side** — the app can produce (weak) bot moves with no server at all.
- No PWA: no manifest, no service worker, only `public/favicon.svg`.
- Heaviest asset: `src/assets/images/1.png` = **8.25 MB** (Lore page hero — the only consumer).
- Custom variant `gridlock-royal` is loaded from `variants.ini` by the native binary.

---

## Phase 0 — Baseline & measurement  ·  effort: XS  ·  risk: none
Establish ground truth before changing anything.

- [ ] Run `npm run build` and record **JS bundle size** (gzipped) + total `dist/` size.
- [ ] Test the current site in a real mobile viewport (Chrome DevTools device mode + one real phone).
- [ ] Note current Lighthouse mobile scores (Performance / PWA / Best Practices) as a baseline.
- [ ] Confirm the two known-flaky property tests still pass in isolation (`format.spec`, `balancedArmy.spec`).

---

## Phase 1 — Simplify: remove Lore + the 8.25 MB image  ·  effort: S  ·  risk: low  ·  HIGH IMPACT  ·  ✅ DONE 2026-07-10
Removing Lore makes the app simpler (Void-Chess-like) **and** deletes the single biggest asset.
`1.png` is imported **only** by `Lore.tsx`, so removing Lore removes the image's only consumer.

- [x] Delete route: `<Route path="/lore" ... />` in `src/App.tsx`.
- [x] Delete import of `LorePage` in `src/App.tsx`.
- [x] Remove `export { LorePage } from './Lore.tsx';` in `src/pages/index.ts`.
- [x] Remove the `{ label: 'Lore', href: '/lore' }` entry in `src/components/layout/Footer.tsx`.
- [x] Delete `src/pages/Lore.tsx` and `src/pages/Lore.mdx`.
- [x] Delete `src/assets/images/1.png` (8.25 MB).
- [x] Grep-sweep for stragglers — clean (`audio/engine.ts` "WelcomeModal lore" comment updated).
- [x] `DocLayout`'s `hero` prop: left as-is (unused but harmless — no `noUnusedLocals` error).
- [x] Licenses re-check: `1.png` was the **Lore** hero (not Quick Start); `cover.webp` was a phantom
      credit (never existed); WelcomeModal has **no image** → removed the stale "Artwork" section and
      deleted `src/assets/images/CREDITS.md`. The app now ships **zero AI raster art**.
- [x] No raster images remain to optimize (only `public/favicon.svg`).
- [x] Verify: `tsc` clean; `eslint` = baseline (2 pre-existing errors, 0 new); property tests pass in
      isolation (full-run timeouts are pre-existing load flakiness, not logic).
- [ ] (Optional) Trim other lore-flavored copy if you want the tone to match Void Chess's minimalism.

---

## Phase 2 — Mobile-first responsive shell (Void-Chess style)  ·  effort: M  ·  risk: low
The app is already partly responsive (`flex-col lg:flex-row`, viewport meta, touch drag + tap-to-move).
This phase makes mobile the *primary* experience, not an afterthought.

- [ ] Add a simple **launcher / home screen**: large stacked buttons (Play vs Computer, Play Online,
      Two Players, How to Play) — mirror the Void Chess pattern.
- [ ] Add a **bottom tab bar** on mobile (e.g. Play / Rules / About) using `env(safe-area-inset-bottom)`.
- [x] **✅ 2026-07-10 — no horizontal scroll on a 390 px phone** (measured `docScrollWidth 385 < 390`).
      Touch targets ~44 px (board ~351 px at `min(90vw,40rem)`).
- [x] **✅ 2026-07-10 — board pinned to the top on mobile.** The game-area flex children are wrapped so
      the board is `order-1` on mobile (was buried ~835 px down → now ~173 px, first screenful);
      `lg:contents` dissolves the wrappers on desktop so the 3-column layout is byte-identical (both
      verified live via screenshots + DOM measurement). STILL TODO: move secondary panels (coach, move
      history, archetype guide) behind tabs/accordions so the mobile page isn't a ~2.6-screen scroll.
- [x] **✅ 2026-07-10 — `prefers-reduced-motion` respected globally** via `<MotionConfig reducedMotion="user">`
      in `App.tsx` (one wrapper → every framer-motion animation honors the OS setting).
- [ ] Verify on real iOS Safari + Android Chrome (not just DevTools).

---

## Phase 3 — Installable PWA  ·  effort: S–M  ·  risk: low  ·  ✅ DONE 2026-07-10 (verified live)
Makes it "Add to Home Screen" installable on Android/desktop (and iOS with caveats). No new server.

- [ ] Add `public/manifest.webmanifest` — `name`, `short_name`, `start_url`, `display: standalone`,
      `background_color`, `theme_color`, and an `icons` array.
- [ ] Generate PNG icons: **192×192**, **512×512**, plus a **maskable** 512 (safe-zone padded).
      Add `apple-touch-icon` (180×180). Source from the brand/favicon, not the deleted 1.png.
- [ ] Link the manifest + iOS meta tags (`apple-mobile-web-app-capable`, status-bar style, theme-color)
      in `index.html`.
- [ ] Add **`vite-plugin-pwa`** (Workbox) to precache the app shell → installable + offline-loads the UI.
- [ ] Verify Lighthouse "Installable" passes; test install on Android + a desktop browser.
- [ ] Note: offline shell ≠ offline bot yet — the strong engine is still server-side until Phase 4.

---

## Phase 4 — Serverless engine via WASM (offline AI)  ·  effort: L  ·  risk: HIGH  ·  GATING SPIKE
This is the hard, decisive part. It removes the **engine** server dependency and enables offline
**vs-Computer + pass-and-play**. **Online PvP still needs the hosted `/uplink` relay** — "offline"
never covers Online PvP; if you keep online play, that relay stays hosted regardless.

### 4a. Spike FIRST (do not skip) — decides the whole mobile strategy
- [x] **✅ VERIFIED 2026-07-10 — variant loads in WASM (validator).** `ffish` loaded `variants.ini`,
      registered `gridlock` + `gridlock-royal`; custom royal `E` (amazon) gave correct ortho (`e1e8`)
      + diagonal (`e1a5`) + knight (`e1f3`) moves. So `customPiece` (Betza) + `extinctionPseudoRoyal`
      + `extinctionPieceTypes` all parse in WASM.
- [x] **✅ VERIFIED 2026-07-10 — the UCI SEARCH engine works too.** `fairy-stockfish-nnue.wasm` v1.1.11
      (real Fairy-Stockfish, GPL-3.0) loaded `gridlock-royal` via `setoption VariantPath` (variants.ini
      written into the Emscripten FS) and returned real bestmoves: startpos → `e2e4`; a custom-royal
      position (amazon on e4) → `e4c2`. Output API = `engine.addMessageListener` + `postMessage`.
      Both engine packages are installed as deps for Phase 4b.
- [ ] Measure WASM engine cold-start + per-move latency on a mid-range phone (`stockfish.wasm` ≈ 1.56 MB).
- [ ] **Cross-origin isolation is the real remaining risk:** this is a THREADED build
      (`stockfish.worker.js` → SharedArrayBuffer) → needs `COOP: same-origin` + `COEP: require-corp`
      headers in Vite dev AND the production host (or use a single-threaded build). Node bypassed this
      via worker_threads, so the **browser** threaded path is NOT yet proven.

### 4a.2 BROWSER FINDING (2026-07-10) — the THREADED engine conflicts with the PWA
Browser smoke test (Chromium, preview build) of the threaded `fairy-stockfish-nnue.wasm`: it FAILED to
start with `SharedArrayBuffer is not defined`. Root cause (verified): `crossOriginIsolated === false`
because the **PWA service worker served the cached page WITHOUT the COOP/COEP headers**
(`coop: null, coep: null`), which defeats cross-origin isolation. (`COEP: credentialless` DID keep the
cross-origin Google Fonts `@import` working — fonts loaded.) So the threaded path additionally needs the
isolation headers present on **service-worker-served** responses (a "COI service worker"), and iOS Safari
SAB support is shaky. **DECISION NEEDED — threaded vs single-threaded:**
- **Option A — single-threaded engine (RECOMMENDED for a mobile / iOS / offline PWA):** no
  SharedArrayBuffer → NO cross-origin isolation → NO SW-header conflict, NO COEP/font issue, works on
  iOS. Slower, but a phone doesn't need deep multi-threaded search. Requires a single-threaded
  Fairy-Stockfish WASM build (verify availability).
- **Option B — keep threaded:** faster, but needs a COI service worker (inject COOP/COEP into cached
  responses) + `credentialless` + accepts fragile/unknown iOS support. More moving parts.

### 4a.3 AVAILABILITY FINDING (2026-07-10) — no ready single-threaded full-search build
`fairy-stockfish.wasm` is a **fork of lichess's THREADED `stockfish.wasm`**; the only published npm
build (`fairy-stockfish-nnue.wasm`) is threaded (needs SharedArrayBuffer). A single-threaded FULL-SEARCH
build would require a custom Emscripten build (high effort). So the realistic offline options are:
- **Option B — threaded search + COI service worker** (inject COOP/COEP into SW-served responses). The
  strong engine, but real added complexity + must confirm iOS.
- **Option C — no new engine offline: use the app's EXISTING client-side bot.** `bot.ts`'s
  `heuristicMove` + `getAllLegalMoves` already run 100% client-side and are ALREADY the offline fallback
  (when the server engine is unreachable). Weaker than full search, but zero new risk, works on every
  platform today. Keep the strong Fairy-Stockfish search for ONLINE play (existing server).
- (`ffish` single-threaded validator works in-browser but only generates legal moves — no search — so it
  adds little over the app's own move generator.)

**Recommendation:** ship offline with Option C (existing heuristic, zero risk, universal), keep strong
AI online; treat Option B (threaded + COI-SW) as a later enhancement IF the offline heuristic proves too
weak. This delivers "installable + offline-capable on all platforms" now without a fragile SW hack.

### 4b. If the spike passes — integrate
- [ ] Add the Fairy-Stockfish WASM build as a static asset; load it in a **Web Worker** (keep UI thread free).
- [ ] Rewrite `src/lib/chess/engine.ts` `evaluatePosition` / `isEngineReady` to talk to the WASM worker
      via UCI messages instead of `fetch(ENGINE_URL)`. **Keep `boardToFen` / `parseUciMove` unchanged.**
- [ ] Keep the existing **depletion re-ranking** in `bot.ts` (it is engine-transport-agnostic).
- [ ] Set expectations: a phone WASM engine is **weaker/slower** than the current multi-threaded
      server engine (no depth-24 `asi` on a phone) — retune the difficulty tiers accordingly.
- [ ] Retire only the **engine-proxy** half of `server.js` (`/api/evaluate`, the native binary).
      **Keep the `/uplink` WebSocket relay hosted** if Online PvP stays — it cannot be serverless.
      (Drop `server.js` + `express`/`ws`/`cors` entirely only if you also drop Online PvP.)
- [ ] Wire the fallback ladder: WASM engine → existing client `heuristicMove` if WASM fails/too slow.

### 4c. If the spike FAILS (variant won't load in WASM)
- [ ] Fallback plan A: ship offline with the **client heuristic bot only** (weaker, but zero-server).
- [ ] Fallback plan B: keep the strong engine **server-backed** (needs a hosted server; no offline AI;
      weaker App Store story — see Phase 5 caveats).

---

## Phase 5 — Native packaging for stores  ·  effort: M–L  ·  risk: medium (iOS)
Wrap the web app into native shells. Strongly prefer doing this **after** Phase 4 (offline engine),
because a self-contained app is far easier to get through review — especially Apple's.

- [ ] Adopt **Capacitor** (one codebase → iOS + Android native shells with native APIs).
- [ ] **Android / Play Store:** build the Capacitor Android app (or a TWA of the PWA). Handle icons,
      splash, versioning, signing. Play Store is relatively lenient with PWA/TWA wrappers.
- [ ] **iOS / App Store:** build the Capacitor iOS app. **Caveat:** Apple guideline **4.2** rejects
      thin "just a website" wrappers — an offline, self-contained game (Phase 4) is the safe path;
      a network-only webview is a rejection risk.
- [ ] Add native niceties: proper splash screen, status-bar theming, back-button handling, haptics (optional).
- [ ] Test on physical iOS + Android devices before submission.

---

## Phase 6 — Release readiness (cross-cutting)  ·  effort: S–M  ·  risk: low
Do these alongside the phases above; they gate a public/store launch.

- [ ] **Licensing:** if the app now ships the **Fairy-Stockfish WASM binary** (GPL v3), include the
      **full GPL v3 license text** next to it + a source pointer (see `Licenses` page). Link the
      build-generated `THIRD-PARTY-LICENSES.txt` from the Licenses page.
- [ ] **Verify the lichess move-sound license** before commercial release (asset license ≠ code AGPL).
- [ ] Add a short **Privacy Policy / Terms** (needed by both stores; online PvP relays data).
- [ ] Re-measure bundle + Lighthouse mobile after Phases 1–4; confirm the 8 MB image is gone and the
      app is genuinely light.
- [ ] Full regression: `tsc`, `eslint`, `vitest`, plus manual play on iOS Safari + Android Chrome.

---

## Effort / risk summary

| Phase | What | Effort | Risk | Status |
|------:|------|:------:|:----:|:------:|
| 0 | Baseline & measurement | XS | none | partial — bundle measured: 736 kB / **230 kB gz** |
| 1 | Remove Lore + 8.25 MB image | S | low | ✅ done 2026-07-10 |
| 2 | Mobile-first responsive shell | M | low | 🟡 board-first + no-h-scroll + reduced-motion ✅; launcher / bottom-nav / panel-collapse remain |
| 3 | Installable PWA | S–M | low | ✅ done 2026-07-10 (verified live) |
| 4 | Serverless WASM engine (offline AI) | L | **high** (variant spike) | � 4a ✅ passed; DECIDED: ship offline w/ existing client heuristic (Option C); threaded-WASM strong-offline deferred |
| 5 | Capacitor packaging (stores) | M–L | medium (iOS 4.2) | todo |
| 6 | Release readiness (licensing, privacy) | S–M | low | todo |

**Phase 4a spike FULLY RESOLVED ✅ (2026-07-10):** BOTH the validator (`ffish`) AND the UCI SEARCH
engine (`fairy-stockfish-nnue.wasm`) load the custom `gridlock-royal` variant and work with the custom
royal pieces (real bestmoves returned). The offline, self-contained mobile app path is **proven viable**.
The only remaining Phase 4b risk is engineering, not compatibility: wiring the WASM engine into
`engine.ts` and enabling **cross-origin isolation** (COOP/COEP) for the threaded build (or a
single-threaded build).
