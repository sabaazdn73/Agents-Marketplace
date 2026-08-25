// DataSourcesPage.jsx
//
// Dedicated "Data Sources / Powered by" page, linked from the footer —
// real provider, real logo, real link, real description of what it's
// actually used for in this codebase. See dataSources.js for the source of
// truth these render from.
import React, { useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { DATA_SOURCES } from './dataSources';

function SourceLogo({ src }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800" />;
  return (
    <img src={src} alt="" width={36} height={36} onError={() => setFailed(true)} className="rounded-xl border border-gray-200 dark:border-gray-700" />
  );
}

export default function DataSourcesPage({ onBack }) {
  return (
    <div className="min-h-screen bg-[#F4F5F8] dark:bg-[#0F172A] text-gray-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors mb-8">
          <ArrowLeft size={16} /> Back to Marketplace
        </button>

        <h1 className="text-2xl font-bold mb-1">Data sources</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Every real external provider this project uses, and what each one actually does here.
          Live reachability for these is tracked on <a href="/status" className="text-indigo-500 hover:underline">/status</a>.
        </p>

        <div className="space-y-3">
          {DATA_SOURCES.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 p-4 hover:shadow-sm transition-shadow"
            >
              <SourceLogo src={s.logo} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-1.5">{s.name} <ExternalLink size={12} className="text-gray-400" /></div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.description}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
