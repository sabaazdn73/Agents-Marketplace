# Regulatory landscape

Where this project sits against the rules that apply to crypto services and
to AI systems, as they stand in September 2026. This is a technical
description of the applicable framework and where the project falls within
it. It is not legal advice, and no lawyer has reviewed it. Anyone deploying
something like this commercially should take advice on their own facts.

What this project does elsewhere in the docs is state gaps plainly rather
than hide them, and that applies here too. The largest gap on this page is
at the end: nobody has obtained a formal legal opinion on any of it.

## Why regulation touches this project at all

Three of its properties are the ones regulators care about. It moves value
on a public chain. It handles stablecoins, which are the most heavily
legislated crypto-asset category in both the EU and the US. And it runs
AI systems that interact with people.

One property matters in the other direction, and it is the reason most of
the heavy obligations below probably do not attach: the backend holds no
private key and never takes custody of anyone's funds. Every transaction is
signed in the user's own browser by the user's own wallet. See
[Data Handling](data-handling.md#private-keys).

## European Union: MiCA

Regulation (EU) 2023/1114, Markets in Crypto-Assets, is the EU's single
framework for crypto-asset issuers and service providers. It has applied to
crypto-asset service providers since 30 December 2024.

### The service list, and whether this project provides any of them

Article 3(1)(16) defines a crypto-asset service as any of nine activities.
Set against what this project does:

| MiCA crypto-asset service | Does Tnega provide it |
|---|---|
| Operating a trading platform | No. It lists agents, not crypto-assets, and matches nobody's orders |
| Exchanging crypto-assets for funds or other crypto-assets | No. The Trading agent builds a transaction the user signs against a public DEX; no exchange is operated |
| Custody and administration on behalf of clients | No. No key is ever held |
| Transfer services on behalf of clients | No. The user's own wallet transfers |
| Placing crypto-assets | No |
| Reception or transmission of orders on behalf of clients | Not on the ordinary reading. Nothing is received or transmitted to a third party for execution |
| Execution of orders on behalf of clients | No. The project cannot execute anything, because it cannot sign |
| Advice on crypto-assets | The closest one. See below |
| Portfolio management | No. The Rebalancing agent computes a plan and does not execute it, and signing is not wired |

The one worth care is advice. The Staking agent returns a recommendation
between named protocols, and the Rebalancing agent proposes a set of swaps.
MiCA's definition of advice concerns crypto-assets and crypto-asset
services, and a recommendation about which liquid-staking protocol to
deposit into is closer to that than a neutral data feed is. This is
described here as an open question rather than resolved, because it is one.

### The decentralisation carve-out

Recital 22 of MiCA states that where crypto-asset services are provided in a
fully decentralised manner without any intermediary, they should not fall
within the scope of the Regulation.

That recital is frequently over-read. It is a recital, not an operative
article, so it guides interpretation rather than granting an exemption. And
"fully decentralised, without any intermediary" is a high bar. This project
runs a hosted frontend, a hosted backend and a curated listing, all under
one operator's control, and it charges a fee through contracts that same
operator owns and can re-parameterise. A supervisor could reasonably view
the interface as an intermediary even though the settlement is
non-custodial.

Stated plainly: non-custody is the strongest fact here, the
decentralisation recital is a weaker one than it first appears, and neither
has been tested against these facts by anyone qualified.

### The transitional deadline that has now passed

Article 143(3) let member states allow providers operating lawfully before
30 December 2024 to continue until 1 July 2026, or until authorisation was
granted or refused, whichever came sooner. Member states could shorten that
period or decline to offer it, and they chose different lengths, which ESMA
published. That window has closed. There is no longer a grandfathering route
for an unauthorised CASP serving EU clients.

The practical consequence for this project: if any of its activities were
ever held to be a crypto-asset service provided to EU clients, there is no
transitional cover available. Authorisation would be required from the
outset.

### What authorisation would involve

Not undertaken and not planned, recorded here so the scale is visible.
Authorisation is granted by the national competent authority of a chosen
home member state and passports across all 27. It requires a business plan,
a governance structure, an ICT and cybersecurity policy, fit-and-proper
assessment of management, and minimum own funds set by service type.

An authorised CASP is also an obliged entity under EU anti-money laundering
rules, subject to the crypto Travel Rule, and a financial entity under DORA
with its ICT risk management, incident reporting and third-party risk
obligations. The compliance surface is considerably larger than the licence
itself.

## European Union: the AI Act

Regulation (EU) 2024/1689. The parts that bear on this project are the
transparency rules rather than the high-risk regime.

The obligations for providers of general-purpose AI models entered
application on 2 August 2025. The Commission's enforcement powers over
providers of the most advanced models entered application on
2 August 2026. From that same date, Article 50 transparency rules apply
where an AI system is intended to interact directly with natural persons or
to generate content.

This project is a deployer of a general-purpose model, not a provider of
one. It calls Google's Gemini through an API and trains nothing. The
provider obligations, model documentation, copyright policy, training-data
summaries, sit with Google rather than here.

Article 50 is the part that lands on a deployer. The studio's agents
interact with a person and generate content, so the requirement that people
be informed they are interacting with an AI system is the relevant one. The
studio does satisfy that in substance: the surface is called MultiAgents,
every agent is drawn and named on screen, and each stage's output is
attributed to the agent that produced it. Whether that presentation meets
the Article's formal requirement has not been assessed against the
Commission's guidance.

One design decision here happens to align with the transparency principle
without having been made for that reason. The model layer never fabricates
in degraded mode. With no API key it returns what it would have asked the
model rather than a plausible answer. See
[The Agent Studio](agent-studio.md#the-model-layer).

Nothing in this project falls in an Annex III high-risk category. It does
not do biometrics, employment decisions, credit scoring, education access or
essential services. Financial recommendation is not itself listed as
high-risk; creditworthiness assessment of natural persons is, and this
project does none.

## United States

Two threads matter, and they are at different stages.

Stablecoins are settled law. The GENIUS Act was signed on 18 July 2025 as
Public Law 119-27. It bars issuing a payment stablecoin in the United States
without a federal or state licence, with an expected effective date of
18 January 2027. Treasury has been issuing implementing rules, including a
FinCEN and OFAC joint proposed rule on anti-money laundering and sanctions
compliance, and proposed rulemaking on state-level regimes.

That regime targets issuers. This project issues nothing. It settles in
tokens other parties issue: `$U`, USDT, USD1 and USDC, per
[Payment Rails](payment-rails.md#what-the-facilitator-supports). The
relevance is indirect but not zero, since an issuer that fails to obtain a
licence affects every venue that settles in its token.

Market structure is not settled law. The CLARITY Act, H.R. 3633, passed the
House in July 2025 and was advanced out of the Senate Banking Committee on
14 May 2026. It would split jurisdiction, giving the CFTC authority over
digital commodities and the SEC authority over digital securities. As of
this writing it has not been enacted, and there is no certainty about
whether or in what form it will be. Anything written here about how this
project would be classified under it would be speculation, so nothing is.

## The standard itself is a draft

Worth stating on a page about regulatory risk, because it is the same kind
of risk from a different direction. ERC-8004, which this project's entire
identity layer depends on, is a Draft EIP created on 13 August 2025. It
defines three registries: Identity, built on ERC-721 with URIStorage;
Reputation; and Validation.

Draft means the specification can still change. A change to the Identity
Registry interface would be a breaking change for the ingestion pipeline and
for `AgentAccessMarket`, whose `list()` is gated by an `ownerOf` check
against that registry.

The related observation, already documented in
[The Graph Integration](thegraph-integration.md), is that the Validation
Registry is deployed and queryable on BSC but has never been used there.
Both `validations` and `validationPoints` return empty across the whole
chain. A draft standard's less-used parts are the ones most likely to move.

## What is not covered here, and why

Consumer protection law, distance selling rules, tax treatment of on-chain
settlement, and the sanctions screening obligations that would attach to a
regulated entity are all out of scope for this page. Each is
jurisdiction-specific and none has been analysed for this project.

No formal legal opinion has been obtained on anything above. The analysis
here is a developer reading primary sources, which is a different thing from
advice and should not be relied on as advice. Where this page says an
activity probably falls outside a definition, read that as an argument that
has not been tested, not as a conclusion.

## Sources

All primary except where noted.

- [Regulation (EU) 2023/1114 (MiCA), consolidated text on EUR-Lex](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1114). Recital 22, Article 3(1)(16), Article 143.
- [ESMA, Article 143 Transitional measures, Interactive Single Rulebook](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-143-transitional-measures)
- [ESMA, List of MiCA grandfathering periods under Article 143(3)](https://www.esma.europa.eu/sites/default/files/2024-12/List_of_MiCA_grandfathering_periods_art._143_3.pdf)
- [ESMA, Statement on the end of transitional periods under MiCA](https://www.esma.europa.eu/sites/default/files/2026-04/ESMA75-113276571-1679_Statement_on_the_end_of_transitional_periods_under_MiCA.pdf)
- [European Commission, Timeline for the implementation of the EU AI Act](https://ai-act-service-desk.ec.europa.eu/en/ai-act/timeline/timeline-implementation-eu-ai-act)
- [European Commission, General-purpose AI obligations under the AI Act](https://digital-strategy.ec.europa.eu/en/factpages/general-purpose-ai-obligations-under-ai-act)
- [GENIUS Act, Public Law 119-27, full text](https://www.congress.gov/119/plaws/publ27/PLAW-119publ27.pdf)
- [Congressional Research Service, Stablecoin Legislation: An Overview of the GENIUS Act of 2025](https://www.congress.gov/crs-product/IN12553)
- [US Treasury, proposed rule implementing the GENIUS Act's illicit finance requirements](https://home.treasury.gov/news/press-releases/sb0435)
- [Congressional Research Service, CLARITY Act's potential effects on SEC jurisdiction](https://www.congress.gov/crs-product/IN12584)
- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
