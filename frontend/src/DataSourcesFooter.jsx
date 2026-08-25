// DataSourcesFooter.jsx
//
// Small, standard "Powered by" attribution strip — real provider names +
// real logos (each fetched directly from the provider's own domain), each
// linking out to their real site. Shared by web + mobile. A logo that fails
// to load just disappears (onError) rather than showing a broken-image icon.
import React, { useState } from 'react';
import { DATA_SOURCES } from './dataSources';

function SourceLogo({ src, name }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt="" width={14} height={14} onError={() => setFailed(true)} className="rounded-sm" />;
}

export default function DataSourcesFooter({ onOpenDataSources, className = '' }) {
  return (
    <footer className={`border-t border-gray-200 dark:border-gray-800 mt-12 pt-6 pb-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-gray-400">
        <span className="font-semibold uppercase tracking-wider text-gray-400">Data sources</span>
        {DATA_SOURCES.map((s) => (
          <a
            key={s.name}
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <SourceLogo src={s.logo} name={s.name} />
            {s.name}
          </a>
        ))}
        {onOpenDataSources && (
          <button onClick={onOpenDataSources} className="ml-auto text-indigo-500 hover:underline">
            About these sources →
          </button>
        )}
      </div>
    </footer>
  );
}
