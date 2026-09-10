// SiteLinks.jsx
//
// The project links row: Docs, GitHub, LinkedIn, then Ecosystem and the demo
// video as icons.
//
// These used to be one "Full documentation" line at the bottom of the page,
// below the partner and data-source footers, where almost nobody scrolled.
// Moving them under the wallet area puts them where someone is already
// looking when they arrive.
//
// Ecosystem view and Demo Walkthrough joined this row on 2026-09-11. They
// were two full-width labelled rows of their own in the desktop sidebar,
// sitting under a divider below the main nav. Neither is a tab you work in:
// one is a visual map, the other is a video that opens in a new tab, and
// between them they took roughly 90px of sidebar height to say so. As icons
// in a row that already existed they cost nothing vertically, and the space
// they gave back goes to the hero image above.
//
// They keep accessible names (aria-label plus title) rather than relying on
// the icon alone, because an unlabelled globe is a guess.
//
// Docs opens the in-app documentation section through the same callback the
// old footer used, so the route does not change. The rest are external and
// open in a new tab.
//
// Shared by web and mobile. The `variant` prop only changes colour, because
// the sidebar sits on a dark panel and the mobile sheet does not.
//
// Laid out as one row with a dot between each entry rather than stacked
// rows. Short labels stacked take a line each of a narrow sidebar for what
// reads as a single group, and the dot is what makes them read as one line
// rather than words that happen to be adjacent.

import React from 'react';
import { BookOpen, Github, Linkedin, Globe, Youtube } from 'lucide-react';

export const GITHUB_URL = 'https://github.com/sabaazdn73/Agents-Marketplace';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/saba-azadegan-2974b622a';
// The recorded walkthrough of the site. Lives here rather than in either
// app, so web and mobile cannot end up pointing at different videos.
export const DEMO_VIDEO_URL = 'https://youtu.be/D3cHUVap-WY';

/** The X wordmark.
 *
 *  Hand-drawn rather than taken from an icon set: lucide ships an `X` glyph,
 *  but that is the close/dismiss cross, not the brand. Using it would put a
 *  dismiss icon next to GitHub and LinkedIn and hope nobody read it as one.
 *  This is the actual mark, and it inherits currentColor like the rest. */
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
  variant = 'dark',
  className = '',
}) {
  const base =
    variant === 'dark'
      ? 'text-gray-400 hover:text-white'
      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white';

  const item = `inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${base}`;
  // Icon-only entries get a hit area rather than sitting flush against the
  // text links, so they are tappable on a phone as well as clickable.
  const iconItem = `inline-flex items-center justify-center p-1 -m-1 rounded transition-colors ${base}`;
  // Not a list item and not focusable: it is punctuation between the links.
  const dot = (
    <span aria-hidden="true" className="opacity-30 select-none">&middot;</span>
  );

  return (
    <nav
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-2 ${className}`}
      aria-label="Project links"
    >
      {onOpenDocs && (
        <>
          <button type="button" onClick={onOpenDocs} className={item}>
            <BookOpen size={13} className="shrink-0" />
            <span>Docs</span>
          </button>
          {dot}
        </>
      )}
      <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={item}>
        <Github size={13} className="shrink-0" />
        <span>GitHub</span>
      </a>
      {dot}
      <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" className={item}>
        <Linkedin size={13} className="shrink-0" />
        <span>LinkedIn</span>
      </a>

      {/* Ecosystem and the walkthrough, icon-only. Rendered after the named
          links because these two are ways of looking at the whole thing
          rather than places to go.

          Held in one inline-flex group, with a single dot before it and none
          inside. The sidebar is about 230px wide and the full row does not
          fit on one line there, so it wraps: without the group it broke
          between the two icons and left the video on a line of its own after
          a trailing dot, which read as a rendering fault. Grouped, the pair
          wraps together and looks deliberate. */}
      {dot}
      <span className="inline-flex items-center gap-2">
        {onOpenEcosystem && (
          <button
            type="button"
            onClick={onOpenEcosystem}
            className={iconItem}
            aria-label="Ecosystem view"
            title="Ecosystem view"
          >
            <Globe size={14} className="shrink-0" />
          </button>
        )}
        <a
          href={DEMO_VIDEO_URL}
          target="_blank"
          rel="noreferrer"
          className={iconItem}
          aria-label="Demo walkthrough on YouTube"
          title="Demo walkthrough"
        >
          <Youtube size={15} className="shrink-0" />
        </a>
      </span>
    </nav>
  );
}
