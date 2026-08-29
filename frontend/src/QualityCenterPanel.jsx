// QualityCenterPanel.jsx
//
// Real, on-demand fetch of 8004scan's own independent "Quality Center"
// assessment for one agent (backend: GET /api/agents/{id}/quality-center —
// see that route's own docstring in server.py for the full real
// investigation behind this). Confirmed live before building this
// (2026-08-29): sampled 15 real, actually-scored BSC agents via the live
// 8004scan API, all 15 had at least one real nonzero dimension score, and
// 4/4 checked had real, structured risk_flags. score_history/trend was
// 'insufficient_data' for every agent checked (0/15) — the registry is too
// young for it yet — so that field is deliberately not surfaced here.
//
// Shared between web and mobile (same pattern as AgentMetrics.jsx), fetched
// once per agent detail view via the same useResilientFetch discipline
// already used elsewhere on this page — never blocks the rest of the
// detail view, and shows nothing (not an error) when 8004scan genuinely
// has no assessment for this agent yet.
//
// Deliberately, permanently labeled as 8004scan's OWN assessment — never
// merged into Tnega's own total_score or any other Tnega-computed number.
// The two scores come from different methodologies measuring different
// things; blending them into one opaque number without a real, principled
// reason would be exactly the kind of shortcut this was built to avoid.

import React from 'react';
import { Loader2, AlertTriangle, Sparkles } from 'lucide-react';
import { useResilientFetch } from './useResilientFetch';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const SEVERITY_STYLE = {
  high: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  low: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
};

export default function QualityCenterPanel({ agentId }) {
  const url = agentId ? `${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/quality-center` : null;
  const { data, status } = useResilientFetch(url, () => fetchJson(url), { enabled: !!agentId });

  if (status === 'loading' && !data) {
    return (
      <div className="mt-6 flex items-center gap-2 text-xs text-gray-400">
        <Loader2 size={13} className="animate-spin" /> Checking 8004scan's own quality assessment…
      </div>
    );
  }
  if (!data || !data.available) return null; // real, honest "nothing to show" — never a fabricated section

  return (
    <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
      <h3 className="text-sm font-bold mb-1 flex items-center gap-2">
        <Sparkles size={14} className="text-indigo-400" /> 8004scan's Quality Center
      </h3>
      <p className="text-[11px] text-gray-400 mb-3">{data.source}</p>
      {data.dimensions?.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          {data.dimensions.map((dim) => (
            <div key={dim.key} title={dim.explanation} className="p-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 text-center">
              <div className="text-[10px] text-gray-400 uppercase tracking-wide">{dim.label}</div>
              <div className="text-sm font-bold">{dim.score != null ? dim.score.toFixed(0) : '—'}</div>
            </div>
          ))}
        </div>
      )}
      {data.risk_flags?.length > 0 && (
        <div className="space-y-1.5">
          {data.risk_flags.map((f, i) => (
            <div key={i} className={`flex items-start gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg ${SEVERITY_STYLE[f.severity] || SEVERITY_STYLE.low}`}>
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span><strong>{f.title}:</strong> {f.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
