// HackathonPartnersPage.jsx
//
// Dedicated "Built for" credits page, linked from the footer — styled
// identically to DataSourcesPage.jsx. Real partner, real logo, real link,
// real description of what it's actually used for in this codebase. See
// hackathonPartners.js for the source of truth these render from.
import React, { useState } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { HACKATHON_PARTNERS } from './hackathonPartners';

function PartnerLogo({ src }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800" />;
  return (
    <img src={src} alt="" width={36} height={36} onError={() => setFailed(true)} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white" />
  );
}

export default function HackathonPartnersPage({ onBack }) {
  return (
    <div className="min-h-screen bg-[#F4F5F8] dark:bg-[#0F172A] text-gray-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors mb-8">
          <ArrowLeft size={16} /> Back to Marketplace
        </button>

        <h1 className="text-2xl font-bold mb-1">Built for</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          The real hackathon partners and tracks this project actually uses, and what each one does here.
        </p>

        <div className="space-y-3">
          {HACKATHON_PARTNERS.map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 p-4 hover:shadow-sm transition-shadow"
            >
              <PartnerLogo src={p.logo} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-1.5">{p.name} <ExternalLink size={12} className="text-gray-400" /></div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{p.description}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
