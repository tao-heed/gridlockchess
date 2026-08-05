# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Gridlock Chess — Fairy-Stockfish engine server (server.js) container image.
#
# This image ships ONLY the backend: server.js + variants.ini + the native
# Fairy-Stockfish binary + backend node_modules. The React app is NOT included.
#
# Base is Debian "bookworm-slim", NOT Alpine, on purpose: the official
# Fairy-Stockfish Linux releases are glibc-linked, and Alpine's musl libc would
# fail to run them. Do not switch to an Alpine base without a musl engine build.
#
# The engine binary is downloaded at build time from a URL you supply, so the
# same Dockerfile builds for x86-64 (Koyeb / most hosts) and arm64 (Oracle
# Ampere) — you just pass the matching release asset:
#
#   x86-64:
#     docker build --build-arg FSF_URL="https://github.com/fairy-stockfish/Fairy-Stockfish/releases/download/<tag>/fairy-stockfish-largeboard_x86-64" -t gridlock-engine .
#   arm64 (build ON an arm64 host, e.g. the Oracle VM):
#     docker build --build-arg FSF_URL="https://.../fairy-stockfish-largeboard_<arm asset>" -t gridlock-engine .
#
# Verify the exact asset name for the current release at:
#   https://github.com/fairy-stockfish/Fairy-Stockfish/releases/latest
# (Use a "largeboard" build to match the local dev binary.) If the asset is
# zipped, unzip it and host/point FSF_URL at the raw binary.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: backend production dependencies (pinned via package-lock.json) ──
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Installs the full "dependencies" set (frontend deps ride along but are unused
# by server.js). Pinned + reproducible via the lockfile; omits devDependencies.
RUN npm ci --omit=dev

# ── Stage 2: fetch the native engine binary (curl stays out of the runtime) ──
FROM debian:bookworm-slim AS engine
ARG FSF_URL
RUN if [ -z "$FSF_URL" ]; then \
      echo "ERROR: build-arg FSF_URL is required (Fairy-Stockfish Linux binary for the target arch)"; \
      exit 1; \
    fi
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /engine \
 && curl -fSL "$FSF_URL" -o /engine/fairy-stockfish \
 && chmod +x /engine/fairy-stockfish

# ── Stage 3: lean runtime ──
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Backend deps, app code, engine binary, and variant definition.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=engine /engine/fairy-stockfish ./bin/fairy-stockfish
COPY server.js ./
COPY variants.ini ./

# Deterministic engine path (skips the OS-candidate probing entirely).
ENV ENGINE_PATH=/app/bin/fairy-stockfish
# Sensible defaults; override per host (Oracle: raise POOL_SIZE/THREADS to cores).
ENV ENGINE_PORT=3005
ENV ENGINE_POOL_SIZE=1
ENV ENGINE_THREADS=2
ENV ENGINE_HASH=128

# Run unprivileged (the node image ships a non-root `node` user).
RUN chown -R node:node /app
USER node

EXPOSE 3005

# Uses the /health endpoint; Node 20 has global fetch, so no extra tools needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.ENGINE_PORT||3005)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
