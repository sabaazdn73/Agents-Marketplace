# Tnega — build milestones

Tnega is a live, mainnet-only agent marketplace on BNB Smart Chain ([tnega.app](https://tnega.app)). It discovers ERC-8004 agents, evaluates them on independent signals, and hires them through ERC-8183 escrow.

It was not built in one sitting for one submission. It has been extended across venues, each stage adding a layer to the same architecture rather than restarting it. This page is the timeline: what existed before each stage, and what that stage actually added.

Technical detail lives in the [docs](README.md) and is linked from each milestone rather than repeated here.

---

## 1. Foundations — the marketplace itself

*Before ETHGlobal Online 2026*

The core system: a discovery layer over the ERC-8004 Identity Registry, backed by a resumable multi-chain ingestion pipeline covering BSC, Ethereum, Base, Solana, Monad, Billions Network, Robinhood Chain, Celo and Arbitrum.

On top of that, an evaluation system that does the part a directory listing does not. Agents are sorted into verification tiers built on on-chain evidence rather than self-description, classified by category, audited for escrow compatibility before a user is ever asked to fund anything, and checked for whether their registered endpoint actually responds. Corroborating signals come from 8004scan's Quality Center, DefiLlama, TermiX and BscScan, each labelled with its own source rather than blended into one opaque number.

Hiring settles through the real ERC-8183 commerce contracts in `$U`, non-custodially, signed in the user's own browser. The backend never holds a key.

Native Agents (Staking, Trading) were added as Tnega's own first-party execution surface: they compare live protocol data, state their reasoning, and execute directly from the user's wallet.

**Outcome:** a working marketplace with roughly 225,000 agent records under continuous ingestion, an evaluation system with real evidence behind each signal, and a hire path proven on mainnet.

*Detail: [Architecture](architecture.md), [Core Concepts](core-concepts.md), [Verification Methodology](verification-methodology.md), [Full Registry Analysis](full-registry-analysis.md).*

---

## 2. ETHGlobal Online 2026 — reaching the rest of the registry

*4–16 September 2026*

The substantive addition is a second data source for the registry, and it exists because the first one had quietly stopped being sufficient.

Ingestion read 8004scan's REST API by walking it offset by offset. That degrades with depth: measured live, offset 0 answers in about a second while offsets past 700,000 time out entirely. The pipeline had been recording the damage without anyone reading it as a ceiling, with 361 offsets stuck in a permanent retry loop. The practical effect was that the marketplace's view of the registry stopped at agent 332,377 while the chain kept minting new ones. This was not a client bug and could not be fixed on our side: offset pagination itself is what degrades.

The fix was to stop paginating and start reading an index. ERC-8004 registries are on-chain, and the [Agent0 subgraphs](https://github.com/agent0lab/subgraph) built with The Graph index exactly the registries this project already reads. Asking for everything after a known agent id becomes a keyed lookup rather than a walk through 800,000 rows, so the failure mode cannot occur.

It went in as a fallback beside 8004scan rather than a replacement, because the two sources carry genuinely different data. The Graph has chain truth and reach; 8004scan has the off-chain computed signals — scores, categories, images — that a subgraph structurally cannot carry. Replacing either would have lost information.

The new data feeds the systems that already existed rather than a separate display. Backfilled agents pass through the same health check and the same no-endpoint policy as everything else, so they arrive carrying a verified service status rather than as raw rows.

**Outcome:** the registry ceiling is gone. 2,399 previously unreachable agents became visible, fetched in 1.5 seconds across three queries from a source that had been timing out indefinitely, and 537 agents with confirmed live endpoints were added to the marketplace.

Alongside it, the app itself got a round of repair: a crash that made every agent's detail view unreachable by clicking a card, browser navigation that did not behave like an application, a backend falling over roughly twice a day under its own response sizes, and a mobile layout carrying eight bottom-bar tabs and three silently dead CSS utilities.

*Detail: [The Graph Integration](thegraph-integration.md).*

---

## At a glance

| Milestone | What it added |
|---|---|
| **1. Foundations** *(before Sept 2026)* | ERC-8004 discovery across nine chains, an evaluation system built on on-chain evidence, non-custodial ERC-8183 hiring in `$U`, and Native Agents as a first-party execution surface. |
| **2. ETHGlobal Online** *(4–16 Sept 2026)* | The Graph's Agent0 subgraph as a second registry source, removing a coverage ceiling that offset-paginated REST could not get past. Plus a repair pass across navigation, backend memory and the mobile UI. |
