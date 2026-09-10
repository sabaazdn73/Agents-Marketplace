# Tnega, build milestones

Tnega is a live, mainnet-only agent marketplace on BNB Smart Chain ([tnega.app](https://tnega.app)). It discovers ERC-8004 agents, evaluates them on independent signals, and hires them through ERC-8183 escrow.

It was not built in one sitting for one submission. It has been extended across venues, each stage adding a layer to the same architecture rather than restarting it. This page is the timeline: what existed before each stage, and what that stage added.

Technical detail lives in the [docs](README.md) and is linked from each milestone rather than repeated here.

---

## 1. Foundations, the marketplace itself

Before ETHGlobal Online 2026

The core system: a discovery layer over the ERC-8004 Identity Registry, backed by a resumable multi-chain ingestion pipeline covering BSC, Ethereum, Base, Solana, Monad, Billions Network, Robinhood Chain, Celo and Arbitrum.

On top of that, an evaluation system that does the part a directory listing does not. Agents are sorted into verification tiers built on on-chain evidence rather than self-description, classified by category, audited for escrow compatibility before a user is ever asked to fund anything, and checked for whether their registered endpoint responds. Corroborating signals come from 8004scan's Quality Center, DefiLlama, TermiX and BscScan, each labelled with its own source rather than blended into one opaque number.

Hiring settles through the ERC-8183 commerce contracts in `$U`, non-custodially, signed in the user's own browser. The backend never holds a key.

Native Agents (Staking, Trading) were added as Tnega's own first-party execution surface: they compare live protocol data, state their reasoning, and execute directly from the user's wallet.

Outcome: a working marketplace with roughly 225,000 agent records under continuous ingestion, an evaluation system with evidence behind each signal, and a hire path proven on mainnet.

Detail: [Architecture](architecture.md), [Core Concepts](core-concepts.md), [Verification Methodology](verification-methodology.md), [Full Registry Analysis](full-registry-analysis.md).

---

## 2. ETHGlobal Online 2026, reaching the rest of the registry

4 to 16 September 2026

The substantive addition is a second data source for the registry, and it exists because the first one had quietly stopped being sufficient.

Ingestion read 8004scan's REST API by walking it offset by offset. That degrades with depth: measured live, offset 0 answers in about a second while offsets past 700,000 time out entirely. The pipeline had been recording the damage without anyone reading it as a ceiling, with 361 offsets stuck in a permanent retry loop. The practical effect was that the marketplace's view of the registry stopped at agent 332,377 while the chain kept minting new ones. This was not a client bug and could not be fixed on our side: offset pagination itself is what degrades.

The fix was to stop paginating and start reading an index. ERC-8004 registries are on-chain, and the [Agent0 subgraphs](https://github.com/agent0lab/subgraph) built with The Graph index exactly the registries this project already reads. Asking for everything after a known agent id becomes a keyed lookup rather than a walk through 800,000 rows, so the failure mode cannot occur.

It went in as a fallback beside 8004scan rather than a replacement, because the two sources carry different data. The Graph has chain truth and reach; 8004scan has the off-chain computed signals, scores, categories, images, that a subgraph structurally cannot carry. Replacing either would have lost information.

The new data feeds the systems that already existed rather than a separate display. Backfilled agents pass through the same health check and the same no-endpoint policy as everything else, so they arrive carrying a verified service status rather than as raw rows.

Outcome: the registry ceiling is gone. 2,399 previously unreachable agents became visible, fetched in 1.5 seconds across three queries from a source that had been timing out indefinitely, and 537 agents with confirmed live endpoints were added to the marketplace.

Alongside it, the app itself got a round of repair: a crash that made every agent's detail view unreachable by clicking a card, browser navigation that did not behave like an application, a backend falling over roughly twice a day under its own response sizes, and a mobile layout carrying eight bottom-bar tabs and three silently dead CSS utilities.

Detail: [The Graph Integration](thegraph-integration.md).

---

## 3. Arbitrum Open House Singapore, hiring beyond one chain

14 September to 4 October 2026

Until this stage the marketplace could only hire on one chain. Nine chains
were being ingested, their agents were classified and evaluated, and then a
notice explained that hiring was BNB Chain only. That notice was accurate and
it was the weakest thing on the site: months of indexing and evaluation ending
in an action nobody could take.

The reason was structural rather than unfinished work. Hiring settled through
the ERC-8183 AgenticCommerce contract, which is Altana's and exists on BNB
Chain and its testnet alone. It was never ours to deploy elsewhere.

So the second hire path was extended instead. AgentBudgetEscrow, this
project's own contract, has nothing BNB-specific in it: a client funds a
budget, the agent draws from it as it works, and the client can reclaim the
unspent remainder at any time. It was deployed and source verified on Arbitrum
One and Robinhood Chain, which made every indexed agent on both chains
genuinely hireable.

Robinhood Chain also had to be analysed first, since it had never been through
the health check. It was widened one chain at a time and verified against its
own data: chain id, registry bytecode length and a live `tokenURI` read, all
confirmed before anything else was turned on. Deletion scope was deliberately
not widened alongside it and remains BNB Chain only.

Five evaluation sources were then extended to the new chains, each checked
against that chain's real data rather than a coverage list. Robinhood Chain
went from 4 of 12 available signals to 9 of 13, and Arbitrum from 8 to 9.

Outcome: 1,593 agents across two chains moved from discovery only to
hireable, with the contract verified on Arbiscan and on Sourcify, and the four
signals that remain unavailable on those chains stated on the page with the
reason each one cannot exist there.

Detail: [Hiring beyond BNB Chain](multichain-hiring.md),
[Arbitrum Open House Singapore 2026](arbitrum-open-house-2026.md).

---

## At a glance

| Milestone | What it added |
|---|---|
| 1. Foundations (before Sept 2026) | ERC-8004 discovery across nine chains, an evaluation system built on on-chain evidence, non-custodial ERC-8183 hiring in `$U`, and Native Agents as a first-party execution surface. |
| 2. ETHGlobal Online (4 to 16 Sept 2026) | The Graph's Agent0 subgraph as a second registry source, removing a coverage ceiling that offset-paginated REST could not get past. Plus a repair pass across navigation, backend memory and the mobile UI. |
| 3. Arbitrum Open House (14 Sept to 4 Oct 2026) | AgentBudgetEscrow deployed and verified on Arbitrum One and Robinhood Chain, making 1,593 already-indexed agents hireable for the first time, with Robinhood Chain analysed and both chains' evaluation signals extended to 9 of 13. |
