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
// Multi-Chain has no mark of its own, so it shows the marks of the chains
// it actually contains, clustered and deliberately smaller than a
// single-chain tab's logo -- the tab represents several chains, and one
// full-size mark would misrepresent it as one.
//
// Three are shown, the three largest by real stored agent count (Base
// 58,580, Monad 2,815, Celo 2,361; then Arbitrum 1,175, Billions 714,
// Robinhood 7). Ranking by count rather than by preference means the
// cluster reflects what the view is actually mostly made of. Their assets
// were verified the same way: Base 32x32 ico, Monad 256x256 png, Celo
// 32x27 ico from docs.celo.org -- celo.org's own head points at a Framer
// CDN asset, so the Celo-owned docs domain was used instead.
//
// Every mark degrades gracefully. A single-chain logo that fails falls
// back to a tinted glyph; a cluster member that fails simply drops out,
// shrinking the cluster rather than showing a broken-image icon.

import React, { useState } from 'react';
import { Boxes } from 'lucide-react';

const LOGOS = {
  bnb: { src: 'https://www.bnbchain.org/favicon.ico', alt: 'BNB Chain' },
  ethereum: { src: 'https://ethereum.org/favicon.ico', alt: 'Ethereum' },
  solana: { src: 'https://solana.com/src/img/branding/solanaLogoMark.svg', alt: 'Solana' },
};

// The Multi-Chain cluster, largest-first.
const MULTICHAIN_LOGOS = [
  'https://www.base.org/favicon.ico',
  'https://www.monad.xyz/favicon.ico',
  'https://docs.celo.org/img/favicon.ico',
];

/** One image that quietly disappears if it fails, so a broken hotlink
 * shrinks the cluster rather than leaving a broken-image icon. */
function ClusterLogo({ src, size, index }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="rounded-full ring-1 ring-white dark:ring-[#0B101B] object-contain bg-white"
      style={{ width: size, height: size, marginLeft: index === 0 ? 0 : -size * 0.32 }}
    />
  );
}

// Fallback tint, used only when a logo fails to load.
const FALLBACK_COLOR = {
  bnb: '#F0B90B', ethereum: '#627EEA', solana: '#14F195', multichain: '#8B93A7',
};

export function ChainMark({ viewId, size = 14, className = '' }) {
  const [failed, setFailed] = useState(false);

  if (viewId === 'multichain') {
    // Smaller than a single-chain mark (~78%), overlapped, so the cluster
    // occupies roughly the same width as one logo and the tab strip keeps
    // its rhythm.
    const each = Math.round(size * 0.78);
    return (
      <span className={`flex items-center shrink-0 ${className}`} aria-hidden="true">
        {MULTICHAIN_LOGOS.map((src, i) => (
          <ClusterLogo key={src} src={src} size={each} index={i} />
        ))}
      </span>
    );
  }

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
