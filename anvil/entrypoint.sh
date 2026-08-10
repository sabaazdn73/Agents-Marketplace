#!/bin/bash
# Starts BOTH processes in the single Web Service container:
#   - Anvil, bound to 127.0.0.1:8545 ONLY (never on the public interface)
#   - gateway.py, on the public $PORT (Render-assigned), fronting Anvil
# If EITHER dies, we exit non-zero so Render restarts the whole container
# (otherwise the gateway would keep serving a dead Anvil).
set -euo pipefail

: "${FORK_RPC_URL:?FORK_RPC_URL is required — an ARCHIVE-capable BSC RPC (see Dockerfile)}"
export PORT="${PORT:-10000}"

if [ -z "${PRACTICE_ADMIN_KEY:-}" ]; then
  echo "[practice-fork] WARNING: PRACTICE_ADMIN_KEY is not set — /admin/rpc will reject ALL calls, so funding will fail. Set it (same value as the backend)."
fi

echo "[practice-fork] starting Anvil on 127.0.0.1:8545 (forked from BSC mainnet, ephemeral — re-forks fresh on restart)"
anvil --host 127.0.0.1 --port 8545 --chain-id 56 --fork-url "${FORK_RPC_URL}" &
ANVIL_PID=$!

# Wait for Anvil to answer before exposing the gateway.
for i in $(seq 1 60); do
  if python3 - <<'PY' 2>/dev/null
import urllib.request
req = urllib.request.Request(
    "http://127.0.0.1:8545",
    data=b'{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}',
    headers={"Content-Type": "application/json"})
urllib.request.urlopen(req, timeout=2).read()
PY
  then
    echo "[practice-fork] Anvil is up"
    break
  fi
  sleep 1
done

echo "[practice-fork] starting public gateway on 0.0.0.0:${PORT}"
python3 /gateway.py &
GATEWAY_PID=$!

# Exit as soon as either process exits, so Render restarts the service.
wait -n "$ANVIL_PID" "$GATEWAY_PID"
echo "[practice-fork] a process exited — stopping the container so Render restarts it"
kill "$ANVIL_PID" "$GATEWAY_PID" 2>/dev/null || true
exit 1
