// Brand.jsx
//
// The Tnega mark beside the wordmark. One component for the web header, the
// mobile header and the sign-in page, so the three cannot drift apart in size,
// spacing or artwork.
//
// The mark is Fendi, the Tnega cat (owner's decision, 2026-09-27: Fendi
// replaces the logo everywhere). assets/fendi-mark.png is
// public/fendi-mark-512.png, the owner's transparent master, scaled to 256px:
// the largest box drawn here is 77px on the sign-in page, which 256px covers
// at 3x without shipping the 512px file to every visitor.
//
// Sizes are the boxes the tile had (44px in both headers, 59px and 77px on
// the sign-in page). The cat fills about nine tenths of its box's height and
// two thirds of its width, so it reads at the size the tile did.
//
// A flex box, not inline-flex: inline-flex sits on its parent's text baseline
// and leaves a descender's gap under it, which put the tile 3px above the
// header's centre line.
//
// The mark is decorative (alt=""); the wordmark carries the accessible name.

import React from 'react';
import markUrl from '../assets/fendi-mark.png';
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
