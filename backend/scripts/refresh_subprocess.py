"""
refresh_subprocess.py

Runs ONE agent-list refresh in a short-lived process, writes the encoded
response body to a file, and exits.

Why a subprocess at all. The refresh reads up to 30,000 known_agents
documents to diversify down to the ~15,700 actually served. Those objects
are freed afterwards, but CPython does not reliably return freed arenas to
the OS, and fragmentation means each cycle's peak lands in fresh ones. The
result is a resident-memory ratchet, measured on the live store at roughly
+40MB across three cycles from an 82MB baseline, which is what kept
walking the web service into its 512Mi ceiling. Nothing in the refresh
leaks in the ordinary sense; gc.collect() does not help, because the
memory is genuinely free inside the process and simply not given back.

Exiting the process is the one thing that reliably gives it back. So the
transient lives here and dies here, and the parent only ever receives the
finished bytes.

Deliberately calls server._refresh_into_store() rather than
reimplementing it. That function also upserts into known_agents and runs
the bounded health-check pass, and its output must stay byte-identical to
the in-process path, so this reuses it exactly rather than approximating
it.

Contract with the parent:
  argv[1]  path to write the encoded body to
  stdout   a single JSON line: {"count": N, "bytes": M}
  exit 0   success; anything else means the parent keeps its existing cache
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import server  # noqa: E402  (after sys.path/env setup)


async def main() -> int:
    out_path = sys.argv[1]
    served = await server._refresh_into_store()
    if not served:
        # A refresh that produced nothing is not a success. Signalling
        # failure means the parent keeps whatever it was already serving,
        # which is the whole point of doing this out of process.
        print(json.dumps({"count": 0, "bytes": 0}), flush=True)
        return 3
    body = server._encode_agents(served)
    with open(out_path, "wb") as fh:
        fh.write(body)
    print(json.dumps({"count": len(served), "bytes": len(body)}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
