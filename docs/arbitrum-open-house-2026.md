# Arbitrum Open House Singapore, 2026

The buildathon Arbitrum and Robinhood Chain support was built for.

## What it is

Arbitrum Open House Singapore: Online Buildathon, a three week online
buildathon run on HackQuest and opened by the Arbitrum Foundation on
14 September 2026. It is the Singapore stop of a programme that has already
run in New York and London.

| | |
|---|---|
| Format | Online |
| Registration | 29 July to 2 October 2026 |
| Submission | 13 September to 4 October 2026 |
| Rewards announced | 12 October 2026 |
| Listing | [arbitrum-singapore.hackquest.io](https://arbitrum-singapore.hackquest.io) |

Prizes total 115,000 USDC:

| Track | Pool | Breakdown |
|---|---|---|
| Overall | 70,000 USDC | 40,000 first, 20,000 second, 10,000 third |
| Promising Products | 15,000 USDC | 7,000 first, 5,000 second, 3,000 third |
| Grants | up to 30,000 USDC | Milestone based, awarded at the organisers' discretion |

Eligibility is stated as: "Your project must be deployed on an Arbitrum chain
to qualify. For example: Arbitrum Sepolia, Arbitrum One, Robinhood Chain, or
others."

The judging criteria are:

1. Smart Contract Quality, "code following best practices, structured logically and efficiently, with minimal security vulnerabilities"
2. Product-Market Fit, "projects with clear potential to attract and retain users"
3. Innovation and Creativity, "original approaches that push boundaries"
4. Real Problem Solving, "applications that address genuine market needs"

## What Tnega submits

Tnega is a live mainnet agent marketplace. It discovers ERC-8004 agents,
evaluates them on independent signals, and hires them. Until this buildathon
it could only hire on BNB Chain.

The submission is the work that changed that: AgentBudgetEscrow written,
deployed and verified on Arbitrum One and Robinhood Chain, with the
marketplace's real indexed agents on both chains now hireable through it.

| | Arbitrum One | Robinhood Chain |
|---|---|---|
| Chain id | 42161 | 4663 |
| AgentBudgetEscrow | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` | `0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333` |
| Verified at | Arbiscan | Sourcify, `exact_match` |
| Agents indexed | 1,403 | 190 |
| Agents responding | 580 | 31 |

Full technical detail, including why one address is two different contracts
across chains, is in [Hiring beyond BNB Chain](multichain-hiring.md).

## Why it fits

Against the first criterion, the contract is the submission rather than a
wrapper around one. AgentBudgetEscrow is deployed on both eligible chains and
source verified on both, so the code can be read rather than taken on trust.
It has one owner across all three of its deployments, a fee fixed at 250 basis
points with a hard ceiling of 1000 in the code, and `reclaim` deliberately
carries no pause modifier so that pausing the contract can never trap a
client's funds. That last decision is readable on chain rather than claimed
here.

Against the fourth, the gap it closes was real and measurable rather than
argued. Agents on both chains were already indexed, classified and evaluated,
and a user could see all of that and then do nothing with it. On Robinhood
Chain only 4 of 12 evaluation signals could say anything at all. Both chains
now carry 9, and both are hireable.

The eligibility rule is met on both chains rather than one, which matters
because the programme reserves prize slots per chain.

## Being accurate about the relationship

Arbitrum and Robinhood Chain support was added for this buildathon. It was not
a pre-existing plan that happened to line up, and saying otherwise would be
untrue.

It also happens to close a genuine gap, which is why it was worth doing beyond
the deadline. The marketplace had spent months indexing and evaluating agents
on chains it could not hire on, and the notice explaining that was one of the
weakest things on the site. That is a real limitation whether or not a
buildathon exists.

Both things are true at once. The deadline is why it happened now.
