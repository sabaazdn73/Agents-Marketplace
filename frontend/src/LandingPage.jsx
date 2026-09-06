// LandingPage.jsx
//
// The entry point for the bare domain. A character, the name, and a way in.
//
// It exists to cover the second or two /api/agents takes, so the request
// starts the moment this renders rather than when someone clicks through
// (see agentsPrefetch.js). If it waited for the click it would add to the
// wait instead of hiding it.
//
// Deliberately holds nothing else. No agent counts, no chain stats, no
// feature grid. Everything it could show, the marketplace already shows
// better and with live data. This is a pleasant few seconds, not a second
// dashboard.
//
// Shown for "/" only. Deep links (/market, /agent/{id}, /docs, ...) go
// straight where they were going; this is an entry point, not a gate.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowRight } from 'lucide-react';
import { startAgentsPrefetch } from './agentsPrefetch';

/** Whether this session has already been through the landing page.
 *
 * Module-level and in-memory on purpose. localStorage is not usable here,
 * and this needs no persistence to do its job: it stops the page
 * reappearing every time someone navigates back to "/" within a session,
 * which is the case that would actually annoy. A full reload shows it
 * again, which is a fair trade for depending on no storage at all. */
let seenThisSession = false;
export function hasSeenLanding() { return seenThisSession; }
export function markLandingSeen() { seenThisSession = true; }

const EYE = { lx: 78, rx: 122, cy: 96, r: 15, pupil: 6.5 };

export default function LandingPage({ onEnter }) {
  const wrapRef = useRef(null);
  // Pupil offset in SVG units, -1..1 on each axis before scaling.
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);

  // The whole reason this page exists: the agent list starts loading now,
  // so the seconds spent here are the same seconds it was fetching.
  useEffect(() => {
    startAgentsPrefetch(`${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}/api/agents`);
  }, []);

  const aimAt = useCallback((clientX, clientY) => {
    if (reduced.current) return;
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height * 0.42;   // roughly where the eyes sit
    const dx = (clientX - cx) / Math.max(box.width, 260);
    const dy = (clientY - cy) / Math.max(box.height, 260);
    const clamp = (n) => Math.max(-1, Math.min(1, n * 2));
    setGaze({ x: clamp(dx), y: clamp(dy) });
  }, []);

  // Pointer tracking covers a mouse. Touch devices have no cursor, so a
  // tap aims the eyes at wherever was tapped; between taps the idle drift
  // below keeps the character from staring blankly.
  useEffect(() => {
    if (reduced.current) return undefined;
    const onMove = (e) => aimAt(e.clientX, e.clientY);
    const onTouch = (e) => {
      const t = e.touches?.[0];
      if (t) aimAt(t.clientX, t.clientY);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('touchstart', onTouch);
    };
  }, [aimAt]);

  // Idle drift: only runs when nothing is pointing at it, so a device
  // without a cursor still gets something alive to look at.
  useEffect(() => {
    if (reduced.current) return undefined;
    const hasCursor = window.matchMedia?.('(hover: hover)').matches ?? true;
    if (hasCursor) return undefined;
    let t = 0;
    const id = setInterval(() => {
      t += 1;
      setGaze({ x: Math.sin(t / 3) * 0.5, y: Math.cos(t / 4) * 0.3 });
    }, 900);
    return () => clearInterval(id);
  }, []);

  // A blink now and then. Cheap, and does most of the work of making the
  // character feel present rather than drawn.
  useEffect(() => {
    if (reduced.current) return undefined;
    let timer;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
        schedule();
      }, 2600 + Math.random() * 3600);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  const enter = () => { markLandingSeen(); onEnter(); };

  // Enter/Space/Escape all go through, so nobody is stuck here without a
  // pointer, and the page never becomes something to get past.
  useEffect(() => {
    const onKey = (e) => {
      if (['Enter', ' ', 'Escape'].includes(e.key)) { e.preventDefault(); enter(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const px = gaze.x * EYE.pupil * 0.8;
  const py = gaze.y * EYE.pupil * 0.8;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F4F5F8] dark:bg-[#0F172A] text-gray-900 dark:text-white px-6">
      <div ref={wrapRef} className="flex flex-col items-center">
        <svg
          viewBox="0 0 200 190" width="188" height="179" aria-hidden="true"
          className="mb-7 drop-shadow-[0_10px_30px_rgba(79,70,229,0.18)]"
        >
          <defs>
            <linearGradient id="tnega-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366F1" />
              <stop offset="100%" stopColor="#4338CA" />
            </linearGradient>
          </defs>
          {/* One rounded shape with a slight lean, rather than a detailed
              figure. Personality comes from the eyes, not the outline. */}
          <rect x="24" y="26" width="152" height="140" rx="46" fill="url(#tnega-body)" />
          <rect x="92" y="6" width="16" height="26" rx="8" fill="#4338CA" />
          <circle cx="100" cy="8" r="7" fill="#A5B4FC" />

          {[EYE.lx, EYE.rx].map((cx) => (
            <g key={cx}>
              <ellipse
                cx={cx} cy={EYE.cy} rx={EYE.r} ry={blink ? 1.6 : EYE.r}
                fill="#FFFFFF"
                style={{ transition: 'ry 110ms ease' }}
              />
              {!blink && (
                <circle
                  cx={cx + px} cy={EYE.cy + py} r={EYE.pupil} fill="#1E1B4B"
                  style={{ transition: 'cx 160ms ease-out, cy 160ms ease-out' }}
                />
              )}
            </g>
          ))}
          {/* Mouth: a small curve, no expression to interpret. */}
          <path d="M86 128 Q100 138 114 128" stroke="#C7D2FE" strokeWidth="5" strokeLinecap="round" fill="none" />
        </svg>

        <h1 className="text-4xl font-bold tracking-tight mb-2">Tnega</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8 text-center max-w-xs">
          Hire AI agents on BNB Chain. Every job and payment settles on-chain.
        </p>

        <button
          onClick={enter}
          autoFocus
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-lg shadow-indigo-500/25 transition-colors"
        >
          Browse agents <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
