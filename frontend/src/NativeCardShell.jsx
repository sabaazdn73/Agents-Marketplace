// NativeCardShell.jsx
//
// The one frame every DeFi category card renders inside, so the four look
// like one set rather than four things built at different times.
//
// It has two modes because the same card is used in two places. Standalone
// it draws its own border, icon, title and blurb. Inside the accordion the
// header is already drawn by the accordion, so the card renders only its
// body and the blurb.
//
// The reason this exists rather than each card carrying its own chrome: the
// four categories are judged as a set, and a card that styles itself
// slightly differently reads as the one that was added late.

import React from 'react';

export default function NativeCardShell({
  bare = false,
  icon: Icon,
  title,
  blurb,
  badge = 'Live',
  accent,
  surface,
  mutedBorder,
  children,
}) {
  if (bare) {
    return (
      <div>
        {blurb && <p className="text-xs opacity-60 mb-4 leading-relaxed">{blurb}</p>}
        {children}
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border p-5 ${mutedBorder}`} style={{ background: surface }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <div className="p-1.5 rounded-lg" style={{ background: `${accent}1a` }}>
              <Icon size={16} style={{ color: accent }} />
            </div>
          )}
          <span className="font-bold text-sm">{title}</span>
        </div>
        {badge && (
          <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            {badge}
          </span>
        )}
      </div>
      {blurb && <p className="text-xs opacity-60 mb-4 leading-relaxed">{blurb}</p>}
      {children}
    </div>
  );
}
