# Privacy

The full privacy notice, for the website and for the Chrome extension, is on
the site at [tnega.app/privacy](https://www.tnega.app/privacy) (last updated
1 October 2026 when this page was last changed). This page summarises it; where
the two differ, the site's notice is the one that applies.

## The website

- There is no account, no email address and no password. The site sets no cookies of its own and runs no analytics or advertising script.
- Pages are served by Vercel. Figures come from Tnega's server (`agents-marketplace-q3k4.onrender.com`, on Render behind Cloudflare). The server limits each network address to a burst of 120 requests, then two a second, keeping only the address and one number in memory.
- Connecting a wallet uses RainbowKit and WalletConnect; WalletConnect's servers receive your IP address, and a phone wallet's connection passes through WalletConnect's relay.
- Four routes on Tnega's server receive a connected wallet's address, always in the body of the request, never in the web address: My Agents (POST /api/my-jobs), the Hyperliquid costs read (POST /api/wallet/habits), the stock and ETF holdings read (POST /api/wallet/holdings) and the trades read (POST /api/wallet/trades), which finds the address's buys and sells on chain for the buy-in and P/L. The Dashboard calls the last three when you open it with a wallet connected. The address is not written to any database or to any log by Tnega's code; what is read is kept in the server's memory only, for up to five minutes (habits), one minute (holdings) and at most thirty minutes after the last request (trades, cleared by a timer). The trades read sends the address to each chain's RPC provider as a filter for its token transfers and in balance reads at past blocks.
- What the site keeps in your browser (the theme, a sign-in signature for 24 hours, the times of recent LI.FI quotes, and the wallet libraries' own keys) is listed by name on the notice. None of it is sent to Tnega's server.

## A signing link

A signing link (`tnega.app/sign/…`) is made by Tnega's MCP server when your
assistant prepares an order. The link itself carries the order (token, chain,
amount, wallet address, expiry), signed by the server so it cannot be changed.
It is encoded, not hidden: anyone who has the link can read the wallet address
in it.

- Opening it sends the link to Tnega's server, which checks it and answers with the order. The server's access log records the path, and so the address; the server writes the order nowhere else.
- "Get a LI.FI quote" sends LI.FI (li.quest) the wallet address, the chain, the two tokens and the amount, from your browser.
- The wallet's balance and allowance are read from the chain's public RPC provider, which receives the wallet address.
- After you sign the swap, your browser sends Tnega's server the transaction hash with the link, so the link cannot be used twice. The server keeps that in memory only.

## Your assistant

When you use Tnega through an assistant, what you type goes to your assistant's
provider under that provider's terms, not to Tnega. Tnega's server receives only
the tool calls the assistant makes, with their arguments (for
`tnega_prepare_buy`, the ticker, the amount and the wallet address), and, as
with any request, the network address the call comes from.

## The Chrome extension

The extension runs on app.hyperliquid.xyz and eight block explorer and registry
sites, reads the identifier in the page's URL (on app.hyperliquid.xyz it also
reads page text, only to decide where to place its panel), and asks Tnega's server about it.
Practice mode computes pretend fills, fees, funding and liquidation on your
machine and sends nothing. The notice lists every site, what is read on each,
and what is stored.

For the data the project stores and the third-party terms it works within, see
the archived [Data handling and third-party terms](data-handling.md).
