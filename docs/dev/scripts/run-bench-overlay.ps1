# run-bench-overlay.ps1 — launch the Option B (full strength) vs shipped FSF+Overlay benchmark.
# Avoids the long inline env chain (which the terminal's stray ^U keeps corrupting).
# Usage:  ./docs/dev/scripts/run-bench-overlay.ps1                 # full run (10 games)
#         $env:GC_GAMES=2; $env:GC_VERBOSE=1; ./docs/dev/scripts/run-bench-overlay.ps1  # quick timing probe
#
# Requires the unthrottled proxy on :3006:
#   $env:PORT=3006; $env:RATE_LIMIT_MAX=100000; $env:ENGINE_MAX_QUEUE=500; node server.js

param()

# Point Option B at the unthrottled proxy (Option B fires ~40 calls/move — the default :3005
# server's 60/min limit would 429 instantly).
if (-not $env:VITE_ENGINE_URL)      { $env:VITE_ENGINE_URL = 'http://localhost:3006' }

# Opponent = the SHIPPED bot (FSF + charge-aware overlay), strongest selectable tier.
if (-not $env:GC_OPPONENT)          { $env:GC_OPPONENT = 'overlay' }
if (-not $env:GC_OVERLAY_DIFFICULTY){ $env:GC_OVERLAY_DIFFICULTY = 'grandmaster' }

# Option B at FULL strength (user: fine if it takes ~60s/move — give its logic full justice).
if (-not $env:GC_GAMES)             { $env:GC_GAMES = '10' }
if (-not $env:GC_K)                 { $env:GC_K = '3' }
if (-not $env:GC_D)                 { $env:GC_D = '3' }
if (-not $env:GC_MOVETIME)          { $env:GC_MOVETIME = '300' }
if (-not $env:GC_LEAF_MOVETIME)     { $env:GC_LEAF_MOVETIME = '500' }
if (-not $env:GC_ENGINE_DEPTH)      { $env:GC_ENGINE_DEPTH = '12' }
if (-not $env:GC_TIME_BUDGET)       { $env:GC_TIME_BUDGET = '60000' }
if (-not $env:GC_WEIGHT)            { $env:GC_WEIGHT = '12' }
if (-not $env:GC_HYBRID)            { $env:GC_HYBRID = '1' }
if (-not $env:GC_MAX_PLIES)         { $env:GC_MAX_PLIES = '200' }
if (-not $env:GC_PROGRESS)          { $env:GC_PROGRESS = 'bench-overlay-fullstrength.log' }

Write-Host "Launching: A=OptionB(K=$($env:GC_K) D=$($env:GC_D)) vs B=overlay:$($env:GC_OVERLAY_DIFFICULTY)  games=$($env:GC_GAMES)  engine=$($env:VITE_ENGINE_URL)"
npm run bench:optionb
