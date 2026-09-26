// SiteLinks.jsx
//
// The site footer, in getquin's column layout (owner's reference, home-11),
// shared by the web shell, the mobile page foot and the mobile menu sheet,
// so all three list the same pages in the same order.
//
// COLUMNS (owner, 2026-09-26)
//   Product  the five pages of the main navigation
//   Tools    Explore agents, Hyperliquid wallet costs, Hyperliquid
//            order-book readings, Practice mode, Chrome extension
//   Legal    Privacy, Data sources
//   Status   the status page, and the social accounts (real ones only)
// Where each Tools entry goes:
//   Hyperliquid wallet costs        /dashboard: a connected wallet's habit
//                                   costs on Hyperliquid are read there
//   Hyperliquid order-book readings /chain/hyperliquid
//   Practice mode                   the extension's store listing: practice
//                                   mode is a panel of the extension on
//                                   Hyperliquid's trading pages
//   Chrome extension                the same listing (extensionLink.js)
// Every entry is a real link with an href, so it opens in a new tab and a
// crawler can follow it; `onNavigate` turns a plain click into an in-app
// navigation without a reload.

import React from 'react';
import { Github, Linkedin } from 'lucide-react';
import { CHROME_EXTENSION_URL } from './extensionLink';

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

export const FOOTER_COLUMNS = [
  { title: 'Product', links: [
    { key: 'stocks', label: 'Stocks & ETFs', path: '/stocks' },
    { key: 'vaults', label: 'Vaults', path: '/vaults' },
    { key: 'my-etfs', label: 'My ETFs', path: '/my-etfs' },
    { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
    { key: 'ai', label: 'Use with AI', path: '/ai' },
  ] },
  { title: 'Tools', links: [
    { key: 'market', label: 'Explore agents', path: '/market' },
    { key: 'hl-costs', label: 'Hyperliquid wallet costs', path: '/dashboard' },
    { key: 'hl-book', label: 'Hyperliquid order-book readings', path: '/chain/hyperliquid' },
    { key: 'practice', label: 'Practice mode', path: CHROME_EXTENSION_URL, external: true },
    { key: 'extension', label: 'Chrome extension', path: CHROME_EXTENSION_URL, external: true },
  ] },
  { title: 'Legal', links: [
    { key: 'privacy', label: 'Privacy', path: '/privacy' },
    { key: 'sources', label: 'Data sources', path: '/data-sources' },
  ] },
  { title: 'Status', links: [
    { key: 'status', label: 'Status page', path: '/status' },
  ] },
];

// Where the figures come from, in one line.
export const SOURCES_LINE = "Costs: our own reads of each chain's pools. Issuer figures stay on the issuer's page. Nothing here is a recommendation.";

export default function SiteLinks({
  // (path) => void. Called for a plain left click; modified clicks (new tab,
  // new window) are left to the browser.
  onNavigate,
  // The current path, so the page you are on is marked.
  activePath = null,
  // 'full' for the page foot, 'sheet' for the mobile menu (no brand, two
  // columns).
  variant = 'full',
  className = '',
}) {
  const go = (e, path) => {
    if (!onNavigate || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate(path);
  };
  const sheet = variant === 'sheet';
  const mark = 'inline-flex items-center justify-center p-1 -m-1 rounded transition-colors text-muted hover:text-fg';
  const socials = (
    <span className="flex items-center gap-3">
      <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={mark} aria-label="GitHub" title="GitHub"><Github size={15} className="shrink-0" /></a>
      <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" className={mark} aria-label="LinkedIn" title="LinkedIn"><Linkedin size={15} className="shrink-0" /></a>
      <a href={X_URL} target="_blank" rel="noreferrer" className={mark} aria-label="X" title="X"><XMark size={14} className="shrink-0" /></a>
    </span>
  );

  return (
    <footer className={className}>
      <div className={sheet ? 'grid grid-cols-2 gap-x-6 gap-y-6' : 'grid grid-cols-2 md:grid-cols-[1.2fr_1fr_1.3fr_1fr_1fr] gap-x-8 gap-y-8'}>
        {!sheet && (
          <div className="col-span-2 md:col-span-1">
            <span className="text-[20px] font-light tracking-[0.02em] text-fg">Tnega</span>
          </div>
        )}
        {FOOTER_COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="text-[13px] text-muted mb-3">{col.title}</h2>
            <ul className="space-y-2.5">
              {col.links.map((item) => {
                const on = !item.external && activePath === item.path;
                return (
                  <li key={item.key}>
                    <a
                      href={item.path}
                      {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : { onClick: (e) => go(e, item.path) })}
                      aria-current={on ? 'page' : undefined}
                      className="text-[13px] font-semibold text-fg hover:underline underline-offset-2"
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
            {col.title === 'Status' && (
              <div className="mt-6">
                <h2 className="text-[13px] text-muted mb-3">Connect</h2>
                {socials}
              </div>
            )}
          </nav>
        ))}
      </div>
      <div className={`mt-8 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted`}>
        <span>
          {SOURCES_LINE}{' '}
          <a href="/data-sources" onClick={(e) => go(e, '/data-sources')} className="underline underline-offset-2 hover:text-fg">Every source</a>
        </span>
        {/* The year is read from the clock: a typed one is wrong every January. */}
        <span>&copy; {new Date().getFullYear()} Tnega</span>
      </div>
    </footer>
  );
}
