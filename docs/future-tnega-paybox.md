# 🤖 Future: Tnega PayBox (research & design only, not built)

Status, updated 2026-09-04: **the settlement rail is now built and live-tested.** Everything below the "Constraint" headings remains the real research record of how this was scoped — and it matters, because every rail it evaluated died on the same rock. What changed is that a rail which doesn't have that problem was found and implemented: **Binance B402**, the x402 standard settled natively on BSC. See "[The rail that actually worked: B402](#the-rail-that-actually-worked-b402-implemented-2026-09-04)" below for what's real and running, and what still isn't.

The original research framing is kept intact rather than rewritten, because the constraints it documents are still true of MetaMask Card and MoonPay — B402 didn't resolve them, it went around them.

Surfaced in-app as a "Web2 Agents + PayBox" Coming Soon card in the Native Agent Marketplace — a vision/roadmap summary only, no code behind it, linking back here for the full research. That card also names a second, genuinely separate idea this page doesn't cover: a "describe an agent in a prompt, get one built and wired to payment automatically" platform. That's its own much larger future project — comparable in scope to BNB Agent Studio or Claude Code itself — not scoped here or anywhere in this codebase; noted for the record, not researched.

## The idea in one paragraph

A shopping agent (the kind [Anthropic's own open-source `commerce-agents` blueprint](https://github.com/anthropics/commerce-agents) describes) assembles a cart and then stops — by design, it never places an order or touches payment itself. Something has to render an actual checkout for the human to complete. Tnega PayBox would be that something: a hosted checkout page a merchant's own backend can hand off to, which settles the purchase using crypto the buyer already holds, via MetaMask Card as the fiat rail. The pitch is "pay for anything an AI shopping agent finds you, straight from your on-chain balance, no manual off-ramp."

## The flow, end to end

```mermaid
flowchart TB
    subgraph Agent["Web2 shopping agent (e.g. Anthropic's commerce-agents)"]
        Cart["🤖 Builds a cart<br/>tailored to size, taste, budget, event"]
        Tool["Calls the checkout tool<br/>the model never sees a URL"]
        Cart --> Tool
    end

    subgraph Merchant["Merchant's own backend"]
        Handoff["StorefrontBackend.checkout_handoff()<br/>runs after the model's call returns"]
    end

    subgraph PayBox["Tnega PayBox — not built"]
        Session["POST /paybox/sessions<br/>amount, currency, order_reference"]
        SessionURL["Returns a session id and checkout_url"]
        Poll["GET /paybox/sessions/session_id<br/>webhook or poll for completion"]
        Session --> SessionURL
    end

    subgraph Checkout["Hosted checkout page"]
        Human["🧑 Human opens checkout_url<br/>(CheckoutHandoff.url)"]
        Wallet["Connects a BSC wallet"]
        Human --> Wallet
    end

    subgraph Settlement["Settlement rail"]
        MoonPay["💳 MoonPay: direct BSC sell<br/>near-term, no bridge"]
        Bridge["🌉 Bridge BSC → Base<br/>only if using MetaMask Card"]
        Card["MetaMask Card<br/>funds from Linea/Base/Solana/Monad"]
        Bridge --> Card
    end

    Tool -.-> Handoff
    Handoff --> Session
    SessionURL --> Human
    Wallet --> MoonPay
    Wallet --> Bridge
    MoonPay --> Poll
    Card --> Poll
    Poll -.-> Handoff
```

## Constraint #1: MetaMask Card doesn't support BSC

Confirmed live against MetaMask's own support docs: the card can be funded from **Linea, Base, Solana, and Monad**. BNB Smart Chain is not in that list, and there's no indication it's coming — worth periodically rechecking rather than assuming it stays that way. Since Tnega is BSC-native, a user's escrow balance, staking positions, and trading gains all sit on a chain the card can't spend from directly.

### Bridging BSC → Base

Base is the obvious target: it's both an eligible card-funding chain and a standard EVM chain, so a bridged asset behaves like any other ERC-20 once it lands.

There is **no canonical, trust-minimized bridge between BSC and Base** — the relationship an L2 has to its L1 doesn't exist here, because BSC is a separate L1, not a Base/OP-stack rollup. Confirmed live:

- BNB Chain's own bridge (`bnbchain.org/en/bnb-chain-bridge`, and the open-source [`bnb-chain/canonical-bridge`](https://github.com/bnb-chain/canonical-bridge) widget/SDK) is itself an **aggregator** — it pools liquidity from Celer, deBridge, and Stargate rather than running its own native bridge. It's a chain-team-endorsed entry point, but still routes through third-party bridge protocols underneath, not a first-party guarantee.
- **Circle's CCTP** (the canonical, burn-and-mint USDC bridge) doesn't include BSC. That rules out the cleanest possible path for USDC specifically — any BSC→Base USDC move goes through a liquidity bridge, not a native mint.
- For USDT, **Stargate** (LayerZero V2) is the best-regarded liquidity-bridge route between BSC and Base.
- **deBridge** is cited as the strongest overall pick into Base in 2026 (speed, security, chain coverage) if the asset isn't USDT/USDC specifically.

A BSC→Base leg is buildable, but it's an extra hop through a third-party liquidity bridge — fees, a settlement delay anywhere from ~10 seconds to a few minutes depending on protocol, and a trust surface beyond BSC's and Base's own security, not a clean native transfer. Whatever this becomes should probably integrate a bridge-aggregator API (Li.Fi and Socket are the standard programmatic equivalents of BNB Chain's own consumer-facing widget) rather than hardcoding one bridge protocol — the same "don't assume one liquidity source" discipline this project already applies elsewhere (see `docs/venus-skill-revert-investigation.md`'s wallet-balance handling, or the Trading Agent's own multi-DEX comparison).

## Constraint #2: MetaMask Card's own signups are paused

This wasn't part of the original ask but changes the picture enough to state plainly. Confirmed live: MetaMask paused new **US** Card signups and halted Metal card orders globally on **June 2, 2026**, with **no restoration date given** as of the most recent reporting found (July 2026). Existing cardholders are unaffected. Virtual-card signups remain open in a defined set of non-US regions (UK, EEA, Canada, Switzerland, and core LATAM: Argentina, Brazil, Colombia, Mexico).

This is a second, independent blocker on top of the chain gap, entirely outside Tnega's control — a design built around MetaMask Card right now would be building toward a rail that isn't accepting new US users at all. Worth a periodic recheck (there's a reasonable chance this reopens before the BSC gap does, since it reads as a regulatory/operational pause rather than a structural limitation), but not something to build against today.

## Architecture: how a commerce agent actually hands off

Read Anthropic's `commerce-agents` source directly rather than assuming an MCP-server shape, since that assumption turned out to be wrong. The extension point is much simpler than an MCP tool call — worth stating precisely because it's the one piece of this design that's already fully confirmed and stable to build against:

```python
# shopping-agent/core/shopping_agent/backend.py
async def checkout_handoff(
    self, session: ShoppingSessionContext, cart: Cart
) -> list[CheckoutHandoff]:
    """Optional: where this cart is paid for when that is not a route in the
    host app, such as the platform's hosted checkout URL, or one URL per
    seller on a marketplace. The executor puts the result on the ``checkout``
    card's payload after the model's call, so the URL is never a tool
    argument and never reaches the model."""

class CheckoutHandoff(BaseModel):
    url: str
    label: str | None = None   # button text; the host has a default
    seller: str | None = None  # set when the cart hands off per seller

class Cart(BaseModel):
    items: list[CartItem]
    currency: str = "USD"
    # .subtotal is computed from items

class CartItem(BaseModel):
    product_id: str
    title: str
    price: float
    quantity: int
    # + image_url, option_values, variant_of
```

Three things this confirms, precisely:

1. **The agent (Claude) never sees the checkout URL or any payment detail.** `checkout_handoff()` runs on the deploying merchant's own backend, after the model's own tool call returns — a deliberate security boundary, not an oversight. Tnega PayBox has no reason to be an MCP server or a tool the agent calls; there's no agent-facing surface to build at all.
2. **The integration point is the merchant's own `StorefrontBackend` implementation**, not the agent framework. A merchant wanting to offer "pay with crypto via Tnega PayBox" implements `checkout_handoff()` to construct a `CheckoutHandoff(url=<PayBox-hosted checkout URL>, label="Pay with crypto")`, alongside (not instead of) whatever normal fiat checkout URL they already return — `checkout_handoff()` returns a **list**, so multiple payment options coexisting is already how the framework expects this to work.
3. **The shape Tnega PayBox needs to expose is a session-based checkout API**, the same pattern Stripe Checkout or a hosted on-ramp widget already uses, not anything novel:
   - `POST /paybox/sessions` — merchant backend calls this when building `checkout_handoff()`, passing `{amount, currency, merchant_id, order_reference, success_url, cancel_url}` (`Cart.subtotal` / `Cart.currency` map directly onto this).
   - Response: `{session_id, checkout_url}` — the `checkout_url` is exactly what goes into `CheckoutHandoff.url`.
   - The hosted `checkout_url` page is where the actual "connect BSC wallet → bridge to Base → settle via MetaMask Card" flow (or whatever the settlement path ends up being) happens, entirely outside the agent's own context.
   - A webhook or polling endpoint (`GET /paybox/sessions/{id}`) lets the merchant's own backend confirm completion, mirroring how this project's own `useJobActions.js`/`JobStatusPanel.jsx` already poll on-chain job status rather than assuming.

This is a genuinely small, well-defined surface — the hard part of this feature was never "how does an agent call into it," it's "does the settlement rail underneath actually work from BSC," which the two constraints above answer plainly: not yet.

## Scope check

**Not a near-term buildable feature as originally scoped (BSC → bridge → MetaMask Card).** Both blockers are external and outside this project's control:

- The chain gap requires either MetaMask adding BSC support (no signal this is planned) or accepting an added bridge hop with its own cost/delay/trust surface.
- The signup pause is a live, unresolved MetaMask-side restriction with no stated end date.

Both facts are worth rechecking before resuming this work, not assuming either has changed.

## An alternative worth considering instead of MetaMask Card specifically

Checked whether a different settlement rail sidesteps the chain problem entirely, since the user asked. It does:

- **MoonPay** confirmed live to support BNB Smart Chain directly as both a buy and sell network, settling a sale to a bank account — no bridge needed at all.
- **Transak** powers the "Sell" button inside MetaMask itself and advertises 80+ source networks; BSC/BEP-20 coverage is broad but wasn't confirmed token-by-token in this pass (a genuine gap, not assumed clean).
- Checked as a possible self-custody-card alternative to MetaMask Card: **Gnosis Pay** (Safe-based, self-custodial) — supports Ethereum, Polygon, and Gnosis Chain, not BSC. Same structural gap as MetaMask Card, not an improvement.

The tradeoff: going this route means Tnega PayBox settles to a **bank payout** (or whatever card-topup rail MoonPay/Transak themselves offer), not specifically a *self-custody Mastercard debit card* the way the original MetaMask Card concept was. That's a different product shape — "instant, no-bridge fiat off-ramp for a checkout" rather than "spend BSC crypto on any card anywhere" — worth deciding on explicitly rather than treating as equivalent. It is, however, the one path here that's actually buildable against BSC today, with no dependency on an external company lifting a signup pause or adding chain support.

## The rail that actually worked: B402 (implemented 2026-09-04)

Every settlement rail researched above failed on the same thing: **BSC**. MetaMask Card can't fund from it (and paused US signups). Gnosis Pay doesn't support it. MoonPay does, but only as a bank-payout off-ramp — not something an agent or a checkout page can settle against directly.

[Binance B402](https://web3.binance.com/en/dev-docs/products/b402-api/integration-guide) is the x402 standard settled **natively on BSC**. No bridge, no chain gap, no third party's signup queue in the middle. Confirmed live against the real API with real credentials, not assumed: all 10 payment kinds this account can accept are on `eip155:56`.

The unplanned bonus, found by reading the real `/supported` response rather than designed for: one of the four assets B402 settles here is **United Stables ($U, `0xcE24439F2D9C6a2289F741120FE202248B666666`) — ERC-8183's own settlement token**, the exact asset this marketplace already denominates escrowed hires in. A PayBox payment and a Tnega hire settle in the same asset on the same chain, with no conversion between them.

### What's real and running

| Piece | Where | State |
|---|---|---|
| HMAC-SHA256 signing, `postB402()` | `backend/core/b402.py` | Live-verified against the real API |
| `supported` (cached, 15 min) | `core/b402.py` | Live — returns 10 real kinds, all BSC |
| `verify` / `settle` + 3-outcome handling | `core/b402.py` | Built; verify live-exercised, settle not (see below) |
| Checkout sessions + server-held requirements | `backend/core/paybox.py` | Live-tested end to end |
| `GET /api/paybox/readiness` | `backend/server.py` | Live |
| `POST /api/paybox/sessions` → real HTTP 402 | `backend/server.py` | Live-tested |
| `GET /api/paybox/sessions/{id}` | `backend/server.py` | Live-tested |
| `POST /api/paybox/sessions/{id}/pay` | `backend/server.py` | Live-tested through verify |

Real assets, verified on-chain (each address matched by calling `name()` on BSC mainnet and comparing it exactly to the name B402 returns, rather than trusting a well-known-address list): $U, USDT, USDC, USD1 — **all 18 decimals on BSC**, which is a real trap worth naming, since USDT/USDC use 6 decimals on Ethereum and getting it wrong would misprice a payment by 10¹².

### The one security rule this design turns on

Payment requirements are **issued and held by the server**, loaded back by session id, and never taken from the request body. Verifying a client-supplied payload against client-supplied requirements proves only that the client agrees with itself — a buyer could lower `amount`, swap `asset` for a worthless token, or repoint `payTo`, and B402's verify would faithfully confirm the match.

This was tested adversarially, not just asserted: a payment submitted with requirements tampered down from 1.25 U to 0.000001 U was checked against the real, stored 1.25 U requirements, and the stored session was confirmed unchanged afterward.

### Honest gaps

- **No real settlement has been executed.** `verify`/`settle` need a genuinely signed EIP-3009 or Permit2 authorization from a funded wallet. Producing one means handling a private key holding real $U, which is out of scope for this backend by design — it never holds a key. The verify path was exercised live with structurally-real payloads and returns real, structured rejections (`invalid_exact_evm_payload_recipient_mismatch`); the settle path is code-complete and unexercised. **Completing a real payment end to end is the honest next step, and it needs a funded browser wallet, not more backend work.**
- **No checkout UI yet.** `checkout_url` points at `/paybox/checkout`, which isn't built. The buyer-facing page that connects a wallet and produces the signature is the remaining piece.
- The `permit2-upto` scheme and its `settleAmount` are implemented but unexercised.

### Two real API details the guide's prose doesn't spell out

Both cost real debugging time and are recorded so the next person doesn't repeat them:

1. **`X-OC-TIMESTAMP` must be ISO 8601, not epoch milliseconds.** Epoch-millis is the natural guess (it's what Binance's own spot API uses) and it fails with `HTTP 401 {"msg":"Invalid timestamp format, expected ISO 8601","code":40103}`.
2. **The signed and sent payload is `{"body": {...}}`** — the x402 object nests inside a `body` key rather than being the top-level document. And `paymentPayload` itself needs `resource` and `accepted` blocks, not just `payload`.

## A production reference case: Pay.sh

Confirmed live 2026-09-03, directly against Solana Foundation's own announcement, pay.sh itself, and its GitHub repo — not just cited secondhand: [Pay.sh](https://pay.sh) is a live, no-waitlist gateway the Solana Foundation built with Google Cloud, letting AI agents (Claude, Gemini, Codex, and others named on the launch page) pay per API call in stablecoins over Solana, built on x402 plus a metering layer called MPP.

- **Genuinely sub-cent pricing, confirmed on the live registry**: several listed services, including two from Alibaba Cloud (Facebody, Image Segmentation), price calls at $0.001 — Alibaba Cloud is a real, present provider in Pay.sh's own registry, not just a rumored partner.
- **Ships a real MCP integration**: `pay --sandbox claude` wires Pay MCP tools straight into Claude Code — an agent framework gets paid-API access as a tool call, no separate payment integration to build.
- **Open source**: `github.com/solana-foundation/pay`.
- Solana's own announcement describes settlement completing "in seconds," reconciled with the provider afterward. A faster, more specific latency figure and a "Payment Channels" throughput upgrade have both been reported for Pay.sh elsewhere, but neither was independently confirmable against Solana Foundation's own materials or the GitHub repo as of this check — worth re-verifying directly before citing a specific number, not repeating secondhand.

Why this belongs in this doc: it's a working, in-production instance of the exact model Tnega PayBox was scoped around — an agent pays per call, no account, no manual off-ramp — just built on Solana with stablecoins instead of BSC with MetaMask Card. It's independent evidence the model is sound. It doesn't remove either BSC-specific blocker documented above.

## Real inspiration, multi-chain direction (future, larger scope)

Noted 2026-09-03, explicitly not scoped or designed, not a near-term next step — recorded so it isn't lost.

Everything above scopes Tnega PayBox narrowly to one chain: BSC in, one settlement rail out (bridge-to-MetaMask-Card, or a direct BSC off-ramp like MoonPay). Pay.sh's own design points at a larger direction worth recording. From the paying agent's side, Pay.sh doesn't care which chain settles a given call — it just picks whichever facilitator underneath makes sense. Tnega PayBox could eventually work the same way: rather than committing to one settlement rail, let an agent hired through or discovered via Tnega settle across whichever chain is genuinely cheapest or fastest for that specific transaction — BSC direct via MoonPay when the buyer already holds BNB-chain assets, a Pay.sh-shaped Solana path when the agent's own stablecoins already sit there, a bridged path when neither applies.

This isn't a new discipline invented for this note — it's the same one the project's own Trading Agent already applies by comparing PancakeSwap, Biswap, and ApeSwap quotes live rather than assuming one DEX is the right venue, applied one layer up, to settlement rails instead of swap venues.

This sits on top of, not in place of, the BSC-specific research above, which stays the concrete near-term path if this is picked back up.

## Recommended next steps, when this is picked back up

1. Recheck both MetaMask Card constraints (BSC chain support, US signup pause) before writing any code.
2. Decide the settlement rail question directly: MetaMask Card + bridge (higher user appeal, two external blockers) vs. MoonPay/Transak direct BSC off-ramp (buildable now, different product shape — bank payout, not a spend-anywhere card).
3. If the bridge path is chosen, prototype against a bridge-aggregator API (Li.Fi or Socket) rather than one hardcoded protocol, and get a measured end-to-end latency/fee number before committing to the UX around it.
4. Build `POST /paybox/sessions` / `GET /paybox/sessions/{id}` against the `CheckoutHandoff` shape above — that part of the design doesn't depend on either open question above and could be built and tested independently.
5. Reference implementation to build against: a `StorefrontBackend.checkout_handoff()` that returns a Tnega PayBox URL alongside a normal fiat option, exercised against Anthropic's own `commerce-agents` examples (`examples/retail/`, etc.) rather than a fresh mock.
