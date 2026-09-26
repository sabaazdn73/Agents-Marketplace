// Brand.jsx
//
// The Tnega mark beside the wordmark. One component for the web header, the
// mobile header and the sign-in page, so the three cannot drift apart in size,
// spacing or artwork.
//
// The mark is icon_v2: the arch and the hexagon network on the rounded blue
// tile. tnega-mark.png is rendered from public/icon_v2.svg at 256px by
// scripts/render_icons.py, the same master the favicon and the app icons come
// from. A raster rather than the SVG itself because icon_v2.svg carries
// drop-shadow filters, which browsers rasterise without reliably following the
// device pixel ratio; 256px covers the largest size drawn here (77px on the
// sign-in page) at 3x.
//
// Sizes. The owner's rule: the ARCH inside the tile is drawn as large as the
// arch of the mark the header showed before the redesign. That mark was
// app-mark.png, the arch on transparency, in a 32px box on the web and a 36px
// box on mobile; its arch was 26.0px and 29.2px tall (104 of its 128px). In
// icon_v2 the arch is 254 of 512px tall (y 130 to 384), so the tile is 52px on
// the web and 59px on mobile, and the header rows grew to 64px and 68px to
// hold it. The sign-in page scales by the same factor: 59px, and 77px from lg.
//
// A flex box, not inline-flex: inline-flex sits on its parent's text baseline
// and leaves a descender's gap under it, which put the tile 3px above the
// header's centre line.
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
    <span className={`flex items-center ${gapClassName} ${className}`}>
      <TnegaMark className={markClassName} />
      <Wordmark className={wordClassName} />
    </span>
  );
}
