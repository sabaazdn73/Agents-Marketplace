// trade/buyLive.js
//
// Is the Buy panel shown? Both switches: the tokenized-equity pages
// (dataLive.js) and the home page's `buy` section switch (home/sections.js),
// which stays off in production until a supervisor has run the flow to the
// wallet's signature prompt on each chain. Everything the buy flow adds
// outside its own panel (the extra wagmi chains, the privacy paragraph)
// reads this one value, so with the switches off the site behaves as it did
// before the flow existed.

import { DATA_LIVE } from '../dataLive.js';
import { SECTION_LIVE } from '../home/sections.js';

export const BUY_LIVE = !!(DATA_LIVE && SECTION_LIVE.buy);
