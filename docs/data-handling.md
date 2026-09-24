# Data handling and third-party terms

What the running system stores, what it deliberately does not, and the
outside constraints it works within. This describes the implementation. It
is not legal advice and no lawyer has reviewed it.

## Personal data

The only personal data the backend stores about a site visitor is a salted
hash used to decide whether someone has visited before.

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
addresses, under its own `WALLET_HASH_SALT`. Nothing calls it yet.

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
query string, and several routes carry a wallet address in one or the other.
Two carry it in the path: `/api/hyperliquid/address/{address}` and
`/api/hyperliquid/history/{address}`. The rest carry it as a query
parameter, among them `/api/agent-performance`, `/api/agent-revenue`,
`/api/agents/wallet-portfolio`, `/api/agent-activity`, `/api/agent-pnl`,
`/api/agent-onchain-history`, `/api/canary-history`,
`/api/agent-escrow-compatibility` and `/api/hyperliquid/history-bulk`.

Almost all of those take an agent's registered `owner_address`, which is
public registry data, or a tracked leaderboard maker. One does not.

`GET /api/my-jobs?client_address=0x...` takes the visitor's own connected
wallet. `frontend/src/MyJobsPanel.jsx` calls it with the address the browser
wallet is connected as, every time the My Agents tab opens. That address is
in the query string, so it is in uvicorn's access log line, and in whatever
request logs Render and Cloudflare keep in front of it. Nothing in this
codebase writes it to a database, and nothing joins it to anything, but it
is in a log we do not own and cannot purge, for as long as those providers
retain their logs.

Moving it to a POST body, or to a path segment carrying a fingerprint rather
than the address, would take it out of the query string. Neither has been
done. It is recorded here rather than left for somebody to find in a log.

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

Three write a wallet that belongs to somebody using this site rather than to
a public registry, and those are the ones the policy has to be explicit
about.

| Where | Which address | Exposure | For how long |
|---|---|---|---|
| `public_api_challenges.address` | The wallet of whoever is requesting an API key | Written, raw | 5 minutes, by TTL index on `expires_at`, and deleted on use |
| `public_api_keys.address` | The same wallet, tied to the issued key | Written, raw | Permanent. There is no TTL, and revoking a key sets `revoked_at` rather than deleting the document |
| `paybox_sessions.settlement.payer` | The buyer's wallet, from the settlement response | Written, raw | 30 minutes, by TTL index on `expires_at` |

`public_api_keys.address` is the sharpest thing in this audit: a raw wallet
address, stored permanently, identifying a specific person who signed up for
this project's API. The API key itself is hashed at rest and the address
beside it is not. Nothing reads that field except an exact-match lookup for
"one key per address", so a fingerprint would serve every query the code
makes of it, and `core/wallet_hash.py` exists so that change has somewhere to
land. It has not been made: changing it invalidates every issued key's
lookup path and is a migration, not an edit, and it is recorded here as
outstanding rather than quietly deferred.

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

An exception message is the easiest way for an address to travel somewhere
nobody decided to put it, and this audit found one place where it does.

`adapters/contract_verification.py` calls Etherscan's V2 API with the
address and the `BSCSCAN_API_KEY` as query parameters, calls
`resp.raise_for_status()`, and on failure returns

    {"reason": f"couldn't reach {explorer}: {e}"}

httpx builds that exception's text from the full request URL including the
query string. Reproduced against a synthetic 429: the message is
`Client error '429 Too Many Requests' for url '...?chainid=56&address=0x...&apikey=...'`.
So any non-2xx from the explorer, and rate limiting is the ordinary case,
puts both the queried address and the API key into the body of
`GET /api/agents/{agent_id}/contract-verification`, and into that module's
24-hour in-memory cache, which then re-serves the same text to every later
caller asking about that agent. The address is one the caller already
supplied. The key is not.

`core/status_checks.py` has the same shape without an address.
`_check_bsc_rpc_backup` posts to an Infura URL with `INFURA_API_KEY` in the
path and calls `raise_for_status()`; `_timed` sets `detail = str(e) or
type(e).__name__` and that string is served verbatim in `GET /api/status`,
which is deliberately unauthenticated. A 401 or a 429 from Infura puts the
key on a public page.

Neither has been changed here. Both are one edit: interpolate
`type(e).__name__` instead of `e`, which is what
`core/first_visit.check_and_record` and the
`/api/hyperliquid/history/{address}` handler already do. They are written
down rather than fixed in passing because a key that may have been exposed
is a rotation decision, not a code decision.

`adapters/zerion.py` puts the wallet in the URL path on five calls and is
safe today only by accident: it checks `resp.status_code` by hand instead of
calling `raise_for_status()`, so the exceptions it catches are network-level
ones, and httpx stringifies those to the empty string. Adding a
`raise_for_status()` there would make it Finding A again.

This codebase also writes exception text into a stored record.
`core/full_registry_ingest.py` puts
`f"{type(e).__name__}: {e}"`, truncated to 300 characters, into
`last_error` on the `full_registry_ingest_progress` document, and the same
text on `full_registry_skipped_offsets`. Neither has a TTL, and
`get_skipped_offsets_summary` serves that stored text back out through
`GET /api/full-registry-progress`, which is also unauthenticated.

No address can reach those fields today. The call inside that `try` goes to
8004scan with a chain id, a cursor and a page size, so an exception that
quotes its URL quotes no address. It is listed because the shape is the
risk: any call added inside that block whose URL carries an address would
put the address in a permanent Mongo field and on a public endpoint, with
nothing in the code saying it had.

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

`public_api_keys.address`, which is the one this audit would change next.

The two error paths that interpolate `e` rather than `type(e).__name__`, and
the `client_address` query parameter on `/api/my-jobs`. All three are
described above with what the change would be. None of them was changed
here, because each one is either a migration or a key rotation rather than
an edit, and a page that quietly fixed them would be a worse record than one
that names them.

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
