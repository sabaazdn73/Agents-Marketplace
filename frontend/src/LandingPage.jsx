// LandingPage.jsx
//
// The Home page. Nothing else is on it.
//
// It used to be a sprite composition: seven flat PNG agents, each cut into
// a torso and two legs with clip-path, walking in from alternating sides on
// a floor line, rising into place, then settling into a float while network
// lines drew between them. Roughly 150 lines of Web Animations calls,
// per-agent timers and a hand-built SVG graph, all to describe a group of
// agents gathering. Its seven PNGs, its standalone source page and 61 lines
// of CSS went with it on 2026-09-11; git history has them if ever needed.
//
// That is now one rendered clip, public/agent-hero/multiagents.mp4: the
// same idea, the same claymation world as the sidebar art and the link
// preview banner, done properly instead of approximated with sprites. The
// animation machinery is gone with it, along with the per-agent timers that
// had to be torn down on unmount so a tab switch mid-walk could not leave
// callbacks firing at a removed DOM.
//
// The clip is 1280x720 h264, ten seconds, and it loops, because a hero that
// plays once and stops reads as broken rather than finished.
//
// It carries a real audio track (AAC stereo, mean -32dB, peak -15.5dB), and
// it starts MUTED anyway. That is not a preference: Chrome, Safari and
// Firefox all refuse to autoplay audible media until the user has interacted
// with the page, and a rejected play() would leave the hero frozen on its
// poster. So the video autoplays silent and a speaker control offers the
// sound, which is the only arrangement that gets both a moving hero and
// audio that can actually be heard. The choice is remembered per viewer, so
// someone who turned it on does not have to keep doing it.
//
// It plays on a phone too. It deliberately did not: App.jsx passed
// animate={!isMobile} to spare a mobile connection 3.5MB, which left the
// poster standing in. That was the wrong trade once the poster was the only
// thing a phone ever saw, and it is the whole video or nothing -- so it is
// the whole video. `animate` survives as an explicit override and as the
// hook for prefers-reduced-motion, where a looping clip is exactly what
// somebody has asked not to be shown.
//
// Kept from the original design: the copy, the "Explore Tnega" link wired
// to the marketplace tab rather than an href="#", and the plain "Skip to
// marketplace" link underneath as a backstop that works even if the click
// handler never runs.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import './agentHero.css';

const HERO_VIDEO = '/agent-hero/multiagents.mp4';
// A frame taken from the clip itself, so the still and the motion are the
// same picture. This used to point at the old animation's stage backdrop,
// which meant a phone -- where autoplay was switched off -- showed the
// artwork of the animation that had just been removed, and never the video.
const HERO_POSTER = '/agent-hero/poster.jpg';
const SOUND_KEY = 'tnega_hero_sound';

/** Reading localStorage throws outright in some contexts (Safari private
 *  mode, site data blocked), so a failed read must mean "muted", not a
 *  crashed Home page. */
function storedSoundPref() {
  try { return localStorage.getItem(SOUND_KEY) === 'on'; } catch { return false; }
}

export default function LandingPage({ onEnterMarketplace, animate = true }) {
  const videoRef = useRef(null);
  // Honoured as a real preference, not an inference from screen width.
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const shouldPlay = animate && !reduceMotion;
  const [soundOn, setSoundOn] = useState(storedSoundPref);

  const toggleSound = useCallback(() => {
    const v = videoRef.current;
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* not fatal */ }
    if (!v) return;
    v.muted = !next;
    if (!next) return;
    // Turning sound on normally counts as a user gesture, so this play() is
    // permitted even where the earlier silent autoplay was refused. Where it
    // is NOT -- a stricter policy, or a click the browser does not treat as
    // trusted -- unmuting turns the clip into audible media and the browser
    // pauses it. Caught in testing: the video stopped dead on unmute. Losing
    // the motion is worse than losing the sound, so fall back to muted and
    // keep it running rather than leaving a frozen hero.
    v.play().catch(() => {
      v.muted = true;
      setSoundOn(false);
      try { localStorage.setItem(SOUND_KEY, 'off'); } catch { /* not fatal */ }
      v.play().catch(() => {});
    });
  }, [soundOn]);

  // Autoplay is set through the DOM rather than the autoPlay attribute:
  // React will not re-run an attribute-driven autoplay when `animate`
  // flips, and a play() call can reject (a browser policy, a tab opened in
  // the background) which must not surface as an unhandled rejection.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (shouldPlay) {
      v.play()
        // Only restore a remembered sound preference once silent playback
        // is actually running. Setting muted=false before that turns the
        // clip into audible media and gets the autoplay refused entirely.
        .then(() => { if (soundOn) v.muted = false; })
        .catch(() => { /* blocked by policy; the poster stands in */ });
    } else {
      v.pause();
    }
    // soundOn is deliberately not a dependency: toggleSound handles changes
    // directly, and re-running this on every toggle would restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay]);

  return (
    <div className="agent-hero">
      <section className="hero">
        <div className="stage">
          <video
            ref={videoRef}
            className="motion"
            src={HERO_VIDEO}
            poster={HERO_POSTER}
            // Muted at mount whatever the stored preference: autoplay is only
            // permitted for silent media, so the sound is restored below
            // once we know playback actually started.
            muted
            loop
            playsInline
            preload={shouldPlay ? 'auto' : 'metadata'}
            aria-hidden="true"
          />
          <button
            type="button"
            className="sound"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? 'Mute the background video' : 'Play sound with the background video'}
            title={soundOn ? 'Mute' : 'Sound'}
          >
            {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>

        <div className="copy">
          {/* "one verifiable network" is a claim about identity, not about a
              single chain: ERC-8004's registry sits at the same address on
              every chain here, so one agent identity resolves everywhere.
              That was ambiguous while the site was BNB-only and the subtitle
              said no more than "across chains", so both now name the chains
              and separate what you can browse from what you can hire. */}
          <h1>Autonomous agents, one verifiable network across chains</h1>
          <p>Discover and verify agents on BNB Chain, Ethereum, Arbitrum, Robinhood Chain and Monad, and hire them on-chain.</p>
          <a
            href="/market"
            onClick={(e) => { e.preventDefault(); onEnterMarketplace?.(); }}
          >
            Explore Tnega
          </a>
        </div>

        {/* The sidebar is hidden while this page shows, so "Explore Tnega"
            is the intended exit and this is the backstop. */}
        <a className="skip" href="/market">Skip to marketplace</a>
      </section>
    </div>
  );
}
