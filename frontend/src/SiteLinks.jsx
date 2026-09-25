// SiteLinks.jsx
//
// The site footer, shared by the web shell and the mobile menu sheet, so the
// two list the same secondary pages in the same order.
//
// WHAT IS IN IT (2026-09-25)
// The main navigation carries the five product pages. Everything else a
// visitor may still want is here, small: Explore agents (/market) and My
// agents (/my-agents, the hire flow), which left the navigation when the
// product changed; then Docs, Status, Data sources and Privacy. Every entry
// is a real link with an href, so it can be opened in a new tab and a crawler
// can follow it; `onNavigate` turns a plain click into an in-app navigation
// without a reload.
//
// Under the links, one line naming where the figures come from, beside the
// link to the full list. Then the baseline: copyright on the left, the social
// marks and any trailing control (the theme toggle, on web) on the right.

import React from 'react';
import { Github, Linkedin } from 'lucide-react';

export const GITHUB_URL = 'https://github.com/sabaazdn73/Agents-Marketplace';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/saba-azadegan-2974b622a';
export const X_URL = 'https://x.com/SabaAzadegan';
// The recorded walkthrough of the site. Lives here rather than in either
// app, so web and mobile cannot end up pointing at different videos.
export const DEMO_VIDEO_URL = 'https://youtu.be/EcpRX5FRles';

/** The X wordmark.
 *
 *  Hand-drawn rather than taken from an icon set: lucide ships an `X` glyph,
 *  but that is the close/dismiss cross, not the brand. Using it would put a
 *  dismiss icon next to GitHub and LinkedIn and hope nobody read it as one.
 *  This is the actual mark, and it inherits currentColor like the rest.
 *
 *  Drawn one pixel smaller than the lucide icons beside it (13 against 14).
 *  Those are stroked outlines with built-in padding; this is a solid fill
 *  that reaches its own edges, so matching the nominal size makes it read as
 *  the heaviest thing in the row. */
export function XMark({ size = 13, className = '' }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="currentColor" aria-hidden="true" focusable="false" className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

// The secondary pages, once. Paths are the app's own routes (routePaths.js
// and the standalone routes in App.jsx).
export const FOOTER_LINKS = [
  { key: 'market', label: 'Explore agents', path: '/market' },
  { key: 'my-agents', label: 'My agents', path: '/my-agents' },
  { key: 'docs', label: 'Docs', path: '/docs' },
  { key: 'status', label: 'Status', path: '/status' },
  { key: 'sources', label: 'Data sources', path: '/data-sources' },
  { key: 'privacy', label: 'Privacy', path: '/privacy' },
];

export const SOURCES_LINE = 'Figures come from chain reads, and from LI.FI quotes for the cost to buy.';

export default function SiteLinks({
  // (path) => void. Called for a plain left click; modified clicks (new tab,
  // new window) are left to the browser.
  onNavigate,
  // The current path, so the page you are on is marked.
  activePath = null,
  // The theme toggle, or anything else the host wants beside the marks.
  trailing = null,
  className = '',
}) {
  const link = 'text-label font-medium text-muted hover:text-fg transition-colors';
  const mark = 'inline-flex items-center justify-center p-1 -m-1 rounded transition-colors text-muted hover:text-fg';

  const go = (e, path) => {
    if (!onNavigate || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(path);
  };

  return (
    <footer className={`border-t border-line pt-4 ${className}`}>
      {/* Separated by spacing, not by dots: a wrapped row leaves no
          punctuation stranded at a line end. */}
      <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Site links">
        {FOOTER_LINKS.map((item) => {
          const on = activePath === item.path;
          return (
            <a
              key={item.key}
              href={item.path}
              onClick={(e) => go(e, item.path)}
              aria-current={on ? 'page' : undefined}
              className={`${link} ${on ? 'text-fg' : ''}`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <p className="mt-3 text-micro text-muted">
        {SOURCES_LINE}{' '}
        <a href="/data-sources" onClick={(e) => go(e, '/data-sources')} className="underline underline-offset-2 hover:text-fg">
          Every source
        </a>
      </p>

      {/* The year is read from the clock: a typed one is wrong every January. */}
      <div className="mt-4 pt-3 border-t border-line flex items-center justify-between gap-2">
        <span className="text-micro text-muted">
          &copy; {new Date().getFullYear()} Tnega
        </span>
        <span className="flex items-center gap-2.5">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={mark}
             aria-label="GitHub" title="GitHub">
            <Github size={14} className="shrink-0" />
          </a>
          <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" className={mark}
             aria-label="LinkedIn" title="LinkedIn">
            <Linkedin size={14} className="shrink-0" />
          </a>
          <a href={X_URL} target="_blank" rel="noreferrer" className={mark}
             aria-label="X" title="X">
            <XMark size={13} className="shrink-0" />
          </a>
          {trailing}
        </span>
      </div>
    </footer>
  );
}
