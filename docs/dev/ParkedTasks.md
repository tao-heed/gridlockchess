# Parked Tasks — Gridlock Chess

Deferred work with rationale, so nothing is silently forgotten. Each item notes **why it's
parked** and **what unblocks it**. This is a living to-do; update as items land.

Related: security-specific items live in [`SecurityChecklist.md`](./SecurityChecklist.md)
(the "Parked" section there, P1–P7). This file is the broader task park, including that.

Last reviewed: 2026-07-05

---

## ⚠️ In-progress / half-done (finish or decide first)

### G0 — Git repo is initialized but NOT committed
- **State:** `git init` was run; **141 files staged** with a validated `.gitignore`
  (engine `.exe` + `node_modules` + `dist` correctly excluded; `docs/dev/scripts/*.mjs` verification scripts tracked).
  **No commit exists yet** because git has no `user.name` / `user.email` configured.
- **Blocker:** commit identity not set — deferred by user ("not for now"). No name/email
  was provided (an earlier example name was a made-up placeholder, not real data).
- **Unblocks when:** you provide a name + email (local or global), then a first commit
  snapshots the current TSC-clean baseline.
- **Risk while parked:** still **no version history / no rollback.** The staged state is not
  a safety net — only a commit is. Losing the folder still loses everything.

---

## Hosting / deployment (needed for internet PvP — China ↔ Brazil)

### H1 — Public host for `server.js`
- **Why:** cross-geography Uplink PvP needs the relay on a public server; a home machine on
  `0.0.0.0` is only LAN-reachable (see SecurityChecklist P1/P3).
- **Unblocks when:** user commits to hosting + picks a provider (VPS/cloud).
- **Note:** PvP-only host does **not** need the engine binary; a bot host needs the **Linux**
  Fairy-Stockfish largeboard build (the committed reference is Windows-only) — see
  [`bin/README.md`](../../bin/README.md).

### H2 — Domain + TLS
- **Why:** `wss://` requires HTTPS with a valid cert; browsers block `wss` from HTTPS pages
  without one (SecurityChecklist P2).
- **Unblocks when:** H1 exists (need a host to point DNS + cert at).

### H3 — Reverse proxy for `/uplink`
- **Why:** standard hosting serves on 443; the relay listens on 3005. Proxy `/uplink` → 3005
  and serve the static build on 443.
- **Ready:** build side is done — `VITE_UPLINK_URL` override exists
  ([`protocol.ts`](../../src/lib/net/protocol.ts) `uplinkUrl()`). Build with
  `VITE_UPLINK_URL=wss://yourdomain/uplink npm run build`.
- **Not written yet:** the actual proxy config (Caddy/nginx). I can draft it on request.

---

## Security (see SecurityChecklist.md for full detail)

### S1 — Server binding `0.0.0.0` → decide localhost vs public
- **Parked:** binding to `127.0.0.1` closes LAN exposure but breaks cross-device Uplink;
  the real goal is internet PvP, so the fix is proper hosting (H1–H3), not a bind change.
- **Owner:** user decision. Do not silently change.

### S2 — Origin / CORS allow-list on the relay
- **Parked:** only meaningful once public (H1–H3). Premature on localhost.

### S3 — Rate limiting (`/api/evaluate` + WS relay)
- **Parked (real tradeoff):** a real-time move relay is sensitive to dropped/delayed frames;
  naive throttling can hurt legit rapid play. Needs a token bucket sized to real move cadence.
  **Requires explicit go-ahead** — I won't add it blindly.

### S4 — Passcode-room auth / server-side move validation
- **Parked (by design):** relay is "friends-trust, not cheat-proof." Server-side rule
  validation = re-implementing engine legality checks in the relay (large effort). Revisit
  only if PvP becomes ranked/adversarial.

---

## IP / ownership polish

### I1 — Resolve `[OWNER_PLACEHOLDER]` tokens ✅ DONE
- **Where:** [`LICENSE`](../../LICENSE), [`Licenses.mdx`](../../src/pages/Licenses.mdx),
  [`Footer.tsx`](../../src/components/layout/Footer.tsx).
- **Resolved:** owner is now `1khl45` (indie developer). The UI reads it from a single
  source of truth — [`src/constants/brand.ts`](../../src/constants/brand.ts) (`BRAND.owner`) —
  which both the footer and the Licenses page import, so renaming is a one-line edit. The
  static `LICENSE` file holds the name literally (it can't import) and is the only manual
  spot to keep in sync.

### I2 — Reconcile `developer.name` vs legal `owner` ✅ DONE
- **Where:** `Footer.tsx`.
- **Resolved:** the separate `developer` credit was removed; the "Built by" credit now uses
  `BRAND.owner`/`BRAND.ownerUrl`, so credit and rights-holder are unified on the indie
  creator. Set `BRAND.ownerUrl` (currently `'#'`, renders as plain text) to a real profile
  URL to turn the credit into a link.

---

## Notes on how to use this file
- When an item lands, move it out of "parked" (delete it or note it done in the relevant doc).
- Keep rationale — the *why parked* is the valuable part; it prevents re-litigating decisions.
- Security items are cross-referenced with `SecurityChecklist.md`; update both together.
