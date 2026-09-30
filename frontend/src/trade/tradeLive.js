// trade/tradeLive.js
//
// THE PER-CHAIN SWITCH for the Buy and Sell tabs on a stock's page
// (stocks/StockPage.jsx, trade/StockTrade.jsx). One line per chain; a chain
// is on only when its value here is `true`. Everything the tabs add outside
// their own panel reads this file: the chains the site's wallet config can
// switch to (wagmiConfig.js) and the privacy page's paragraph.
//
// Base is on: the one chain with a real run through the signing page's
// checks (2026-09-30: 5 USDC to 0.0217831 NVDAc, an exact approval to
// LI.FI's contract). A chain is switched on here only after a real buy and a
// real sale have been run on it with a brand-new test wallet.
//
// This is not the site's older Buy switch (trade/buyLive.js, home/sections.js
// `buy`), which stays off: it governs the basket buys and the home section.

import { DATA_LIVE } from '../dataLive.js';

export const TRADE_SWITCH = {
  1: false, // Ethereum
  8453: true, // Base
  42161: false, // Arbitrum
  56: false, // BNB Chain
  4663: false, // Robinhood Chain
  999: false, // HyperEVM
};

/** Buy and Sell are offered for a version on this chain. */
export const tradeOn = (chainId) => !!DATA_LIVE && TRADE_SWITCH[Number(chainId)] === true;

/** The chains switched on, as numbers. Empty while DATA_LIVE is off. */
export const TRADE_CHAIN_IDS = DATA_LIVE
  ? Object.keys(TRADE_SWITCH).map(Number).filter((id) => TRADE_SWITCH[id] === true)
  : [];
