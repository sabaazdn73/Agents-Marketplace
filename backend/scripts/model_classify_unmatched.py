"""
Classify the served agents that keyword matching could not place, using the
model rather than more keywords.

Read only against Mongo by default. It writes nothing unless --apply is
passed, and even then it writes to a SEPARATE field (`model_category`) so
the keyword classification stays exactly as it is and the two can be
compared rather than one silently overwriting the other.

Agents are sent in batches, because one call per agent would be 8,345 calls
against a free tier that has already been seen to run out of quota. A batch
returns one label per agent, keyed by index, and any agent the model does
not return a label for is left unclassified rather than guessed at.

The taxonomy handed to the model is the existing one from categorize.py. It
is not allowed to invent a category, and "none" is an explicit, expected
answer for an agent whose description genuinely says nothing useful, which a
lot of them do: a description of "premium" or "bnbagent" is not a category
problem.
"""
from __future__ import annotations

import asyncio
import json
import os
import pathlib
import sys
import time
from collections import Counter

from dotenv import load_dotenv

sys.path.insert(0, "/Users/sabaazadegan/Documents/DDIB2026/F2F-Agents/backend")
load_dotenv("/Users/sabaazadegan/Documents/DDIB2026/F2F-Agents/backend/.env")

from motor.motor_asyncio import AsyncIOMotorClient   # noqa: E402
from pymongo import UpdateOne                        # noqa: E402
from core.categorize import CATEGORIES               # noqa: E402
from core.commerce import model                      # noqa: E402

BATCH = 40
CONCURRENCY = 3
# Free-tier Gemini answered 503 on 3 of 4 parallel calls. Fewer in flight,
# larger batches, and a pause between windows trades wall time for a
# completion rate that is actually usable.
WINDOW_PAUSE = 4.0
MAX_DESC = 300
OUT = pathlib.Path(__file__).with_name("model_classify_result.json")

TAXONOMY = ", ".join(CATEGORIES)


def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def build_prompt(rows) -> str:
    lines = []
    for i, (_id, name, desc) in enumerate(rows):
        d = (desc or "").replace("\n", " ").strip()[:MAX_DESC]
        lines.append(f'{i}. name: "{name}" | description: "{d}"')
    listing = "\n".join(lines)
    return (
        "You are labelling AI agents registered on a blockchain agent registry.\n"
        f"Allowed categories, use these exact strings and nothing else:\n{TAXONOMY}\n\n"
        "Rules:\n"
        "- Pick the single best category for each agent.\n"
        "- Use \"none\" when the text genuinely does not say what the agent does. "
        "Many entries are placeholders like \"premium\" or a repeated name. "
        "\"none\" is the correct answer for those, do not guess.\n"
        "- Judge only from the text given. Do not infer from the name alone "
        "unless the name plainly states the function.\n"
        "- Descriptions may be in any language. Classify them the same way.\n\n"
        f"Agents:\n{listing}\n\n"
        'Return JSON: {"labels": {"0": "Category or none", "1": "..."}} '
        "with one entry per agent index above."
    )


# reason() raises ModelUnavailable on a 503 or a quota error rather than
# returning degraded, and Gemini answered 503 "high demand" on the first
# attempt here. Both are temporary, so this retries with backoff instead of
# throwing the batch away, and only gives up after MAX_TRIES.
MAX_TRIES = 5
BACKOFF = 8.0


MODEL_FALLBACKS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-3.5-flash"]


async def classify_batch(rows, sem):
    delay = BACKOFF
    for attempt in range(MAX_TRIES):
        # A model that has run out of daily quota stays out of quota, so
        # rotating on retry is what actually helps here, not just waiting.
        os.environ["COMMERCE_MODEL"] = MODEL_FALLBACKS[attempt % len(MODEL_FALLBACKS)]
        try:
            async with sem:
                out = await model.reason(
                    build_prompt(rows),
                    '{"labels": {"<index>": "<category or none>"}}',
                    intent="classify uncategorised registry agents",
                    timeout=120.0,
                )
        except Exception as e:
            if attempt == MAX_TRIES - 1:
                return None, f"{type(e).__name__}: {str(e)[:120]}"
            await asyncio.sleep(delay)
            delay *= 1.8
            continue
        if out.get("degraded"):
            return None, out.get("reason", "degraded")
        labels = out.get("labels")
        if not isinstance(labels, dict):
            if attempt == MAX_TRIES - 1:
                return None, "no labels object in the response"
            await asyncio.sleep(delay)
            delay *= 1.8
            continue
        return labels, None
    return None, "exhausted retries"


async def main():
    apply = "--apply" in sys.argv
    limit = None
    for a in sys.argv[1:]:
        if a.startswith("--limit="):
            limit = int(a.split("=")[1])

    cl = AsyncIOMotorClient(os.environ["MONGODB_URI"])
    db = cl[os.environ.get("MONGODB_DB_NAME", "agents_marketplace")]
    ka = db.known_agents

    log(f"model: {model.status()}")
    if not model.is_configured():
        log("no model key configured, nothing to do")
        return

    q = {"$or": [{"category": None}, {"category": "Unclassified"},
                 {"category": {"$exists": False}}]}
    cur = ka.find(q, {"id": 1, "name": 1, "description": 1, "_id": 0})
    rows = [(d.get("id"), d.get("name") or "", d.get("description") or "")
            async for d in cur]
    if limit:
        rows = rows[:limit]
    log(f"{len(rows)} served agents with no category")

    batches = [rows[i:i + BATCH] for i in range(0, len(rows), BATCH)]
    sem = asyncio.Semaphore(CONCURRENCY)
    results: dict[str, str] = {}
    failures = 0
    t0 = time.time()

    for chunk_start in range(0, len(batches), CONCURRENCY):
        window = batches[chunk_start:chunk_start + CONCURRENCY]
        outs = await asyncio.gather(*(classify_batch(b, sem) for b in window))
        for b, (labels, err) in zip(window, outs):
            if labels is None:
                failures += 1
                continue
            for i, (aid, _n, _d) in enumerate(b):
                lab = str(labels.get(str(i), "none")).strip()
                if lab and lab.lower() != "none" and lab in CATEGORIES:
                    results[aid] = lab
        await asyncio.sleep(WINDOW_PAUSE)
        done = min(chunk_start + len(window), len(batches))
        log(f"  batches {done}/{len(batches)}  labelled {len(results)}  "
            f"failed batches {failures}  {time.time() - t0:.0f}s")

    counts = Counter(results.values())
    log(f"\nDONE in {time.time() - t0:.0f}s")
    log(f"  of {len(rows)} unclassified, the model placed {len(results)} "
        f"({100 * len(results) / max(1, len(rows)):.1f}%)")
    log(f"  left as none: {len(rows) - len(results)}")
    log(f"  failed batches: {failures} of {len(batches)}")
    print()
    for c, n in counts.most_common():
        print(f"   {c:30s}{n:>6}")

    FOUR = ["Rebalancing", "Grid Trading", "Yield Optimisation", "Health Factor Monitoring"]
    print("\n  of which, under the four hackathon labels:")
    for c in FOUR:
        print(f"   {c:30s}{counts.get(c, 0):>6}")

    OUT.write_text(json.dumps({"labels": results, "counts": dict(counts),
                               "considered": len(rows), "failed_batches": failures}, indent=1))
    log(f"\nwritten to {OUT.name}")

    if apply and results:
        ops = [UpdateOne({"id": aid}, {"$set": {"model_category": c,
                                                "model_category_at": time.time()}})
               for aid, c in results.items()]
        for i in range(0, len(ops), 1000):
            await ka.bulk_write(ops[i:i + 1000], ordered=False)
        log(f"applied model_category to {len(ops)} documents "
            f"(the keyword `category` field is untouched)")

asyncio.run(main())
