// guide/GuideLink.jsx
//
// "How this works": the small link each product page carries to its own
// section of "Read before you start" (/guide#<id>). A real anchor, so a
// middle click or Cmd-click opens it in a new tab; a plain click goes
// through the app's navigate when the page has one.

import React from 'react';
import { BookOpen } from 'lucide-react';

/** The path of one guide section. */
export const guidePath = (id) => `/guide${id ? `#${id}` : ''}`;

// `newTab` opens the guide in a new tab (the signing page, where leaving
// would lose a quote); `ariaLabel` tells two links with the same words apart.
export default function GuideLink({ id, onNavigate, label = 'How this works', className = '', newTab = false, ariaLabel }) {
  const href = guidePath(id);
  const go = (e) => {
    if (newTab || !onNavigate || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(href);
  };
  return (
    <a href={href} onClick={go} aria-label={ariaLabel} {...(newTab ? { target: '_blank', rel: 'noopener' } : {})}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line text-[12px] font-medium text-muted hover:text-fg hover:bg-inset whitespace-nowrap ${className}`}>
      <BookOpen size={13} aria-hidden="true" />{label}
    </a>
  );
}
