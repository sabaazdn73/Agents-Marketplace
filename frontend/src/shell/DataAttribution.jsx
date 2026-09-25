// DataAttribution.jsx
//
// The credit lines CoinGecko's API Terms ask for, in one place, so web and
// mobile cannot credit the same data differently.
//
// CoinGeckoAttribution sits beside any figure computed from CoinGecko's API
// (today, the US dollar value of a BNB balance, priced by the backend's
// /api/market/bnb-price). GeckoTerminalAttribution sits above output from the
// GeckoTerminal trending-pools skill. Both are visible text links, at least
// 10px, never hidden behind a tooltip.

import React from 'react';

const linkClass = 'text-[10px] leading-tight text-muted hover:text-fg hover:underline underline-offset-2 whitespace-nowrap';

export function CoinGeckoAttribution({ className = '' }) {
  return (
    <a
      href="https://www.coingecko.com/en/api"
      target="_blank"
      rel="noopener noreferrer"
      title="Data provided by CoinGecko"
      className={`${linkClass} ${className}`}
    >
      Powered by CoinGecko API
    </a>
  );
}

export function GeckoTerminalAttribution({ className = '' }) {
  return (
    <a
      href="https://www.geckoterminal.com"
      target="_blank"
      rel="noopener noreferrer"
      className={`${linkClass} ${className}`}
    >
      On-chain data provided by GeckoTerminal
    </a>
  );
}
