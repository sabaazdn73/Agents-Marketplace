"""
agent_builder.py

The REAL "build in the browser" pipeline. Every function here shells
out to the actual `bag` CLI (bnbagent-studio), confirmed working via
a live test run (9 Aug 2026: `bag init` really scaffolded a full
project, installed 175 real packages, confirmed `[deploy]
destination = "platform"` is the real default, a free 48h testnet
trial requiring no user AWS account).

Security model, stated plainly: each build gets a fresh, throwaway
BSC TESTNET wallet, created server-side, funded with test tokens only.
This matches the platform trial's own documented model ("RECOMMENDED:
use a fresh throwaway testnet wallet, its key is sent to the
operator's Secrets Manager on deploy"), not a new risk this project
invented. Nothing here ever touches mainnet or a real-value wallet.
"""

import asyncio
import os
import re
import secrets
import shutil
import subprocess
from pathlib import Path

BUILDS_ROOT = Path(os.environ.get("AGENT_BUILDS_ROOT", "/tmp/agent-builds"))
BAG_BIN = os.environ.get("BAG_BIN", "bag")  # path to the bag executable, e.g. a dedicated venv's bin/bag


def slugify(description: str) -> str:
    """Alphanumeric-only, matching AgentCore's real, confirmed naming
    rule: '-', '_', '.' rejected, AND a hard 23-character total limit
    (confirmed live: a 26-char name was rejected with 'over the
    23-character limit'). Base is capped at 17 chars to leave room
    for a 6-char collision-avoidance suffix."""
    base = re.sub(r"[^a-zA-Z0-9]", "", description)[:17].lower()
    suffix = secrets.token_hex(3)  # 6 hex chars
    return f"{base or 'agent'}{suffix}"


async def _run(cmd: list[str], cwd: Path, env: dict, timeout: int = 300) -> tuple[int, str]:
    """Runs a real subprocess, non-interactively, captures combined
    output. Every real bag call in this module goes through this."""
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=str(cwd), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return -1, f"Command timed out after {timeout}s: {' '.join(cmd)}"
    return proc.returncode, stdout.decode(errors="replace")


def _base_env() -> dict:
    env = os.environ.copy()
    env["PATH"] = f"{Path(BAG_BIN).parent}:{env.get('PATH', '')}"
    return env


async def scaffold_agent(description: str) -> dict:
    """Step 1: real bag init. Returns the real project slug and the
    real command output, not a fabricated success message."""
    slug = slugify(description)
    BUILDS_ROOT.mkdir(parents=True, exist_ok=True)
    code, output = await _run(
        [BAG_BIN, "init", slug, "--network", "bsc-testnet", "--no-onboard"],
        cwd=BUILDS_ROOT, env=_base_env(),
    )
    return {"ok": code == 0, "slug": slug, "output": output}


async def create_wallet(slug: str) -> dict:
    """Step 2: a real, fresh, throwaway testnet wallet, encrypted
    locally with a random password generated server-side for this
    build only (never reused, never logged in full)."""
    project_dir = BUILDS_ROOT / slug / "app" / "agent"
    password = secrets.token_urlsafe(24)
    env = _base_env()
    env["WALLET_PASSWORD"] = password

    code, output = await _run([BAG_BIN, "wallet", "new"], cwd=project_dir, env=env)
    if code != 0:
        return {"ok": False, "output": output}

    # Real address, parsed from bag's own confirmed output format
    # (0x... printed on its own line), verify this matches a live run
    # before trusting it blindly for anything beyond display.
    address_match = re.search(r"0x[a-fA-F0-9]{40}", output)
    address = address_match.group(0) if address_match else None

    return {"ok": True, "address": address, "wallet_password": password, "output": output}


async def activate_llm(slug: str, wallet_password: str) -> dict:
    """Step 3: Pieverse LLM, zero-deposit by default per the real config."""
    project_dir = BUILDS_ROOT / slug / "app" / "agent"
    env = _base_env()
    env["WALLET_PASSWORD"] = wallet_password
    code, output = await _run([BAG_BIN, "llm", "activate"], cwd=project_dir, env=env, timeout=120)
    return {"ok": code == 0, "output": output}


def write_agent_logic(slug: str, description: str) -> dict:
    """Step 4: sets the real agent's task behavior.

    CORRECTED 9 Aug 2026 after inspecting a real emitted project: there
    is no `handle_fulfill` function anywhere in the real output (the
    earlier assumption was wrong, caught by actually reading the file
    rather than trusting the docs' conversational summary). The real,
    confirmed customization point is the `instruction=(...)` string
    inside the `Agent(...)` call in main.py, this is what the ADK
    agent reads to know what it's actually supposed to do when
    `run_work` is invoked. This function replaces that string with
    one built from the user's real description, it does not invent a
    new function or append speculative code.
    """
    project_dir = BUILDS_ROOT / slug / "app" / "agent"
    main_py = project_dir / "main.py"
    if not main_py.exists():
        return {"ok": False, "error": f"{main_py} not found, scaffold may have failed"}

    content = main_py.read_text()

    # The real, confirmed default instruction block (verified against
    # a live-generated file), matched precisely so we replace exactly
    # this string, not a guess at where instructions "probably" are.
    default_instruction_marker = '"You are a seller agent. You do the actual work once a job is funded. "'
    if default_instruction_marker not in content:
        return {"ok": False, "error": "The expected default instruction string was not found in the "
                                       "real emitted main.py, the template may have changed, inspect "
                                       "the real file before writing again, don't guess a second time."}

    new_instruction = f'"You are a seller agent whose specific job is: {description.strip()}."'

    # Replace only the first quoted instruction line, leave the rest of
    # the real, working instruction block (tool-use guidance, x402
    # notes) intact rather than clobbering the whole thing.
    updated = content.replace(default_instruction_marker, new_instruction, 1)
    main_py.write_text(updated)
    return {"ok": True}


async def deploy_to_platform(slug: str, wallet_password: str) -> dict:
    """Step 5: the real free 48h testnet trial deploy. destination=platform
    is the confirmed real default, no AWS account needed."""
    project_dir = BUILDS_ROOT / slug / "app" / "agent"
    env = _base_env()
    env["WALLET_PASSWORD"] = wallet_password
    code, output = await _run([BAG_BIN, "deploy", "agent"], cwd=project_dir, env=env, timeout=600)
    return {"ok": code == 0, "output": output}


async def get_agent_status(slug: str, wallet_password: str) -> dict:
    """Real status check via bag doctor, not assumed healthy."""
    project_dir = BUILDS_ROOT / slug / "app" / "agent"
    env = _base_env()
    env["WALLET_PASSWORD"] = wallet_password
    code, output = await _run([BAG_BIN, "doctor"], cwd=project_dir, env=env, timeout=60)
    return {"ok": code == 0, "output": output}


def cleanup_build(slug: str) -> None:
    """Removes a build's real files from disk, for expiry/cleanup
    jobs (the platform trial auto-reclaims at 48h, this just cleans
    our own local scratch copy)."""
    project_dir = BUILDS_ROOT / slug
    if project_dir.exists() and project_dir.is_relative_to(BUILDS_ROOT):
        shutil.rmtree(project_dir)
