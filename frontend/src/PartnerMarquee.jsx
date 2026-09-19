// PartnerMarquee.jsx
//
// The scrolling strip of partners and tools along the bottom of the site.
//
// HOW THE LOOP WORKS
// The list is rendered twice inside a track that is twice the width of the
// visible area. The track translates from 0 to -50%, which lands the second
// copy exactly where the first started, so the animation restarts with no
// visible jump. The duplicate is hidden from assistive technology with
// aria-hidden so the names are not announced twice.
//
// MOTION AND FOCUS
// Hovering pauses the scroll, and so does focusing a link inside it, which
// matters because a keyboard user cannot hover. Without that, tabbing into
// the strip would move the focused link out from under the cursor while
// the person is trying to read it.
//
// prefers-reduced-motion stops the animation completely rather than slowing
// it. The strip then sits still and scrolls horizontally like any other
// overflow container, so every logo is still reachable.
//
// Nothing here traps focus. The links are ordinary anchors in document
// order, tab moves through them and then out of the strip.
//
// A logo that fails to load hides itself and leaves the name, so a vendor
// changing their icon path degrades to a text credit instead of a broken
// image box.

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { PARTNERS, PARTNER_KIND } from './partners';

// The strip carries the primary marks only: the chains this project deploys
// to, and the events it was built for. Every other credit moved to the Sources
// line above it as text on 2026-09-18, because twenty-one logos in one strip
// compete with each other and with these, and a mark that competes with twenty
// others is not a mark anybody reads.
const PRIMARY = new Set([PARTNER_KIND.EVENT, PARTNER_KIND.CHAIN]);

// Kept out of the strip by name, 2026-09-19.
//
// Excluded here rather than deleted from partners.js because that file is the
// project's credit list and these three are still used: TermiX is the venue
// behind the Advantage Report, PancakeSwap and Altana are read by the running
// system. What changes is that they are not marks in the moving strip, which
// carries the chains this project deploys to and the events it was built for.
// Removing the rows instead would have dropped the credit as well as the logo.
const NOT_IN_STRIP = new Set(['Altana', 'PancakeSwap', 'TermiX']);

// THE CHAINS RUN TOGETHER, IN THE ORDER THE TABS ARE IN.
//
// They were scattered through the strip: BNB Chain early, Arbitrum and
// Robinhood in the middle, and the four added on 2026-09-19 at the end, so the
// chains the site covers read as unrelated credits rather than as one set.
//
// Ordered by name rather than by kind, because BNB Chain is in PARTNERS as an
// event, which it also is. Sorting on kind would have put it with the
// conferences and broken the run, and giving it a second entry under the chain
// heading would put the same name in the strip twice.
//
// The order is ChainViewTabs' own FALLBACK_TABS order, so the strip and the tab
// row name the chains in the same sequence. Anything not listed keeps its
// position in PARTNERS, after the chains.
const CHAIN_ORDER = [
  'Hyperliquid', 'BNB Chain', 'Ethereum', 'Solana',
  'Arbitrum', 'Robinhood Chain', 'Monad',
];

const PRIMARY_PARTNERS = PARTNERS
  .filter((p) => PRIMARY.has(p.kind) && !NOT_IN_STRIP.has(p.name))
  .sort((a, b) => {
    const ai = CHAIN_ORDER.indexOf(a.name);
    const bi = CHAIN_ORDER.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0;
  });

function PartnerLogo({ p }) {
  const [broken, setBroken] = useState(false);
  return (
    <a
      href={p.url}
      target="_blank"
      rel="noreferrer"
      className="partner-marquee__item"
      title={p.name}
    >
      {!broken && (
        <img
          src={p.logo}
          alt=""
          loading="lazy"
          className="partner-marquee__logo"
          onError={() => setBroken(true)}
        />
      )}
      <span className="partner-marquee__name">{p.name}</span>
    </a>
  );
}

// How much wider than the screen each half is made when the list is too short
// to fill it. Enough that the widest single mark cannot straddle the seam.
const SEAM_MARGIN_PX = 200;

export default function PartnerMarquee({ items = PRIMARY_PARTNERS }) {
  const viewportRef = useRef(null);
  const groupRef = useRef(null);

  // IT ALWAYS MOVES, AND NO LOGO IS EVER ON SCREEN TWICE.
  //
  // Those two want opposite things and the middle is a measurement.
  //
  // The loop is two identical halves translated by -50%, so the second half
  // lands where the first began and the motion never jumps. Seeing a logo twice
  // at once happens only when a half is NARROWER than the viewport, because
  // then both halves fit on screen together. Ten marks come to 1,223px against
  // a 1,363px viewport, so they did.
  //
  // Stopping the animation fixed the duplicate and lost the movement. Repeating
  // the list to pad the width kept the movement and put the duplicates inside a
  // single pass, which is worse. So instead each half is widened to exactly the
  // viewport width and the slack goes into the gaps: the strip runs
  // continuously, one half covers the screen, and the copy of any given logo is
  // always a full screen away from it.
  //
  // Measured rather than set in CSS. A percentage min-width inside a
  // max-content track is circular, and the item widths are the partner names,
  // which are not all the same length.
  const [fillWidth, setFillWidth] = useState(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!viewport || !group) return undefined;

    const measure = () => {
      const kids = Array.from(group.children);
      if (!kids.length) return;
      const styles = getComputedStyle(group);
      const gap = parseFloat(styles.columnGap || styles.gap) || 0;
      // The natural width of one pass, summed from the items so it does not
      // change when the group is stretched. Measuring group.scrollWidth here
      // would latch: once stretched it reports the container width forever.
      const onePass = kids.reduce((w, k) => w + k.offsetWidth, 0)
        + gap * (kids.length - 1);
      // A MARGIN, NOT EXACTLY THE VIEWPORT.
      //
      // At exactly the viewport width the two halves meet on screen and the
      // item sitting on that seam is visible at both edges at once: measured,
      // Solana appeared twice. Making a half wider than the screen guarantees a
      // full screen between any logo and its copy, so the seam falls where
      // there is nothing to double.
      const target = viewport.clientWidth + SEAM_MARGIN_PX;
      setFillWidth(onePass < target ? target : null);
    };

    measure();
    // The logos are lazy images, so a pass can be narrower at first paint than
    // it will be a moment later. A ResizeObserver catches that and the window
    // changing width.
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    ro.observe(group);
    return () => ro.disconnect();
  }, [items.length]);

  if (!items.length) return null;

  // Applied to BOTH halves, or they would be different widths and the -50%
  // translate would no longer land the second where the first began.
  const halfStyle = fillWidth
    ? { minWidth: `${fillWidth}px`, justifyContent: 'space-evenly', paddingRight: 0 }
    : undefined;

  return (
    <section className="partner-marquee" aria-label="Partners and tools this project uses">
      <div className="partner-marquee__viewport" ref={viewportRef}>
        <div className="partner-marquee__track">
          <div className="partner-marquee__group" ref={groupRef} style={halfStyle}>
            {items.map((p) => <PartnerLogo key={p.name} p={p} />)}
          </div>
          {/* Second half makes the loop seamless. Hidden from screen readers so
              each name is announced once. */}
          <div className="partner-marquee__group" aria-hidden="true" style={halfStyle}>
            {items.map((p) => <PartnerLogo key={`dup-${p.name}`} p={p} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
