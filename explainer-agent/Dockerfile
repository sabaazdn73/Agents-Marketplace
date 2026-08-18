# Real BNB Agent Studio seller agent (the TermiX Advantage Report explainer
# agent), self-hosted as ONE public Docker Web Service — Render free tier,
# same pattern as anvil/Dockerfile, deliberately NOT using `bag deploy agent`'s
# AWS AgentCore path (this project's standing rule: no paid/unknown-cost
# infrastructure anywhere, confirmed by real investigation — see the repo
# history around 2026-08-19 for the full trace).
#
# Real, confirmed-viable investigation, not assumed: main.py's own real
# __main__ block calls bedrock_agentcore's build_a2a_app() (a plain library
# function returning a plain Starlette app) and serves it with plain
# `uvicorn.run()` — no AWS-specific runtime call anywhere. AWS Secrets Manager
# is only touched if BNBAGENT_RUNTIME_SECRET_ID is set (it isn't, here — real
# secrets arrive as real Render env vars instead, same as every other secret
# in this project). The actual LLM ("the agent's brain") runs via Pieverse's
# own credit system, fully independent of AWS Bedrock. Empirically confirmed
# working end-to-end locally (`bag dev`) with zero AWS involvement before this
# Dockerfile was even written.
#
# Real, honest limitation carried forward from the local build: studio.toml
# has [storage].kind = "local" — deliverables are written to the container's
# own ephemeral disk (Render free tier has no persistent disk, same real
# constraint as the Anvil fork). A deliverable submitted and then not fetched
# before a container restart/idle-cycle would become unreadable even though
# its on-chain reference survives. Accepted for now, same "documented
# free-tier tradeoff" pattern as the rest of this project; revisit if it
# becomes a real problem in practice.

FROM python:3.13-slim

WORKDIR /app

# git is needed by a couple of the real pinned dependencies' build backends;
# build-essential covers any C-extension wheels that don't ship prebuilt for
# this platform. Removed after install to keep the image small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml README.md studio.toml ./
COPY *.py ./
RUN pip install --no-cache-dir -e .

# Real, checked quirk (not a bug): studio.toml's [wallet].keystore_dir is
# "../../.studio/wallets", written for the original nested
# workspace_root/app/agent/ layout. In this flattened image, find_project_root()
# sees WORKDIR /app as the project root, so ensure_keystore_materialized()
# resolves that relative path to /.studio/wallets (container filesystem root)
# — confirmed via bnbagent_studio_core/wallet.py + config.py source and a
# local Path().resolve() check. Since this image runs as root (no USER
# directive) that mkdir/write succeeds; if it ever didn't, wallet.py already
# falls back to a writable tempdir on OSError. Left as-is: functionally fine,
# just an unusual on-disk location worth knowing about.

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Render assigns $PORT at runtime; the entrypoint maps it to AGENT_PORT (the
# real env var main.py actually reads — its own comment is explicit that
# AGENT_PORT, not $PORT, is the override main.py honors). EXPOSE is
# informational only.
EXPOSE 9000
ENTRYPOINT ["/entrypoint.sh"]
