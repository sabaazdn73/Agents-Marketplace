# Practice Layer fork, packaged as ONE public Docker Web Service (Render free
# tier — no card, no persistent disk). Inside the container:
#   - Anvil binds 127.0.0.1:8545 only (never public).
#   - gateway.py listens on the public $PORT and is the ONLY exposed process.
#     It forwards to Anvil, but blocks admin cheats (anvil_*/hardhat_*/evm_*) on
#     its public door, and only forwards them via an authenticated /admin/rpc
#     door (shared secret PRACTICE_ADMIN_KEY, which only our backend knows).
#
# Why a Web Service (not a Private Service): Render's FREE tier covers public
# Web Services; Private Services are paid-only. Binding Anvil to localhost +
# the filtering gateway gives Private-Service-grade safety on the free tier.
FROM ghcr.io/foundry-rs/foundry:latest

# FORK_RPC_URL MUST be an ARCHIVE-capable BSC endpoint. Pruned public endpoints
# (bsc-dataseed.binance.org, publicnode, ankr public) intermittently crash anvil
# with "missing trie node" once the fork block ages out of their pruning window
# (a long-lived fork always hits this). Only an archive node keeps serving it.
#
# Provision a free archive endpoint (recommended: dRPC — confirmed free-tier BSC
# archive, ~210M compute units/month): drpc.org -> create a key -> enable BNB
# Smart Chain -> copy your HTTPS endpoint URL. Any provider with CONFIRMED
# free-tier archive works (dRPC, BlockPI); avoid ones where archive is a paid
# add-on. Set FORK_RPC_URL + PRACTICE_ADMIN_KEY in the Render dashboard.

# python3 (stdlib only) runs the tiny gateway; apt as root, then back to default.
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

COPY gateway.py /gateway.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Render assigns $PORT at runtime; the gateway binds it. EXPOSE is informational.
EXPOSE 10000
ENTRYPOINT ["/entrypoint.sh"]
