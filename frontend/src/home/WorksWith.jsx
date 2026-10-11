// WorksWith.jsx
//
// "Works with the AI tools you already use": the assistants and editors that
// reach Tnega's MCP server, in one row under the home page's hero (the
// owner's reference: Agensi's skill pages, 2026-10-11). Which names appear,
// which carry a mark and why is connectMarks.js's (WORKS_WITH, MCP_CLIENTS);
// this file only draws them. A mark that fails to load leaves its name, as on
// /ai: the row is the claim and the picture is decoration. Nothing is
// recoloured or inverted; a vendor that publishes a light and a dark mark
// gets both, swapped by the theme.

import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { MCP_CLIENTS, WORKS_WITH } from '../connectMarks';

const CLIENT = Object.fromEntries(MCP_CLIENTS.map((c) => [c.name, c]));
const SIZE = 20;

function Item({ item }) {
  const [failed, setFailed] = useState(false);
  const client = CLIENT[item.clients[0]];
  const mark = item.showMark && client?.mark && !failed ? client : null;
  const title = item.note || item.clients.map((n) => CLIENT[n]?.support).filter(Boolean).join('. ');
  const img = (src, className) => (
    <img
      src={src}
      alt=""
      width={SIZE}
      height={SIZE}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: SIZE, height: SIZE }}
    />
  );
  return (
    <li className="inline-flex items-center gap-2 text-[14px] font-semibold text-fg" title={title}>
      {mark && img(mark.mark, mark.markDark ? 'dark:hidden' : '')}
      {mark?.markDark && img(mark.markDark, 'hidden dark:block')}
      <span className="whitespace-nowrap">{item.name}</span>
    </li>
  );
}

export default function WorksWith({ onOpen }) {
  const open = (e) => {
    if (!onOpen || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen();
  };
  return (
    <section aria-labelledby="works-with-title" className="rounded-xl border border-line bg-surface px-4 py-4 sm:px-6">
      <h2 id="works-with-title" className="text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Works with the AI tools you already use
      </h2>
      <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {WORKS_WITH.map((it) => <Item key={it.name} item={it} />)}
      </ul>
      <p className="mt-3 text-center text-[11px] text-muted">
        Each one checked against its own documentation for remote MCP servers.{' '}
        <a href="/ai" onClick={open} className="inline-flex items-center gap-0.5 font-semibold text-fg hover:underline">
          How to connect<ArrowRight size={12} aria-hidden="true" />
        </a>
      </p>
    </section>
  );
}
