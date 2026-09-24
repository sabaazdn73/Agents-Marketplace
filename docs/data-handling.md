# Data handling and third-party terms

What the running system stores, what it deliberately does not, and the
outside constraints it works within. This describes the implementation. It
is not legal advice and no lawyer has reviewed it.

## Personal data

The one thing the backend stores about every site visitor is a salted hash
used to decide whether someone has visited before. One other store holds a
specific person's data, and only when that person pays: a PayBox session
keeps the paying wallet raw for 30 minutes. The access log, which is not a
store of ours but is written by this server, is covered under "Client IP
addresses" and "Wallet addresses in URLs".

There is also code for an API key table that would hold a salted
fingerprint of the wallet that signs for each key. That code,
`backend/publicapi/`, has never been mounted: no commit in this repository's
history imports it from `server.py` or any other entry point, so no route can
issue a key and nobody can have signed up. What it will store once mounted is
described under "Wallet addresses, written".

`backend/core/first_visit.py` takes the client address from
`X-Forwarded-For`, salts it with `FIRST_VISIT_SALT`, hashes it with SHA-256,
and keeps the first 32 hex characters with a timestamp. The address itself
is never written. Records expire after 90 days through a MongoDB TTL index,
so the collection stays a short-lived set of recent visitors rather than a
log that grows forever.

A cookie would be cleaner, because it is per-browser and stores nothing
about anyone. It does not work here: the frontend is on Vercel and the API
is on Render, so a cookie set by the API is third-party from the browser's
point of view, and Safari blocks those by default. The API's CORS is now an
explicit origin allowlist rather than the `allow_origins=["*"]` this
paragraph used to cite, so the wildcard objection no longer applies, but
`allow_credentials` is deliberately off and a credentialed cross-origin
request needs it on. The conclusion is unchanged: no cookie.

### The fallback salt is gone

This section used to end by saying `FIRST_VISIT_SALT` was unset, that the
code fell back to a fixed string in source, and that a known salt makes the
hash reversible for any address by anyone reading this repository. That is
now fixed on both sides. The variable is set on the deployment, and the
fallback has been removed from the code so that it cannot silently come back
if the variable is ever cleared.

There is no default salt and there will not be one. A default has to be a
constant in the file, and a hash taken against a constant a reader already
has is reversible by trying candidates until one matches. For an IPv4
address the candidate space is small enough to walk.

So with `FIRST_VISIT_SALT` unset the module hashes nothing, writes nothing
and reads nothing. `GET /api/first-visit` answers

    {"first_visit": null,
     "withheld_reason": {"code": "salt_not_configured", "detail": "..."}}

which is the absence shape the rest of this project uses for a measurement
it cannot make, the same one in `core/hyperliquid/corestate.py` and
`core/extension/subject.py`. `first_visit` is now `true`, `false` or `null`,
and `null` is never a quieter way of saying `false`. It used to report
`false` on every failure, which answered a question nothing had answered.

The process prints one line naming the variable and what is degraded, once
per process rather than once per request. An unconfigured deployment still
takes traffic at whatever rate the internet sends it, and a line per request
would push everything worth reading out of its own log.

`backend/core/wallet_hash.py` applies the same discipline to wallet
addresses, under its own `WALLET_HASH_SALT`. Its caller is
`backend/publicapi/keys.py`, which is not mounted, and with the salt unset
that module refuses to issue a key rather than store the address raw. The
running service also uses the module's address check, `is_address`, for
`POST /api/my-jobs`, which hashes nothing.

### The stored hashes were deleted, and this is the only record of it

Put here rather than only in a script, because this is where somebody
auditing what the site holds about its visitors will look.

On 2026-09-24 every document in the `home_first_visit` collection was
deleted from the PRODUCTION MongoDB, the database named by `MONGODB_URI` in
`backend/.env` and reached as `agents_marketplace`. This was a destructive
write against production, authorised by the project owner, and it is not
reversible: there is no backup of this collection and the deleted values
cannot be reconstructed.

The reason is the fallback above. Every hash written while
`FIRST_VISIT_SALT` was unset was taken against a string committed to this
repository, so each one could be reversed to an address by anyone who read
the file and tried candidates. Losing a few weeks of first-visit counts is
the smaller cost.

What was there before the delete, read rather than assumed:

| | |
|---|---|
| Collection | `home_first_visit` |
| Documents | 131 |
| Fields present across all of them | `_id` and `seen_at`, nothing else |
| `_id` | a 32-character hex string, which is the truncated digest |
| Date range of `seen_at` | 2026-09-06T22:35:55Z to 2026-09-19T17:34:22Z |
| Indexes | `_id_`, and `seen_at_1` with `expireAfterSeconds` 7776000 |

No document held an address in any field. The collection carried the digest
and a timestamp and nothing else, which is exactly what
`first_visit.check_and_record` writes, and is how the collection was
confirmed to be the one this is about before anything was deleted.

The delete was `delete_many({})`, not a drop. 131 documents deleted, 0
remaining, the collection and its 90-day TTL index left in place so the
feature keeps working. The upper bound of the date range is 2026-09-19,
which is the day the frontend stopped calling the endpoint, so nothing has
been written since and a re-count some hours later still read 0.

The check somebody else can run, against the same `MONGODB_URI`:

    db.home_first_visit.countDocuments({})

It should be 0, or a small number that is entirely later than
2026-09-24, from traffic after the purge. Any document with a `seen_at`
before 2026-09-24 would mean the delete did not take.

## Where an address can reach, audited

Established by reading the code, in September 2026, for both kinds of
address: a visitor's client IP, and a wallet address. Written, held in
memory and transmitted are different exposures and are kept apart here.

### Client IP addresses

| Where | What happens | Exposure | For how long |
|---|---|---|---|
| `core/first_visit.client_ip`, from `X-Forwarded-For` or the socket peer | The only place in the backend that reads a client IP. Hashed with the salt before anything else touches it | Held in memory for the length of one request | One request |
| `home_first_visit` collection | The 32-character digest and a timestamp. The address is never written | Written | 90 days by TTL index, and currently empty |
| `core/deliverable_proxy.py` | Resolves the host of a job's `deliverable_url` to an IP to refuse private ranges. This is infrastructure addressing, not a visitor | Held in memory | One request |
| uvicorn's access log | On by default. Each line is `client - "METHOD path?query HTTP/1.1" status`, where `client` is `scope["client"]` | Written to the platform's log | Render's retention, not ours |
| A third party | No `X-Forwarded-For` value is forwarded anywhere. No analytics or telemetry SDK is present in the backend or the frontend | None | n/a |

The access-log row needs a caveat the code cannot settle. uvicorn runs
`ProxyHeadersMiddleware` by default, which rewrites `scope["client"]` from
`X-Forwarded-For` only when the immediate peer is in `forwarded_allow_ips`,
which defaults to `127.0.0.1` and is overridable by `FORWARDED_ALLOW_IPS`.
Whether the access log shows the visitor's address or Render's proxy
therefore depends on a setting that is configured in the Render dashboard
and is not in this repository. The backend web service is not declared in
`render.yaml` at all, so its start command cannot be read from here. Someone
with dashboard access should check it rather than take this page's word.

### Wallet addresses in URLs, and therefore in logs

Whatever the access log resolves the client to, it records the path and the
query string. This list is read from the route decorators in `server.py`,
every GET route with a path or query parameter that can hold an address.

In the path:

- `/api/hyperliquid/address/{address}` and
  `/api/hyperliquid/history/{address}`: a Hyperliquid address.
- `/api/extension/subject/{identifier}`: an address or an agent id.
- `/api/token-risk/{contract_address}`: a token contract, not a wallet.

In the query string:

- `owner_address` on `/api/agents/performance`, `/api/agents/revenue`,
  `/api/agents/wallet-portfolio`, `/api/agents/activity`,
  `/api/agents/pnl-summary`, `/api/agents/onchain-performance`,
  `/api/agents/onchain-history`, `/api/canary/history`,
  `/api/agents/termix-performance` and `/api/agents/escrow-compatibility`.
- `owner` on `/api/budget-mode/status` and
  `/api/chain-agent/{chain_id}/{token_id}/evaluation`.
- `addresses` on `/api/hyperliquid/history`.
- `q` on `/api/search/resolve`: whatever was typed into search.
- `search` on `/api/agents` and `/api/agents/facets`: whatever was typed
  into the marketplace grid's search box.

The `owner_address` and `owner` routes are called by the frontend with an
agent's registered owner, which is public registry data, and the Hyperliquid
history routes with tracked leaderboard makers. Four are different, because
what they carry is whatever a person chose to look up, which can be their
own wallet:

- `/api/extension/subject/{identifier}`, from the extension's popup, where an
  address can be pasted in, and from its explorer and 8004scan panels.
- `/api/hyperliquid/address/{address}`, which the extension calls for every
  Hyperliquid address page opened, without consulting its list.
- `/api/search/resolve?q=`, from the site's search box, and `search` on
  `/api/agents` and `/api/agents/facets`, from the grid's.

Those put a looked-up address in the access log alongside the client
address of whoever looked it up. They are read-only and write nothing, but
the log line is the record. The privacy page says so for the extension.

One route used to carry the visitor's own connected wallet by design, and no
longer does.

`/api/my-jobs` takes the visitor's own connected wallet.
`frontend/src/MyJobsPanel.jsx`, which the web and mobile apps both render,
calls it with the address the browser wallet is connected as, every time the
My Agents tab opens.

That address used to ride in the query string, `GET
/api/my-jobs?client_address=0x...`, which put it in uvicorn's access log line
and in whatever request logs Render and Cloudflare keep in front of it. The
code now sends `POST /api/my-jobs` with the address in a JSON body,
`{"client_address": "0x..."}`. The access log line for it carries the client
address and the status code, as every line does, and the path
`/api/my-jobs` with no wallet in it. Nothing in this codebase writes the
wallet to a database or joins it to anything; it is used for the one scan
and returned in the response body to the caller who sent it.

A malformed body, whatever is wrong with it, gets one fixed 400 that repeats
nothing that was sent. The body is read by hand, capped at 256 bytes, rather
than declared as a model, because FastAPI's validation error for a model
repeats the offending input in its response.

This is what the code does. It is not yet what production does: the
backend deploys on Render and the frontend on Vercel, separately, and until
both have shipped, a new page can meet the old API, which answers the POST
405, or an old tab the new API, which answers its GET 410. The new page
shows "The service is updating. Reload in a minute." on the 405 and does not
fall back to the GET, because the GET is the leak. An old tab shows its own
generic error until it is reloaded.

The GET form was not kept for compatibility. It now answers 410 with a
sentence naming the POST, declares no parameter and echoes nothing from the
query string. A surviving GET that still served results would have kept the
leak open for any caller still using it, and a 410 cannot close it either.
uvicorn writes the access log line when the response starts, which is after
the handler has run, but the line carries the request's full path and query
string whatever the handler answered, so a caller that keeps sending the GET
keeps putting its address in the log. The only fix for that caller is
changing it. Every caller in this repository was changed,
`MyJobsPanel.jsx` and `backend/scripts/api_probe.py`; `extension/` never
called it.

Addresses logged before the change stay in logs we do not own and cannot
purge, for as long as those providers retain them.

### Wallet addresses, written

Most of these are public on-chain data this project deliberately indexes.
The owner of a registered agent, the client and provider of an ERC-8183 job,
the agent an escrow budget was opened against, and the makers on
Hyperliquid's published leaderboard are all already public, and are read
from a chain or from a venue's own public file rather than from anybody
using this site. They are listed because an audit that only listed the
awkward ones would not be an audit.

| Where | Which address | Exposure | For how long |
|---|---|---|---|
| `known_agents.owner_address` | Agent owner, from the registry | Written, raw | Permanent, subject to a 40,000-document cap |
| `full_agent_registry` | Agent owner, from 8004scan and TheGraph | Written, raw | Permanent |
| `erc8183_job_index.client` and `.provider` | Job counterparties, from the contract | Written, raw | Permanent |
| `budget_index.agent` | Decoded from `BudgetOpened` and `Drawn` log topics | Written, raw | Permanent |
| `canary_tests.owner_address` | The agent being probed | Written, raw | Permanent |
| Cockroach `hl_poll`, `hl_order_counts`, `hl_ws_buckets`, `hl_ws_coverage`, `hl_targets`, `hl_leaderboard` | Hyperliquid makers from the public leaderboard | Written, raw | Permanent. Cockroach has no TTL construct in this schema |

One store in the running service writes a wallet that belongs to somebody
using this site rather than to a public registry:

| Where | Which address | Exposure | For how long |
|---|---|---|---|
| `paybox_sessions.settlement.payer` | The buyer's wallet, from the settlement response | Written, raw | 30 minutes, by TTL index on `expires_at` |

### The API key tables, which are not mounted

`backend/publicapi/` is a service layer, a public schema, and key issuing
with tiers, added in commit 4990b6f as "stage 1" with no transport. No
commit has mounted it: `git log --all -S publicapi` finds nothing touching
`server.py`, `worker.py` or `mcp_server/`. So no route can issue a key, no
one can have signed up, and nothing below runs today. This section describes
what `publicapi/keys.py` will write once a route calls it.

| Where | Which address | Exposure | For how long |
|---|---|---|---|
| `public_api_challenges.address_fingerprint` | The wallet of whoever requests an API key | A salted fingerprint, not the address. The signed message, which quotes the address, is not stored: it is rebuilt at issue from the address the caller sends again and the stored nonce | Deleted on use. Also meant to expire five minutes after issue, through a TTL index on `purge_at`, but that index exists only once `keys.ensure_indexes()` has run, and nothing calls it yet |
| `public_api_keys.address_fingerprint` | The same wallet, tied to the issued key | A salted fingerprint, not the address | For the life of the key. Revoking deletes the document |

As first written, `keys.py` would have stored the raw wallet permanently
beside a key that was itself hashed at rest, which is why this audit called it
the sharpest thing here, even unmounted. It now stores a fingerprint from
`core/wallet_hash.py`, in a field named `address_fingerprint`, and the same
is true of the challenge collection.
Every read `publicapi/keys.py` makes of either, "one key per address", the
challenge lookup and `set_tier`, is an exact match on a value the caller
supplies again, so the fingerprint serves all of them. There is no admin or
list endpoint over either collection.

With `WALLET_HASH_SALT` unset, `create_challenge`, `issue_key` and `set_tier`
raise `AddressHashUnavailable` carrying `salt_not_configured`, before any
write. There is no fallback to the raw address. The salt must never change
once keys exist, because every stored fingerprint was taken against it.

Revoking a key deletes its document instead of setting `revoked_at`. The key
lookup, `verify_key`, then finds nothing and returns `None`, which is exactly
what it returns for a key that was never issued, so a revoked key is rejected
the same way.

What the fingerprint buys is stated in `core/wallet_hash.py` and is limited:
the candidate set of addresses is public and small, so anybody holding the
salt can match every stored value. It is a pseudonym as private as the
environment variable.

Three things this change does not settle, stated so they are not assumed.

The migration has not been run, and may have nothing to do. Since nothing
has been mounted, the collections should be empty or absent in production,
but that has not been read. If any document was written by some other
means, it would carry a raw `address`, and a revoked one `revoked_at`.
`backend/scripts/public_api_keys_migrate.py` deletes the revoked documents,
replaces the raw address with its fingerprint on the rest, and deletes every
challenge that still holds a raw address. It is a dry run printing counts
unless given `--apply`, and it must run with the deployment's own
`WALLET_HASH_SALT`, or the fingerprints it writes will not match the ones the
service computes. It calls `load_dotenv()`, so `backend/.env`, which names
the production database, supplies `MONGODB_URI` and the salt unless they are
set in the shell; unsetting them with `env -u` does not help. Until it runs,
`keys.py` also matches the legacy `address` field so that one key per address
holds across both shapes, and still refuses a legacy document carrying
`revoked_at`.

The TTL index as first written would have expired nothing. It was on
`expires_at`, which is epoch seconds, and MongoDB only expires documents
whose indexed field is a date, so an abandoned challenge, with its raw
address and the message quoting it, would have stayed until the same address
asked again. Challenges now carry a date in `purge_at`, and
`keys.ensure_indexes` puts the TTL index there. Nothing calls
`ensure_indexes`, so whoever mounts this package has to call it at startup,
or no challenge expires.

`WALLET_HASH_SALT` is not declared in `render.yaml`. That file does not
declare the backend web service at all, so whether the variable is set on the
deployment can only be read from the Render dashboard.

### Wallet addresses, held in memory

Every cache below is a module-level dictionary in one process. Nothing is
pickled, shelved or written to disk, none of it survives a restart, and none
of it is shared between workers.

| Where | Key | TTL | Cap |
|---|---|---|---|
| `core/hyperliquid/attribution.py` | wallet | 6 hours | 512, cleared entirely when full |
| `core/hyperliquid/venuerole.py` | wallet | 6 hours | 4096, cleared entirely when full |
| `core/hyperliquid/corestate.py` | wallet | 20 seconds | none |
| `adapters/zerion.py`, three caches | wallet, holding portfolio, activity and PnL | 10 minutes | none |
| `adapters/contract_verification.py` | wallet or contract | 24 hours | none |
| `core/universal_search.py` | whatever was typed into search, which can be a pasted address | 5 minutes | 5000 |
| `core/agent_performance.py` | one slot holding every client and provider address in the most recent 1,500 jobs | 30 minutes | one slot |

The attribution cache is the one worth justifying rather than listing,
because it holds raw addresses for six hours, which is longer than anything
else here.

It stays as it is. It is in process memory, never on disk and never in any
database, so it is gone on restart and gone on redeploy, and no query, dump
or backup can reach it. What it holds is a Hyperliquid address the project
selected from a public leaderboard and the attribution it computed for it,
which is public information about a public account rather than anything a
visitor told us. The six hours buy the thing the module exists for: an
attribution costs several venue calls and a sweep over a 30-day window, and
recomputing it per request would spend the venue's rate limit on a figure
that moves slowly. The cap bounds it at 512 entries. So the exposure is a
bounded set of public addresses, in one process's memory, for at most six
hours, with no path to storage. That is judged acceptable, and the
judgement is written down here so the page is not claiming a cleanliness the
code does not have.

Three of these caches are unbounded, which is a separate and smaller point:
`corestate.py`, the three in `adapters/zerion.py` and the one in
`adapters/contract_verification.py` have no cap, so they grow by one entry
per distinct address queried and are only ever overwritten. Everything the
paragraph above says about memory-only and restart still applies, but this
project's own pattern elsewhere is to cap a cache keyed by caller-supplied
input, and these do not.

In the browser, wagmi's default storage keeps the connected wallet address
in `localStorage` so the site can reconnect on reload. That is the visitor's
own browser and their own address, it is first-party, and nothing in this
codebase sends it anywhere.

### Wallet addresses, transmitted

| Third party | Which address | Where it rides | Note |
|---|---|---|---|
| Zerion | Wallet being viewed | URL path: `/wallets/{address}/positions` and three more | In the path, so it lands in Zerion's access logs |
| Etherscan and Sourcify | Owner or contract | Query string | Same |
| Binance Web3 Market | Token contract, not a wallet | Query parameter | |
| Hyperliquid info API and WebSocket | Tracked maker | POST body or subscription message | Not in a URL |
| HyperEVM, BSC and backup RPC providers | Wallet, ABI-encoded as calldata | POST body | Not in a URL |

8004scan, TheGraph, CoinGecko, DefiLlama and Crossmint receive no address
from this project. Owner addresses arrive in 8004scan's and TheGraph's
responses; none is ever sent as a request parameter. No model API call built
in `core/commerce/` interpolates a wallet or an IP into a prompt.

### Error paths

An exception message is the easiest way for an address, or a credential, to
travel somewhere nobody decided to put it. This audit found two places where
one did, and both were fixed in commit 773a4b3 through
`backend/core/safe_errors.py`. Its one function, `describe`, returns
`HTTP <status>` when an exception carries a response and the exception's
class name otherwise, and never its message, the request URL or the response
body.

`adapters/contract_verification.py` calls Etherscan's V2 API with the
address and the `BSCSCAN_API_KEY` as query parameters and calls
`resp.raise_for_status()`. httpx builds that exception's text from the full
request URL, so a non-2xx, and rate limiting is the ordinary case, used to
put both the address and the key into the `reason` of
`GET /api/agents/{agent_id}/contract-verification` and into that module's
24-hour in-memory cache. The reason is now
`couldn't reach <explorer>: HTTP 429` or a class name.

`core/status_checks.py` had the same shape without an address.
`_check_bsc_rpc_backup` posts to an Infura URL with `INFURA_API_KEY` in the
path, and `_timed` served `str(e)` in `GET /api/status`, which is
deliberately unauthenticated. `_timed` now serves verbatim only the text of
`_CheckFailed`, a class private to that module whose every message is a
literal written there, at most with an integer JSON-RPC error code
interpolated. Everything else, a `RuntimeError` from a library included, is
reduced to `describe(e)`. An RPC answer with no `result` used to be raised
with the provider's whole response body in its message; it is now described
as `unexpected RPC response: no result field`, or `JSON-RPC error <code>`
when the code is an integer, and the body is not served.

The same commit fixed paths this page had not named. `core/rpc.py` fails
over to the Infura URL for every RPC caller, so any caller that formatted an
RPC exception could publish that key; the address search in
`core/universal_search.py` did, and now uses `describe`. `adapters/thegraph.py`
holds its key in the URL path and interpolated the exception into an error a
caller sees, and now uses `describe` too. The commit also changed
`core/agent_health.py`, `core/budget_index.py` and `core/pinned_agents.py`;
its message has the detail.

Whether the keys that could have been exposed were rotated is the project
owner's decision and is not recorded here.

`/api/my-jobs` answered a failed scan with
`Couldn't look up hire history right now: {e}`. The scan reaches the RPC
providers, and so the Infura failover, so that was the same leak on a public
route. It now uses `describe` as well. So does `store_cap_runs_error` in
`GET /api/status`, which served a Mongo driver's message, one that can quote
the cluster's hosts.

Two interpolations of `e` remain in `contract_verification.py`, reviewed
rather than missed. `no RPC configured for chain {chain_id}: {e}` quotes a
`ValueError` that `core/rpc.py` raises with a message it wrote. `couldn't
reach Sourcify: {e}` is on a request whose URL carries the queried contract
and no key, and that branch does not call `raise_for_status()`, so what it
catches are network-level exceptions.

`adapters/zerion.py` puts the wallet in the URL path on five calls and is
safe today only by accident: it checks `resp.status_code` by hand instead of
calling `raise_for_status()`, so the exceptions it catches are network-level
ones, and httpx stringifies those to the empty string. Adding a
`raise_for_status()` there would recreate the contract-verification leak above.

This codebase also writes exception text into a stored record.
`core/full_registry_ingest.py` puts `last_error` on the
`full_registry_ingest_progress` document, which has no TTL and is served back
through `GET /api/full-registry-progress`, which is unauthenticated. Since
773a4b3 that text is `describe(e)`, not the exception message, so a call
added later whose URL carries an address or a key cannot put either there.
Text stored before that commit is still in place: the progress document's
`last_error` is overwritten on the next failure or cleared on the next
success, and the entries in `full_registry_skipped_offsets` are not
rewritten. `_record_skipped_offset`, the function that wrote them, has no
caller in the current code. No address or credential could reach any of that
stored text: the call inside that `try` goes to 8004scan with a chain id, a
cursor and a page size, and 8004scan takes its key in a header.

`core/first_visit.check_and_record` deliberately returns the exception TYPE
and not its text, for the same reason: a driver's message can quote the
connection string, and a DNS or socket failure can quote a host address.

Logged exception text is truncated rather than dropped in several places,
and two log lines carry a truncated public maker address, `address[:10]`, in
`server.py`'s collector loop and in `core/hyperliquid/ws_collector.py`.
Those are the ten leading characters of an address from a public
leaderboard, in the platform's stdout log.

### What did not change

The first-visit design. IP rather than cookie, 32 hex characters rather than
the whole digest, 90 days rather than forever, and the reasoning for all
three is in the header of `core/first_visit.py`.

The indexing of public on-chain addresses. An agent's owner, a job's client
and provider, an escrow's agent and a leaderboard's makers are the subject
matter of this project, not incidental collection, and hashing them would
make the product impossible while protecting nothing that is not already
public on a chain.

The attribution cache, for the reasons set out above.

The two error paths are no longer in this list. They were changed in commit
773a4b3, described under "Error paths" above. `public_api_keys.address` and
the `client_address` query parameter on `/api/my-jobs` are no longer in it
either; both were changed in the code as described above. The `/api/my-jobs`
change is not live until both the backend and the frontend have deployed.
`publicapi` is still unmounted, and its migration has not been run.

## Private keys

The backend holds none, by design. It signs nothing.

Every transaction is signed in the browser by the user's own wallet. Where a
settlement rail needs a signed authorisation, such as B402's EIP-3009 or
Permit2 payloads, the backend refuses to proceed without one rather than
holding a key to produce it. `core/commerce/rails/b402_rail.py` states this
where it declines.

Deploy scripts that need a key are run by the project owner, not by any
automated process, and no key is committed. A gitleaks scan across all 318
commits found no credential in history.

## Spending controls

The commerce pipeline can place orders through Crossmint, so three
independent limits sit in front of it.

Orders are disabled unless `COMMERCE_ALLOW_REAL_ORDERS` is set. A spend
ceiling lives in `core/commerce/limits.py` as a source constant rather than
an environment variable, because a constant has to be edited and committed
while an environment variable can be changed by a deploy config. Browser
profiles, which persist a user's logged-in session at a merchant, are never
created, and an existing profile id is only ever used when the caller states
that the user authorised it in that session.

## Third-party marks

The partner strip shows a logo only where the vendor's terms allow it. Three
services the project uses have no mark:

Gemini, because Google's rules require Google-approved artwork and the only
assets that resolve are either build-hash URLs that rot or Google's and
DeepMind's corporate icons rather than the Gemini product mark.

Claude Code, because Anthropic requires written permission for logo use.
Saying in plain text that a product uses Claude Code is allowed, and that is
what this does.

Infura, because no logo asset resolves on infura.io, and using Consensys's
or MetaMask's icon would misrepresent three companies at once.

Ledger was left out earlier for the same kind of reason.

## Payment partners

MoonPay declined our partner onboarding on country and industry grounds.
Nothing in the codebase is built against MoonPay or against Tnega PayBox,
which depended on it. See `future-tnega-paybox.md` for the research that led
there and for B402, which replaced it.

Crossmint physical-goods checkout needs the `worldstoreCheckout` addon,
which this project does not have. The adapter reports that as a missing
entitlement rather than as a bug.
