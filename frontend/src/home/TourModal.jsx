// home/TourModal.jsx
//
// "Watch the tour": the launch film in a modal. It never plays by itself:
// preload="none", no autoplay and no muted autoplay; the visitor presses
// play. Esc and the close button shut it, focus stays inside while it is
// open and returns to the button that opened it, and closing pauses the film.

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function TourModal({ src, poster, onClose }) {
  const box = useRef(null);
  const video = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    box.current?.querySelector('button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Tab') {
        const f = [...box.current.querySelectorAll('button, video')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const v = video.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      try { v?.pause(); } catch { /* not fatal */ }
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-label="The Tnega tour" className="w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end mb-2">
          <button type="button" onClick={onClose} aria-label="Close the tour" className="w-9 h-9 rounded flex items-center justify-center text-white hover:bg-white/10">
            <X size={18} />
          </button>
        </div>
        <video ref={video} className="w-full rounded bg-black aspect-video" src={src} poster={poster || undefined} controls preload="none" playsInline />
      </div>
    </div>
  );
}
