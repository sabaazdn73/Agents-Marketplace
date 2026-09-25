// HackathonPartnersPage.jsx
//
// Dedicated "Built for" credits page, linked from the footer, styled
// identically to DataSourcesPage.jsx. partner, logo, link,
// description of what it's used for in this codebase. See
// hackathonPartners.js for the source of truth these render from.
import React, { useState } from 'react';
import StandaloneBar from './shell/StandaloneBar';
import { ExternalLink } from 'lucide-react';
import { HACKATHON_PARTNERS } from './hackathonPartners';

function PartnerLogo({ src }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="w-9 h-9 rounded-xl bg-inset " />;
  return (
    <img src={src} alt="" width={36} height={36} onError={() => setFailed(true)} className="rounded-xl border border-line bg-surface" />
  );
}

export default function HackathonPartnersPage({ onBack }) {
  return (
    <div className="min-h-screen bg-page text-fg">
      <div className="max-w-[1400px] mx-auto px-6 py-10">
        <StandaloneBar onBack={onBack} />

        <h1 className="text-2xl font-bold mb-1">Built for</h1>
        <p className="text-sm text-muted mb-8">
 The hackathon partners and tracks this project uses, and what each one does here.
        </p>

        <div className="space-y-3">
          {HACKATHON_PARTNERS.map((p) => (
            <a
              key={p.name}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-4 bg-surface rounded-2xl border border-line p-4 hover:shadow-sm transition-shadow"
            >
              <PartnerLogo src={p.logo} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold flex items-center gap-1.5">{p.name} <ExternalLink size={12} className="text-muted" /></div>
                <div className="text-xs text-muted mt-0.5">{p.description}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
