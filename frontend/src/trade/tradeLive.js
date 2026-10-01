// trade/tradeLive.js
//
// THE PER-CHAIN SWITCH for the Buy and Sell tabs on a stock's page
// (stocks/StockPage.jsx, trade/StockTrade.jsx). One line per chain; a chain
// is on only when its value here is `true`. Everything the tabs add outside
// their own panel reads this file: the chains the site's wallet config can
// switch to (wagmiConfig.js) and the privacy page's paragraph.
//
// Every chain is on: switched on by the owner's decision on 2026-10-01, so
// that the owner can run real tests from the site. Base is the one chain with
// a real run so far (a small buy of NVDAc, with an
// exact approval to LI.FI's contract; the real sale is still to run). No real
// buy or sale has run yet on Ethereum, Arbitrum, BNB Chain, Robinhood Chain or
// HyperEVM.
//
// This is not the site's older Buy switch (trade/buyLive.js, home/sections.js
// `buy`), which stays off: it governs the basket buys and the home section.

import { DATA_LIVE } from '../dataLive.js';

export const TRADE_SWITCH = {
  1: true, // Ethereum
  8453: true, // Base
  42161: true, // Arbitrum
  56: true, // BNB Chain
  4663: true, // Robinhood Chain
  999: true, // HyperEVM
};

/** Buy and Sell are offered for a version on this chain. */
export const tradeOn = (chainId) => !!DATA_LIVE && TRADE_SWITCH[Number(chainId)] === true;

/** The chains switched on, as numbers. Empty while DATA_LIVE is off. */
export const TRADE_CHAIN_IDS = DATA_LIVE
  ? Object.keys(TRADE_SWITCH).map(Number).filter((id) => TRADE_SWITCH[id] === true)
  : [];
