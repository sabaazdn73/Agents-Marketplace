// chainMarks.jsx
//
// Visual marks for the chain tabs.
//
// These are deliberately NOT the chains' own logos, and the reason is a
// trademark one rather than a design one. The brand terms were checked
// first, the same way they were for MetaMask, The Graph and Ledger:
//
//   BNB Chain  already used elsewhere in this project (hackathonPartners.js),
//              so precedent exists -- but see the consistency note below.
//   Ethereum   ethereum.org's own assets page carries no permission
//              language in either direction.
//   Solana     solana.com/branding publishes design do's and don'ts but no
//              permission language; the only usage terms found were from a
//              secondary source stating that commercial use requires
//              written permission -- the same position that led to Ledger's
//              mark being left out.
//
// With two of four unclear, the honest options were a strip mixing one
// real logo with placeholder gaps, or one consistent set of neutral marks.
// Consistency won: geometric glyphs in each chain's accent colour give the
// tabs real visual distinction without putting anyone's trademark on a
// fee-taking product on the strength of unclear terms.
//
// Colours are used, and that is deliberate: a hex value is not a mark, and
// the association is what makes a tab scannable at a glance.
//
// If written permission is ever obtained for any of these, swapping a
// glyph for the real mark is a one-line change here and nowhere else.

import React from 'react';
import { Hexagon, Diamond, Layers, Boxes } from 'lucide-react';

const MARKS = {
  bnb: { Icon: Hexagon, color: '#F0B90B' },
  ethereum: { Icon: Diamond, color: '#627EEA' },
  solana: { Icon: Layers, color: '#14F195' },
  multichain: { Icon: Boxes, color: '#8B93A7' },
};

/** A chain's mark. Falls back to the neutral multi-chain glyph for any view
 * id this file does not know, so adding a view can never render nothing. */
export function ChainMark({ viewId, size = 14, className = '' }) {
  const { Icon, color } = MARKS[viewId] || MARKS.multichain;
  return <Icon size={size} color={color} className={className} aria-hidden="true" />;
}

export default ChainMark;
