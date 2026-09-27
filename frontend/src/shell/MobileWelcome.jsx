// shell/MobileWelcome.jsx
//
// The first screen on a phone, and in the installed app on a phone: Fendi
// waving, "Wealth, borderless." and one Enter button (owner, 2026-09-27).
// Shown once per browser session (sessionStorage, key `tnega_welcomed`,
// listed on the privacy page), never on desktop.
//
// It is an overlay over the app, not a page in its place: the page under it
// renders and loads as usual, so a shared link opens where it points once
// Enter is pressed, and nothing the page reads is delayed. Search engine
// crawlers are not shown it (a user-agent check), because a screen covering
// the content is what their mobile rendering would otherwise index.
//
// fendi-wave.webp is the owner's Fendi-wave.png, cropped to the cat and his
// shadow and scaled to 640px wide (the largest box drawn is about 300px, at
// 2x), re-encoded without its metadata.

import React, { useEffect, useRef, useState } from 'react';
import waveUrl from '../assets/fendi-wave.webp';
import Wordmark from './Wordmark';

const KEY = 'tnega_welcomed';
const CRAWLER = /bot|crawler|spider|crawling|google-inspectiontool|lighthouse|facebookexternalhit|slurp/i;

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
  const button = useRef(null);
  const [leaving, setLeaving] = useState(false);

  // The page under it does not scroll while it is open, and the one control
  // takes focus, so a keyboard or screen-reader user starts on it.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    button.current?.focus();
    return () => { document.body.style.overflow = prev; };
  }, []);

  const enter = () => {
    remember();
    setLeaving(true);
    // Matches the fade below; reduced motion skips it (see index.css).
    window.setTimeout(onEnter, 180);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className={`fixed inset-0 z-[100] bg-page text-fg flex flex-col items-center justify-between px-6 transition-opacity duration-200 motion-reduce:transition-none ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ paddingTop: 'max(env(safe-area-inset-top), 32px)', paddingBottom: 'max(env(safe-area-inset-bottom), 28px)' }}
    >
      <Wordmark className="text-[22px]" />
      <div className="flex flex-col items-center text-center">
        <img
          src={waveUrl}
          alt="Fendi, the Tnega cat, waving"
          width={640}
          height={932}
          className="w-[62vw] max-w-[300px] h-auto select-none"
          draggable="false"
        />
        <h1 id="welcome-title" className="mt-6 text-[40px] leading-[1.04] font-bold tracking-[-0.03em]">
          Wealth,<br />borderless.
        </h1>
      </div>
      <button
        ref={button}
        type="button"
        onClick={enter}
        className="w-full max-w-[420px] h-12 rounded bg-accent text-accent-fg text-[15px] font-semibold hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
      >
        Enter
      </button>
    </div>
  );
}
