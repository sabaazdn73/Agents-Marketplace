// PageFrame.jsx
//
// What every product page shares: the title row. Shared by the product
// pages, and through them by both apps, so the heading cannot differ between
// web and mobile. There is no "being built" state: a page shows what its
// reads return, and a section with nothing to show does not render.
//
// `layout` is 'web' or 'mobile' and changes spacing only. The mobile shell
// has no side gutter of its own, so the page brings one.

import React from 'react';

export function PageFrame({ layout = 'web', title, sub = null, right = null, children }) {
  return (
    <div className={layout === 'mobile' ? 'px-4 pt-5 pb-6' : 'w-full'}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-fg">{title}</h1>
          {sub && <p className="mt-1 text-[14px] text-muted">{sub}</p>}
        </div>
        {right}
      </div>
      <div className={layout === 'mobile' ? 'space-y-4' : 'space-y-6'}>{children}</div>
    </div>
  );
}
