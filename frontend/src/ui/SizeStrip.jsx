// ui/SizeStrip.jsx
//
// The row of measured sizes ($100 to $250k) on the stock page, a basket
// page and the builder, in both apps. On a narrow screen the row is wider
// than the page, so it scrolls sideways: the chosen size is scrolled into
// view whenever it changes (and on first draw, so a link opening at $250k
// shows $250k), and a fade with a chevron marks each edge that has more
// sizes past it. The page itself never scrolls sideways.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Pills } from './primitives';

const label = (s) => (s >= 1000 ? `$${s / 1000}k` : `$${s}`);

// `onSurface` for a strip inside a card, so the fade matches the card.
export default function SizeStrip({ stops, value, onChange, ariaLabel = 'Order size', className = '', onSurface = false }) {
  const box = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = box.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  // Scroll only the strip, never the page: set scrollLeft rather than
  // calling scrollIntoView.
  useLayoutEffect(() => {
    const el = box.current;
    const on = el?.querySelector('[aria-selected="true"]');
    if (el && on) {
      const target = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
      el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
    }
    measure();
  }, [value, stops?.length]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const fade = 'pointer-events-none absolute inset-y-0 w-8 flex items-center text-muted';
  return (
    <div className={`relative ${className}`}>
      <div ref={box} onScroll={measure} className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Pills label={ariaLabel} value={value} onChange={onChange} options={stops.map((s) => ({ id: s, label: label(s) }))} />
      </div>
      {edges.left && <span aria-hidden="true" className={`${fade} left-0 justify-start bg-gradient-to-r ${onSurface ? 'from-surface' : 'from-page'} to-transparent`}><ChevronLeft size={14} /></span>}
      {edges.right && <span aria-hidden="true" className={`${fade} right-0 justify-end bg-gradient-to-l ${onSurface ? 'from-surface' : 'from-page'} to-transparent`}><ChevronRight size={14} /></span>}
      {(edges.left || edges.right) && <span className="sr-only">More sizes: scroll the row sideways.</span>}
    </div>
  );
}
