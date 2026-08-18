#!/bin/bash
# Starts the ONE process in this Web Service container: the real BNB Agent
# Studio seller agent (main.py), a plain Starlette/uvicorn A2A server — see
# the Dockerfile's header comment for why this has no hard AWS dependency.
set -euo pipefail

: "${WALLET_PASSWORD:?WALLET_PASSWORD is required — unlocks this agent real V3 keystore}"
: "${WALLET_KEYSTORE_JSON:?WALLET_KEYSTORE_JSON is required — the real encrypted keystore JSON (ensure_keystore_materialized() writes it to disk on boot)}"

# main.py reads AGENT_PORT (not $PORT) for the bind port — see main.py's own
# __main__ block. Render assigns $PORT at runtime; map it here.
export AGENT_PORT="${PORT:-9000}"
export AGENT_BIND_HOST="0.0.0.0"

echo "[explainer-agent] starting on 0.0.0.0:${AGENT_PORT}"
exec python main.py
