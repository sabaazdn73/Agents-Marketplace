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
# MODEL CHOICE, from live measurement 2026-09-09
# gemini-3.6-flash ran out of free quota and returned 429 RESOURCE_EXHAUSTED
# on every call. Five Flash models were timed on the same prompt, the Sydney
# in December case that separates a month lookup from actual reasoning about
# hemispheres:
#   gemini-3.7-flash        1.7s   correct
#   gemini-3.5-flash-lite   0.8s   correct, but it is the smallest tier
#   gemini-3.5-flash       12.8s   correct
#   gemini-3.8-flash       77.6s   correct
#   gemini-3.6-flash          -    429, no quota left
# gemini-3.7-flash is the default: full Flash tier rather than lite, correct
# on the case that matters, and forty times faster than what it replaces.
# COMMERCE_MODEL overrides it, so the next switch is one environment value.
#
# EARLIER MODEL PINNING NOTE, from 2026-09-08
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
DEFAULT_GEMINI_MODEL = "gemini-3.7-flash"

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

# Transient provider failures are retried; everything else fails fast.
#
# Both of these are the provider saying "try again", not "this is wrong":
#   429 RESOURCE_EXHAUSTED  quota or rate limit
#   503 UNAVAILABLE         "experiencing high demand ... usually temporary"
#
# Only 429 used to be retried. A 503 raised on the first failure and killed
# the whole run at its first agent, which is what a user hit: the provider
# said the spike was temporary and we did not wait even once. This file's own
# notes had already recorded a 503 from an alias months earlier, so the case
# was known and simply never added to the retry test.
#
# 500 INTERNAL and 504 DEADLINE_EXCEEDED are included on the same reasoning.
# They are matched as whole status tokens rather than as substrings, because
# a bare "500" search would also match a number inside an unrelated message.
TRANSIENT_STATUS = ("RESOURCE_EXHAUSTED", "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED")
TRANSIENT_CODES = (429, 503, 500, 504)

# Three attempts in total. A single retry was not enough for a demand spike,
# which is measured in tens of seconds rather than one pause, and the delays
# are kept short enough that a run still finishes inside a reasonable wait.
RETRY_BACKOFF_SECONDS = (3.0, 9.0)
RATE_LIMIT_BACKOFF_SECONDS = RETRY_BACKOFF_SECONDS[0]  # kept: referenced elsewhere


def _transient_kind(text: str) -> str | None:
    """'throttled', 'busy', or None. Read from the provider's own status
    token and code so the message to the user can say which it was."""
    upper = text.upper()
    code = None
    for c in TRANSIENT_CODES:
        # "503 UNAVAILABLE" or "'code': 503"
        if re.search(rf"\b{c}\b", text):
            code = c
            break
    if "RESOURCE_EXHAUSTED" in upper or code == 429:
        return "throttled"
    if any(s in upper for s in ("UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED")) or code in (503, 500, 504):
        return "busy"
    return None



class ModelUnavailable(RuntimeError):
    """The provider is configured but the call could not be completed."""


class RateLimited(ModelUnavailable):
    """The provider is throttling. Temporary, and worth retrying."""


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

    async def _once():
        return await asyncio.wait_for(asyncio.to_thread(_call), timeout=timeout)

    resp = None
    last_kind: str | None = None
    waited = 0.0
    attempts = len(RETRY_BACKOFF_SECONDS) + 1
    for attempt in range(attempts):
        try:
            resp = await _once()
            break
        except asyncio.TimeoutError:
            raise ModelUnavailable(f"model call exceeded {timeout}s") from None
        except Exception as e:
            text = f"{type(e).__name__}: {str(e)[:200]}"
            kind = _transient_kind(text)
            if kind is None:
                # A real error: a bad key, an unknown model, a malformed
                # request. Retrying cannot help and would only delay the
                # report, so it is surfaced immediately.
                raise ModelUnavailable(text) from None
            last_kind = kind
            if attempt == attempts - 1:
                break
            delay = RETRY_BACKOFF_SECONDS[attempt]
            waited += delay
            await asyncio.sleep(delay)

    if resp is None:
        # Say which of the two it was, in the provider's own terms, and say
        # what was actually tried. "Try again later" is only fair advice if
        # the user knows waiting has already been attempted on their behalf.
        tried = f"Tried {attempts} times over {waited:.0f}s."
        if last_kind == "throttled":
            raise RateLimited(
                f"{model_name()} is rate limited. {tried} This is a quota limit on the "
                f"API key rather than a fault, and it clears on its own."
            ) from None
        raise ModelUnavailable(
            f"{model_name()} is busy: the provider reported high demand. {tried} "
            f"Nothing is wrong with the request, and it usually clears within a minute."
        ) from None

    parsed = _extract_json(getattr(resp, "text", "") or "")
    if parsed is None:
        raise ModelUnavailable("model response contained no JSON object")
    return parsed
