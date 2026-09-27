<img src="https://www.tnega.app/fendi-head-512.png" alt="" width="112" align="right" />

# tnega-mcp

Adds [Tnega](https://www.tnega.app)'s MCP server to your client.

```
npx tnega-mcp
```

That is the whole install. No key, no account, no sign-up.

## What it does

Writes one config entry, by asking Claude Code's own CLI to write it. It starts
no server, installs no dependency, and runs nothing afterwards. Tnega's MCP
server is hosted and reached over HTTP, so there is nothing to run on your
machine. `bin/tnega-mcp.js` has no dependencies and is short enough to read
before you run it.

```
npx tnega-mcp --print         the config, to paste yourself
npx tnega-mcp --scope user    every project, not just this one
```

Run it twice and it says the server is already configured and changes nothing.
For a client other than Claude Code, `--print` gives you the entry and the
endpoint; where that entry belongs differs per client, and this package only
claims the path it has checked.

## What it connects you to

Six tools over nine datasets. Start with `tnega_catalogue`, which lists every
dataset, the keys each accepts, and its live coverage.

| | |
|---|---|
| `tokenized_equities` | tokenized stocks and ETFs, every issuer's version on each chain side by side, with what a 1,000 or 10,000 USD buy costs, simulated on the pools at a stated block; transfer controls and who may hold each, in the issuer's own words |
| `vaults.stablecoin` | vaults taking a stablecoin deposit, read on chain: TVL, who controls them, what they lend against, fees, lockup and audits |
| `baskets.curated` | fixed example baskets of tokenized stocks and ETFs, each leg priced from the same measurements; not recommendations |
| `agents.index` | ERC-8004 agents on BNB Chain, ranked by what they have delivered rather than what they claim |
| `chains.agents` | the same registries on Ethereum, Arbitrum, Robinhood Chain, Solana and Monad |
| `chains.views` | which chains are covered, which can be hired on, and by which contract. Hiring runs either through ERC-8183 escrow, where payment is held until delivery, or through a spending budget, which is not an escrow |
| `jobs.erc8183` | on-chain jobs for one provider: who hired them, what was escrowed, what state each is in |
| `budgets.escrow` | budgets funded to agents, what was drawn against them, what was reclaimed. A spending mechanism, not an escrow: drawing requires no deliverable, so a drawn budget records money taken and never work received |
| `hyperliquid.post_only` | the share of an address's post-only orders the matching engine refused instead of resting |

No counts are printed here on purpose. They move, a README cannot re-read
itself, and a figure that cannot be refreshed is the thing this project exists
to argue against. `tnega_catalogue` carries the current ones.

## It reads, and the protocol says so

Every tool declares `readOnlyHint: true` and `destructiveHint: false`, so a
client can establish that this server writes nothing before it calls anything,
rather than taking the claim from a page. The server holds no key, signs
nothing, and cannot spend or hire.

`openWorldHint` is set per tool rather than defaulted: true where a call can
reach the venue while answering, false on `tnega_resolve`, which reads stored
data only.

## Every answer carries its coverage

A measurement with nothing behind it returns a stated reason rather than a
zero. Each dataset carries its own caveats: what a figure does not mean, how it
was counted, and where it has been wrong before. Some of those caveats record
findings this project published and then withdrew, because a withdrawal is
worth more than a clean number.

## The rest of Tnega

This package installs one surface of four. The others are not on npm:

- **The site**, [tnega.app](https://www.tnega.app), and its chain views
- **A Chrome extension** that puts the same readings on nine sites: Hyperliquid,
  8004scan and seven block explorers. It also carries practice mode, a paper
  trading panel priced entirely from Hyperliquid's own book, fees, funding and
  tick sizes, where the only thing that is not theirs is the money
- **A Telegram bot**, for the same measurements in a chat

[How it works](https://www.tnega.app/how-it-works) covers all four.

## Licence

MIT
