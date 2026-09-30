# Dashboard

The Dashboard (`/dashboard`) is where a connected wallet's holdings are shown.
Without a wallet connected it asks for one; there is nothing to sign up for.

The screenshot was taken on https://www.tnega.app on 30 September 2026 at
21:06 UTC, with no wallet connected.

![The Dashboard with no wallet connected: "Connect a wallet to see what it holds", and the Connect wallet button](images/site-dashboard.png)

With a wallet connected, the Dashboard shows three cards: **Stocks**, **ETFs** and **Vaults**. Stocks and ETFs list the listed tokenized versions the wallet holds on the six buy chains (Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM). A chain that could not be read says so and is never shown as zero, and a dollar value appears only from Tnega's own measured price under a day old. Vaults says that the listed vaults are on Solana and were not checked for an EVM address. This page shows no connected screenshot.

Connecting a wallet uses RainbowKit (a browser wallet such as MetaMask, or a
phone wallet through WalletConnect). Signing in on the site is a signature over
a short message that moves no funds and approves nothing.

The same holdings can be read without the site: `tnega_wallet_holdings` (see
[MCP tools](mcp-tools.md)) reads which listed tokenized stocks a wallet holds
on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM, at one
block per chain.
