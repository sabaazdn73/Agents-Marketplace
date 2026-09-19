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

const PRIMARY_PARTNERS = PARTNERS.filter(
  (p) => PRIMARY.has(p.kind) && !NOT_IN_STRIP.has(p.name),
);

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

export default function PartnerMarquee({ items = PRIMARY_PARTNERS }) {
  const viewportRef = useRef(null);
  const groupRef = useRef(null);

  // SCROLL ONLY WHEN THERE IS MORE THAN FITS.
  //
  // The loop is two identical halves translated by -50%, which reads as one
  // continuous strip and, by construction, shows every logo again each time it
  // comes round. That is what a marquee is, and it was right when the strip
  // carried nine marks and overflowed every screen.
  //
  // Three were removed on 2026-09-19 and six no longer fill a desktop width, so
  // both halves were on screen at once and every logo was visibly present
  // twice. Repeating the list to pad the width was tried first and is worse: it
  // duplicates the names inside a single pass, so they still appear twice and
  // now do so with no loop to explain it.
  //
  // There is nothing to scroll when everything already fits, so it does not.
  // Below the width where the list overflows, the loop is exactly as it was.
  const [scroll, setScroll] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const group = groupRef.current;
    if (!viewport || !group) return undefined;

    const measure = () => {
      // MEASURED FROM THE ITEMS, NOT FROM THE GROUP.
      //
      // Static mode stretches the group to the full width and spaces the items
      // out, so once it is on, group.scrollWidth equals the container and the
      // comparison can never become true again: the strip latched static and
      // stopped scrolling at any width. Found by narrowing the container to
      // 420px and watching nothing happen.
      //
      // The items' own widths do not change with justify-content, so the
      // natural width is their sum plus the gaps between them. That is the same
      // number in both modes, which is what makes the switch reversible.
      const kids = Array.from(group.children);
      if (!kids.length) return;
      const styles = getComputedStyle(group);
      const gap = parseFloat(styles.columnGap || styles.gap) || 0;
      const onePass = kids.reduce((w, k) => w + k.offsetWidth, 0)
        + gap * (kids.length - 1);
      setScroll(onePass > viewport.clientWidth + 1);
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

  return (
    <section className="partner-marquee" aria-label="Partners and tools this project uses">
      <div
        className={`partner-marquee__viewport${scroll ? "" : " partner-marquee__viewport--static"}`}
        ref={viewportRef}
      >
        <div className={`partner-marquee__track${scroll ? "" : " partner-marquee__track--static"}`}>
          <div className="partner-marquee__group" ref={groupRef}>
            {items.map((p) => <PartnerLogo key={p.name} p={p} />)}
          </div>
          {/* The second copy exists only to make the loop seamless, so it is
              rendered only when there is a loop. Hidden from screen readers so
              each name is announced once. */}
          {scroll && (
            <div className="partner-marquee__group" aria-hidden="true">
              {items.map((p) => <PartnerLogo key={`dup-${p.name}`} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
