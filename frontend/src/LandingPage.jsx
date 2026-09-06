// LandingPage.jsx
//
// A tab, not a gate. "/" goes straight to the marketplace as it always
// did; this is a destination someone chooses from the nav.
//
// WHY THE MOVEMENT IS PARALLAX AND NOT EYE TRACKING
// -------------------------------------------------
// The artwork is a flat 1254x1254 PNG. It holds seven robots on a lit
// podium between two neon arches, connected by a network of glowing lines,
// with city towers and floating UI panels behind them. Their eyes are
// glowing shapes rendered into the image, complete with their own lighting
// and reflections, and each pair is a couple of dozen pixels across in the
// source. There is nothing to isolate and nothing to move: making the eyes
// follow a cursor would mean drawing fake eyes over real ones, at seven
// different scales and angles, and it would look worse than doing nothing.
//
// So the whole scene shifts instead. The image tilts and drifts a few
// degrees against the pointer, which reads as depth in a picture that
// already has strong perspective, and is honest about being one flat
// image.
//
// Deliberately holds nothing else: the artwork, the name, one way to the
// marketplace. No counts or stats, which the marketplace already shows
// with live data.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowRight } from 'lucide-react';

const MAX_TILT_DEG = 7;     // subtle; more than this reads as a gimmick
const MAX_SHIFT_PX = 10;

export default function LandingPage({ onEnterMarketplace }) {
  const frameRef = useRef(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, x: 0, y: 0 });
  const [loaded, setLoaded] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduced.current) setTilt({ rx: 0, ry: 0, x: 0, y: 0 });
  }, []);

  const aimAt = useCallback((clientX, clientY) => {
    if (reduced.current) return;
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return;
    // -1..1 from the centre of the artwork.
    const nx = Math.max(-1, Math.min(1, (clientX - (box.left + box.width / 2)) / (box.width / 2)));
    const ny = Math.max(-1, Math.min(1, (clientY - (box.top + box.height / 2)) / (box.height / 2)));
    setTilt({
      ry: nx * MAX_TILT_DEG,        // horizontal pointer turns it left/right
      rx: -ny * MAX_TILT_DEG,       // vertical pointer tips it up/down
      x: nx * MAX_SHIFT_PX,
      y: ny * MAX_SHIFT_PX,
    });
  }, []);

  useEffect(() => {
    if (reduced.current) return undefined;
    const onMove = (e) => aimAt(e.clientX, e.clientY);
    // A touch device has no cursor, so a tap tilts the scene toward the
    // tap point. Between taps the drift below keeps it alive.
    const onTouch = (e) => {
      const t = e.touches?.[0];
      if (t) aimAt(t.clientX, t.clientY);
    };
    const onLeave = () => setTilt({ rx: 0, ry: 0, x: 0, y: 0 });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('pointerleave', onLeave);
    };
  }, [aimAt]);

  // Slow drift on devices that report no hover, so a phone gets motion
  // rather than a static picture waiting for a cursor that never arrives.
  useEffect(() => {
    if (reduced.current) return undefined;
    const hasCursor = window.matchMedia?.('(hover: hover)').matches ?? true;
    if (hasCursor) return undefined;
    let t = 0;
    const id = setInterval(() => {
      t += 1;
      setTilt({
        ry: Math.sin(t / 5) * (MAX_TILT_DEG * 0.55),
        rx: Math.cos(t / 7) * (MAX_TILT_DEG * 0.4),
        x: Math.sin(t / 5) * (MAX_SHIFT_PX * 0.5),
        y: Math.cos(t / 7) * (MAX_SHIFT_PX * 0.4),
      });
    }, 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center text-center py-6">
      <div
        ref={frameRef}
        className="w-full max-w-[440px] aspect-square rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-xl mb-8"
        style={{ perspective: '1100px' }}
      >
      <picture>
        {/* WebP first, the original PNG as fallback. The source is a
            2.14MB 1254px PNG and this page is meant to feel quick; a 900px
            WebP is 0.12MB, 94% smaller, and 900px still covers the 440px
            frame on a 2x display. agent.png is left untouched as the
            fallback and the master. */}
        <source srcSet="/agent.webp" type="image/webp" />
        <img
          src="/agent.png"
          alt="Tnega agents on a lit platform, linked by a network of connections"
          width={1254}
          height={1254}
          onLoad={() => setLoaded(true)}
          className="w-full h-full object-cover will-change-transform"
          style={{
            transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) translate3d(${tilt.x}px, ${tilt.y}px, 0) scale(1.06)`,
            // scale(1.06) hides the edges the tilt would otherwise expose.
            transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 500ms ease',
            opacity: loaded ? 1 : 0,
          }}
        />
      </picture>
      </div>

      <h1 className="text-3xl font-bold tracking-tight mb-2">Tnega</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-7 max-w-sm">
        Hire AI agents on BNB Chain. Every job and payment settles on-chain.
      </p>

      <button
        onClick={onEnterMarketplace}
        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-lg shadow-indigo-500/25 transition-colors"
      >
        Browse agents <ArrowRight size={16} />
      </button>
    </div>
  );
}
