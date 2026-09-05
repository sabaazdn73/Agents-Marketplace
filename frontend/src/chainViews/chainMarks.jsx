// chainMarks.jsx
//
// The chains' own marks on the chain tabs.
//
// Earlier this used neutral geometric glyphs, on the reasoning that
// Ethereum's and Solana's usage terms were unclear. That was the wrong
// call and is corrected here. Identifying which blockchain a set of agents
// comes from, by showing that chain's mark in a chain selector, is
// nominative use: it is the standard convention in every wallet, explorer
// and aggregator, and it makes no claim of endorsement or partnership.
// That is a materially different thing from putting a company's logo in a
// partners list, which is where the caution actually belongs.
//
// Assets are first-party and verified, the same discipline used for
// MetaMask, The Graph and ETHGlobal -- checked live, and checked that they
// decode as real images rather than trusting an HTTP 200:
//
//   BNB Chain  www.bnbchain.org/favicon.ico              32x32 ico
//   Ethereum   ethereum.org/favicon.ico                  256x256 ico (PNG inside)
//   Solana     solana.com/src/img/branding/...Mark.svg   real SVG, from their
//              own /branding path, valid XML
//
// Stable paths deliberately. solana.com's <head> points at a hashed
// Next.js build asset (favicon.b615f892.png) whose name changes on their
// deploys, and ethereum.org's carries a cache-busting query. Both were
// avoided in favour of URLs that do not churn.
//
// Multi-Chain keeps a neutral glyph, and that is correct rather than a
// compromise: it is not a chain and has no mark of its own.
//
// Every mark falls back to the glyph if the image fails to load, so a
// hotlink breaking degrades to the previous behaviour instead of an empty
// tab.

import React, { useState } from 'react';
import { Boxes } from 'lucide-react';

const LOGOS = {
  bnb: { src: 'https://www.bnbchain.org/favicon.ico', alt: 'BNB Chain' },
  ethereum: { src: 'https://ethereum.org/favicon.ico', alt: 'Ethereum' },
  solana: { src: 'https://solana.com/src/img/branding/solanaLogoMark.svg', alt: 'Solana' },
};

// Multi-Chain only. Not a chain, so it gets a generic cluster glyph.
const FALLBACK_COLOR = {
  bnb: '#F0B90B', ethereum: '#627EEA', solana: '#14F195', multichain: '#8B93A7',
};

export function ChainMark({ viewId, size = 14, className = '' }) {
  const [failed, setFailed] = useState(false);
  const logo = LOGOS[viewId];

  if (!logo || failed) {
    return (
      <Boxes
        size={size}
        color={FALLBACK_COLOR[viewId] || FALLBACK_COLOR.multichain}
        className={className}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      src={logo.src}
      alt=""                     /* decorative: the tab already says the name */
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export default ChainMark;
