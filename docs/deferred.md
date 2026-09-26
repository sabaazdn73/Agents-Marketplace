# Deferred work

The rule for this page, set by the owner: whatever is blocked goes here, with
what blocks it, what unblocks it, and the research already done, with its
sources. Nothing on this page is shown in the app. An item leaves this page
only when it is built and proven end to end by a real run, or when the owner
drops it.

Each entry gives: what it is; its status (deferred, and since when); what
blocks it; what unblocks it; and the research done, with sources. Web sources
carry the date they were read. Findings read from a package's code name the
package, its version, and the file or string. Minified file names are those in
the published tarball and change between versions.

Contents:

1. [Email and social sign-in, embedded wallets and key export (Privy)](#1-email-and-social-sign-in-embedded-wallets-and-key-export-privy)
2. [Fiat onramp](#2-fiat-onramp)
3. [Google and Apple sign-in](#3-google-and-apple-sign-in)
4. [Any MoonPay route](#4-any-moonpay-route)
5. [Chainlink feed-derived figures and premium (E22, E24)](#5-chainlink-feed-derived-figures-and-premium-e22-e24)
6. [Backed / xStocks API reads (E20) and what hangs on them](#6-backed--xstocks-api-reads-e20-and-what-hangs-on-them)
7. [Phase 5: Solana](#7-phase-5-solana)
8. [Phase 6: custom baskets](#8-phase-6-custom-baskets)
9. [Phase 7: vaults](#9-phase-7-vaults), including Hyperliquid vault deposits
10. [Two animations, after the web version is complete](#10-two-animations-after-the-web-version-is-complete)
11. [MCP on our own chain reads instead of Zerion and LI.FI](#11-mcp-on-our-own-chain-reads-instead-of-zerion-and-lifi)
12. [Jupiter: not used](#12-jupiter-not-used)
13. [Other deferred items already recorded elsewhere in these docs](#13-other-deferred-items-already-recorded-elsewhere-in-these-docs)
14. [Budget index: a free BSC fallback after the QuickNode trial](#14-budget-index-a-free-bsc-fallback-after-the-quicknode-trial)

---

## 1. Email and social sign-in, embedded wallets and key export (Privy)

**What it is.** A second way in for people without a crypto wallet: sign-in by
email, Google or Apple through Privy (`@privy-io/react-auth`), an embedded EVM
and Solana wallet created for the user, key export so the user can take the
wallet elsewhere, and Privy's fiat onramp (entry 2). It was planned as a
separate, removable path beside the plain wagmi and SIWE wallet path, all
Privy code in one folder behind a small wallet interface.

**Status.** Deferred since 2026-09-25, by the owner: step one ships with
crypto wallets only, and every trace of Privy was removed from the code,
dependencies, configuration, tests and other docs. The site ran Privy until
2026-09-25. The owner checked Privy's dashboard before the removal: it held no
users and no embedded wallets, so no account or wallet was stranded.

**What blocks it.**

- The owner's decision to reintroduce it.
- Two properties the site's privacy promises need and the SDK does not give by
  construction (both below): that no path can reach MoonPay or Coinbase, and
  that code on our origin cannot export a user's key.
- No data processing agreement (DPA) in Privy's developer terms.
- The owner's own Google and Apple OAuth credentials (entry 3).

**What unblocks it.**

- The owner decides to bring it back.
- Privy confirms in writing that MoonPay and Coinbase can be disabled for the
  app, and that client-side programmatic key export can be disabled.
- A signed DPA with Privy.
- The owner's own Google credentials, and for Apple an Apple Developer
  account and credentials (entry 3).
- A real run proving sign-in, wallet creation and key export end to end.

**Research done.** Package findings are from `@privy-io/react-auth` 3.45.0,
the latest on npm when read (`npm view`, modified 2026-09-21), unpacked from
the published tarball on 2026-09-25. Docs pages were read on 2026-09-25.

*External wallet detection.* Leaving `'wallet'` out of `loginMethods` does not
stop the SDK looking for browser wallets.

- On mount the SDK unconditionally calls mipd's `createStore()`, which
  broadcasts the EIP-6963 `eip6963:requestProvider` event and keeps every
  wallet's announcement in memory, then initialises its connector manager
  (`dist/esm/index-BStyLWM-.mjs`).
- `externalWallets.disableAllExternalWallets` (typed `@experimental` in
  `dist/dts/types-CgWBevVE.d.ts`) makes `ConnectorManager.initialize()` return
  before the detection function that reads `window.ethereum` and
  `window.ethereum.providers`, and before the Coinbase, Base, WalletConnect,
  Phantom and Backpack connectors are built (`dist/esm/toViemAccount-BEZt_I8V.mjs`;
  the detection function is in `dist/esm/storage-DWGw0C_e.mjs`). The mipd
  broadcast above still runs.
- `toSolanaWalletConnectors()` calls the Wallet Standard `getWallets()` and so
  probes installed Solana wallets whatever `disableAllExternalWallets` says. It
  is the only place `getWallets()` is called. The plan was never to pass it.
- The bundle contains no `eip6963:announceProvider` and no Wallet Standard
  `registerWallet`, so Privy's embedded wallet is not announced to wagmi or
  RainbowKit.
- Docs: https://docs.privy.io/wallets/connectors/setup/configuring-external-connector-wallets

*Key export.* The documented export (`useExportWallet`) opens Privy's own modal
for the user (https://docs.privy.io/wallets/wallets/export). The SDK also
exports `useGetWalletPrivateKey` (`dist/dts/index.d.ts`, typed
`@experimental`): `getWalletPrivateKey({address, recipientPublicKey})` returns
the wallet's private key HPKE-encrypted to a public key the calling code
supplies, so code on our origin holding the user's access token can fetch and
decrypt the key with no confirmation step. "Non-custodial" therefore holds by
our policy, not by construction. The type comment says it works only for TEE
("unified stack") wallets.

*Automatic wallet creation.* `embeddedWallets.ethereum.createOnLogin` and
`embeddedWallets.solana.createOnLogin` (`'all-users' | 'users-without-wallets' |
'off'`, default `'off'`) apply only to login through Privy's modal, not to
whitelabel login
(https://docs.privy.io/basics/react/advanced/automatic-wallet-creation).

*Deleting a user.* Deletion does not delete the embedded wallet: it
"soft deletes" it by disassociating it from the user, and a user who returns
gets a new user id and a new wallet address; recovery is "not guaranteed"
(https://docs.privy.io/user-management/users/managing-users/deleting-users).

*Test accounts.* Privy's test accounts are email or SMS only; other login
flows cannot be tested with them
(https://docs.privy.io/recipes/using-test-accounts).

*Allowed domains and redirects.* The production app must list its allowed
domains. Wildcards are allowed only as a subdomain, and Privy's docs warn
against `https://*.vercel.app` because anyone can deploy to it
(https://docs.privy.io/recipes/dashboard/allowed-domains). Allowed OAuth
redirect URLs must be exact matches with no wildcards, and if none are listed
"users can be redirected to any URL"
(https://docs.privy.io/recipes/react/allowed-oauth-redirects).

*Privacy policy* (https://www.privy.io/privacy-policy, last updated
2026-05-20, read 2026-09-25). Privy collects email, phone number, wallet
address, social media information, IP address and IP-based location, and
device, operating system and browser type. The services are "hosted and
operated in the United States". For customers' end users Privy states it is
"the processor of Personal Data". The policy refers to transfers to the US
"pursuant to a data processing agreement incorporating standard data
protection clauses", and lists subprocessors at trust.privy.io.

*No DPA in the developer terms.* The developer terms of service
(https://www.privy.io/developer-terms-of-service, read 2026-09-25) contain no
data processing agreement and do not incorporate one by reference; the only
DPA mention found is the privacy policy's sentence above.

*Pricing* (https://www.privy.io/pricing, read 2026-09-25): Core, free, up to
50K signatures and $1M transaction volume a month; Scale, $299 a month for
500 to 2,499 monthly active users and $499 a month for 2,500 to 9,999;
Enterprise, custom pricing per transaction or transacting wallet, "as low as
$0.001/signature". The page names no onramp or wallet fees. International SMS
is limited to the Scale and Enterprise plans
(https://docs.privy.io/basics/get-started/dashboard/configure-login-methods).

*Naming mismatch.* SDK 3.45.0 exports `useAddFunds`; the docs page names
`useDepositFunds` (https://docs.privy.io/wallets/funding/use-deposit-funds).

---

## 2. Fiat onramp

**What it is.** Buying stablecoins with a card or bank payment straight into
the user's wallet, through Privy's `useFiatOnramp`. The owner's plan was every
supported destination offered, the user picking one, and availability shown
from the provider rather than hard-coded.

**Status.** Deferred since 2026-09-25. It depends on entry 1 and was removed
with it.

**What blocks it.** Entry 1. Separately, the SDK can route a purchase to
MoonPay or Coinbase for every destination (below), and any path that can reach
MoonPay is not shipped (entry 4).

**What unblocks it.** Entry 1 unblocked, plus Privy's written confirmation that
MoonPay and Coinbase can be disabled for the app, plus a real run that opens
the onramp with a quote for each destination.

**Research done** (`@privy-io/react-auth` 3.45.0, and
https://docs.privy.io/wallets/funding/fiat-onramp, read 2026-09-25):

*The hook.* `useFiatOnramp()` is typed `@experimental` ("may change at any
time"). It returns `fund(opts): Promise<{status: 'submitted' | 'confirmed'}>`,
where `opts` is:

```
{
  source: { assets?: SupportedFiatCurrency[]; defaultAsset?: SupportedFiatCurrency };
  destination: { asset: string; chain: `${string}:${string}`; address: string };
  environment?: 'sandbox' | 'production';
  defaultAmount?: string;
}
```

`destination.asset` is the token address and `destination.chain` a CAIP-2 id.

*The destinations.* Privy's docs list the Stripe destinations as "USDC.e on
Tempo, USDC on Base, Solana, Ethereum, Arbitrum, and Polygon, and USDT on
Ethereum", available "in the US (excluding New York), the EU, and Serbia".
The owner's list is the six outside Tempo; Tempo's USDC.e is the seventh the
docs name.

| Destination | CAIP-2 (Privy docs) | Token address | Address source |
|---|---|---|---|
| USDC on Arbitrum | `eip155:42161` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | Circle |
| USDC on Base | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Circle |
| USDC on Ethereum | `eip155:1` | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | Circle |
| USDC on Polygon PoS | `eip155:137` | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | Circle |
| USDC on Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | Circle |
| USDT on Ethereum | `eip155:1` | `0xdac17f958d2ee523a2206206994597c13d831ec7` | Tether |
| USDC.e on Tempo | `eip155:4217` | not established | none found |

Sources: https://developers.circle.com/stablecoins/usdc-contract-addresses
(read 2026-09-25, no Tempo entry), https://tether.to/en/supported-protocols/
(read 2026-09-25). The Privy docs' own note that `solana:mainnet` is accepted
differs from the genesis-hash form in their sandbox table; which one Privy's
server wants was not tested.

*No BSC stablecoin.* The SDK's Stripe network allowlist in its onramp screen
is aptos, avalanche, arbitrum, base, bitcoin, ethereum, optimism, polygon,
solana, stellar, sui, tempo, worldchain and xrpl: no BSC. Its
`MoonpayCurrencyCode` type includes `BNB_BSC` (native BNB) and no USDC or USDT
on BSC. BSC was to be reached by an unsigned LI.FI bridge proposal, never
executed.

*No region API.* The SDK exports nothing that says whether a region is served
before checkout. Unavailability appears only at checkout, as Stripe's
`location_not_supported`
(https://docs.privy.io/wallets/funding/headless-fiat-onramp).

*Providers.* The docs say Privy "routes purchases through supported providers
(Stripe, Meld, MoonPay, and Coinbase) based on availability and user region",
and that USD, EUR, AUD and BRL go "through Stripe and MoonPay". In 3.45.0
`fund()` takes no provider filter and the SDK picks among the quotes Privy's
server returns, so MoonPay (and Coinbase) are reachable for every destination
whenever the server returns such a quote. Restricting `source.assets` to USD
and EUR does not force Stripe.

*KYC, for the Stripe path.* The fields are typed into Privy's modal on our
origin: name, date of birth, address, nationality, birth place and, for US
users, SSN. The SDK submits them from the browser with `@stripe/crypto`'s
`onramp.submitKycInfo`, and passes the user's email and phone to Stripe's
session, which ties the purchase to a Stripe Link account. Our server never
receives any of it. Stripe's Embedded Components docs:
https://docs.stripe.com/crypto/onramp/embedded-components.

---

## 3. Google and Apple sign-in

**What it is.** Sign-in with Google or Apple, through Privy, using the owner's
own OAuth credentials rather than Privy's defaults.

**Status.** Deferred since 2026-09-25, with entry 1. Apple sign-in was already
deferred earlier the same day.

**What blocks it.** Entry 1. For Apple, an Apple Developer account as well.

**What unblocks it.** Entry 1 unblocked; the owner's Google OAuth client; an
Apple Developer account and the owner's Apple credentials, set before the
first Apple user signs in.

**Research done** (https://docs.privy.io/basics/get-started/dashboard/configure-login-methods
and https://docs.privy.io/authentication/user-authentication/login-methods/oauth,
read 2026-09-25):

- Every provider's redirect URI is Privy's callback,
  `https://auth.privy.io/api/v1/oauth/callback`.
- Google: create an OAuth client of type Web application
  (https://support.google.com/cloud/answer/6158849), add the callback above as
  an authorised redirect URI, give Privy the client id and secret, and add our
  domain as an authorised domain on the consent screen. Unresolved: Google's
  brand verification checks the domains the consent screen names, and the
  redirect lives on privy.io, a domain we cannot verify. Whether verification
  passes with that redirect was not established.
- Custom credentials go live for all users as soon as they are saved.
- Apple: a Services ID with Sign in with Apple, the callback above as its
  redirect, plus Team ID and Key ID
  (https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple).
- Apple credential migration: Apple's user identifier (`sub`) is scoped to the
  developer team, so users who signed in on Privy's default Apple credentials
  cannot be moved to ours. Privy's docs: "we do not yet support migrating these
  users", and once custom Apple credentials are in use they cannot be reset.
  The same holds for LinkedIn and TikTok. So our own Apple credentials must be
  set before the first Apple user.
- Also in allowed domains and redirects under entry 1.

---

## 4. Any MoonPay route

**What it is.** Any path by which a user's purchase or sale could go through
MoonPay: Privy's onramp (entry 2), the Tnega PayBox settlement idea, or a
direct integration.

**Status.** Deferred. MoonPay declined our partner onboarding on country and
industry grounds (recorded in [Payment Rails](payment-rails.md) and
[Data Handling](data-handling.md)); the owner's rule since 2026-09-25 is that
any path that can still reach MoonPay is not shipped.

**What blocks it.** MoonPay's refusal of partner onboarding, and the owner's
rule.

**What unblocks it.** An owner decision on MoonPay, and for the Privy path
also Privy's written confirmation in entry 2.

**Research done.** [Future: Tnega PayBox](future-tnega-paybox.md) holds the
MoonPay research (BSC buy and sell, bank payout off-ramp). Nothing in the
codebase is built against MoonPay.

---

## 5. Chainlink feed-derived figures and premium (E22, E24)

**What it is.** A tokenized equity's premium over its underlying share price,
and any figure computed from Chainlink feed answers (median ratios, distances
in basis points), in the `tokenized_equities` dataset and the measurements
record.

**Status.** Deferred since 2026-09-25 by the owner's decisions E22 and E24.
Premium is withheld with the reason `awaiting_permission`; the collector does
not read the feeds.

**What blocks it.** The Chainlink Foundation Terms of Service v6.0 (effective
2026-08-18) define the Services to include data provided "via data feeds"
(§1), forbid distributing them or letting a third party use them (§3), and
forbid derivative works of them (§2, first list, item (vi)). Chainlink's
tokenized-equity docs say "all developers must reach out to Chainlink Labs
prior to integrating these feeds". No clause read permits display.

**What unblocks it.** Written confirmation from Chainlink Labs, which the owner
is requesting.

**Research done.** `mcp/TOKENIZED-EQUITIES.md`, E22 and E24 in section 12, and
sections 4.3 and 10.1; the clauses are quoted whole in
[Tokenized Equity Measurements](tokenized-equity-measurements.md). The feeds
were read on chain 4663, Ethereum, Optimism, BNB Smart Chain and Ink by
`backend/scripts/te_chainlink_reads.py`, which still computes the withdrawn
figures locally and marks them as not for publication. Not yet read: the
Chainlink Labs Terms of Service, which the Data Streams terms incorporate, and
whether an upstream exchange licence applies.

---

## 6. Backed / xStocks API reads (E20) and what hangs on them

**What it is.** Automated reads of Backed's (xStocks') API, and what needs
them:

- E10: a sound key for identifying xStocks mints on Solana, since mint
  authority alone can be spoofed and all three candidate keys need the
  issuer's asset list;
- the circulating-supply figure, whose exclusions are the issuer's wallet list;
- naming a Solana holding as an xStocks instrument, on the site or through
  MCP;
- Solana execution cost for an xStock pair, from our own pool simulation
  (entry 7).

**Status.** Deferred since 2026-09-25 by the owner's decision E20. Verdicts
that compare against an issuer figure read `awaiting_permission`.
`backend/scripts/te_xstocks_reads.py` refuses any network call without
`--call-issuer-api`.

**What blocks it.** §3(4) of the issuer's terms forbids "any robot, spider,
site search or retrieval application, or any other manual or automatic device
or process to retrieve, index, data-mine, or in any way reproduce" the site or
services.

**What unblocks it.** Backed's written permission, which the owner is
requesting; then the E10 coverage measurement of candidates (a) and (b).

**Research done.** `mcp/TOKENIZED-EQUITIES.md`, E10, E18, E20, E21, E25 in
section 12, and section 4.8; the Solana authority set, Squads vaults and
creation-signature sample are in E10.

---

## 7. Phase 5: Solana

**What it is.** Solana as a separate, removable path: Solana wallets (Phantom,
Solflare, Backpack) through wallet-adapter-react, Sign in with Solana with a
locally verified signed-message fallback, a chain-family-aware wallet
interface, Solana holdings with Token-2022 scaled-UI multipliers applied,
Solana execution cost from our own simulation against the pools themselves
(Raydium CLMM and CPMM, and the other major Solana AMMs holding the pairs we
need), read through `SOLANA_RPC_URL`, the same method planned for MCP (entry
11), and EVM to Solana moves as unsigned LI.FI proposals. Jupiter is not used
(entry 12).

**Status.** Plan only, written 2026-09-25. Nothing is built. Phase 5 no longer
includes anything from entry 1.

**What blocks it.** Completion of the web version, and the owner's approval of
the plan.

**What unblocks it.** Both of those, then a real run of each wallet.

**RPC.** The Solana RPC will be QuickNode, reached from our server through the
environment variable `SOLANA_RPC_URL`, set by the owner on Render and never in
the frontend bundle or in logs. This replaces the plan's browser-side public
endpoint, so the visitor's Solana address reaches our server in the holdings
read, and the privacy page must say so when the phase ships.

**Items the plan itself marks deferred** (each also waits on the phase):

| Item | Blocker | Unblocks it |
|---|---|---|
| Naming xStocks holdings on Solana; MCP Solana instruments; pool-simulated cost for xStock pairs | E10, which waits on E20 (entry 6) | Backed's permission, then the E10 measurement |
| Mobile Wallet Adapter and mobile in-app browsers | Cannot be tested here | A real device run |
| Any wallet that fails its real-run test | Its result | A passing re-run |
| MCP Solana execution cost | Needs our own chain reads | Entry 11 |

**Research done** (read 2026-09-25):

- LI.FI keyless limits: https://docs.li.fi/api-reference/rate-limits; Solana
  support: https://docs.li.fi/introduction/lifi-architecture/solana-overview.
- Sign in with Solana: https://github.com/phantom/sign-in-with-solana and
  https://phantom.com/learn/developers/sign-in-with-solana (documented only for
  Phantom); Backpack's implementation:
  https://raw.githubusercontent.com/coral-xyz/backpack/master/packages/wallet-standard/src/wallet.ts.
- Wallet adapter and mobile: https://github.com/anza-xyz/wallet-adapter/blob/master/APP.md.
- Solana public RPC limits: https://solana.com/docs/references/clusters;
  blockhash expiry: https://solana.com/docs/advanced/confirmation.

---

## 8. Phase 6: custom baskets

**What it is.** A creator publishes a basket of up to five components with
weights. A buyer gets one unsigned swap per component and signs each one; the
buyer's own wallet broadcasts. No pooled token, no rebalancing, no
auto-follow, no fees.

**Status.** Plan only, as of 2026-09-25. Nothing is built.

**What blocks it.** Completion of the web version, and the owner's approval of
the plan.

**What unblocks it.** Both of those.

**Research done.** Plan notes are being written; the owner will add a research
report.

---

## 9. Phase 7: vaults

**What it is.** Phase 7's first step is read-only due diligence of vaults:
Solana real-world-asset vaults on Kamino, GLAM and Voltr, and Hyperliquid
vaults. Deposits, and vaults created by users, are a separate and later part.

**Status.** Plan only, as of 2026-09-25. Nothing is built.

**What blocks it.**

- The read-only step: completion of the web version, and the owner's approval
  of the plan.
- Deposits and user-created vaults: the owner's own legal opinion. In the
  owner's words: "Deposits and user-created vaults are deferred until I have a
  legal opinion".

**What unblocks it.** For the read-only step, the two approvals above. For
deposits and user-created vaults, the owner's legal opinion.

**Research done.** Plan notes are being written; the owner will add a research
report.

### Hyperliquid vault deposits

**What it is.** Depositing into a Hyperliquid vault from the user's own wallet.
The later signing path is a `vaultTransfer` L1 action, signed by the user's
wallet; our server signs nothing.

**Status.** Deferred since 2026-09-25. The read-only due diligence of
Hyperliquid vaults comes first, and is plan only.

**What blocks it.** The owner's legal opinion, as for all deposits in phase 7.

**What unblocks it.** The owner's legal opinion, then an approved plan and a
real run.

**Signing details.** TO BE ADDED from the phase 7 plan.

---

## 10. Two animations, after the web version is complete

**What it is.**

1. A "How it works" walkthrough of using the site.
2. A behind-the-scenes animation of how the site works, especially how anyone
   can call our MCP server from their own assistant or coding tool.

**Status.** Deferred since 2026-09-25, by the owner: "after the web version is
complete".

**What blocks it.** Completion of the web version.

**What unblocks it.** The same.

**Facts the second animation must show accurately**, as read in the repo on
2026-09-25:

- The server is hosted and reached over HTTP. It is mounted in the main
  backend at `POST /mcp` (`backend/server.py`, `backend/mcp_server/`), and the
  endpoint the npm package writes is
  `https://agents-marketplace-q3k4.onrender.com/mcp` (`mcp/npm/bin/tnega-mcp.js`).
- Connecting takes no key, no account and no sign-up. `npx tnega-mcp` (package
  `tnega-mcp`, `mcp/npm`) writes one config entry by running the command-line
  tool's own "add an HTTP MCP server" command with the endpoint above; it
  starts no server and runs nothing afterwards. `npx tnega-mcp --print` prints
  the entry for any other client, and `--scope user` adds it for every project.
  The package only claims the one client path it has checked
  (`mcp/npm/bin/tnega-mcp.js`).
- The protocol is JSON-RPC, answering five methods: `initialize`,
  `notifications/initialized`, `ping`, `tools/list` and `tools/call`
  (`backend/mcp_server/protocol.py`).
- Six tools: `tnega_catalogue` (start here), `tnega_resolve`, `tnega_get`,
  `tnega_list`, `tnega_summary` and `tnega_series`
  (`backend/mcp_server/tools.py`), over the datasets in
  `backend/mcp_server/registry.py`.
- It reads only. Every tool declares `readOnlyHint: true` and
  `destructiveHint: false`; the server holds no key, signs nothing, and cannot
  spend or hire.
- One call at a time, process-wide: a second concurrent call is refused with
  a reason (`server_busy`), not queued.
- Each answer carries its coverage and caveats, and a measurement with nothing
  behind it returns a withheld reason, not a zero.
- Each tool has a response size ceiling (`backend/mcp_server/envelope.py`):
  8,192 bytes for catalogue, get and summary, 2,048 for resolve, 32,768 for
  list, 16,384 for series.
- Third-party data the site shows (Zerion, and in future LI.FI) never goes
  through MCP.
- The site already has a `/how-it-works` route (`frontend/src/routePaths.js`),
  which the npm package's README links to.

---

## 11. MCP on our own chain reads instead of Zerion and LI.FI

**What it is.** Our own site may use Zerion and LI.FI, each labelled, but none
of their data goes onward through MCP or a public API. A later phase gives MCP
its own figures from chain reads: balances from RPC and token contracts, and
execution cost simulated on pools, through Quoter contracts on EVM chains and,
on Solana, against the pools themselves (Raydium CLMM and CPMM, and the other
major Solana AMMs holding the pairs we need), read through `SOLANA_RPC_URL`.
The site's Solana execution cost in phase 5 (entry 7) uses the same method.
Jupiter is not used anywhere (entry 12).

**Status.** Deferred as a later phase, by the owner's rule of 2026-09-25.

**What blocks it.** Not yet planned or built.

**What unblocks it.** A plan approved by the owner, after the web version.

**Research done.** The owner's Zerion decision (display on our site, no stored
history, nothing through MCP unless Zerion agrees in writing) is reflected in
[Data Handling](data-handling.md). No Quoter or Raydium work has been done
yet.

---

## 12. Jupiter: not used

**What it is.** Jupiter's Swap API and SDK, once considered as the source of
Solana execution cost in phase 5.

**Status.** Dropped by the owner on 2026-09-25, not deferred. No worker,
script or test calls any Jupiter endpoint.

**Why.** The owner's decision, in the owner's words: "drop Jupiter entirely. I
read the licence myself: §5.1 allows access only with issued keys, §3.2(g)
forbids combining its content with other content, and §3.2(f) forbids
competitive analysis. Comparing execution cost across venues is exactly what we
do, so Jupiter cannot be part of it. No further calls to any Jupiter endpoint,
from any worker, script or test."

Solana execution cost comes instead from our own simulation against the pools
(entries 7 and 11).

**The licence.** Jupiter API & SDK License Agreement,
https://developers.jup.ag/docs/legal/sdk-api-license-agreement, page modified
2026-04-16, read 2026-09-25. The clauses, quoted whole:

> 5.1 Subject to payment of fees as described herein, Jupiter would issue to
> the Licensee certain unique API keys, tokens, passwords and/or other
> credentials (collectively, "Keys"), for accessing the API and/or SDK and
> managing the Licensee's access to the API. The Licensee may only access the
> API with the Keys issued to the Licensee by Jupiter. The Licensee
> acknowledges that access to the API may not always be available. The
> Licensee may not sell, transfer, sublicense or otherwise disclose its Keys
> to any other party or use them for any other purpose other than that
> expressly permitted by Jupiter. The Licensee is responsible for maintaining
> the secrecy and security of the Keys. The Licensee is fully responsible for
> all activities that occur using the Keys, regardless of whether such
> activities are undertaken by the Licensee or a third party. The Licensee is
> responsible for maintaining up-to-date and accurate information (including a
> current email address and other required contact information) for the
> Licensee's access to the API and SDK. Jupiter may discontinue the Licensee's
> access to the API and SDK if such contact information is not up-to-date
> and/or the Licensee does not respond to communications directed to such
> coordinates.

> 3.2 Except as expressly authorised under this Agreement or by Jupiter in
> writing, the Licensee agrees it shall not (and shall not permit or authorise
> any other person to):
>
> d. sell, lease, share, transfer or sublicense the API, SDK or any content
> obtained through the API, directly or indirectly, to any third party;
>
> f. access the API or SDK for competitive analysis or disseminate performance
> information (including uptime, response time and/or benchmarks) relating to
> the API;
>
> g. use the API in conjunction with, or combine content from the API with,
> content obtained through scraping or any other means outside the API;

The licence states that it is effective from first access: "This Agreement is
effective as of the date you first access, download, copy or otherwise use the
API or SDK ("Effective Date")", and §13.1: "The effective date of this
Agreement is the start of use of the API or SDK by the Licensee."

**The calls made, all on 2026-09-25 and all before this decision reached the
work that made them.**

- One keyless request to the Swap V2 order endpoint
  (`GET https://api.jup.ag/swap/v2/order`, a SOL to USDC quote with no key),
  at 10:39 UTC, during phase 5 research.
- At least six keyless requests to Jupiter's lite-api token search, between
  14:11 and 14:15 UTC, during vault research for phase 7, used to look up
  token symbols. The exact URLs and request count were not recorded; the
  count is taken from the six saved responses. Nothing derived from them is
  used: the tokens they concerned were re-read on chain instead.

No call has been made since, and none will be.

**What would reopen it.** Only a written licence from Jupiter permitting
cross-venue comparison; not planned.

---

## 13. Other deferred items already recorded elsewhere in these docs

Each is described in full on its own page; they are listed here so this page
is complete.

| Item | Blocked by | Unblocked by | Where |
|---|---|---|---|
| Re-ingesting about 9,100 working BSC agents 8004scan never indexed | A large write during hackathon judging | Judging closing | [Known Limitations](limitations.md) |
| Trust8004 as a third registry source | Deferred until judging closes | Judging closing | [Known Limitations](limitations.md) |
| More memory for the backend instance | Standing rule against paid infrastructure changes without an explicit decision | Funding, or the failure mode worsening | [The 512Mi Memory Ceiling](memory-ceiling.md) |
| Remaining contract test coverage | Deferred until after the deadline (2026-09-07) | Time after the deadline | [Contract Coverage Gaps](contract-coverage-gaps.md) |
| Tnega PayBox | No settlement rail: MoonPay declined (entry 4) | A rail decision | [Future: Tnega PayBox](future-tnega-paybox.md) |
| Perpetuals agent (Avantis on Base) | Calldata comes from Avantis's live transaction builder, and orders fill asynchronously or expire in about 15 to 30 seconds | An integration built for that shape, or a read-only positions view if wanted | [Native Agents](native-agents.md#investigated-and-not-built) |
| Tokenized assets agent | The RWA data researched on 2026-09-02 was CoinGecko's, whose free tier's terms, on the owner's reading, do not cover this site | A data source whose terms do, or our own chain reads | [Native Agents](native-agents.md#investigated-and-not-built) |
| Lending and borrowing agent | Needs a collateral-enablement step and a live health-factor and liquidation-risk display | Building those as one complete piece | [Native Agents](native-agents.md#investigated-and-not-built) |
| Token Radar (trending pools), removed 2026-09-25 | GeckoTerminal's terms do not clearly allow commercial use | Our own chain reads: rank BSC pools by recent PancakeSwap v3 Swap events, read with getLogs in 5,000-block chunks by our server, which reads the BNB price on chain the same way. Built only if the owner wants the skill kept, since the Skills page leaves the navigation | [CoinGecko Removed](coingecko-removal-2026-09-25.md#geckoterminal-removed-the-same-day) |

---

## 14. Budget index: a free BSC fallback after the QuickNode trial

**What it is.** A free public BSC endpoint for the budget index
(`backend/core/budget_index.py`) to fall back on once the QuickNode trial ends
(30 days). The index reads AgentBudgetEscrow logs with `eth_getLogs`, back to
budget #1's block, 120,311,961, in 4,901-block pages.

**Status.** Deferred since 2026-09-26. The mechanism is built:
`BSC_FALLBACK_RPC_URLS` (comma-separated) is tried after bloXroute and
QuickNode, QuickNode is switched off for the process on its first 401 or 403,
and public calls are counted in `rpc_credits` at 0 credits under
`public:<host>`. What is deferred is the default list, which is empty.

**What blocks it.** No free endpoint tested passes both required checks: the
known-log control (an unfiltered `eth_getLogs` at block 120,311,961 must
return at least one log) and one 4,901-block Drawn-topic page from that
block. Measured from a local machine on 2026-09-26, one or two requests each:

| Endpoint | Control at 120,311,961 | 4,901-block page | Range cap seen | Terms |
|---|---|---|---|---|
| bsc-rpc.publicnode.com | HTTP 403, -32602 "Archive requests require a personal token" | same | none seen at the head: a 4,901-block page at the head answered `[]` | Unclear. The PublicNode terms (publicnode.com/terms, read 2026-09-26) ban "commercial solicitation", not commercial use of the RPC |
| bsc.drpc.org | HTTP 429, code 15 "Public endpoint rate limit" | HTTP 400, code 35 "ranges over 10000 blocks are not supported on free plan", also for 1,000 recent blocks | a 100-block unfiltered page near the head hit "max results 20000" | Unclear: the terms page is script-rendered and could not be read without a browser |
| bsc-dataseed.bnbchain.org | -32005 "limit exceeded" | same | getLogs disabled | Excluded on function. BNB Chain's JSON-RPC docs (docs.bnbchain.org, read 2026-09-26) say "eth_getLogs is disabled on below Mainnet endpoints". The defibit and ninicoin dataseeds answer the same |
| 1rpc.io/bnb | -32000 "header not found" | -32602 "eth_getLogs is limited to 0 - 50 blocks range" | 50 blocks | Unclear: the terms page is script-rendered |
| bsc-mainnet.public.blastapi.io | HTTP 429, rate-limited | same | not measurable | not read |
| bsc.meowrpc.com | "The method eth_getLogs is not supported" | HTTP 429 | not supported | not read |
| rpc.ankr.com/bsc | "Unauthorized: You must authenticate your request with an API key" | same | needs a key | not read |
| bsc.blockpi.network/v1/rpc/public | HTTP 521 | same | down | not read |
| binance.llamarpc.com | connection refused | same | down | not read |

**The load-balancer caveat, for any fallback added later.** A public
endpoint is a pool of backend nodes behind one URL, and consecutive
requests can land on different nodes. The control can reach an archive node
while the next page reaches a pruned one, which may answer `[]` with HTTP
200 for a range it does not hold. A control passed once per pass therefore
proves less on a public endpoint than on a single provider. Any public
fallback must be checked per page, not once per pass. Since 2026-09-26 the
code does this for every URL in `BSC_FALLBACK_RPC_URLS`: its control is
asked again on each empty page it returns, never read from the pass cache.
That narrows the gap but does not close it, because the control and the page
can still reach different nodes within the same second; a depth-aware probe
as in option 2 would be closer still.

**What unblocks it.** Any one of:

1. A free endpoint that serves archive `eth_getLogs` at 4,901 blocks.
   Add it to `DEFAULT_BSC_PUBLIC_FALLBACKS` after the two checks, or set it in
   `BSC_FALLBACK_RPC_URLS` on Render.
2. A depth-aware control. publicnode serves recent ranges, and once the
   backlog is cleared during the trial, only recent ranges are needed. The
   control could prove a provider at the depth of each page, not at budget
   #1: an unfiltered `eth_getLogs` over a few blocks at the page's start
   should return logs. One block near the head returned 208 logs on
   2026-09-26; that nearly every BSC block carries some logs is expected
   from its traffic but was not checked block by block, so the probe should
   span a few blocks rather than rely on one. This changes the empty-page
   safety rule, so it needs the owner's go-ahead. On publicnode's terms, the
   facts are: they are unclear for this use (see the table), and the
   owner's rule for unclear terms is to use the source, labelled, with the
   source recorded here. That is not a finding that the terms allow it.
3. A paid plan: QuickNode after the trial, or a keyed free tier (Ankr,
   NodeReal, Alchemy) under a key held as a server secret.

