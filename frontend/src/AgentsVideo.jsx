// AgentsVideo.jsx
//
// The agents clip, public/agent-hero/multiagents.mp4, at the top of Explore
// agents (/market) on web and mobile. It was the hero of the old home page
// (LandingPage.jsx) and moved here on 2026-09-26, when "/" became the
// Dashboard and nothing agent-related stays on it.
//
// Same behaviour as it had there:
// - it plays silent and loops; browsers refuse to autoplay audible media,
//   so a speaker button offers the sound, and the choice is remembered;
// - with prefers-reduced-motion it does not play and the poster, a frame of
//   the clip, stands in;
// - a play() the browser refuses leaves the poster, never an error.
//
// One component for both apps; `layout` changes only its height.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';

const VIDEO = '/agent-hero/multiagents.mp4';
const POSTER = '/agent-hero/poster.jpg';
const SOUND_KEY = 'tnega_hero_sound';

/** localStorage can throw (Safari private mode, site data blocked); a failed
 *  read means muted. */
function storedSoundPref() {
  try { return localStorage.getItem(SOUND_KEY) === 'on'; } catch { return false; }
}

export default function AgentsVideo({ layout = 'web' }) {
  const ref = useRef(null);
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const shouldPlay = !reduceMotion;
  const [soundOn, setSoundOn] = useState(storedSoundPref);

  const toggleSound = useCallback(() => {
    const v = ref.current;
    const next = !soundOn;
    setSoundOn(next);
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* not fatal */ }
    if (!v) return;
    v.muted = !next;
    if (!next) return;
    // Unmuting can make the browser pause the clip as audible media. Losing
    // the motion is worse than losing the sound, so fall back to muted.
    v.play().catch(() => {
      v.muted = true;
      setSoundOn(false);
      try { localStorage.setItem(SOUND_KEY, 'off'); } catch { /* not fatal */ }
      v.play().catch(() => {});
    });
  }, [soundOn]);

  // Played through the DOM rather than the autoPlay attribute, so a refused
  // play() is caught, and the remembered sound is restored only once silent
  // playback is running.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (shouldPlay) {
      v.play()
        .then(() => { if (soundOn) v.muted = false; })
        .catch(() => { /* refused by policy; the poster stands in */ });
    } else {
      v.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldPlay]);

  const height = layout === 'mobile' ? 'max-h-[220px]' : 'max-h-[320px]';
  return (
    <section className="card overflow-hidden relative mb-4" aria-label="Agents, a short clip">
      <video
        ref={ref}
        className={`block w-full aspect-video ${height} object-cover bg-inset`}
        src={VIDEO}
        poster={POSTER}
        muted
        loop
        playsInline
        preload={shouldPlay ? 'auto' : 'metadata'}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={soundOn}
        aria-label={soundOn ? 'Mute the agents clip' : 'Play sound with the agents clip'}
        title={soundOn ? 'Mute' : 'Sound'}
        className="absolute right-3 bottom-3 w-9 h-9 rounded-full flex items-center justify-center bg-black/55 text-white hover:bg-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {soundOn ? <Volume2 size={16} aria-hidden="true" /> : <VolumeX size={16} aria-hidden="true" />}
      </button>
    </section>
  );
}
