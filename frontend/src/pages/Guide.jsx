// Guide.jsx
//
// /guide, "Read before you start". The product pages are kept short (a
// title, the figures, one muted line, details behind an (i)); everything
// that explains them is here, one section per topic, from the files in
// guide/ (guide/index.js lists them in order and skips any that is missing).
// Each page's "How this works" link opens its section, /guide#<id>.
//
// One component for both apps: on web the contents sit in a column on the
// left and stay in view; on a phone they are a row of links above the
// sections.

import React, { useEffect } from 'react';
import { GUIDE_SECTIONS } from '../guide/index';
import { Card } from '../ui/primitives';
import { PageFrame } from './PageFrame';

function scrollToHash(smooth) {
  let id = '';
  try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { id = ''; }
  if (!id) return;
  // After the sections have rendered.
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
}

function Contents({ onJump, mobile }) {
  if (mobile) {
    return (
      <nav aria-label="Sections" className="-mx-4 px-4 overflow-x-auto">
        <ul className="flex gap-2 w-max">
          {GUIDE_SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} onClick={(e) => onJump(e, s.id)}
                className="inline-flex items-center h-8 px-3 rounded-full border border-line text-[12px] font-medium text-fg whitespace-nowrap hover:bg-inset">
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    );
  }
  return (
    <nav aria-label="Sections" className="sticky top-24">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted mb-2">Sections</div>
      <ul className="space-y-0.5">
        {GUIDE_SECTIONS.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`} onClick={(e) => onJump(e, s.id)}
              className="block px-2 py-1.5 rounded text-[13px] text-muted hover:text-fg hover:bg-inset">
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({ s }) {
  const { Body } = s;
  return (
    <Card id={s.id} className="scroll-mt-24">
      <h2 className="text-[18px] font-semibold text-fg">{s.title}</h2>
      {s.summary && <p className="mt-1 text-[13px] text-muted">{s.summary}</p>}
      <div className="mt-2 divide-y divide-line"><Body /></div>
    </Card>
  );
}

export default function Guide({ layout = 'web', path = '/guide' }) {
  const mobile = layout === 'mobile';
  // Open at the section the address names, and follow it when a page's
  // "How this works" link changes it.
  useEffect(() => { scrollToHash(false); }, [path]);
  useEffect(() => {
    const onHash = () => scrollToHash(true);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const jump = (e, id) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    try { window.history.replaceState(window.history.state, '', `/guide#${id}`); } catch { /* not fatal */ }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sub = 'What each part of Tnega shows, how the figures are measured and what is checked before you sign.';
  const sections = GUIDE_SECTIONS.map((s) => <Section key={s.id} s={s} />);
  return (
    <PageFrame layout={layout} title="Read before you start" sub={sub}>
      {mobile ? (
        <>
          <Contents onJump={jump} mobile />
          {sections}
        </>
      ) : (
        <div className="grid grid-cols-[200px_minmax(0,1fr)] gap-8 items-start">
          <Contents onJump={jump} />
          <div className="space-y-6 min-w-0 max-w-[860px]">{sections}</div>
        </div>
      )}
    </PageFrame>
  );
}
