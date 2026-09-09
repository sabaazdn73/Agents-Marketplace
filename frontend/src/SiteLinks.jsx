// SiteLinks.jsx
//
// Docs, GitHub and LinkedIn, sitting under the wallet panel.
//
// These used to be one "Full documentation" line at the bottom of the page,
// below the partner and data-source footers, where almost nobody scrolled.
// Moving them under the wallet area puts them where someone is already
// looking when they arrive.
//
// Docs opens the in-app documentation section through the same callback the
// old footer used, so the route does not change. The other two are external
// and open in a new tab.
//
// Shared by web and mobile. The `variant` prop only changes colour, because
// the sidebar sits on a dark panel and the mobile sheet does not.
//
// Laid out as one row with a dot between each entry rather than three
// stacked rows. Three short labels stacked took three lines of a narrow
// sidebar for what reads as a single group, and the dot is what makes them
// read as one line rather than three words that happen to be adjacent.

import React from 'react';
import { BookOpen, Github, Linkedin } from 'lucide-react';

export const GITHUB_URL = 'https://github.com/sabaazdn73/Agents-Marketplace';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/saba-azadegan-2974b622a';
// The recorded walkthrough of the site. Lives here rather than in either
// app, so web and mobile cannot end up pointing at different videos.
export const DEMO_VIDEO_URL = 'https://youtu.be/D3cHUVap-WY';

export default function SiteLinks({ onOpenDocs, variant = 'dark', className = '' }) {
  const base =
    variant === 'dark'
      ? 'text-gray-400 hover:text-white'
      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white';

  const item = `inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${base}`;
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
    </nav>
  );
}
