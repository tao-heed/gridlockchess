# Security Checklist — Gridlock Chess

Status snapshot for the app's network surfaces. Split into **Implemented** (verified in
code) and **Parked** (not done — future work with rationale). Severities assume the app's
*current* reality: a localhost dev tool whose engine URL is hardcoded to `localhost:3005`,
with an Uplink relay intended (long-term) for internet PvP but **not yet publicly hosted**.

> Threat-model note: two threat models coexist here.
> - **Today:** everything runs on `localhost` / LAN. Risks are low.
> - **Intended future:** the Uplink relay faces the public internet (cross-geography PvP).
>   The moment that happens, several "low" items become real. Parked items are scoped for
>   *that* future.

---

## Implemented (done + validated)

All four land in [`server.js`](../../server.js); the URL change is in
[`src/lib/net/protocol.ts`](../../src/lib/net/protocol.ts). Each was validated with
`node --check server.js` and/or `tsc -b` clean.

| # | Fix | Where | Severity addressed | Breaks legit use? |
|---|-----|-------|--------------------|-------------------|
| 1 | **FEN validation / sanitization** — reject non-string, `>200` chars, or anything outside `[A-Za-z0-9/\- ]` before it reaches the engine's stdin | `server.js` `/api/evaluate` (`FEN_ALLOWED` regex) | Low–Med — closes a stdin/UCI command-injection boundary (a newline in a FEN could inject extra UCI commands). No RCE ceiling: UCI has no shell command. | No — valid FENs (incl. fairy royal glyphs `e/f/g/h/i/j/s`) contain no newlines. |
| 2 | **Search-parameter clamping** — `depth 1–32`, `movetime 50–10000ms`, `multipv 1–20`, `skill 0–20` via `clampInt()` | `server.js` `/api/evaluate` | Low — prevents CPU pinning via unbounded search (`{depth:999, movetime:9999999}`) | No — ceilings sit above the heaviest real preset (asi `depth 24`/`movetime 4000`; beginner `multipv 15`). |
| 3 | **HTTP body size cap** — `express.json({ limit: '16kb' })` | `server.js` app setup | Low — rejects oversized payloads | No — a FEN is <100 bytes. |
| 4 | **WebSocket frame cap** — `maxPayload: 64 * 1024` on the Uplink relay | `server.js` `WebSocketServer` | Low today / Med if public — `ws` defaults to 100 MB per frame; caps a peer shipping multi-MB frames | No — heaviest legit message (`state-init`: 8×8 board + vectors) is a few KB. |
| 5 | **Configurable Uplink URL** — `VITE_UPLINK_URL` override; falls back to LAN/localhost `:3005` | `src/lib/net/protocol.ts` `uplinkUrl()`, typed in `src/vite-env.d.ts` | Enabler (not a fix) — removes the hardcoded `:3005` that blocks 443-behind-proxy hosting | No — unset = identical prior behavior. |

### Already present before this pass (verified, not newly added)
- **Player-name sanitization** — `sanitizePlayerName()` in `protocol.ts` strips control chars,
  collapses whitespace, caps to 20 chars, falls back to `'Opponent'`. Defense-in-depth
  (React already escapes on render, so not an XSS fix).
- **WebSocket heartbeat / dead-socket sweep** — ping/pong every 30s, `terminate()` on missed
  pong; prevents zombie peers blocking room rejoins. (Availability, not a security control.)
- **Malformed-frame tolerance** — relay `JSON.parse` in try/catch, ignores bad frames.
- **Room cap** — max 2 peers per room; third join rejected (`room-full`).

---

## Parked (NOT implemented — future work)

Ordered by what blocks internet PvP first. None of these are done.

### P1 — Server binding is `0.0.0.0`, not localhost
- **What:** `httpServer.listen(PORT)` has no host arg → Node binds **all interfaces**, despite
  the log saying "localhost". Reachable by anyone on the same LAN.
- **Severity:** Med on untrusted wifi (café/office); low on a trusted home network.
- **Why parked:** Binding to `127.0.0.1` would close LAN exposure **but break cross-device
  Uplink**, and the stated goal is *internet* PvP — so localhost binding is the wrong fix.
  The correct answer is a proper public host + reverse proxy (see P3), not a bind change.
- **Decision owner:** user. Do **not** silently change.

### P2 — No TLS / no HTTPS
- **What:** `server.js` serves plain HTTP; `wss://` only works if the *page* is HTTPS with a
  valid cert. No cert, no domain, nothing in-repo.
- **Severity:** High **for public hosting** (unencrypted relay traffic, browsers block `wss`
  from HTTPS pages without valid TLS). N/A on localhost.
- **Why parked:** Infrastructure, not code. Needs a domain + cert (Let's Encrypt via proxy).

### P3 — No public host / reverse proxy
- **What:** For China↔Brazil play, `server.js` must run on a public server, with `/uplink`
  reverse-proxied to `:3005` and the static build served on 443. No deployment config exists
  (no Dockerfile, vercel.json, netlify.toml, Procfile, `.env`).
- **Severity:** Hard blocker for the stated goal (not a vuln — a missing capability).
- **Why parked:** Hosting decision the user hasn't committed to yet. `VITE_UPLINK_URL` (done)
  makes the build side ready.

### P4 — No origin / CORS restriction on the relay
- **What:** `app.use(cors())` is wide-open; the WS relay does no origin check.
- **Severity:** Low today (localhost); Low–Med if public (any site could open a socket to the
  relay). The relay only shuttles game frames between two passcode-matched peers, so blast
  radius is small, but an allow-list is cheap defense-in-depth once public.
- **Why parked:** Only meaningful after P2/P3. Premature on localhost.

### P5 — No rate limiting on `/api/evaluate` or the WS relay
- **What:** No throttle on request or message frequency.
- **Severity:** Low today; Low–Med if public (a peer could spam moves/eval requests).
- **Why parked (important tradeoff):** A real-time move relay is sensitive to dropped/delayed
  frames; naive per-socket throttling can hurt legitimate rapid play. Needs deliberate design
  (token bucket sized to real move cadence), not a blanket limiter. **User go-ahead required.**

### P6 — Passcode rooms are guessable / no auth
- **What:** Rooms are short passcodes; relay is "friends-trust, not cheat-proof, by design"
  (documented in `server.js`). No authentication; no move-legality validation server-side
  (moves relayed verbatim — a malicious client could send illegal state).
- **Severity:** Low (by design for friends play); Med only if used competitively/publicly.
- **Why parked:** Intentional design choice. Server-side rule validation would be a large
  effort (re-implement the engine's legality checks in the relay) and contradicts the current
  trust model. Revisit only if PvP becomes ranked/adversarial.

### P7 — No git repository (highest-value, lowest-effort)
- **What:** No version control anywhere in the workspace.
- **Severity:** Not a runtime vuln, but the **biggest IP/recovery gap.** No rollback, no
  history, no protection for the LICENSE/footer/docs IP work.
- **Why parked:** Awaiting user go-ahead. Recommended as the immediate next step *before*
  any hosting experiments. Needs a `.gitignore` (node_modules, dist, `bin/*.exe`, `server.err`).

---

## What is deliberately NOT recommended (avoid over-engineering)

These would be cargo-cult for this app's architecture — listed so future-me doesn't add them
reflexively:

- **Helmet / CSP / HSTS on `server.js`** — the server serves **no HTML**, only a JSON API +
  WS relay; the UI is a separate Vite static build. CSP protects pages the server serves;
  there are none. HSTS needs TLS that doesn't exist yet. Add security headers at the **static
  host / reverse proxy** layer instead, if/when hosting happens.
- **Heavyweight auth/session stack** — contradicts the friends-trust passcode model (P6).
- **Per-call engine sandboxing** — the engine spawns **once** at boot (`startEngine()`); calls
  only write UCI to the persistent process. No per-request process to sandbox.

---

## Corrections logged (for honesty / future accuracy)
- Earlier claim that `/api/evaluate` "spawns an engine per call" was **wrong**. Verified in
  `startEngine()`: the binary spawns **once**; requests write `position fen` + `go` to that
  single persistent process. Real DoS vector was CPU monopolization (now clamped, fix #2),
  not process spawning.
- Initial framing that CORS/Helmet were the headline was surface-level. After reading the
  code, the real findings were the injection boundary (#1) and the `0.0.0.0` binding (P1) —
  found by reading `send()` and the `listen()` call, not by pattern-matching for middleware.
