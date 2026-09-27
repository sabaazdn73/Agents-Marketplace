// shell/MobileWelcome.jsx
//
// The first screen on a phone, and in the installed app on a phone: Fendi,
// facing straight ahead, on the navy blue of the app icon, and nothing else
// (owner, 2026-09-27). A tap anywhere opens the app; so does waiting five
// seconds. Shown once per browser session (sessionStorage, key
// `tnega_welcomed`, listed on the privacy page), never on desktop.
//
// It is an overlay over the app, not a page in its place: the page under it
// renders and loads as usual, so a shared link opens where it points once the
// welcome goes, and nothing the page reads is delayed. Search engine crawlers
// are not shown it (a user-agent check), because a screen covering the
// content is what their mobile rendering would otherwise index.
//
// fendi-front.webp is the owner's Fendi-front.png, cropped to the cat and his
// shadow and scaled to 640px wide (the largest box drawn is about 300px, at
// 2x), re-encoded without its metadata. The background is the app icon's
// radial navy (#3B6FE0 to #081334), the same in the light and dark themes.

import React, { useEffect, useRef, useState } from 'react';
import frontUrl from '../assets/fendi-front.webp';

const KEY = 'tnega_welcomed';
const CRAWLER = /bot|crawler|spider|crawling|google-inspectiontool|lighthouse|facebookexternalhit|slurp/i;
const AUTO_MS = 5000;

function seen() {
  try { return window.sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

function remember() {
  try { window.sessionStorage.setItem(KEY, '1'); } catch { /* storage blocked: shown again next load */ }
}

/** Whether the welcome should open now: a phone-width layout (App decides
 *  that), not yet seen this session, and not a crawler. */
export function shouldWelcome(isMobile) {
  if (!isMobile || typeof window === 'undefined') return false;
  if (CRAWLER.test(navigator.userAgent || '')) return false;
  return !seen();
}

export default function MobileWelcome({ onEnter }) {
  const screen = useRef(null);
  const done = useRef(false);
  const [leaving, setLeaving] = useState(false);

  const open = () => {
    if (done.current) return;
    done.current = true;
    remember();
    setLeaving(true);
    // Matches the fade below; reduced motion skips the fade itself.
    window.setTimeout(onEnter, 200);
  };

  // The page under it does not scroll while it is open; the screen takes
  // focus, so Enter or Space on a keyboard opens the app too; after five
  // seconds it opens on its own.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    screen.current?.focus();
    const t = window.setTimeout(open, AUTO_MS);
    return () => { window.clearTimeout(t); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      ref={screen}
      type="button"
      onClick={open}
      aria-label="Tnega. Tap to open the app; it opens by itself after five seconds."
      className={`fixed inset-0 z-[100] w-full h-full flex items-center justify-center outline-none cursor-pointer transition-opacity duration-200 motion-reduce:transition-none ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'radial-gradient(120% 90% at 50% 30%, #3B6FE0 0%, #1E3F9A 38%, #0C1C4F 72%, #081334 100%)' }}
    >
      <img
        src={frontUrl}
        alt=""
        width={640}
        height={966}
        className="w-[64vw] max-w-[300px] h-auto select-none pointer-events-none"
        draggable="false"
      />
    </button>
  );
}
