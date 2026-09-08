# Payment Rails

There are four ways money moves in this project, and they are separate
systems that happen to share a chain. This page covers all four and says
which is used where.

| Rail | Where it is used | What settles | Status |
|---|---|---|---|
| ERC-8183 escrow | Hiring an agent from the marketplace | `$U` on BSC, held in escrow | Live |
| AgentAccessMarket | Buying access to an agent you do not hire per job | BNB, USDT or `$U` on BSC | Live |
| B402 | The studio's API flow | `$U`, USD1, USDT or USDC on BSC | Entitled and reachable; settlement needs a browser signature |
| Crossmint | The studio's physical flow | A card, off-chain | Configured but missing the physical-goods entitlement |
| Handoff | Anything the other rails cannot settle | Nothing. The buyer completes checkout | Always available |

ERC-8183 and AgentAccessMarket are contracts and are covered in
[Smart Contracts](smart-contracts.md). The rest of this page is the studio's
pluggable rail layer, in `backend/core/commerce/rails/`.

## Why there is a rail interface at all

One interface, `PaymentRail`, with `is_configured()`, `quote(cart)` and
`execute(cart)`. Everything payment-shaped sits behind it, so the pipeline
never learns which rail settled a cart.

The reason it exists rather than a direct call to whichever rail works: of
the three, one works today, one is missing an entitlement, and one depends
on nothing at all. Only the last is guaranteed. The interface is what let
everything upstream of payment ship regardless of which of the other two was
available on a given day.

A quote returns `available`, a total and a reason. A result returns one of
five statuses: `settled`, `handoff_required`, `unavailable`, `failed` or
`indeterminate`. `handoff_required` is not a success. The money has not
moved and the caller must not treat it as though it had.

## Selection

`select_rail()` asks each rail, in order, whether it is available for this
specific cart, and takes the first that says yes. The order is B402,
Crossmint, Handoff. Handoff is always last, and by construction always
selectable, which is the guarantee the whole pipeline rests on: no cart can
reach the end and find nothing to do with itself.

Selection asks about the cart, not about configuration. B402 can be fully
configured and still unable to settle a particular token, and a rail that
says "not for this cart" must not be chosen just because its key exists.

Every quote considered is returned alongside the choice, so a surprising
selection is explainable after the fact rather than needing a re-run.

A rail that raises during `quote()` is caught and recorded as unavailable
with the exception name. A broken rail must not break selection.

## B402

B402 is the x402 standard settled natively on BSC. It is the rail that ended
a long search: every other settlement route evaluated in
[Future: Tnega PayBox](future-tnega-paybox.md) died on the same rock, that
it could not fund from BSC. B402 settles on BSC. There is no bridge hop and
no chain gap.

Host and paths, from `backend/core/b402.py`:

```
https://web3.binance.com/build/api/v2/b402/supported
https://web3.binance.com/build/api/v2/b402/verify
https://web3.binance.com/build/api/v2/b402/settle
```

Requests are HMAC-signed with `OC_API_KEY` and `OC_SECRET_KEY`. Both are
backend-only. The secret key signs every request and must never reach a
browser or a frontend bundle, so nothing in that module is safe to port
client-side and no route echoes either value back.

The response envelope carries its own `code`, and that, not the HTTP status,
is authoritative. `000000000` is success. A malformed request can still
return a 200-shaped envelope.

### What the facilitator supports

Read live from `/supported` on 2026-09-08. Ten payment kinds, all on
`eip155:56`, across four assets, all 18 decimals, at x402 version 2.

| Asset | Symbol | Address | Transfer methods offered |
|---|---|---|---|
| United Stables | `U` | `0xcE24439F2D9C6a2289F741120FE202248B666666` | `eip3009`, `permit2-exact`, `permit2-upto` |
| World Liberty Financial USD | `USD1` | `0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d` | `eip3009`, `permit2-exact`, `permit2-upto` |
| Tether USD | `USDT` | `0x55d398326f99059fF775485246999027B3197955` | `permit2-exact`, `permit2-upto` |
| USD Coin | `USDC` | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | `permit2-exact`, `permit2-upto` |

Two things in that table are worth reading carefully. USDT and USDC offer no
`eip3009` method, so a payment in either has to go through Permit2. And one
of the four assets is `$U`, which is ERC-8183's own settlement token, the
token this marketplace already denominates hires in. A B402 payment and a
Tnega escrow hire settle in the same asset on the same chain with no
conversion between them. That alignment was not designed for. It was found
by reading the `/supported` response.

The Permit2 spender addresses the facilitator names are
`0x3038f7ac3b4D1a3fe886BdCB5cD01e9f6BDd8633` for the `exact` scheme and
`0x8c819E6De3df83E0e87bBE7651c5D4e83229b239` for `upto`.

An earlier `40104` "No permission" response blocked this rail entirely. That
is resolved: the account is entitled, verified live.

### What B402 will not do here

It will not settle without a caller-supplied, already-signed payment
payload. Settlement needs an EIP-3009 or Permit2 authorisation signed by the
payer's wallet, and this backend holds no private key by design. So
`execute()` with no payload reports that a signature is required, and the
pipeline falls through to Handoff rather than attempting anything.

It also never retries a settle. A settle whose response is lost is
ambiguous: the transaction may have broadcast. Retrying could spend a user's
money twice. The classifier distinguishes a broadcast-but-unconfirmed
outcome from a terminal failure, and the first is surfaced as
`indeterminate` for a person to resolve on-chain, never retried
automatically.

The quote also refuses on a decimals mismatch. If the facilitator states a
token's decimals and they disagree with the cart's, the cart's total is
denominated wrongly and settling it would move the wrong amount, so the rail
declines rather than reconciling silently.

`GET /api/paybox/selfcheck` runs the rail's checks against the live
facilitator and is surfaced in the app, so a visitor can see the rail's
state rather than take a claim on trust.

## Crossmint

Crossmint is the path for physical goods. A production key is configured, so
`execute()` can place orders and spend money, which is why three independent
guards sit in front of it. No single mistake is enough to cause an
unintended purchase.

Guard one: `execute()` is inert unless `COMMERCE_ALLOW_REAL_ORDERS` is set,
and it is off by default. Reading prices, quoting and building carts all
work without it. Only the order write is gated. A flag that has to be set
deliberately is the difference between running the pipeline and buying
something.

Guard two: the hard spend ceiling described below, checked immediately
before the HTTP write.

Guard three: a browser profile is never created, and a `browserProfileId` is
never sent unless the caller states explicit per-session consent. Per
Crossmint's own documentation a profile persists the browser state resulting
from a user's merchant login, so creating one as a side effect of a checkout
would silently establish a durable logged-in session on someone's retail
account. That is a decision for the person whose account it is, taken each
time. The profile endpoint is named as a constant in the module so the guard
can be checked against something concrete, and the module never calls it.

Endpoints, from Crossmint's documentation, re-verified 2026-09-08:

```
POST /2022-06-09/orders            create an order   (header X-API-KEY)
GET  /2022-06-09/orders/{orderId}  read an order
```

The base is `https://www.crossmint.com/api` in production and
`https://staging.crossmint.com/api` in staging.

The blocker on this rail is not code. Physical-goods checkout needs the
`worldstoreCheckout` addon, which this project's account does not have. The
adapter reports that as a missing entitlement rather than as a bug. Until it
is granted, the physical flow ends at Handoff.

Three refusals in the adapter are worth knowing about, all covered by the
self-check. A testnet payment method is refused rather than accepted as a
harmless default. There is no implicit payment method: with
`CROSSMINT_PAYMENT_METHOD` unset it refuses rather than guessing one. And
BSC is not in the accepted method set, so a cart cannot be pointed at it by
mistake.

## Handoff

The fallback that always works, and the reason the rest of the pipeline is
shippable. It renders the cart and hands the buyer a URL to complete the
purchase themselves.

It depends on nothing: no API key, no network call, no merchant
relationship, no chain. That is the whole point. Every other rail can be
unavailable and this one still completes.

It never reports a purchase. Its status is `handoff_required`.

A single-item cart hands back that merchant's own product page. A cart
spanning several merchants has no single checkout URL, and inventing one
would be a broken link, so it lists each item's own link and says why.
`COMMERCE_HANDOFF_BASE_URL`, if set, overrides both with a hosted checkout
page.

## The hard spend cap

`backend/core/commerce/limits.py` holds one constant,
`MAX_ORDER_VALUE_MINOR_UNITS`, currently `5 * 10**18`. That is 5.00 units of
an 18-decimal token, chosen so that a bug costs about a coffee rather than a
wardrobe. It is a ceiling, not a budget. A buyer's own budget is separate and
QA enforces it independently.

It is deliberately not an environment variable. An environment variable can
be raised by accident, by a deploy config, or by a process inheriting a
stale value. A number in source has to be edited, reviewed and committed,
which is the friction the cap exists to provide.

It is enforced in two places, and neither is redundant. `agents/payment.py`
checks before a rail is chosen, so it applies to every rail rather than only
to Crossmint. `rails/crossmint.py` checks immediately before the HTTP write,
so a future caller that bypasses the payment agent still cannot exceed it.
The first is the policy and the second is the fuse.

A decimals mismatch is treated as a failure rather than something to convert
around. If a token's decimals are not what the cap assumes, the cap's
meaning is unclear, and the safe answer on a spend path is to refuse rather
than to guess a conversion.

## The B402 Bazaar

Separate from settlement: the Bazaar is Binance's discovery index of x402
endpoints, and it is what gives the studio's API flow something to search.
The endpoints are public and take no key.

```
https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar/resources
https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar/search
https://www.binance.com/bapi/ramp/v1/public/ramp/b402/bazaar/merchant
```

Measured on 2026-09-08, the catalogue held 500 resources across five pages
of 100. Every accept entry was on `eip155:56`, and the ones inspected priced
in `$U` at the same address the facilitator's `/supported` returns. Search
returned relevant results for plain queries such as "image" and "weather
forecast".

That is worth stating because the expectation going in was the opposite:
that BNB Chain would carry few x402 services and that most would settle on
Base or Solana. For this directory it does not hold.

Because the Bazaar is somebody else's index, every value it returns is
treated as untrusted input by the stages above it. A directory entry's
description is passed to Match as a candidate and QA checks the price before
anything is paid.

## What was ruled out

The Binance Pay Merchant API, meaning QR and deeplink checkout, was
considered and not built. The B402 Bazaar opt-in was built instead, which is
the lighter integration and the more relevant one for agent-to-agent
commerce. This was a scope decision, not an oversight.

MoonPay declined partner onboarding on country and industry grounds, and
Tnega PayBox depended on it. Nothing in the codebase is built against
either. The research that led there is in
[Future: Tnega PayBox](future-tnega-paybox.md).

MetaMask Card and Gnosis Pay were both evaluated and both failed on the same
constraint: neither could fund from BSC. That record is in the same page.
