// InfoTooltip.jsx
//
// Real, small on-demand info popover — click-to-toggle (not hover-only, so
// it works the same on a touch device as a mouse), closes on outside
// click/Escape. Built to de-clutter the marketplace's top stats/filter area
// (2026-08-28): several genuinely useful explanations (the diversity-limit
// note, the service-health legend, the verification-tier legend) used to
// each render as a permanent, always-visible paragraph box stacked one
// after another — real information, but competing for attention with
// everything else in that area regardless of whether anyone needed it right
// now. This moves that same real content behind a small (i) a reader
// chooses to open, without cutting anything the text actually said.
//
// Shared by web + mobile so the interaction can't drift between them.

import React, { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

export default function InfoTooltip({ label, children, align = 'left', size = 14, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocEvent = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocEvent);
    document.addEventListener('touchstart', onDocEvent);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocEvent);
      document.removeEventListener('touchstart', onDocEvent);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-expanded={open}
        aria-label={label ? `More info: ${label}` : 'More info'}
        className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
      >
        {label && <span className="text-[11px] font-medium">{label}</span>}
        <Info size={size} />
      </button>
      {open && (
        <div
          className={`absolute z-20 top-full mt-2 w-72 max-w-[80vw] p-3 rounded-xl border shadow-lg text-[11px] leading-relaxed
            bg-white border-gray-200 text-gray-600 dark:bg-[#1E293B] dark:border-gray-700 dark:text-gray-300
            ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </div>
      )}
    </span>
  );
}
