# Hiring beyond BNB Chain: Arbitrum and Robinhood Chain

Until 2026-09-10 this marketplace could only hire on one chain. Agents on
every other chain were indexed, evaluated and displayed, and then a notice
told you that you could not do anything with them. This page is what changed,
why, and how to verify all of it independently.

## What the situation was

Nine chains were being ingested. Their agents were stored, classified and
listed under their own tabs. Two of those tabs, Arbitrum and Robinhood Chain,
had been promoted out of a shared Multi-Chain view because they had enough
data to stand alone.

The views said this, in these words: "These agents can be browsed but not
hired here. Tnega's escrow runs on BNB Smart Chain, so hiring is only
available for BNB Chain agents."

That was true, and it was the whole problem. Hiring settled through the
ERC-8183 AgenticCommerce contract, which is Altana's and is deployed on BNB
Chain and BNB testnet only. Nothing this project could do would put it on
another chain, so every non-BNB agent was permanently discovery only.

Robinhood Chain was worse off still. It had never been analysed, so its
agents carried no health status at all, and only 4 of the 12 evaluation
signals could say anything about them.

## What was added

### Analysis for Robinhood Chain

Chain 4663 was brought into the analysis pass one chain at a time, verified
against its own data rather than assumed from the pattern of other EVM
chains. Three checks before widening anything:

- `eth_chainId` returned 4663
- The ERC-8004 registry at `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` holds 130 bytes of code, the same length it has on every other chain carrying it
- `tokenURI` resolved for 10 of 10 randomly taken stored agents

Then the real pass ran over all 190 stored agents: 190 checked, 31 responding
(16.3%), 159 with no registered endpoint, zero resolution failures, zero
deleted.

Deletion scope was deliberately not widened alongside analysis. It remains
BNB Chain only. Those are separate lists in `core/full_registry_analysis.py`
precisely so that adding a chain to one cannot delete anything on the other.

### AgentBudgetEscrow on both chains

ERC-8183 could not be extended, so the second hire path was. AgentBudgetEscrow
is this project's own contract: a client funds a budget, the agent draws
against it as it works, and the client can take back the unspent remainder at
any time. Nothing about it is BNB-specific, so it was deployed to both chains.

That gives two hire paths with different footprints, which the UI now states
per chain instead of collapsing into one sentence.

### Evaluation signals extended

Each of these was verified against that chain's real data before being turned
on, not read off a coverage list:

| Signal | What was confirmed |
|---|---|
| Zerion | Indexes Robinhood Chain as `robinhood`, external id `0x1237`. Three real stored owner addresses returned live positions, not empty responses |
| DefiLlama | Carries it as `Robinhood Chain`, not `Robinhood`. The short form matches nothing. 158 protocols list it |
| 8004scan quality | Scores agents on 4663. Checked against that API's habit of ignoring filters: every response returned the chain id and token id asked for |
| Binance token risk | USDG on 4663 returned 12 populated fields, matching BNB Chain's own 12 for USDT and ahead of Arbitrum's 6 |
| Contract verification | Runs through Sourcify plus our own RPC on 4663, because the Blockscout API is behind a Cloudflare interstitial and returns 403 to a client |

Robinhood Chain went from 4 available signals to 9. Arbitrum went from 8 to 9.
BNB Chain has 13.

## Where things stand now

| | BNB Chain | Arbitrum | Robinhood Chain |
|---|---|---|---|
| Chain id | 56 | 42161 | 4663 |
| Agents stored | 154,695 | 1,403 | 190 |
| Responding | 105,771 | 580 | 31 |
| Evaluation signals | 13 of 13 | 9 of 13 | 9 of 13 |
| Escrow hiring | Yes | No | No |
| Budget hiring | Yes | Yes | Yes |

## Everything needed to verify it

### Contracts

| Contract | Chain | Address | Verified at |
|---|---|---|---|
| AgentBudgetEscrow | 56 | `0x4728f03693DDABbe50E79c7BfFCb930e522D585B` | BscScan |
| AgentBudgetEscrow | 42161 | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | Arbiscan |
| AgentBudgetEscrow | 4663 | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | Sourcify, `exact_match` |
| AgentBudgetEscrow | 1 | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | Etherscan |
| AgentAccessMarket | 56 | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | BscScan |
| ERC-8004 Identity Registry | all of them | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | standard, not ours |

Ethereum is in that table but not in this document's subject. This page records
the Arbitrum and Robinhood Chain work; Ethereum got the same contract on
2026-09-11, after it, and the canonical list is
[Deployed Contracts](deployments.md).

All four escrow deployments share one owner,
`0x48cE74cdC366E8347f17F7187FBf2Ab9240692E9`, and `feeBps` returns 250 on each
with `MAX_FEE_BPS` fixed at 1000. Compiled with solc `0.8.24+commit.e11b9ed9`,
optimizer on at 200 runs, creation bytecode 8,380 bytes and runtime 7,396,
identical across all four.

Robinhood Chain uses Sourcify rather than an explorer API because its
Blockscout instance answers a browser normally but returns HTTP 403 with a
Cloudflare interstitial to an API client. Getting around bot protection was
not automated. Sourcify supports chain 4663, and Blockscout renders
Sourcify-verified sources natively, so a reader opening the explorer still
sees verified source.

### The address collision, which matters

`0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` is two different contracts:

- On BNB Chain it is AgentAccessMarket, the Sell Your Agent contract
- On Ethereum, Arbitrum and Robinhood Chain it is AgentBudgetEscrow

This is a coincidence of CREATE address derivation. The same deployer wallet
at the same nonce produces the same address on every EVM chain, and this
wallet's nonce-N deploy happened to be one contract on BNB Chain and a
different one on the two new chains. It is not a design and it guarantees
nothing.

It is dangerous rather than merely untidy because both contracts implement
`owner()`, `feeBps()` and `MAX_FEE_BPS()`. Checked on chain: all three answer
on all four chains, with the same owner and the same 250 and 1000. So a
defensive "is our contract here?" probe passes while pointing at the wrong
contract.

The concrete hazard was in the market client, which held one global
`MARKET_ADDRESS`. On Arbitrum its ERC-20 `approve(MARKET_ADDRESS, ...)` would
have granted the budget escrow a real allowance over a user's tokens. A
successful transaction, the wrong recipient, and nothing to notice at the
time. `list()` would merely have reverted; the approval would not have.

`frontend/src/chainContracts.js` is now the only place an address lives, keyed
by chain id, with the collision documented at the top of the file. No module
holds a bare address constant. AgentAccessMarket is pinned to chain 56 with an
assertion before every write. `frontend/scripts/chain_contracts_selfcheck.mjs`
enforces it, including a check that no source file outside `chainContracts.js`
hardcodes either address.

### Chains, RPCs and failovers

| Chain id | RPC | Failover |
|---|---|---|
| 56 | bloXroute gateway | Infura BSC |
| 42161 | `https://arb1.arbitrum.io/rpc` | Infura Arbitrum |
| 4663 | `https://rpc.mainnet.chain.robinhood.com` | `https://robinhood-rpc.publicnode.com` |

Robinhood Chain is an Arbitrum Orbit L2 with ETH as its gas token, which is
why it carries the same ERC-8004 registry address as every other EVM chain
here. Its failover was verified against the primary rather than taken from a
list: it returns chain id 4663, the registry with the same 130 bytes, and
resolves the same `tokenURI` at a block height within about 15 of the primary.

### Accepted tokens

Each address was read on its own chain, calling `symbol()` and `decimals()`
live, rather than copied from a token list.

| Chain | Token | Address | Decimals |
|---|---|---|---|
| 42161 | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 |
| 42161 | USD₮0 | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 |
| 4663 | USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | 6 |

Native ETH is accepted on both new chains through the `0xEeee…EEeE` sentinel,
added automatically by the deploy script rather than listed. WETH is
deliberately excluded: a budget denominated in the wrapped gas token gives a
client two ways to express the same thing and an agent two balances to reason
about, for no gain.

Full commands, measured gas and per-explorer verification flags are in
[Arbitrum and Robinhood Deployment](multichain-deploy.md).

## What is still not available, and why

Four signals are missing on both new chains. None of them is unfinished work.

Escrow compatibility, delivery record and canary results all read from the
ERC-8183 AgenticCommerce contract. That contract is Altana's and is deployed
on BNB Chain and its testnet only. Not ours to deploy, and not a gap that
effort closes.

Subgraph provenance comes from the Agent0 subgraph, which indexes BNB Smart
Chain only in practice. Its schema carries a chain field, which makes it look
multi-chain, but a 200-agent sample of the deployment was 100% chain 56 and
explicit queries for other chains returned zero rows.

Contract verification on Robinhood Chain runs through Sourcify rather than an
explorer API, for the Cloudflare reason above. That is a different route to
the same answer, not a missing signal.

Every one of these is stated on the chain's own view with its reason, so an
absence reads as an explanation rather than an empty space.

## Three bugs worth keeping

### A configuration error wearing the wallet's error code

A user with Arbitrum already in MetaMask was told their wallet did not know
about Arbitrum and should add it manually. The wallet was never asked.

wagmi's connector runs `config.chains.find(x => x.id === chainId)` before it
touches the wallet and throws if the chain is missing. The wagmi config listed
`chains: [bsc]`, so a switch to 42161 failed inside the app with no request
reaching MetaMask.

What made it read as a wallet problem is that viem gives its `SwitchChainError`
class a static `code = 4902`, the same code MetaMask returns for a chain it
does not have. An app-side configuration error arrived wearing the wallet's
error code and was reported to the user as their problem.

The lesson is that the two must be told apart by error name, not by code, and
that a chain has to be listed in the wagmi config before any part of the app
can switch to it. Adding a deployment to `chainContracts.js` is not enough on
its own.

### A token symbol with a default

The budget amount formatter took `symbol = 'BNB'` as a default parameter. On
BNB Chain that is invisible. On Robinhood Chain it labelled ETH as BNB.

The default is the bug. There is no sensible fallback token, because a budget
is denominated in the gas token of the chain it was opened on. The resolver
now throws when it has no chain id, because a quiet answer is exactly what let
three separate surfaces render the wrong unit, each found and fixed one at a
time over several rounds.

### Money in scientific notation

The same formatter switched to `toExponential(2)` below 0.0001, after passing
the value through `Number()`, which is what produced the exponent. A real
budget rendered as `7.00e-6 BNB`.

Seven millionths and seven million are one character apart on screen. The
shared formatter now keeps the exact decimal string and never floats it, shows
the full value on hover, and prints a bound rather than a row of zeros for
amounts too small to write out.

All three shared a shape: each passed a build and a page render before anyone
saw it. The checks that guard them now assert rendered output rather than code
structure, which is what caught the last of them.
