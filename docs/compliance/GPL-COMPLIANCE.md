# GPL Compliance — Gridlock Chess × Fairy-Stockfish Fuel Modification

## Purpose

Gridlock Chess bundles a **modified** build of Fairy-Stockfish (`libgridlockfsf.so`, ARM64)
inside the Android APK. The modification adds a custom `fuel` UCI command that enables
charge-aware search, and strips the upstream variant library down to the single Gridlock
variant definition. Fairy-Stockfish (and its upstream, Stockfish) is licensed under
**GPL v3**, which requires that if you distribute a modified binary, you acknowledge the
modification and make the source available — or provide a **written offer** to do so.

This document tracks the compliance strategy, current status, and the exact steps to
execute when a request arrives.

---

## Strategy — GPL v3 §6(b) Written Offer

GPL v3 gives three ways to comply when distributing a modified binary. This project uses
**§6(b): written offer**. Instead of publishing the source immediately, the in-app legal
page carries a written offer to provide the complete corresponding source to anyone who
requests it. The offer must be valid for **at least 3 years** from the distribution date.

This is a fully legitimate compliance path used by many embedded/commercial projects.
No source code needs to be published unless a request is received.

**What stays private forever:** All TypeScript/JavaScript source (`bot.ts`, `nativeEngine.ts`,
game logic, tier system, heuristics). GPL only covers the modified C++ engine and its
runtime variant config. Your actual "secret recipe" is not affected.

**What must be ready to send on request:** The modified Fairy-Stockfish source at
`C:/New folder/Fairy-Stockfish`, branch `gridlock-fuel` — already committed locally.

---

## Current Status

| Item | Status |
|------|--------|
| Modified binary in APK (`libgridlockfsf.so`) | ✅ Done |
| `Licenses.mdx` acknowledges modification | ✅ Done |
| Written offer in `Licenses.mdx` (§6(b)) | ✅ Done — contact `gridlockchess.dev@gmail.com` |
| Fuel changes committed in local FSF repo | ✅ Done — branch `gridlock-fuel`, commits `eb4b3a1` + `4a643f2` |
| APK rebuilt with updated `Licenses.mdx` | ⏳ Pending — hold until all fixes done |
| APK uploaded to Google Play | ⏳ Pending |
| Distribution date recorded (see §Expiry) | ⏳ Pending — fill in on Play Store publish |
| Public fork on GitHub | ⏳ Only needed when a source request arrives |

---

## Risk Assessment

| Scenario | Risk Level | Notes |
|----------|-----------|-------|
| Ship APK with "unmodified" claim + no offer | **HIGH** | False statement in legal doc + clear GPL violation |
| Ship APK with modification acknowledged + written offer (§6(b)) | **LOW** | Fully compliant, no source required yet |
| Receive source request, respond within ~30 days | **LOW** | Standard cure period, good faith = closed case |
| Receive source request, ignore it | **HIGH** | Escalates to Play Store complaint, possible removal |
| Source published on GitHub (full public fork) | **ZERO** | Maximum compliance, no exposure |

**Who enforces GPL on small apps:** Software Freedom Conservancy (SFC), Stockfish/FSF
copyright holders, and community members. Enforcement for small indie games is rare.
Enforcement escalates when: the app grows large, has visible ad revenue, or a contributor
actively searches Google Play. The false "unmodified" claim is the highest single risk factor
— it makes any complaint harder to cure.

---

## Step 1 — ✅ DONE: Update `Licenses.mdx`

**File:** `C:/New folder/test/src/pages/Licenses.mdx`

The Fairy-Stockfish section now:
- Describes the `fuel` UCI command modification honestly
- Includes the GPL v3 §6(b) written offer block
- Lists the contact email `gridlockchess.dev@gmail.com`
- Removes all prior "unmodified" claims

- [x] `Licenses.mdx` updated with modification acknowledgement and written offer
- [x] Contact email filled in (`gridlockchess.dev@gmail.com`)
- [ ] APK rebuilt and uploaded to Google Play *(hold — more fixes pending)*

---

## Step 2 — ✅ DONE: Commit Fuel Changes Locally

The modified source is committed on branch `gridlock-fuel` in `C:/New folder/Fairy-Stockfish`.

**Commits:**
- `eb4b3a1` — `Add fuel UCI command for Gridlock Chess charge-aware search`
  - Files: `src/evaluate.cpp`, `src/parser.cpp`, `src/position.cpp`, `src/position.h`,
    `src/types.h`, `src/uci.cpp`, `src/variant.h`
- `4a643f2` — `Add Gridlock variant definition (variants.ini)`
  - File: `src/variants.ini` — upstream 2126-line example library stripped to the
    71-line Gridlock-only definition. Required to reproduce the binary's runtime behavior.

- [x] `gridlock-fuel` branch created
- [x] Fuel changes committed (C++ + variant config — no TypeScript, no game code)

---

## Step 3 — When a Source Request Arrives

Follow these steps in order. Target: **respond within 14 days** (well within any cure period).

### 3a. Create public GitHub fork

A "fork" is just GitHub's term for copying someone else's public repo into your own account.
You need this so the source can live at a public URL you control.

**You need a GitHub account first.** If you don't have one:
1. Go to `https://github.com/signup`
2. Create a free account. Username `b33zsm00th` is referenced in this doc — use whatever username you have.

**Fork the upstream repo:**
1. Go to `https://github.com/fairy-stockfish/Fairy-Stockfish` (the official upstream)
2. Click the **Fork** button near the top-right of the page
3. GitHub will ask where to fork it — select your own account
4. Leave the name as `Fairy-Stockfish` and click **Create fork**
5. GitHub creates `https://github.com/<your-username>/Fairy-Stockfish` — this is your fork

That's it. The fork is now a public repo under your account. It starts as an identical copy
of the upstream — your modified branch is not there yet (Step 3b does that).

- [ ] GitHub account exists
- [ ] Fork created at `https://github.com/<your-username>/Fairy-Stockfish`

### 3b. Push the fuel branch

This sends your local `gridlock-fuel` branch (with the fuel commits) to your public fork.

Open a terminal and run:

```bash
cd "C:/New folder/Fairy-Stockfish"

# Add your fork as a remote (only need to do this once)
git remote add fork https://github.com/<your-username>/Fairy-Stockfish.git

# Push the branch
git push fork gridlock-fuel
```

Replace `<your-username>` with your actual GitHub username.

After the push, the branch is publicly visible at:
`https://github.com/<your-username>/Fairy-Stockfish/tree/gridlock-fuel`

Anyone can browse or download the source from that URL.

- [ ] Fork remote added (`git remote add fork ...`)
- [ ] `gridlock-fuel` branch pushed to public fork

### 3c. Update `Licenses.mdx` to link the fork

Replace the written offer block with a direct link:

```
- The modified source (fuel UCI command + Gridlock variant config) is at
  [github.com/<your-username>/Fairy-Stockfish/tree/gridlock-fuel](https://github.com/<your-username>/Fairy-Stockfish/tree/gridlock-fuel).
```

- [ ] `Licenses.mdx` updated with direct fork link
- [ ] APK rebuilt with updated legal page
- [ ] New APK uploaded to Google Play

### 3d. Reply to the requester

Send a response (email or Play Store reply) with the link to the fork. Keep it brief:

> "Thank you for your inquiry. The complete corresponding source code for the modified
> Fairy-Stockfish binary in Gridlock Chess is available at:
> https://github.com/<your-username>/Fairy-Stockfish/tree/gridlock-fuel
> This covers all modifications made to the upstream Fairy-Stockfish source."

- [ ] Reply sent with fork link

---

## File Locations Reference

| Item | Path |
|------|------|
| This document | `C:/New folder/test/docs/compliance/GPL-COMPLIANCE.md` |
| Modified FSF C++ source (local) | `C:/New folder/Fairy-Stockfish/` — branch `gridlock-fuel` |
| Committed fuel files | `src/evaluate.cpp`, `src/parser.cpp`, `src/position.cpp`, `src/position.h`, `src/types.h`, `src/uci.cpp`, `src/variant.h`, `src/variants.ini` |
| License page | `C:/New folder/test/src/pages/Licenses.mdx` |
| Bundled ARM64 binary (modified) | `C:/New folder/test/android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf.so` |
| Vanilla reference binary | `C:/New folder/test/android/app/src/main/jniLibs/arm64-v8a/libgridlockfsf-vanilla.so` |

---

## 3-Year Offer Expiry

GPL §6(b) requires the written offer to remain valid for **at least 3 years from the date
of distribution**. After that floor, either renew it or publish the fork publicly.

- Distribution start date: *(fill in when app goes live on Google Play)*
- Offer expiry (minimum): *(3 years from above)*

Set a calendar reminder at the 3-year mark to either:
- Update the legal page with a renewed offer, **or**
- Push the `gridlock-fuel` branch to your public fork (makes the offer moot forever)

- [ ] Distribution date recorded
- [ ] Calendar reminder set for offer renewal/expiry
