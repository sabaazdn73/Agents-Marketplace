// SiteLinks.jsx
//
// The site footer, shared by the desktop sidebar and the mobile menu sheet.
//
// These used to be one "Full documentation" line at the bottom of the page,
// below the partner and data-source footers, where almost nobody scrolled.
// Moving them under the wallet area puts them where someone is already
// looking when they arrive.
//
// Docs opens the in-app documentation section through the same callback the
// old footer used, so the route does not change. The rest are external and
// open in a new tab.
//
// STRUCTURE
// ---------
// Built as a footer rather than as a strip of links, in the shape a reader
// already knows from other sites: a rule, a row of named destinations, a
// second rule, then a baseline with the copyright on one side and the
// social marks and controls on the other.
//
// What it replaced was two rows that did not agree with each other. The
// first was labelled links, Docs and GitHub and LinkedIn and X; the second
// was five bare icons, Skills and the report and Learn and Ecosystem and
// the walkthrough, with no labels at all. So half the footer's destinations
// were named and half were glyphs to guess at, and Ecosystem and the
// walkthrough had been put in the icon row purely because they arrived
// later. The theme toggle then sat on a third line of its own, pushed to
// the right against nothing.
//
// Now the split carries meaning instead of history. Everything in this app
// is a named link in the nav row. The social accounts are marks in the
// baseline, which is the one place an icon needs no label, because GitHub
// and LinkedIn and X are recognised by their marks and the row they sit in
// says what they are. The theme toggle keeps them company rather than
// floating alone.
//
// The `variant` prop only changes colour, because the sidebar sits on a
// dark panel and the mobile sheet does not.

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

export default function SiteLinks({
  onOpenDocs,
  onOpenEcosystem,
  // Real in-app routes rendered here as named links rather than as tabs.
  // Each is { key, label, Icon, onClick, active }. Passed in rather than
  // imported, so this component stays a footer and does not need to know
  // the app's route table. `Icon` is accepted and ignored: the nav row is
  // words, not glyphs. Mobile passes none and those entries simply do not
  // appear.
  routeLinks = [],
  // The theme toggle, or anything else the host wants sitting with the
  // social marks. Optional: mobile has its own toggle in the header.
  trailing = null,
  variant = 'dark',
  className = '',
}) {
  const dark = variant === 'dark';
  const base = dark
    ? 'text-gray-400 hover:text-white'
    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white';
  // A route can be the current page; an external link cannot. The active one
  // gets full strength, so moving these out of the tab list did not cost the
  // ability to see where you are.
  const active = dark ? 'text-white' : 'text-gray-900 dark:text-white';
  const rule = dark ? 'border-white/10' : 'border-gray-200 dark:border-gray-800';
  const quiet = dark ? 'text-gray-500' : 'text-gray-400 dark:text-gray-500';

  const link = `text-xs font-medium transition-colors ${base}`;
  // The marks get a hit area rather than sitting flush against each other,
  // so they are tappable on a phone as well as clickable.
  const mark = `inline-flex items-center justify-center p-1 -m-1 rounded transition-colors ${base}`;

  // Every named destination in one list, so the row is built in one place
  // and a new entry cannot land in some other row by accident. Docs first
  // because it is the one that explains the rest; the walkthrough last
  // because it leaves the site.
  const items = [
    onOpenDocs && { key: 'docs', label: 'Docs', onClick: onOpenDocs },
    ...routeLinks,
    onOpenEcosystem && { key: 'ecosystem', label: 'Ecosystem', onClick: onOpenEcosystem },
    // Same tab, not a new one: it is a page of this site, and the Chrome Web
    // Store listing links to it, so it has to be reachable from the site
    // itself rather than only from the store. `internal` is what keeps it out
    // of the target="_blank" branch below.
    { key: 'privacy', label: 'Privacy', href: '/privacy', internal: true },
    { key: 'demo', label: 'Walkthrough', href: DEMO_VIDEO_URL },
  ].filter(Boolean);

  return (
    <footer className={`border-t ${rule} pt-3 ${className}`}>
      {/* Separated by spacing, not by dots. The row wraps in a 384px rail,
          and an interpunct belongs to neither the link before it nor the one
          after: with a dot between every pair, "Learn ." sat at the end of
          the first line with nothing following it, which reads as a
          rendering fault rather than punctuation. gap-x-4 is four times the
          word space inside "Advantage Report", so the links still separate
          cleanly, and a wrap leaves nothing stranded. */}
      <nav
        className="flex flex-wrap items-center gap-x-4 gap-y-2 px-2"
        aria-label="Site links"
      >
        {items.map((item) => (
          item.href ? (
            <a
              key={item.key}
              href={item.href}
              target={item.internal ? undefined : '_blank'}
              rel={item.internal ? undefined : 'noreferrer'}
              className={link}
            >
              {item.label}
            </a>
          ) : (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={`${link} ${item.active ? active : ''}`}
              aria-current={item.active ? 'page' : undefined}
            >
              {item.label}
            </button>
          )
        ))}
      </nav>

      {/* The baseline. Copyright on the left, marks and controls on the
          right, which is the arrangement a reader has seen a thousand
          times and does not have to work out.

          The year is read from the clock rather than typed in. A hard-coded
          one is wrong every January and nothing fails to tell you. */}
      <div className={`mt-3 pt-3 border-t ${rule} px-2 flex items-center justify-between gap-2`}>
        <span className={`text-[11px] ${quiet}`}>
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
