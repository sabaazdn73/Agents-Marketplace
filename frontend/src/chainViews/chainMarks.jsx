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
// partners list, which is where the caution belongs.
//
// Assets are first-party and verified, the same discipline used for
// MetaMask, The Graph and ETHGlobal -- checked live, and checked that they
// decode as images rather than trusting an HTTP 200:
//
//   BNB Chain  www.bnbchain.org/favicon.ico              32x32 ico
//   Ethereum   ethereum.org/favicon.ico                  256x256 ico (PNG inside)
// Solana solana.com/src/img/branding/...Mark.svg SVG, from their
//              own /branding path, valid XML
//
// Stable paths deliberately. solana.com's <head> points at a hashed
// Next.js build asset (favicon.b615f892.png) whose name changes on their
// deploys, and ethereum.org's carries a cache-busting query. Both were
// avoided in favour of URLs that do not churn.
//
// Multi-Chain has no mark of its own, so it shows the marks of the chains
// it contains, clustered. Each cluster mark is now rendered at the
// SAME diameter as a single-chain tab's logo: at 78% the tab visibly sat
// lighter than its three neighbours. Equal weight comes from equal
// diameter; what keeps the strip's rhythm is the overlap, not shrinking.
//
// Three are shown, the three largest by stored agent count (Base
// 58,580, Monad 2,815, Celo 2,361; then Arbitrum 1,175, Billions 714,
// Robinhood 7). Count is deliberately the basis, and it was reconsidered
// against ranking by verified status instead. Two things decided it:
// those three are 97% of the agents in the view, so the mark reflects what
// the tab contains; and verification is already stated explicitly
// and per-chain by UnverifiedStatusNote, which names the checked and
// unchecked chains from the backend. A tab icon is a label, not a claim,
// and promoting Arbitrum (1.8% of the view) over two larger chains would
// misrepresent the composition to duplicate something already said in
// words. Base is in any case both the largest member and live-checked.
//
// Every mark was verified by rendering it, not by trusting an HTTP 200 --
// the failure this catches is an asset that decodes perfectly and is the
// wrong picture. Two findings:
//   - docs.celo.org/img/favicon.ico is a Docusaurus MASCOT (a green
//     cartoon character), not Celo's mark. It decoded fine and was wrong.
// Replaced with Celo's symbol, the black C on yellow.
//   - Base's favicon is a plain blue square with no glyph, which looks
//     broken but is correct: that IS Base's logomark, confirmed against a
//     second independent source. Kept, and kept edge-to-edge, because a
//     solid blue disc reads at 13px where a small square on white padding
//     would not.
// Checked on both grounds: none is a wordmark, none is light-mode-only,
// and all six survive the dark-mode background.
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
  // Added 2026-09-10 with their own tabs. Both checked live before being
  // hardcoded, same as the three above: arbitrum.io returns a 3.4KB ico and
  // robinhood.com a 15KB ico, each from the chain's own domain rather than a
  // third-party mirror.
  arbitrum: { src: 'https://arbitrum.io/favicon.ico', alt: 'Arbitrum' },
  robinhood: { src: 'https://robinhood.com/favicon.ico', alt: 'Robinhood Chain' },
  // Added 2026-09-11 with Monad's own tab. The apex serves the icon
  // directly (13KB ico); www.monad.xyz 308-redirects to it, so the apex is
  // used to skip a hop on every render.
  monad: { src: 'https://monad.xyz/favicon.ico', alt: 'Monad' },
};

// The Multi-Chain cluster was removed on 2026-09-11 with the view itself.
// ClusterLogo below is kept as the generic "hotlink that disappears
// rather than showing a broken image" helper.

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
      style={{ width: size, height: size, marginLeft: index === 0 ? 0 : -size * 0.36 }}
    />
  );
}

// Fallback tint, used only when a logo fails to load.
const FALLBACK_COLOR = {
  bnb: '#F0B90B', ethereum: '#627EEA', solana: '#14F195',
  arbitrum: '#12AAFF', robinhood: '#00C805', monad: '#836EF9',
  // Used when a viewId has no colour of its own.
  fallback: '#8B93A7',
};

export function ChainMark({ viewId, size = 14, className = '' }) {
  const [failed, setFailed] = useState(false);

  const logo = LOGOS[viewId];

  if (!logo || failed) {
    return (
      <Boxes
        size={size}
        color={FALLBACK_COLOR[viewId] || FALLBACK_COLOR.fallback}
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

/** Chain id -> the view id the logo table is keyed by, so a card that knows
 *  only which chain an agent is on can still show that chain's mark. */
export const CHAIN_ID_TO_VIEW = {
  56: 'bnb', 1: 'ethereum', 101: 'solana',
  42161: 'arbitrum', 4663: 'robinhood', 143: 'monad',
};

/** The chain marker on an agent card.
 *
 *  A logo, not the chain's name. "BNB Smart Chain" is three words in a badge
 *  pinned to a card's top-right corner, and once the grid narrows it wraps to
 *  three stacked lines of small text, which reads as debris rather than a
 *  label. A mark is one glyph at any width.
 *
 *  The name is not lost: it stays as the title and the accessible name, so a
 *  hover and a screen reader both still get it. Where a chain has no logo the
 *  badge falls back to its name, because an unlabelled blank is worse than an
 *  untidy word. */
export function ChainCardBadge({ chainId, chainName, className = '' }) {
  const viewId = CHAIN_ID_TO_VIEW[Number(chainId)];
  const label = chainName || (viewId ? viewId : '');
  if (!viewId) {
    if (!label) return null;
    return (
      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 shrink-0 ${className}`}>
        {label}
      </span>
    );
  }
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={`shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md bg-gray-100 dark:bg-gray-800 ${className}`}
    >
      <ChainMark viewId={viewId} size={14} />
    </span>
  );
}
