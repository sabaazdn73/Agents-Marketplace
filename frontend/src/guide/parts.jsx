// guide/parts.jsx
//
// The pieces every guide section is written with, so the sections read
// alike: Q is one question and its answer, Terms a list of terms and what
// each means, P a paragraph. Not a section itself (guide/index.js reads only
// the files it lists).

import React from 'react';

/** One question, and the answer under it. */
export function Q({ q, children }) {
  return (
    <div className="py-3">
      <h4 className="text-[14px] font-semibold text-fg">{q}</h4>
      <div className="mt-1 text-[13px] leading-relaxed text-muted space-y-2">{children}</div>
    </div>
  );
}

/** Terms and what each means: [[term, meaning], ...]. */
export function Terms({ items }) {
  return (
    <dl className="py-3 grid grid-cols-1 sm:grid-cols-[minmax(0,180px)_1fr] gap-x-4 gap-y-2 text-[13px] leading-relaxed">
      {items.map(([t, d]) => (
        <React.Fragment key={t}>
          <dt className="font-semibold text-fg">{t}</dt>
          <dd className="text-muted min-w-0">{d}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A plain paragraph. */
export function P({ children }) {
  return <p className="py-1.5 text-[13px] leading-relaxed text-muted">{children}</p>;
}

/** A link to another section of the guide, by its id. */
export function See({ id, children }) {
  return <a href={`#${id}`} className="text-fg underline underline-offset-2 hover:opacity-80">{children}</a>;
}
