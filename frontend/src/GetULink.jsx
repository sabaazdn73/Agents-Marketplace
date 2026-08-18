// GetULink.jsx
//
// One shared, honest "Get $U" link, reused everywhere $U is a required
// currency (hire budget, Altana session spend cap, buy/subscribe in $U).
// Single source of truth for the URL so every instance can't drift/typo.
// Real Binance price/trading page for United Stables — not altered, not
// guessed at a different path.

import React from 'react';
import { ExternalLink } from 'lucide-react';

export const GET_U_URL = 'https://www.binance.com/en/price/united-stables';

export default function GetULink({ className = '' }) {
  return (
    <a
      href={GET_U_URL}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 text-[11px] text-indigo-500 hover:text-indigo-600 ${className}`}
    >
      Need $U? Get it on Binance <ExternalLink size={10} />
    </a>
  );
}
