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

import React, { useState } from 'react';
import { PARTNERS } from './partners';

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

export default function PartnerMarquee({ items = PARTNERS }) {
  if (!items.length) return null;

  return (
    <section className="partner-marquee" aria-label="Partners and tools this project uses">
      <div className="partner-marquee__viewport">
        <div className="partner-marquee__track">
          <div className="partner-marquee__group">
            {items.map((p) => <PartnerLogo key={p.name} p={p} />)}
          </div>
          {/* Second copy makes the loop seamless. Hidden from screen
              readers so each name is announced once. */}
          <div className="partner-marquee__group" aria-hidden="true">
            {items.map((p) => <PartnerLogo key={`dup-${p.name}`} p={p} />)}
          </div>
        </div>
      </div>
    </section>
  );
}
