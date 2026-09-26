// Brand.jsx
//
// The Tnega mark beside the wordmark. One component for the web header, the
// mobile header and the sign-in page, so the three cannot drift apart in size,
// spacing or artwork.
//
// The mark is icon_v2: the arch and the hexagon network on the rounded blue
// tile. tnega-mark.png is rendered from public/icon_v2.svg at 192px by
// scripts/render_icons.py, the same master the favicon and the app icons come
// from. A raster rather than the SVG itself because icon_v2.svg carries
// drop-shadow filters, which browsers rasterise without reliably following the
// device pixel ratio; 192px covers the largest size drawn here (56px on the
// sign-in page) at 3x.
//
// Sizes. Before the redesign the header drew the mark at 32px on the web and
// 36px on mobile. The owner asked for the blue tile about 20% larger than
// that: 38px and 43px.
//
// The mark is decorative (alt=""); the wordmark carries the accessible name.

import React from 'react';
import markUrl from '../assets/tnega-mark.png';
import Wordmark from './Wordmark';

export function TnegaMark({ className = 'w-[38px] h-[38px]' }) {
  return (
    <img
      src={markUrl}
      alt=""
      aria-hidden="true"
      draggable="false"
      className={`block shrink-0 select-none ${className}`}
    />
  );
}

export default function Brand({ markClassName, wordClassName, gapClassName = 'gap-1.5', className = '' }) {
  return (
    <span className={`inline-flex items-center ${gapClassName} ${className}`}>
      <TnegaMark className={markClassName} />
      <Wordmark className={wordClassName} />
    </span>
  );
}
