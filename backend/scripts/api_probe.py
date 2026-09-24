"""Probe the live API's user-facing endpoints and record every failure.

Written to answer one question with data rather than inference: which
requests actually fail, how often, and for how long at a stretch. The
marketplace intermittently showed "Failed to fetch", and the agent-list
fetch was given a retry, but a second report named a different endpoint
(/api/my-jobs), so the failures are not specific to one call.

Records to a TSV. Prints only transitions, so a long healthy run stays
quiet and an outage is visible as it starts and ends.
"""
import json, time, urllib.request, urllib.error, sys, os

BASE = os.environ.get("PROBE_BASE", "https://agents-marketplace-q3k4.onrender.com")
OUT = os.environ.get("PROBE_OUT", "/tmp/api_probe.tsv")
# One cheap, one heavy, one per-user. The heavy one is what the browser
# waits on; the cheap one separates "backend down" from "this route slow".
# my-jobs is a POST with the wallet in the body: the GET form, which put the
# address in the query string and so in access logs, now answers 410.
ENDPOINTS = [
    ("status", "/api/status", None),
    ("agents", "/api/agents", None),
    ("my-jobs", "/api/my-jobs",
     {"client_address": "0x48ce74cdc366e8347f17f7187fbf2ab9240692e9"}),
]
INTERVAL = 20
TIMEOUT = 45

def probe(path, body=None):
    t0 = time.time()
    try:
        headers = {"User-Agent": "tnega-probe"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        req = urllib.request.Request(BASE + path, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
        return r.status, len(body), time.time() - t0, ""
    except urllib.error.HTTPError as e:
        return e.code, 0, time.time() - t0, f"HTTP {e.code}"
    except Exception as e:
        return 0, 0, time.time() - t0, type(e).__name__

def main():
    last = {}
    with open(OUT, "a", buffering=1) as log:
        while True:
            stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            for name, path, body in ENDPOINTS:
                code, size, secs, err = probe(path, body)
                ok = code == 200
                log.write(f"{stamp}\t{name}\t{code}\t{size}\t{secs:.1f}\t{err}\n")
                if last.get(name) is not None and last[name] != ok:
                    state = "RECOVERED" if ok else f"FAILING ({err or code})"
                    print(f"{stamp}  {name}: {state}  {secs:.1f}s", flush=True)
                last[name] = ok
            time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
