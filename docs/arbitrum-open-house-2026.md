# Arbitrum Open House Singapore, 2026

The buildathon Arbitrum and Robinhood Chain support was built for.

## What it is

Three weeks of intensive building. Deploy on Arbitrum One or launch a custom
Arbitrum chain. Bring an existing project or start from scratch. Build with
Stylus in familiar languages, or use Solidity. The tracks are open: DeFi,
gaming, social, DePIN, or something else.

The top three teams get a place at the in-person Founder House in Singapore,
three days with Arbitrum's technical team, mentors and ecosystem founders.

| | |
|---|---|
| Format | Online, three weeks |
| Registration | 29 July to 2 October 2026 |
| Submission | 13 September to 4 October 2026 |
| Rewards | 12 October 2026 |
| Listing | [arbitrum-singapore.hackquest.io](https://arbitrum-singapore.hackquest.io) |
| Our submission | [Tnega on HackQuest](https://arbitrum-singapore.hackquest.io/projects/Tnega) |

Prizes are 15,000 USDC across three places, plus up to 30,000 USDC in
discretionary milestone grants. At least one of the three prizes is reserved
for a project on Arbitrum, and at least one for Robinhood Chain.

Eligibility is stated as: "Your project must be deployed on an Arbitrum chain
to qualify. For example: Arbitrum Sepolia, Arbitrum One, Robinhood Chain, or
others."

The judging criteria are:

1. Smart Contract Quality, "code following best practices, structured logically and efficiently, with minimal security vulnerabilities"
2. Product-Market Fit, "projects with clear potential to attract and retain users"
3. Innovation and Creativity, "original approaches that push boundaries"
4. Real Problem Solving, "applications that address genuine market needs"

## Being accurate about the relationship

Arbitrum and Robinhood Chain support was added for this buildathon. It was not
a pre-existing plan that happened to line up, and saying otherwise would be
untrue.

It also closed a gap that was real independently of any deadline. The
marketplace had spent months indexing, classifying and evaluating agents on
chains it could not hire on, and the notice explaining that was one of the
weakest things on the site. Both things are true at once. The deadline is why
it happened now.

## What was built

Five pieces of work, each checkable.

### 1. AgentBudgetEscrow deployed to both chains

| | Arbitrum One | Robinhood Chain |
|---|---|---|
| Chain id | 42161 | 4663 |
| Address | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` |
| Verified | [Arbiscan](https://arbiscan.io/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) | Sourcify, `exact_match` |
| Explorer | [Arbiscan](https://arbiscan.io) | [Blockscout](https://robinhoodchain.blockscout.com/address/0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333) |

One address, two chains, because the same deployer wallet at the same nonce
produces the same address on every EVM chain. That is a coincidence rather
than a guarantee, and the same address is a different contract on BNB Chain.
See [Smart Contracts](smart-contracts.md) for why that is dangerous rather
than merely untidy.

Robinhood Chain publishes a Blockscout instance rather than an Etherscan-family
explorer, and its API sits behind a bot check, which is why verification there
went through Sourcify.

### 2. Robinhood Chain brought into the analysis scope

It was previously indexed but unanalysed, which meant its agents carried no
live status at all. Three things had to hold before it could be added, and
each was checked on chain rather than assumed:

| Check | Result |
|---|---|
| ERC-8004 registry present at the shared address | 130 bytes, identical to every other chain carrying it |
| RPC reachable, with a failover | `rpc.mainnet.chain.robinhood.com` primary, `robinhood-rpc.publicnode.com` failover, both answering chain id 4663 |
| `tokenURI` resolving against real stored agents | resolved against stored agents and returned real metadata hosts |

### 3. Evaluation signals extended

Of the 13 signals the marketplace can show, Robinhood Chain went from 4 to 9
and Arbitrum from 8 to 9.

The nine now available on both:

| Signal | What it covers |
|---|---|
| `category` | What the agent claims to do, classified |
| `live_health` | Whether its endpoint answers right now |
| `contract_verification` | Whether its contract source is published |
| `independent_corroboration` | Whether a second source agrees it exists |
| `financial_record` | On-chain value movement |
| `quality_score` | The composite score shown on the card |
| `owner_balance` | Whether the owner wallet holds anything |
| `token_risk` | Token safety checks where a token is involved |
| `budget_delivery_record` | Draws actually made against a budget |

The four that cannot be ported, and why:

| Signal | Why not |
|---|---|
| `subgraph_provenance` | The Agent0 subgraph indexes BNB Smart Chain only |
| `escrow_compatibility` | ERC-8183 escrow exists on BNB Chain only |
| `delivery_record` | Derived from ERC-8183 jobs, same reason |
| `canary_results` | Canary tests settle through ERC-8183, same reason |

Three of those four are the same underlying fact: the ERC-8183 contract is
Altana's and is deployed on BNB Chain only, so it is not ours to extend.

### 4. Hiring made to work on both chains

Budget hiring only. A client funds a budget and the agent draws against it as
it works, bounded by a per-draw cap and a total.

ERC-8183 escrow hiring stays BNB Chain only for the reason above. The two
paths are reported separately in the API rather than collapsed into one
"hireable" flag, because a single boolean cannot say that one path works and
the other does not.

### 5. Both chains given their own tabs

Same structure as BNB Chain: the full card with an action on it, category
chips with counts, and numbered pages rather than an open-ended load more.
A chain switches to that layout when its agents become hireable, and would
switch back if that stopped being true.

## Against the judging criteria

Stated as evidence rather than as a claim to meet them. A judge can check each
line.

### Smart contract quality

Everything below was produced by running the tools, not quoted from an earlier
run.

#### Tests

44 tests in `contracts/test/AgentBudgetEscrow.t.sol`, all passing.
The suite is adversarial first, which its own header states is deliberate:
this contract hands an agent unilateral spend authority, a weaker trust model
than the ERC-8183 escrow already in use, so the tests lead with the attacks
rather than the happy path.

#### Coverage

On `src/AgentBudgetEscrow.sol`, from `forge coverage`:

| Measure | Result |
|---|---|
| Lines | 100.00% (104 of 104) |
| Functions | 100.00% (15 of 15) |
| Statements | 87.42% (139 of 159) |
| Branches | 60.47% (26 of 43) |

Lines and functions are complete. Statements and branches are not, and are
printed here rather than omitted, because "100% coverage" without saying which
measure is the kind of claim that does not survive a judge running the command
themselves.

#### Pausing can never trap a client's funds

`openBudget` and `draw` carry
`whenNotPaused`. `reclaim` deliberately does not, so a paused contract still
lets a client take their money back. The test asserting exactly that is
`test_pause_canNEVERtrapClientFunds`, and the property is readable on chain
from the deployed source rather than only here.

#### Static analysis

Slither 0.11.6 against `src/AgentBudgetEscrow.sol`, 11
detectors fired on our own code. The full output is checked into the repository at
`docs/data/slither-agentbudgetescrow.json`, so every finding below can be read
in full rather than taken from this summary. It is not a clean report and is
not presented as one:

| Impact | Count | Finding and assessment |
|---|---|---|
| High | 1 | `arbitrary-send-eth` on `_payout`. It flags `to.call{value: amount}("")`. `to` is the budget's own client or provider, stored at `openBudget` and not attacker supplied at payout time, the return value is checked and reverts on failure, and `call` is the recommended pattern for native transfers. Judged a false positive. |
| Medium | 2 | `incorrect-equality` twice. One is `b.status == Status.NONE` to detect a budget that does not exist, the other is `received == 0` to reject a token that delivered nothing. Both are comparisons against a sentinel zero, which is what the detector is not aimed at. Judged false positives. |
| Low | 6 | `timestamp`, all six. A budget that drips over time has to read `block.timestamp`. Unavoidable and immaterial at the per-day granularity used. |
| Informational | 2 | A pragma mismatch between OpenZeppelin's `^0.8.20` and our pinned `0.8.24`, and the low-level call already covered above. |

The honest summary is that Slither's high and medium findings were reviewed
and judged false positives with reasons given, not that there were none.

#### What the tests actually run against

They run against
Foundry test doubles, including a `MockERC20` and a fee-on-transfer variant,
not against a forked mainnet. That is the right environment for adversarial
unit tests and it is not the same as testing against live token behaviour.
The deployments themselves are on mainnet, and the Ethereum deployment of the
same contract was rehearsed against a forked mainnet before it was sent.

### Product-market fit

The marketplace is live on mainnet and indexes real agents rather than
fixtures. Arbitrum carries 1,412 indexed agents of which 817 answer; Robinhood
Chain carries 197 of which 32 answer. Those are the numbers the site shows,
and the gap between indexed and answering is shown to visitors rather than
hidden.

### Innovation and creativity

The budget path is the part that is not a standard escrow. An escrow pays for
one job and holds the money until it is delivered. A budget is a spending
limit the agent draws down as it works, which suits an agent that has to spend
to do its job rather than return one result. Both paths exist here and the
site says which applies where.

### Real problem solving

The gap was measurable rather than argued. Agents on both chains were already
indexed, classified and evaluated, and a visitor could see all of that and
then do nothing with it. On Robinhood Chain only 4 of 13 signals could say
anything at all. Both chains now carry 9, and both are hireable.

## Honest limits

Almost no third-party agent can complete a hire on either chain. Drawing
from a budget requires the agent to call `draw` on the escrow, which means
code its developer has not written. The contract is deployed, the path works,
and the marketplace can fund a budget, but the counterparty has to participate
and almost none can yet. This is the single most important caveat on this
page, and a judge who discovers it after reading a page that omitted it would
be right to discount everything else here.

ERC-8183 escrow hiring is not available on either chain and will not be,
because that contract is Altana's rather than ours.

Four of the 13 evaluation signals cannot be shown on either chain, listed
above with reasons. A card on Arbitrum or Robinhood Chain is therefore less
evidenced than the same card on BNB Chain, and the capabilities panel on each
tab says so per signal.

Coverage is complete on lines and functions only. Branch coverage is
60.47%.

The tests are unit tests against doubles, not fork tests.

## Reproducing the contract checks

```bash
cd contracts

forge test --match-path test/AgentBudgetEscrow.t.sol
forge coverage --match-path test/AgentBudgetEscrow.t.sol

slither src/AgentBudgetEscrow.sol \
  --solc-remaps "@openzeppelin/=lib/openzeppelin-contracts/" \
  --exclude-dependencies
```

Full technical detail on the multichain work, including the address collision,
is in [Hiring beyond BNB Chain](multichain-hiring.md).
