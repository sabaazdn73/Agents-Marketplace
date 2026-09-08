# model.py
#
# One `reason(prompt, schema)` interface. The provider is a config value, so
# swapping Gemini for Anthropic later is an env change, not a rewrite.
#
# WHY IT DEGRADES INSTEAD OF RAISING
# ----------------------------------
# A missing key is a deployment state, not a bug, and the pipeline is
# deliberately useful without one: QA is deterministic and Handoff needs no
# model at all. So with no key configured this returns
# {"degraded": True, "would_have": "..."} and each model-backed agent
# surfaces that as its result. The pipeline completes and explains itself.
#
# It never fabricates a plausible answer in degraded mode. "Here is what I
# would have asked the model" is useful; a guessed size or a made-up product
# is worse than nothing, because everything downstream would price and
# potentially BUY against it.
#
# MODEL PINNING, from live measurement 2026-09-08
# -----------------------------------------------
# `gemini-2.5-flash` now 404s for new users -- the API's own error names
# `gemini-3.6-flash` as the replacement, and that model answered a live call
# successfully. The moving alias `gemini-flash-latest` returned 503 (high
# demand) on the same run, so the default is PINNED to a specific version
# rather than an alias that can change or be unavailable underneath us.

from __future__ import annotations

import asyncio
import json
import os
import re

DEFAULT_PROVIDER = "gemini"
DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"

# Every model call is bounded. An unbounded call would hang a request until
# the client gives up, with no diagnosis of where it stopped.
#
# 90 seconds, from measurement rather than taste. The first value here was
# 45, which was a guess, and gemini-3.6-flash on this key answered the
# context prompt in 34.9s, then timed out at 45.0s, then answered in 44.7s.
# Sitting the limit on top of the observed range turns a slow model into an
# intermittent failure, which is the worst of both: the call still costs the
# time and the result is thrown away.
DEFAULT_TIMEOUT_SECONDS = 90.0


class ModelUnavailable(RuntimeError):
    """The provider is configured but the call could not be completed."""


def provider_name() -> str:
    return (os.environ.get("COMMERCE_MODEL_PROVIDER") or DEFAULT_PROVIDER).strip().lower()


def model_name() -> str:
    return (os.environ.get("COMMERCE_MODEL") or DEFAULT_GEMINI_MODEL).strip()


def _api_key() -> str | None:
    if provider_name() == "gemini":
        return os.environ.get("GEMINI_API_KEY") or None
    if provider_name() == "anthropic":
        return os.environ.get("ANTHROPIC_API_KEY") or None
    return None


def is_configured() -> bool:
    return bool(_api_key())


def status() -> dict:
    """For the readiness endpoint and the self-check. Never returns the key."""
    return {
        "provider": provider_name(),
        "model": model_name(),
        "configured": is_configured(),
        "env_var": "GEMINI_API_KEY" if provider_name() == "gemini" else "ANTHROPIC_API_KEY",
    }


def _degraded(intent: str) -> dict:
    return {
        "degraded": True,
        "would_have": intent,
        "reason": f"{status()['env_var']} is not set, so no model call was made.",
    }


def _extract_json(text: str) -> dict | None:
    """Models wrap JSON in prose or fences often enough that this is required
    rather than defensive. Returns None when there is genuinely no object --
    the caller then reports a parse failure instead of inventing a result."""
    if not text:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return None


async def reason(
    prompt: str,
    schema_hint: str,
    *,
    intent: str,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict:
    """Ask the model for one JSON object.

    Returns either the parsed object, or a {"degraded": True, ...} dict.
    Never raises for an unconfigured provider -- that is a supported state.
    """
    if not is_configured():
        return _degraded(intent)

    provider = provider_name()
    if provider == "gemini":
        return await _reason_gemini(prompt, schema_hint, intent=intent, timeout=timeout)
    if provider == "anthropic":
        # Deliberately not implemented rather than guessed: the interface is
        # here so the swap is config, but writing an unexercised second
        # provider would be untested code on a path that handles money.
        return {
            "degraded": True,
            "would_have": intent,
            "reason": "provider 'anthropic' is selected but its client is not implemented in this build.",
        }
    return {
        "degraded": True,
        "would_have": intent,
        "reason": f"unknown COMMERCE_MODEL_PROVIDER={provider!r}",
    }


async def _reason_gemini(prompt: str, schema_hint: str, *, intent: str, timeout: float) -> dict:
    try:
        from google import genai
    except ImportError:
        return {
            "degraded": True,
            "would_have": intent,
            "reason": "google-genai is not installed (see backend/requirements.txt).",
        }

    client = genai.Client(api_key=_api_key())
    full = (
        f"{prompt}\n\n"
        f"Respond with ONE JSON object and nothing else. Shape:\n{schema_hint}\n"
        "If you cannot determine a field, use null rather than inventing a value."
    )

    def _call():
        return client.models.generate_content(model=model_name(), contents=full)

    try:
        # The SDK call is blocking, so it goes to a thread; wait_for bounds it
        # so a hung provider cannot hold the request open indefinitely.
        resp = await asyncio.wait_for(asyncio.to_thread(_call), timeout=timeout)
    except asyncio.TimeoutError:
        raise ModelUnavailable(f"model call exceeded {timeout}s") from None
    except Exception as e:  # provider errors are surfaced, never swallowed
        raise ModelUnavailable(f"{type(e).__name__}: {str(e)[:200]}") from None

    parsed = _extract_json(getattr(resp, "text", "") or "")
    if parsed is None:
        raise ModelUnavailable("model response contained no JSON object")
    return parsed
