# Third-party notices

What this project depends on, under what terms, and the one question that is
still open. Checked against the installed licence texts and the npm registry on
2026-09-16 rather than from memory.

## The open question: ua-parser-js

`ua-parser-js@2.0.10` is AGPL-3.0-or-later. It is not a direct dependency: it
arrives through `@rainbow-me/rainbowkit@2.2.11`, which requires `^2.0.9`, and
through `react-device-detect`. It reaches the browser in the built bundle.

AGPL section 13 extends the source obligation to people who interact with the
software over a network, so a hosted site has no internal-use exemption. This
is recorded here as unresolved rather than described as satisfied.

The routes, in the order they cost least:

1. An npm `overrides` entry pinning `ua-parser-js` to `1.0.x`, which is MIT.
   The relicence happened at the 2.x boundary. RainbowKit's declared range is
   `^2.0.9`, so this is an override against a stated requirement and the
   RainbowKit paths that use it need testing.
2. The author sells permissive editions, which is the intended alternative to
   the AGPL edition.
3. License this project under AGPL.

Whichever is chosen should be recorded here as a decision, with its date.

## Resolved

`@altananetwork/sdk` was GPL-3.0-or-later at 0.7.0 and is Apache-2.0 from
0.9.0. This project moved to 0.9.0 on 2026-09-16, which removed the obligation
rather than satisfying it. All nine symbols the app imports exist in that
version and the build passes.

## Everything else

Frontend: React, viem, wagmi, RainbowKit, TanStack Query, lucide-react,
three.js and the rest are MIT, and `@privy-io/react-auth` is Apache-2.0.

Backend: FastAPI, pydantic and python-dotenv are MIT; uvicorn, starlette and
httpx are BSD-3-Clause; motor, pymongo and google-genai are Apache-2.0;
certifi is MPL-2.0; psycopg and psycopg-binary are LGPL-3.0-only. The two weak
copyleft ones run server side and are never conveyed to a user, so neither
MPL section 3.2 nor LGPL section 4 is triggered by serving an HTTP API from
them.

Contracts: this project's own `AgentBudgetEscrow.sol` and
`AgentAccessMarket.sol` carry MIT SPDX headers and import OpenZeppelin, which
is MIT and vendored under `contracts/lib/`.

## Other people's work that is not a dependency

The ERC-8004 Identity Registry and the ERC-8183 AgenticCommerce contract are
not this project's. AgenticCommerce is Altana's, deployed on BNB Chain, and
this project integrates with it. `docs/smart-contracts.md` marks which
contracts are ours and which are not.

Hypurr is Hyperliquid's mascot. It appears inside the browser extension's
panel, on Hyperliquid's own site, describing Hyperliquid's own data, which is
nominative use. Every surface that identifies the software carries Tnega's own
mark. The provenance of the specific artwork file is not recorded anywhere in
this repository, which is a gap worth closing before the extension is
published: a source URL and the terms that URL states, beside the file.

CoinGecko's API terms require the wording "Powered by CoinGecko" where their
data is displayed. The site currently renders "CoinGecko" in its data sources
strip, which is the right place and not yet the required wording.
