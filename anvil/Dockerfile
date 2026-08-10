# Persistent Anvil fork of live BSC mainnet for the Practice Layer.
#
# Runs as a Render PRIVATE SERVICE (internal-only). The backend reaches it at
# http://<service-name>:8545 and exposes it to the browser through the
# allow-listed proxy at /api/practice/rpc — the admin RPC (anvil_* cheat
# methods) is never public.
FROM ghcr.io/foundry-rs/foundry:latest

# FORK_RPC_URL MUST be an ARCHIVE-capable BSC endpoint. Pruned public
# endpoints (e.g. bsc-dataseed.binance.org, publicnode) intermittently crash
# anvil with "missing trie node" / archive errors under whale-impersonation
# funding — and a LONG-LIVED fork always hits this eventually, because anvil
# lazily fetches state at the ORIGINAL fork block for any account it hasn't
# cached yet, and that block ages out of a full node's pruning window within
# minutes. Only an archive node keeps serving it.
#
# Provision a free archive endpoint (recommended: Alchemy):
#   dashboard.alchemy.com -> Create app -> BNB Smart Chain / Mainnet ->
#   copy https://bnb-mainnet.g.alchemy.com/v2/<API_KEY>  (archive included free)
# Alternatives: BlockPI (generous free archive), QuickNode (archive may be a
# paid add-on). Set FORK_RPC_URL as a Render secret (render.yaml: sync:false).
ENV PORT=8545

# --state persists the fork to disk (load on boot + periodic dump), so
# accumulated practice state survives restarts/redeploys when /data is a
# mounted persistent disk. --state-interval controls the dump cadence (s).
EXPOSE 8545
ENTRYPOINT []
# Log whether existing state was found on the mounted disk BEFORE starting, so
# a mis-mounted disk (state silently reset to nothing) is obvious in the logs
# rather than a mystery after deploy.
CMD ["sh", "-c", "if [ -s /data/anvil-state.json ]; then echo \"[practice-fork] LOADING existing state from /data/anvil-state.json ($(wc -c < /data/anvil-state.json) bytes) — disk mounted, state preserved\"; else echo \"[practice-fork] NO existing state at /data/anvil-state.json — starting FRESH (first boot, or /data disk NOT mounted correctly)\"; fi; exec anvil --host 0.0.0.0 --port ${PORT:-8545} --chain-id 56 --fork-url ${FORK_RPC_URL} --state /data/anvil-state.json --state-interval 30"]
