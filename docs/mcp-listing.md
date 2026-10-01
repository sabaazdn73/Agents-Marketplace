# Listing the MCP server so assistants can find it

Drafted 2026-10-01; deploy and icons verified live the same evening. Nothing here has been submitted. Every submission is a public
act under the owner's name, so each one waits for her yes.

## The one-paragraph description (use everywhere)

Tnega measures what it really costs to buy a tokenized stock or ETF, per issuer's
version on each chain, and prepares the order for you to sign in your own wallet.
It also reads on-chain AI agents (ERC-8004), jobs, budgets and stablecoin vaults.
Every number carries its coverage and an as_of time. Read only: Tnega never signs,
holds funds or asks for a key. Free, hosted, no account.

Short (under 100 characters): `Real cost of buying tokenized stocks on every chain, then sign in your own wallet.`

## Facts every directory asks for

| Field | Value |
|---|---|
| Name | Tnega |
| Endpoint | `https://mcp.tnega.app/mcp` (streamable HTTP, JSON-RPC over POST) |
| Auth | none |
| Install (Claude Code) | `npx tnega-mcp` |
| npm | `tnega-mcp` |
| Website | https://www.tnega.app |
| Source | https://github.com/sabaazdn73/Agents-Marketplace |
| Icon | https://www.tnega.app/app-icon-512.png (Fendi) |
| Tools | tnega_catalogue, tnega_resolve, tnega_get, tnega_list, tnega_summary, tnega_series, tnega_prepare_buy, tnega_prepare_sell, tnega_wallet_holdings |
| Tags | tokenized-stocks, rwa, defi, erc-8004, ai-agents, solana, base, bnb-chain, finance |

## Example prompts (3 to 5, real ones)

1. What does it cost to buy $500 of NVDA as a tokenized stock, and which chain is cheapest?
2. Which tokenized stocks does 0x... hold?
3. Does Aave V4 on Base accept this tokenized stock as collateral?
4. List ERC-8004 agents on BNB Chain that have a verified delivered job.
5. Compare the stablecoin vaults Tnega reads on chain.

## Official MCP Registry (`server.json` at the repo root, ready)

The registry namespaces GitHub-owned servers as `io.github.<user>/<name>` and
asks the publisher to authenticate with GitHub. That login is hers to do.

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.sabaazdn73/tnega",
  "title": "Tnega",
  "description": "Real cost of buying tokenized stocks on every chain, then sign in your own wallet. Read only.",
  "version": "0.1.0",
  "websiteUrl": "https://www.tnega.app",
  "repository": { "url": "https://github.com/sabaazdn73/Agents-Marketplace", "source": "github" },
  "remotes": [
    { "type": "streamable-http", "url": "https://mcp.tnega.app/mcp" }
  ]
}
```

The file is `server.json` in the repo root; its schema URL and `remotes` shape match
the registry's remote-servers page as of 2026-10-01. To publish (hers, GitHub login):

```
brew install mcp-publisher        # or the release binary from the registry repo
mcp-publisher login github        # opens a device-code page, she approves
mcp-publisher publish             # run in the repo root
```

## Other directories (each is a form or a pull request)

- Smithery, PulseMCP, Glama, mcp.so: submit the endpoint and the table above.
- Claude's connector directory: has its own review; apply only when the server is
  stable on a domain of its own (see below).
- `awesome-mcp-servers` (GitHub lists): a one-line pull request. Line to add:
  `- [Tnega](https://github.com/sabaazdn73/Agents-Marketplace) - Real cost of buying tokenized stocks on every chain, wallet holdings, ERC-8004 agent data; prepares orders you sign yourself. Read only, no key.`

## Why Claude shows Render's logo, and the fix

A client shows the icon of the host in the MCP URL. This URL is on
`onrender.com`, which had no `/favicon.ico` of its own, so the client fell back to
Render's. This branch makes that host answer `/favicon.ico` (and
`/icon-192.png`, `/icon-512.png`) with Fendi and adds `icons` to `serverInfo`.
Clients that cache the old icon may need a reconnect.

The lasting fix is a domain of Tnega's own. `mcp.tnega.app` was added to the Render
service (free) and a CNAME `mcp` -> `agents-marketplace-q3k4.onrender.com` to
Namecheap on 2026-10-01; verified, HTTPS and `/mcp` answer. The old onrender.com
URL keeps working, and `npx tnega-mcp` 0.1.2 still writes it until the package is republished. Then the connector shows Fendi everywhere, directories look
more serious, and the URL survives a change of host. That is a DNS record and a
Render custom-domain setting, both the owner's.
