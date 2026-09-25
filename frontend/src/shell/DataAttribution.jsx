// DataAttribution.jsx
//
// The lines that say where a figure came from, in one place, so web and mobile
// cannot describe the same figure differently.
//
// BnbPriceSource sits beside a dollar value computed from the BNB price. The
// price is read on BNB Chain by our server (backend/core/bnb_usd.py): a
// 30-minute average of the PancakeSwap v3 WBNB/USDT pool, in USDT taken at one
// US dollar. The line says exactly that, with the block, and the title carries
// the method and the assumption. It replaced the CoinGecko credit on
// 2026-09-25, when the price stopped coming from CoinGecko.

import React from 'react';
import { bnbQuoteSource } from '../useBnbPrice';

const lineClass = 'text-[10px] leading-tight text-muted';

export function BnbPriceSource({ quote, className = '' }) {
  const text = bnbQuoteSource(quote);
  if (!text) return null;
  const title = [quote.method, quote.assumption, quote.source?.pool ? `Pool ${quote.source.pool}` : null]
    .filter(Boolean).join(' ');
  return (
    <span className={`${lineClass} ${className}`} title={title}>
      {text}
    </span>
  );
}

// Beside anything computed from Zerion's API. The backend tags those responses
// "source": "via the Zerion API" and names this exact sentence for the page to
// show (backend/adapters/zerion.py, owner's decision 2026-09-25): it says where
// the data came from and that this is not Zerion's own product.
export const ZERION_SOURCE_TEXT = 'Data via the Zerion API. Tnega is not a Zerion app.';

export function ZerionSourceLine({ className = '' }) {
  return <p className={`${lineClass} ${className}`}>{ZERION_SOURCE_TEXT}</p>;
}
