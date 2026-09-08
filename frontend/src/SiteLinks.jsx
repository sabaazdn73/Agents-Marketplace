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

import React from 'react';
import { BookOpen, Github, Linkedin } from 'lucide-react';

export const GITHUB_URL = 'https://github.com/sabaazdn73/Agents-Marketplace';
export const LINKEDIN_URL = 'https://www.linkedin.com/in/saba-azadegan-2974b622a';

export default function SiteLinks({ onOpenDocs, variant = 'dark', className = '' }) {
  const base =
    variant === 'dark'
      ? 'text-gray-400 hover:text-white hover:bg-white/5'
      : 'text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5';

  const item = `flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${base}`;

  return (
    <nav className={`space-y-0.5 ${className}`} aria-label="Project links">
      {onOpenDocs && (
        <button type="button" onClick={onOpenDocs} className={item}>
          <BookOpen size={13} className="shrink-0" />
          <span>Docs</span>
        </button>
      )}
      <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={item}>
        <Github size={13} className="shrink-0" />
        <span>GitHub</span>
      </a>
      <a href={LINKEDIN_URL} target="_blank" rel="noreferrer" className={item}>
        <Linkedin size={13} className="shrink-0" />
        <span>LinkedIn</span>
      </a>
    </nav>
  );
}
