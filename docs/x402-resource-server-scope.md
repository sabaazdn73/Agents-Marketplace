# x402 resource server: scope

Scope only. Nothing here is built, and this document is not a commitment to
build it. It exists so that the decision to build or not build can be made on
what is known, and so that whoever builds it does not rediscover any of it.

Every claim below is either verified in this pass (with the check named in the
verification log at the end) or marked unverified inline. Nothing is carried
over on trust.

## 0. Where we actually stand

Tnega has no x402 resource server. A grep for `X-PAYMENT`, `PAYMENT-SIGNATURE`,
`PAYMENT-REQUIRED` and `PAYMENT-RESPONSE` across `backend/` and `frontend/src/`
returns one file, `frontend/src/x402Skill.js`, and that is a buyer-side wrapper
around someone else's `fetchWithX402`. Nothing on the server reads a payment
header.

What exists is PayBox, a checkout session:

| Endpoint | What it does |
|---|---|
| `POST /api/paybox/sessions` | returns HTTP 402 with `x402Version`, `error`, `accepts`, `resource`, `session_id`, `checkout_url` |
| `GET /api/paybox/sessions/{id}` | poll target |
| `POST /api/paybox/sessions/{id}/pay` | payment arrives as a JSON body, verify then settle |

That is a checkout flow. An x402 client cannot pay it, because an x402 client
retries the same URL with a payment header and expects the resource back. Ours
hands out a URL to go and pay at. The two are not the same protocol even though
they share a status code and a body shape.

---

## 1. The evidence question, which comes first

This section leads because it can invalidate the rest. The question is not how
someone pays. It is what evidence exists afterwards.

### 1.1 What the measurement is today

Verified from code, not from memory:

- `backend/core/agents_index.py:125-126`. `_tier()` returns `TIER_VERIFIED`
  when `delivered_external` is above zero, and nothing else can reach that tier.
- `backend/core/job_index.py:589-593`. `delivered = COMPLETED + SUBMITTED`,
  `self_delivered = COMPLETED + SUBMITTED` over jobs where
  `client == provider`, and `delivered_external = delivered - self_delivered`.
- `backend/core/job_index.py:522`. Self-funded is literal on-chain address
  equality: `{"self_funded": {"$eq": ["$client", "$provider"]}}`.

So the standing rule is: at least one ERC-8183 job, funded by an address other
than the agent owner's own, that reached SUBMITTED or COMPLETED.

Live tier counts, read from `tnega_catalogue` at 2026-09-23T14:46Z:

| Tier | Count |
|---|---|
| verified | 32 |
| canary_verified | 0 |
| responding | 652 |
| unproven | 14220 |

The fallback tier is empty. So the verified set does not degrade gracefully
under a change of hire path. It goes to zero.

The September fix the owner refers to is recorded in
`docs/verification-methodology.md:64` and in the `agents.index` caveat returned
by the catalogue: enforcing the self-funded exclusion on 2026-09-16 moved the
BNB verified count from 29 to 27. Two agents had held the tier on self-funded
work alone, one of them on 184 jobs. The rule that fix established is the
constraint every answer in this section has to satisfy: evidence that the
subject generated about itself does not count, and evidence Tnega generates
about a subject does not count either. `canary_verified` exists precisely
because a Tnega-funded test hire is a weaker claim, and the catalogue says it
is never blended with verified. Its count is 0.

### 1.2 What a settlement proves, exactly

After a B402 settlement on BSC, this is what is on chain and nothing else.

For the `eip3009` transfer method, a `transferWithAuthorization` call on the
token contract produces an ERC-20 `Transfer(from, to, value)` log and, on tokens
that implement the event, an `AuthorizationUsed(authorizer, nonce)` log. For the
`permit2-exact` and `permit2-upto` methods, Permit2's
`SignatureTransfer.permitTransferFrom` or `permitWitnessTransferFrom` produces
the same ERC-20 `Transfer` log plus a nonce invalidation on Permit2. In both
cases the transaction is sent by B402's own signer
(`0x34F7a661160780Ce1346e6D7B96D2bE244590899`, read live from `/supported`), so
the transaction sender is the facilitator and not the payer.

The full set of facts recoverable from chain:

| Fact | What it supports | What it does not support |
|---|---|---|
| payer address | that this address authorized a transfer, non-repudiably | nothing about whether the payer received anything |
| payee address | that funds arrived at the registered `payTo` | which agent was paid, see below |
| asset address | which token moved | nothing about value delivered |
| amount | how much moved | nothing about what it bought |
| block number and timestamp | ordering, and that the payment preceded or followed some other event | nothing about delivery, which leaves no on-chain trace |
| transaction hash | a handle to all of the above | nothing further |
| transaction sender | that B402's signer broadcast it | not the payer, and not the seller |

The decisive entry is the payee. `backend/core/paybox.py:_pay_to_address()`
reads `PAYBOX_PAY_TO`, one address, and its own docstring records that the B402
registration of that address is write-once and cannot be changed. So every
payment through this app's B402 registration lands on the same address
regardless of which agent did the work. Under ERC-8183 the provider address is
a field of the job and the money goes to it, which is why
`client == provider` is a check anyone can run against the chain. Under x402
as configured, the chain does not record which agent was paid at all. The
mapping from a settlement to an agent would be a join Tnega holds in its own
index, which is exactly the self-generated evidence the September fix removed.

There is one configuration in which this does not hold: each agent operator
onboards with B402 separately, holds its own credentials, registers its own
`payTo`, and runs its own resource server. Then the payee on chain is the
agent's own address and the attribution is on chain. In that configuration
Tnega is not the resource server and this document is scoping the wrong thing.
Whether B402 supports per-operator onboarding at any useful scale is unverified;
nothing in this pass tested it.

### 1.3 Candidates that could carry delivery evidence, by source

Classified by who generates the artifact. Anything sourced from Tnega is named
and disqualified rather than omitted.

#### (a) The PAYMENT-RESPONSE header the resource server emits

Source: the resource server. If Tnega runs it, that is Tnega. Disqualified.

Content, as B402 returns it and as `b402.classify_settle_result` reads it:
`success`, `transaction`, `network`, `payer`, `errorReason`. There is no content
hash, no deliverable pointer, and no counterparty field. It is also a response
header, so nothing persists it but the recipient, and the recipient is the buyer.
Even if it were strong, it is not durable and not queryable.

Verdict: carries settlement, not delivery. Disqualified on source when we run it.

#### (b) The offer-and-receipt extension

`specs/extensions/extension-offer-and-receipt.md`, read in full this pass. Its
own overview names the target use case: "verifiable proof of commercial
interactions for reputation systems". So it is aimed at exactly this problem.

Who signs, from section 5: "A receipt is a signed statement returned by the
resource server only on success, confirming that payment was received and
service was delivered." The signature is the resource server's, either EIP-712
under the domain `name: "x402 receipt", version: "1", chainId: 1`, or JWS.

Is there a counterparty check? No. The receipt payload fields, section 5.2, are
`version`, `network`, `resourceUrl`, `payer`, `issuedAt`, and an optional
`transaction`. There is no buyer signature in the artifact and no field the
buyer contributes. The verification procedure in section 5.5 step 5 is "Confirm
the signer is authorized to sign for the service identified by
`payload.resourceUrl`". That checks who signed. It does not check whether what
was signed is true.

Which weakness it has, stated precisely because it is not the same weakness as
Tnega attesting: this is the seller attesting to its own delivery. It is
stronger than Tnega attesting in three ways. The statement is signed by a key
the seller controls, so it is non-repudiable. It is portable, so a third party
can verify it without asking us. And it names the payer, which is independently
checkable against the chain. It is weaker than counterparty evidence in one way
that matters more than all three: the payload contains no commitment to what was
delivered. There is no content hash and no deliverable pointer in the schema. A
receipt issued for an empty response and a receipt issued for a delivered
response are byte-identical apart from timestamps. So it proves the seller
claimed delivery, which is the claim-without-measurement this project exists to
point at, with a signature on it.

And if Tnega is the resource server, it collapses entirely: we would be signing
receipts about our own marketplace's agents. Disqualified in that configuration.

#### (c) A hash of the response body, committed somewhere

Source depends on who commits it, and the only party holding the bytes at
delivery time with a motive to commit them is the seller.

Nothing stops the seller committing a hash of nothing. A hash binds bytes; it
does not bind those bytes to the thing that was bought. This is equally true of
ERC-8183's own `deliverable`, which is a `bytes32` on chain with the content
stored off chain (`frontend/src/altana.js:45`). What makes the ERC-8183
commitment evidence is not the hash. It is what follows it, covered in 1.4.

Committing a hash on chain also reintroduces a transaction per delivery, sent by
someone holding a key and a gas balance, which is the burden section 5 of this
document exists to keep off us.

Verdict: seller-sourced, no counterparty check, and costly in the specific way
we are trying to avoid.

#### (d) A buyer-signed acknowledgement

Source: the buyer. This is the only candidate in the list that is
counterparty-sourced.

What would make it unforgeable: sign it with the same key that signed the
payment authorization, over a tuple of (`resourceUrl`, `transaction`,
`contentHash`, `issuedAt`). The payer key is already bound to the payment by the
chain, so a seller cannot manufacture the acknowledgement without that key, and
anyone can check that the acknowledging key is the paying key by reading the
`Transfer` log.

Why it does not save us today:

1. Nothing in x402 asks for it. There is no such artifact in the core spec or in
   the offer-and-receipt extension, and no client library emits one. Defining it
   means defining a Tnega extension, which does not make the artifact
   self-generated but does make adoption the binding constraint.
2. It is a second signature requested after the buyer already has the goods. The
   buyer's cost is non-zero and its benefit is zero. Withholding it is a free way
   to keep a seller out of a verified tier, and a buyer who is also a competitor
   has a reason to withhold.
3. Consequently the measurement selects for cooperative buyers rather than for
   delivering sellers, which is a different quantity from the one the tier
   claims.

Verdict: buildable, correctly sourced, not available today, and the adoption
question is unresolved. It is the only candidate worth revisiting if x402 hiring
ever becomes material.

#### (e) Repeat payment from the same payer over time

Source: the chain. Authored by nobody. This is the strongest un-authored signal
available and it deserves the most careful cost analysis.

What it proves: an address that paid once chose to pay again after having
whatever the first payment bought. That is revealed preference, and revealed
preference is the thing a reputation system actually wants.

What it costs to fake. The owner's brief suggested the 2.5 percent fee and gas
as the cost. Neither applies here, and this matters:

- The 2.5 percent is `feeBps = 250` on `AgentBudgetEscrow.draw()`, documented in
  `docs/budget-integration.md`. It is the budget path's fee. It has nothing to
  do with x402 or B402.
- Gas under x402 is paid by the facilitator's signer, not by the payer. That is
  the entire point of the direction. So the payer pays no gas.
- Whether B402 charges a facilitator fee on settle is unverified. Nothing in
  `backend/core/b402.py` or `backend/core/b402_selfcheck.py` reads or records a
  fee field, and this pass did not perform a live settle.

So the cost of faking a repeat-payment history is a self-payment loop: money
leaves an address the faker controls and arrives at an address the faker
controls, minus whatever the facilitator takes. If the facilitator takes nothing,
the cost is approximately zero and the only expenditure is elapsed time. Under
that condition repeat payment proves nothing whatsoever.

If a facilitator fee does exist, repeat payment becomes a signal whose forgery
cost is (fee rate) times (volume faked), and a tier built on it is stating a
minimum amount of money someone was willing to burn. That is a measurable quantity, but
it is a statement about spending, not about delivery, and it must be named that
way. Resolving the fee question is a prerequisite to taking this candidate
seriously at all.

#### (f) Payment from a payer who is not the agent's owner

Source: the chain. This is the direct analogue of `delivered_external` and it is
the candidate that looks strongest and is not.

It breaks in two places:

1. Attribution. `delivered_external` compares `client` against `provider`, and
   both are on-chain fields of the same job. Under x402 with a single write-once
   `payTo`, there is no on-chain provider to compare against, per 1.2. The
   comparison would run against an owner address held in our index, so the
   equality test stays on chain but the mapping from payment to agent does not.
   That mapping is ours, and the September fix is about exactly this class of
   evidence.
2. Sybil cost. Address inequality is one fresh keypair away, and that is equally
   true under ERC-8183. What differs is the price of the keypair. Under
   ERC-8183 a fake external hire requires funding escrow, submitting a
   deliverable commitment, and waiting out a 604800 second dispute window before
   the money settles back (`backend/core/pnl.py:101`, read live from
   `OptimisticPolicy.disputeWindow()`). Under x402 the money moves immediately,
   there is no window, and the deliverable commitment does not exist. The cost of
   one fake external payment falls from capital locked for seven days plus an
   on-chain commitment to one new address and a round trip that may cost nothing.

Verdict: the analogue looks exact and does not hold. It loses the attribution and
it loses the price.

### 1.4 The structural comparison

ERC-8183's evidence is not that delivery happened. It is two things together:

1. A commitment. A `bytes32` deliverable pointer and content hash committed on
   chain, with the job in SUBMITTED or COMPLETED state.
2. A counterparty's silence. The 604800 second dispute window elapsed and nobody
   disputed.

Taking each half under x402:

The commitment half is weakly reconstructible, by the seller. Candidate (c) can
produce it, and candidate (b) as specified cannot, because the receipt schema
carries no content hash. Either way the committer is the party with the motive,
and committing it on chain costs a transaction we are trying not to send.

The silence half is not reconstructible at all. x402 has no dispute, no window,
no refund, and no state after settlement in which a buyer can object. There is
therefore no period during which not objecting means anything, because there is
nothing to object with. Silence after an x402 payment is indistinguishable from
silence after any other event, including no delivery at all.

The half that is lost is the half that made the other half mean something. A
committed hash with no window behind it is a seller's statement in a
cryptographic wrapper.

One correction for accuracy, because it cuts against the current tier as well:
`delivered` counts SUBMITTED, and SUBMITTED means the window has not elapsed.
The catalogue's own caveat says so: "an undisputed SUBMITTED job is a delivery
that has not been settled yet: it does not mean a job was completed." So today's
verified tier already rests, for some of its members, on the commitment half
alone. That is a known weakness of the existing measurement and it does not make
x402 any better. It does mean the gap is commitment-plus-sometimes-silence
against commitment-only-if-someone-builds-it-and-never-silence, rather than a
clean two-halves-to-zero.

### 1.5 The answer

They do not compose.

An x402 hire path produces a settlement transaction. Everything else that could
carry delivery is authored by the seller (the PAYMENT-RESPONSE header, the
offer-and-receipt receipt, a committed content hash), by us (any join from a
settlement to an agent, given a single write-once `payTo`), or by nobody in a
way that costs nothing to forge (repeat payment, under a facilitator-pays-gas
model with an unverified fee). The one correctly sourced candidate, a
buyer-signed acknowledgement, does not exist in the standard, is emitted by no
client, and asks a buyer to sign something after it already has the goods.

So: a hire path on x402 empties the verified tier and there is no replacement
that is not self-generated.

What follows from that, stated as decisions rather than as a mood:

1. Do not extend tiering to x402 settlements. If a resource server is built,
   record settlements in their own store and surface them as payments received.
2. If they are surfaced at all, the truthful name for what they measure is
   paid, or paid_external if the payer-is-not-the-owner check is applied with
   its limits stated. Not verified. A tier called verified that counts
   settlements measures spending, which is the exact claim-without-measurement
   this project exists to point at.
3. Do not blend. The precedent is already in the codebase: `canary_verified` is
   a separate, named, weaker tier that the catalogue states is never blended
   with verified, and it currently reads 0. The same discipline applies here,
   and for the same reason.
4. If x402 ever becomes the only hire path, the verified count is zero and the
   correct response is to publish zero, not to redefine verified until it is not
   zero.

The two things the owner asked for, hiring that works and measurement that
survives it, do not both come out of this rail. Hiring works. Measurement does
not survive. That is the finding.

---

## 2. What a paid route looks like

### 2.1 Shape

A FastAPI dependency, not middleware.

Middleware sees a raw request and would need its own path table to know what a
route costs, which duplicates routing. A dependency is declared on the route it
prices, receives the route's own parameters, and can set response headers
through an injected `Response`. So:

```
@app.get("/api/<paid-route>")
async def handler(paid = Depends(priced(...))):
    ...
```

The dependency does, in order:

1. Load the requirements for this route from a server-held source. Either a
   route price table, or for a staged job the stage record loaded by job id.
   Never from the request.
2. Read the payment header under both names (section 3).
3. If absent, raise 402 carrying the challenge body and the `PAYMENT-REQUIRED`
   header. This is the correct status and not an error condition.
4. If present, decode the envelope under both dialects (section 3), apply the
   rail gate (section 8), then call `b402.verify_payment` with the server-held
   requirements.
5. Settle at the point chosen in section 5, classify with
   `b402.classify_settle_result`, and attach `PAYMENT-RESPONSE`.

A response hook is needed for the `PAYMENT-RESPONSE` header in the
work-before-settle ordering, because the settle happens after the handler has
produced its body. In the settle-before-work ordering the dependency can set it
directly.

### 2.2 Which of our endpoints are candidates

There are 72 routes on `backend/server.py`. Every one of them is currently free
and public, and several are consumed by the frontend, the extension, and the MCP
server. Paywalling any existing route is a regression for existing callers and
would break at least one shipped surface.

So the first paid route should be a new endpoint, not a paid version of a free
one. That is a recommendation, not a preference: there is no existing route
whose callers can absorb a 402.

The routes worth studying for shape, not for paywalling:

| Route | Why it is interesting |
|---|---|
| `POST /api/studio/runs` plus `/answers`, `/retry`, `/{run_id}` | already a staged, resumable, polled job with a run id and a pause-for-input boundary. The natural model for staged payment, section 5. |
| `POST /api/commerce/run` | single-shot version of the same coordinator |
| `GET /api/agents/{agent_id}/quality-center` | per-subject report with substantial computation behind it |
| `GET /api/agents/escrow-compatibility` | audit output, the kind of thing a buyer would pay per subject for |

### 2.3 What we would be selling

A payment server with nothing behind it is not a deliverable, so this has to be
answered before anything is built.

The one thing this project holds that is not available elsewhere is the
measurement corpus: per-agent delivery history joined from chain logs across
five chains, escrow compatibility, service liveness, and the Hyperliquid
post-only rejection study with 28,037 polls behind it. The `mcp/` server already
exposes a read-only slice of that.

A defensible first paid resource is a per-subject report generated on demand:
one address or one agent id in, a computed report out, priced per call, with
nothing cached between buyers. That has marginal cost, it has a natural per-call
unit, it is new rather than a paywalled existing route, and its value does not
depend on the buyer trusting a claim we make about ourselves.

What it is not is a hire path. Selling our own measurements over x402 and hiring
third-party agents over x402 are different products, and only the second one
runs into section 1. If the first paid route is a Tnega-authored report, section
1's finding does not block it, because nobody is claiming the report proves an
agent delivered.

---

## 3. Header and envelope compatibility

Both x402 versions are live in the wild. A server that reads one will refuse
clients that speak the other. The compatibility surface is two dimensions, and
they are independent: header names, and envelope shape.

### 3.1 Header names

| Direction | v2 name | v1 name |
|---|---|---|
| server to client, the challenge | `PAYMENT-REQUIRED` | none, the 402 body carried it |
| client to server, the payment | `PAYMENT-SIGNATURE` | `X-PAYMENT` |
| server to client, the outcome | `PAYMENT-RESPONSE` | `X-PAYMENT-RESPONSE` |

All are base64 JSON.

Precedence rules, to be written down and not left to whichever branch runs first:

1. Read `PAYMENT-SIGNATURE` first. If present, use it and ignore `X-PAYMENT`.
2. If absent, read `X-PAYMENT`.
3. If both are present and differ, reject the request rather than picking. Two
   different payments in one request is not a dialect difference, it is either a
   confused client or an attempt to have the server verify one and settle the
   other.
4. Emit both `PAYMENT-RESPONSE` and `X-PAYMENT-RESPONSE` with identical content.
   Emitting both is safe; a v1 client ignores the v2 name and the reverse.
5. Emit `PAYMENT-REQUIRED` alongside the 402 JSON body. A v1 client reads the
   body and ignores the header.

### 3.2 Envelope shapes

The v2 `PaymentPayload` is `{x402Version, resource?, accepted, payload,
extensions?}`, where `accepted` is a full `PaymentRequirements` object and there
is no top-level `scheme` or `network`.

Our own `frontend/src/b402Pay.js:buildPaymentPayload` emits
`{x402Version: 2, scheme, network, payload}`. That is the v1 shape with a 2
stamped on it. Its own module comment records that the shape was established by
probing the live facilitator rather than from the spec, which explains how it
got there. If we build a resource server that rejects v1-shaped envelopes, our
own buyer cannot pay it.

So the decoder must accept both, and the precedence rules are:

1. Network and chain id: read `accepted.network` first, fall back to the
   top-level `network`, then to `accepted.chainId` or the top-level `chainId`.
2. Rail discrimination: `payload.authorization` means eip3009;
   `payload.permit` or `payload.permit2Authorization` means a permit2 rail.
3. Within the permit2 rails, presence of `permit.witness` distinguishes
   `permit2-witness` from bare `permit2`. Section 8 governs what happens next.
4. `accepted` is the client's echo of the requirements. It may be read for
   dialect discrimination. It must never be read for any value that decides what
   is paid or to whom. Those come from the server-held requirements, loaded by
   route or session id.

Rule 4 is the one that carries the security of the whole thing, and it is
already enforced by `backend/core/paybox.py`. It must not be relaxed for the
resource-server path.

### 3.3 The published pattern we are reading from

There is a published dialect-tolerance pattern in `@altananetwork/x402-server`
version 0.2.0. That package is not in this repo and is not ours. It was read
from npm in this pass by downloading the tarball, and it is referenced here as
prior art only.

- `dist/decode.js:22-34`, `chainIdOf()`, reads `accepted?.network` then
  `envelope.network`, then falls back to `accepted?.chainId ?? envelope.chainId`.
- `dist/decode.js:93`, `payload.permit ?? payload.permit2Authorization`, which
  is exactly the two-dialect tolerance described above.
- Its own comment at `dist/decode.js:38-42` names three dialects by origin, and
  records that b402 buyers send `permit2Authorization` with `from` nested inside
  while others send `permit` plus a sibling `payload.from`.

Worth noting for anyone copying it: that package reads only `X-PAYMENT`, the v1
header name. Its error strings all begin `X-PAYMENT:`. So it is prior art for
envelope tolerance and not for header tolerance.

---

## 4. What is reused versus what is new

`backend/core/b402.py` already carries four things. None of them should be
written a second time.

| Already in `b402.py` | Do not duplicate because |
|---|---|
| HMAC-SHA256 transport, ISO 8601 millisecond timestamps, `{"body": {...}}` wrapping, the `{code, msg, data}` envelope with `000000000` authoritative over HTTP status | the signing is over the exact serialized string, and a second serializer is a second chance to sign one body and send another. `sign_request`'s own docstring says this. |
| `ASSETS_BY_NAME`, the asset-name to on-chain-address map, verified against `name()` on BSC mainnet, all four at 18 decimals | a second copy would eventually disagree, and a wrong address here misdirects a payment. The 18-versus-6 decimals difference against Ethereum would misprice by 10^12. |
| `get_supported` with its 15-minute cache, and `kinds_for_network` | refetching per request on a latency-sensitive path, and a second cache with a different TTL. |
| `classify_settle_result`, the three outcomes | this is the one the brief singles out and it is right. A second classifier would drift, and the drift would land on outcome 2, `success: false` with a non-empty `transaction`, where the wrong answer double-charges a buyer whose payment is already on chain. |

`backend/core/paybox.py` already carries the security rule, the server-held
requirements store, `to_base_units` via `Decimal`, the TTL-indexed session
collection, and the idempotency behaviour on a duplicate submit. The resource
server should read the same store rather than opening a parallel one, and should
reuse `to_base_units` rather than reimplementing decimal scaling.

What the resource server genuinely adds:

1. A header codec, both names, both directions, base64 JSON, with the precedence
   rules of section 3.1.
2. An envelope decoder, both dialects, with the precedence rules of 3.2.
3. A rail gate, section 8.
4. A challenge builder that emits a 402 with `accepts` for a route rather than
   for a session, plus the `PAYMENT-REQUIRED` header.
5. A route price table, or for staged jobs a stage-record store, both
   server-held.
6. The settle-ordering policy of section 5 and the field that records which
   ordering a given stage used.

That is six new things and zero rewrites. If any of the four `b402.py` items
appears in the new code, something has gone wrong.

One inconsistency found in this pass and not resolved: `backend/core/b402.py`
uses paths `/build/api/v2/b402/{supported,verify,settle}`, and
`frontend/src/x402Skill.js` declares
`export const B402_SETTLE_PATH = '/papi/v2/b402/settle'`. The backend path is
the one confirmed working against the live API in this pass. The frontend
constant is unverified and may be a documentation path for the Bazaar extension
rather than a callable one. Resolve before either is relied on.

---

## 5. Staged payment

This was the point of the direction, so it gets the detail.

### 5.1 One challenge per stage is forced, not chosen

The `upto` scheme spec, section "Out of Scope", lists what the scheme does not
support:

> - Multi-settlement / streaming: Settling the same authorization multiple times (e.g., pay-per-chunk streaming)

and Core Properties MUST number 1, Single-Use Authorization:

> Each authorization MUST be settled at most once. After settlement (regardless of amount), the authorization is consumed and cannot be reused.

So one authorization cannot be drawn against across stages. N stages means N
authorizations, N challenges, and N settlements. This is not a design choice
available to us.

### 5.2 How a multi-stage job is expressed

As a sequence of paid requests against one job id, which is the shape
`/api/studio/runs` already has:

1. `POST /api/<job>` returns 402 with the stage-1 challenge and, in the body,
   the job id.
2. The client retries with a payment header. The server verifies against the
   stage-1 requirements it holds, runs stage 1, settles, returns the stage-1
   result plus a 402-equivalent challenge for stage 2.
3. Repeat until the job has no further stage, at which point the final response
   carries the result and no further challenge.

### 5.3 What the client holds between stages

The job id, the stage index, and its own signing key. It cannot hold a reusable
authorization, per 5.1.

This has a consequence worth naming before anyone builds against it: the buyer
must be online and able to sign at every stage boundary. An unattended client
that signs once and walks away cannot use a staged job. The only way to remove
that constraint is a single `upto` authorization covering the whole job settled
once at the end, which is one stage with internal structure rather than staged
payment, and which puts the entire job's value in the gap described below.

### 5.4 Which side carries the gap

Per stage there are two orderings, and both are available live: `exact` and
`upto` are each offered by B402 for all four assets, confirmed against
`/supported` in this pass.

| Ordering | Scheme | Who carries the gap | What the gap is |
|---|---|---|---|
| settle before work | `exact` | the buyer | the stage is paid for before it runs. If it fails, the buyer has paid for nothing and x402 has no refund. |
| work before settle | `upto` | the server | the stage runs before it is charged. If the authorization has expired, been consumed elsewhere, or the payer's balance has moved, the work is unpaid. |

### 5.5 Recommendation: work before settle, using `upto`, per stage

Reasons, in order of weight:

1. It matches the house position. `docs/budget-integration.md` states the
   ordering rule for the budget path in its own worked example: "do the work
   first, then charge for it, and never charge for work that failed." The same
   rule should not reverse because the rail changed.
2. `verify` costs nothing and closes most of the gap. `b402.verify_payment`
   checks signature, terms, and validity against the server-held requirements
   without moving funds. Running it before the work converts the server's
   exposure from unknown to checked-at-start. What remains is the window between
   verify and settle, which is bounded by choosing stage durations well inside
   `deadline` minus a margin.
3. `upto` is the only scheme where a stage that consumed less than budgeted
   charges less, per Core Properties MUST 4: the settled amount MUST be less
   than or equal to the authorized maximum, and MAY be 0. Under `exact` every
   stage is a fixed toll regardless of what it did. Per-stage pricing that
   cannot vary with the stage is not per-stage pricing.
4. It puts the gap on the party that can price it. We know our own failure rate
   per stage; the buyer does not.

Note the phase-dependent semantics this brings, Core Properties MUST 5: at
verification time `amount` in the requirements is the authorized maximum, at
settlement time it is the amount to actually charge. `b402.settle_payment`
already takes `settle_amount` for exactly this and passes it as `settleAmount`.
Two different values of `amount` for one payment is a genuine footgun and the
requirements record must store the maximum, with the charged amount stored
separately.

### 5.6 How the choice is recorded

Per stage, in the stage record, not inferred later:

`stage_index`, `requirements_issued` (the server-held object verbatim),
`ordering` (one of `settle_first`, `work_first`), `authorized_max`,
`charged_amount`, `payer`, `verify_result`, `settle_outcome` (one of the three),
`transaction`, `started_at`, `settled_at`.

`ordering` is stored rather than assumed because the failure handling differs by
ordering and because a policy change must not retroactively rewrite what happened
to older jobs.

### 5.7 A TTL decision this forces

`paybox.SESSION_TTL_SECONDS` is 30 minutes, deliberately short because an open
session is a held price quote. A multi-stage job can outlive that. Either stage
records get their own collection with a longer TTL, or each stage's requirements
are minted at the stage boundary rather than up front. The second is better: it
keeps every quote short-lived and it prices later stages with knowledge of what
earlier stages produced. Decide explicitly; inheriting 30 minutes by accident
would expire jobs mid-run.

---

## 6. What we do not run

The recommendation is to use B402's facilitator and not to run our own.

Running a facilitator means holding an EOA with a private key, keeping a gas
balance on it, monitoring that balance, and accepting a liveness obligation,
because a facilitator that is down is a checkout that is down. That is the
transaction-sending burden this whole direction exists to remove, relocated onto
us. It is visible in the prior art: `@altananetwork/x402-server`'s
`dist/settle.js` ends with `clients.wallet.sendTransaction`,
`waitForTransactionReceipt`, and a revert check, which is the shape of exactly
what we would be taking on.

### 6.1 What we depend on B402 for

| Dependency | Consequence of losing it |
|---|---|
| signature verification against our requirements (`/verify`) | no payment can be checked; we would have to implement EIP-712 and ERC-1271 verification ourselves |
| broadcast and gas (`/settle`) | no payment can move |
| nonce management and replay protection | handled by the token's EIP-3009 nonce or Permit2's bitmap, so this survives a facilitator outage as a property of the chain |
| receipt confirmation | the `transaction` field in the settle response |
| the supported-kinds list (`/supported`) | we cannot build requirements we know the facilitator will accept |
| the spender and signer addresses | these are B402's, read live, and they change without our involvement |

### 6.2 What breaks when it is unavailable

Verified in the existing code path, which already handles this correctly:

- `get_supported` caches for 15 minutes, so a short outage is invisible for new
  challenges built during the cache window, and then challenge creation fails.
- `b402.B402Error` is raised and `backend/server.py` turns it into a 503 with
  the message attached. That is the right behaviour and the resource server
  should reuse it, not invent a different code.
- Any request already holding a valid authorization is stuck: it cannot be
  verified and cannot be settled. Under the work-before-settle ordering of
  section 5, work already done during an outage is unpaid, and the authorization
  may expire before the facilitator returns. This is the concrete cost of
  recommendation 5.5 and it should be stated to anyone accepting it.
- Nothing already settled is affected. Settled payments are on chain and B402's
  availability has no bearing on them.

There is one failure mode with no clean handling: a settle that returns outcome
2, broadcast but unconfirmed, followed by the facilitator going down. The
transaction is on chain, we cannot ask B402 about it, and we must not retry. The
only resolution is reading the chain ourselves for that transaction hash, which
needs an RPC client but not a key and not a gas balance. That is an acceptable
dependency and should be built rather than left to a manual check.

---

## 7. The failure table

| Failure | What happens to money | What happens to state |
|---|---|---|
| Agent offline before a stage runs | under work-before-settle, nothing moves. The authorization the buyer signed expires unused at its `deadline` and the nonce is never consumed. Under settle-before-work, the buyer has paid for a stage that will not run and there is no refund path in x402. | job stalls at the last completed stage. The stage record holds a verified but unsettled authorization, which must be marked expired rather than failed once `deadline` passes, because those are different facts. |
| Buyer vanishes mid-job | stages already settled stay settled. No further stage is challenged, so no further money moves. | job is abandoned at a stage boundary with no challenge outstanding. Needs a sweeper, because an abandoned job holds a stage record forever otherwise. This is the TTL decision of 5.7 arriving as an operational problem. |
| Facilitator refuses (`isValid: false`, or a non-success envelope code) | nothing moves. | the request is refused with the `invalidReason` surfaced, as `paybox.submit_payment` already does. Record the attempt; do not mark the stage failed, because a refused payment is a buyer problem and the stage has not been attempted. Onboarding-incomplete (code 1160401) is a distinct case and already distinguished in `b402.py`: it means our account, not their payload, and must not be reported to the buyer as their fault. |
| Facilitator delays to the edge of `validBefore`, the buyer signs a replacement, and both settle | the buyer is charged twice. | this cannot happen on one authorization: EIP-3009 burns the nonce and Permit2 burns the bitmap bit, so the second settlement of the same authorization reverts. It can happen across two authorizations, because a replacement is a different nonce and both are independently valid until their own deadlines. The defence is that the server must never issue a second challenge for a stage that has an outstanding unsettled authorization, and must treat outcome 2 as outstanding, not as failed. `classify_settle_result` already returns `retryable: False` for outcome 2 and that must be honoured by the new path exactly as `paybox.submit_payment` honours it, including its refusal to accept a resubmit while a session is in `broadcast_unconfirmed`. |
| A stage is delivered and rejected | money has moved and stays moved. x402 has no dispute and no refund. | nothing in protocol state changes. The buyer's only recourse is not to pay for the next stage, which is the whole of buyer protection on this rail. This is the point where the rail's posture differs most sharply from ERC-8183, and it should be stated to buyers in the same terms `docs/budget-integration.md` states the budget model's trade, rather than left implicit. |

---

## 8. Conformance requirement: reject bare permit2

This is a conformance requirement, not a house preference. The specification's
own wording, quoted verbatim from `specs/schemes/upto/scheme_upto.md`, Core
Properties (MUST), item 3:

> ### 3. Recipient Binding
>
> The authorization MUST cryptographically bind the recipient address. The server/facilitator cannot redirect funds to a different address than what the client signed.
>
> - Rationale: Prevents malicious facilitators from stealing funds.
> - Implementation: On EVM, the Permit2 witness pattern binds `witness.to`. Other networks MUST implement equivalent recipient binding.

### 8.1 The rule

Reject any payment payload whose rail is bare permit2. Require permit2-witness.

Concretely, in the decoder of section 3.2: when `payload.permit` or
`payload.permit2Authorization` is present and carries no `witness`, refuse the
request. Do not verify it, do not settle it, and do not fall back to treating
`payTo` from the server-held requirements as sufficient.

### 8.2 The mechanism, verified

`PermitTransferFrom` signs the token, the amount, the spender, the nonce and the
deadline, and says nothing about the recipient. Read from Uniswap's own
`PermitHash.sol:21-22`, the typehash is:

```
PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)
```

There is no recipient field in it. The spender is bound because
`PermitHash.sol:62` hashes `msg.sender` into the digest, so the signature names
who may spend but not who receives.

`SignatureTransfer.sol` then transfers to a runtime argument, not to anything
signed. Line 67:

```
ERC20(permit.permitted.token).safeTransferFrom(owner, transferDetails.to, requestedAmount);
```

and line 61 permits the amount to be adjusted downward:

```
if (requestedAmount > permit.permitted.amount) revert InvalidAmount(permit.permitted.amount);
```

So on the bare rail the spender picks both the recipient and the amount, the
amount only downward.

The prior art confirms this is reachable rather than theoretical.
`@altananetwork/x402-server` 0.2.0, read from npm in this pass:

- `dist/decode.js:118` emits three rails: `"eip3009"`, and `witness ? "permit2-witness" : "permit2"`.
- `dist/verify.js:72-74` checks `payTo` only inside the `permit2-witness`
  branch. The bare branch at line 85 builds `buildPermit2TypedData(base)` from
  token, amount, spender, nonce and deadline, with no recipient check anywhere.
- `dist/settle.js:108` builds `transferDetails = { to: cfg.payTo, requestedAmount: ... }` and line 124-127 calls plain `permitTransferFrom` when the payload carries no witness.
- Its README documents two rails, `eip3009` and `permit2-exact`, and states:
  "The recipient is bound into the buyer's signature (EIP-3009 `to` / the
  permit2 `Witness`), so a compromised facilitator key cannot redirect
  earnings."

That README claim is false on the third rail, which the README does not
document and the decoder does emit.

### 8.3 Who is actually at risk, stated correctly

B402 itself produces a witness. Every permit2 kind on the live `/supported`
response is `permit2-exact` or `permit2-upto`, and both use the witness pattern.
So the bare rail is reachable only when a payer omits the witness when
constructing its own payload. It is not an unsafe kind B402 offers.

That means the party harmed by the bare rail is the payer, not us. A payer who
signs a bare `PermitTransferFrom` has handed the spender a capability to move
that amount of that token to any address of the spender's choosing. Our `payTo`
being correct in our own config protects nobody, because on the bare rail the
signature never committed to it.

The rule still goes in, for two reasons. We should not accept a payment the
payer's signature did not authorize to us, because we then hold funds whose
authorization is ambiguous. And a server that accepts the bare rail is a server
that teaches clients the bare rail works.

### 8.4 Bounded blast radius, and what this is not

The correction matters for accuracy. A bare permit2 spender holds one closed
capability: one token, up to one amount, until one deadline, burnable once by
one nonce. An EIP-2771 trusted forwarder holds standing authority over every
function on the contract, permanently, with no amount cap and no expiry.

Same mechanism, different radius. Do not write that bare permit2 reproduces the
2771 failure. It does not. It is a single-use, capped, expiring version of the
same shape, and the correct statement is that the shape recurs, not that the
failure does.

---

## 9. Size

Not in lines of code. In surfaces touched and decisions someone has to make.

### 9.1 Surfaces

| Surface | Change |
|---|---|
| `backend/core/x402_resource.py` (new) | header codec, envelope decoder, rail gate, challenge builder, route price table |
| `backend/core/paybox.py` | extract the requirements store so the checkout path and the resource path share one. No behaviour change to the checkout path. |
| `backend/server.py` | the new paid route or routes, plus a response hook for the outcome header |
| `backend/core/b402.py` | none. If it changes, section 4 has been violated. |
| storage | one collection for stage records with its own TTL, per 5.7 |
| an RPC read path | for outcome 2 resolution when the facilitator is unavailable, per 6.2 |
| `frontend/src/b402Pay.js` | only if a browser buyer must pay the new route. Its envelope is v1-shaped, per 3.2. |
| docs | this document, plus whatever the buyer-facing terms become |
| tests | envelope dialects, header precedence, the rail gate, the three settle outcomes, and the double-authorization case from section 7 |

Nine surfaces, of which two are new files, one is a refactor with no behaviour
change, and one is explicitly do-not-touch.

### 9.2 Decisions

These are the things nobody can decide for the implementer.

1. What is sold, per 2.3. Unanswered, this blocks everything.
2. Whether Tnega is the resource server or each agent is. This decides whether
   the payee on chain is our single write-once `payTo` or the agent's own, and
   therefore whether any payment is attributable to an agent without a join we
   author. Section 1.2. It is the highest-consequence decision in the document.
3. `exact` with settle-before-work, or `upto` with work-before-settle. Section
   5.5 recommends the second.
4. Stage granularity, and the session TTL that follows from it. Section 5.7.
5. Whether to accept v1 header names and the v1-shaped envelope our own buyer
   emits. Section 3.
6. Whether bare permit2 is rejected. Section 8 says yes and gives the
   specification's wording for it.
7. What is done for a buyer who paid for a stage that then failed, given x402
   has no refund. Section 7, last two rows.
8. Whether x402 settlements touch tiering. Section 1.5 says no, and says what
   the alternative would have to be named.
9. Whether to publish a receipt at all, and signed with what key. Section 1.3(b)
   says what a receipt does and does not prove before anyone signs one.

Decisions 1 and 2 gate the rest. Neither is a technical question.

---

## 10. Verification log

What was checked in this pass, and how.

| Claim | Check |
|---|---|
| No x402 resource server exists | grep for the four header names across `backend/` and `frontend/src/`. One hit, a buyer-side wrapper. |
| Ten supported kinds, all `eip155:56`, schemes `exact` and `upto` | live `GET /api/paybox/readiness` against the deployed backend, 2026-09-23. Ten kinds returned: eip3009 for U and USD1, permit2-exact for all four, permit2-upto for all four. No batch-settlement. Signer `0x34F7a661160780Ce1346e6D7B96D2bE244590899`. |
| Permit2 signs no recipient | `PermitHash.sol:21-22` typehash, fetched from Uniswap's repository. |
| Permit2 transfers to a runtime argument, amount adjustable downward | `SignatureTransfer.sol:61` and `:67`, same source. |
| The `upto` spec's Recipient Binding wording | `specs/schemes/upto/scheme_upto.md` fetched from the x402 repository, quoted verbatim in section 8. |
| `upto` forbids multi-settlement | same file, Out of Scope and Core Properties MUST 1, quoted in 5.1. |
| The receipt is signed by the resource server with no counterparty check | `specs/extensions/extension-offer-and-receipt.md` sections 5, 5.2 and 5.5, fetched from the same repository. |
| Three rails in the prior art, README documents two | `@altananetwork/x402-server` 0.2.0 tarball from npm. `dist/decode.js:118`, `dist/verify.js:72-74`, `dist/settle.js:108` and `:124-127`, README "How settlement works". |
| Dialect tolerance pattern | `dist/decode.js:22-34` and `:93` in the same package. |
| Tier rule and the September fix | `backend/core/agents_index.py:125-126`, `backend/core/job_index.py:522` and `:589-593`, `docs/verification-methodology.md:64`, and the `agents.index` caveat from `tnega_catalogue`. |
| Live tier counts | `tnega_catalogue`, as of 2026-09-23T14:46Z. verified 32, canary_verified 0, responding 652, unproven 14220. |
| 604800 second dispute window | `backend/core/pnl.py:101`, annotated as read live from `OptimisticPolicy.disputeWindow()`. |
| `deliverable` is a `bytes32` on chain with content off chain | `frontend/src/altana.js:45`. |
| `PAYBOX_PAY_TO` is one address and its B402 registration is write-once | `backend/core/paybox.py:_pay_to_address()` docstring. Not independently re-tested against B402 in this pass. |

Marked unverified, and left that way rather than smoothed:

- Whether B402 charges a facilitator fee on settle. Nothing in `b402.py` or
  `b402_selfcheck.py` reads a fee field, and no live settle was performed. This
  is a prerequisite for section 1.3(e), because without it the cost of faking a
  repeat-payment history is unknown and possibly zero.
- Whether B402 supports per-operator onboarding, which is the only configuration
  in which an x402 payment is attributable to an agent on chain. Section 1.2.
- `frontend/src/x402Skill.js`'s `B402_SETTLE_PATH = '/papi/v2/b402/settle'`
  against `b402.py`'s `/build/api/v2/b402/settle`. The backend path is confirmed
  working; the frontend constant is not, and the two disagree.
- That the `PAYBOX_PAY_TO` registration is genuinely immutable at B402's end.
  The code asserts it; this pass took the assertion at face value.
