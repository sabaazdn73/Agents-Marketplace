// DataSourcesPage.jsx
//
// Dedicated "Data Sources / Powered by" page, linked from the footer,
// provider, logo, link, description of what it's
// used for in this codebase. See dataSources.js for the source of
// truth these render from.
import React, { useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { DATA_SOURCES } from './dataSources';

// Status is grouped rather than left as a badge on an otherwise flat list,
// because the honest distinctions here are the point: something the product
// depends on, something that works only partly, something configured but
// deliberately switched off, and something used for published analysis rather
// than by the site. A reader who cannot tell those apart cannot use the page.
const STATUS_META = {
  live: {
    label: 'Live',
    color: '#1E7A5E',
    meaning: 'In use by the site right now.',
  },
  partial: {
    label: 'Partial',
    color: '#8A6516',
    meaning: 'Used, but not for everything it could be. The note says what is missing.',
  },
  inactive: {
    label: 'Not active',
    color: '#64748B',
    meaning: 'Connected and verified, but deliberately not doing anything yet.',
  },
  analysis: {
    label: 'Analysis only',
    color: '#2B4C7E',
    meaning: 'Used to produce published analysis. The live site does not depend on it.',
  },
};
const STATUS_ORDER = ['live', 'partial', 'inactive', 'analysis'];

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

        <h1 className="text-2xl font-bold mb-1">Resources</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Every external service this project uses, what each one does here, and whether it is
          actually running. Live reachability for the ones marked as checked is tracked on{' '}
          <a href="/status" className="text-indigo-500 hover:underline">/status</a>.
        </p>

        {/* The legend earns its place: without it "partial" and "analysis"
            are guesses. Counts come from the data so they cannot drift. */}
        <div className="flex flex-wrap gap-2 mb-8">
          {STATUS_ORDER.map((key) => {
            const n = DATA_SOURCES.filter((s) => s.status === key).length;
            if (!n) return null;
            const m = STATUS_META[key];
            return (
              <span
                key={key}
                className="text-[11px] px-2.5 py-1 rounded-full border"
                style={{ borderColor: `${m.color}55`, background: `${m.color}14`, color: m.color }}
                title={m.meaning}
              >
                {m.label} · {n}
              </span>
            );
          })}
        </div>

        <div className="space-y-3">
          {STATUS_ORDER.map((key) => {
            const group = DATA_SOURCES.filter((s) => s.status === key);
            if (!group.length) return null;
            const m = STATUS_META[key];
            return (
              <section key={key} className="pt-2">
                <h2 className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 mb-1">
                  {m.label}
                </h2>
                <p className="text-[11px] text-gray-400 mb-3">{m.meaning}</p>
                <div className="space-y-3">
                  {group.map((s) => (
                    <a
                      key={s.name}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-4 bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 p-4 hover:shadow-sm transition-shadow"
                    >
                      <div className="mt-0.5"><SourceLogo src={s.logo} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
                          {s.name}
                          <ExternalLink size={12} className="text-gray-400" />
                          <span
                            className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{ background: `${m.color}1F`, color: m.color }}
                          >
                            {m.label}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.description}</div>
                        {s.statusNote && (
                          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{s.statusNote}</div>
                        )}
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
