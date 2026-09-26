// siteCopy.js
//
// The site's title and description, in one place, for both states of
// DATA_LIVE (dataLive.js). App.jsx uses them for "/" at runtime; the build
// writes them into index.html (title, meta description, og: and twitter:
// tags, JSON-LD) and into dist/manifest.json (vite.config.js), so a
// scraper that never runs the app reads the same words.
//
// Each describes only what the site does in that state. Before the lists
// are live, that is the wallet Dashboard and Use with AI.

import { DATA_LIVE } from './dataLive.js';

const TODAY = {
  docTitle: 'Tnega: Wealth, borderless.',
  ogTitle: 'Tnega: Wealth, borderless.',
  description: 'Connect your wallet to see what it holds on Hyperliquid, BNB Chain, Arbitrum and Robinhood Chain, and what its Hyperliquid trading has cost it.',
};

const LIVE = {
  docTitle: 'Tnega: Every Tokenized Equity, and What It Costs to Buy',
  ogTitle: 'Tnega: Wealth, borderless.',
  description: 'Tokenized stocks and ETFs across issuers and chains, with what each costs to buy at your size, and your wallet\'s holdings, read from the chain.',
};

export const SITE_COPY = DATA_LIVE ? LIVE : TODAY;
