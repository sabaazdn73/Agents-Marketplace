// PageFrame.jsx
//
// What every product page shares: the title row and, while a page has
// nothing live, the one sentence that says so. Shared by the five pages, and
// through them by both apps, so the wording cannot differ between web and
// mobile or between pages.
//
// `layout` is 'web' or 'mobile' and changes spacing only. The mobile shell
// has no side gutter of its own, so the page brings one.

import React from 'react';

export const BEING_BUILT = 'This page is being built. Nothing here is live yet.';

export function PageFrame({ layout = 'web', title, children }) {
  return (
    <div className={layout === 'mobile' ? 'px-4 pt-5 pb-6' : 'w-full'}>
      <h1 className="text-h1 font-bold text-fg mb-5">{title}</h1>
      <div className={layout === 'mobile' ? 'space-y-4' : 'space-y-6'}>{children}</div>
    </div>
  );
}

/** The empty state. A card with the sentence and, optionally, one more line
 *  saying what the page will hold, so a reader knows what they are waiting
 *  for without being shown anything that looks like data. */
export function BeingBuilt({ what = null, children = null }) {
  return (
    <section className="card p-4 md:p-6" aria-label="Status of this page">
      <p className="text-title font-semibold text-fg">{BEING_BUILT}</p>
      {what && <p className="text-body text-muted mt-1.5 max-w-2xl">{what}</p>}
      {children}
    </section>
  );
}
