// HackathonPartnersFooter.jsx
//
// Small "Built for" attribution strip, styled identically to
// DataSourcesFooter.jsx — real partner names + real logos (each fetched
// directly from the partner's own domain), each linking out to their real
// site. Shared by web + mobile.
import React, { useState } from 'react';
import { HACKATHON_PARTNERS } from './hackathonPartners';

function PartnerLogo({ src }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt="" width={14} height={14} onError={() => setFailed(true)} className="rounded-sm" />;
}

export default function HackathonPartnersFooter({ onOpenPartners, className = '' }) {
  return (
    <footer className={`border-t border-gray-200 dark:border-gray-800 mt-6 pt-6 pb-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-gray-400">
        <span className="font-semibold uppercase tracking-wider text-gray-400">Built for</span>
        {HACKATHON_PARTNERS.map((p) => (
          <a
            key={p.name}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <PartnerLogo src={p.logo} />
            {p.name}
          </a>
        ))}
        {onOpenPartners && (
          <button onClick={onOpenPartners} className="ml-auto text-indigo-500 hover:underline">
            About these partners →
          </button>
        )}
      </div>
    </footer>
  );
}
