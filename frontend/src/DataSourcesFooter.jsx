// DataSourcesFooter.jsx
//
// The Sources block: everything this project reads from or settles through,
// as plain text, under one heading.
//
// WHY THE LOGOS ARE GONE FROM HERE
// The foot of the site was carrying two rows of marks: this strip with a logo
// beside every provider name, and the partner marquee below it with another
// twenty-one. Twenty-odd logos compete with each other and with the few that
// are supposed to stand out, which are the chains this project deploys to and
// the events it was built for. Those keep their marks in the marquee. Every
// other credit is here, in text, one line, still a link, still reachable.
//
// Nothing was dropped. A provider that was credited with a logo is credited
// with its name, which is what the attribution actually owes them, and the
// full page behind "All sources" carries the detail for each one.
//
// Shared by web and mobile, like the strip it replaces.
import React from 'react';
import { DATA_SOURCES } from './dataSources';
import { PARTNERS, PARTNER_KIND } from './partners';

export default function DataSourcesFooter({ onOpenDataSources, className = '' }) {
  // The data providers, plus the services and tools from the partner list.
  // Chains and events are deliberately absent: they are the marks the marquee
  // keeps, and repeating them here would undo the point of thinning this out.
  const seen = new Set();
  const entries = [];
  for (const s of DATA_SOURCES.filter((x) => x.inFooter)) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    entries.push({ name: s.name, url: s.url });
  }
  for (const p of PARTNERS) {
    if (p.kind !== PARTNER_KIND.SERVICE && p.kind !== PARTNER_KIND.TOOL) continue;
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    entries.push({ name: p.name, url: p.url });
  }

  return (
    <footer className={`border-t border-gray-200 dark:border-gray-800 mt-12 pt-6 pb-4 ${className}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
        Sources
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-gray-400">
        {entries.map((s) => (
          <a
            key={s.name}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            {s.name}
          </a>
        ))}
        {onOpenDataSources && (
          <button onClick={onOpenDataSources} className="ml-auto text-indigo-500 hover:underline">
            All sources →
          </button>
        )}
      </div>
    </footer>
  );
}
