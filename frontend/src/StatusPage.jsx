// StatusPage.jsx
//
// Real, standalone /status page — a plain list of real, live, right-now
// checks against every external integration this project depends on
// (backed by backend/core/status_checks.py's /api/status). No fabricated
// uptime percentage or history: this is a snapshot, refreshed for real on
// every visit (server-side cached for a short 30s TTL, honestly labeled
// with "cache_age_seconds" — never presented as an average or a claim
// about the past).
import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

function useStatus() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fetch(`${API_BASE_URL}/api/status`)
      .then((res) => { if (!res.ok) throw new Error(`Backend returned ${res.status}`); return res.json(); })
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((err) => setState({ loading: false, error: err.message, data: null }));
  }, []);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}

export default function StatusPage({ onBack }) {
  const { loading, error, data, reload } = useStatus();
  const services = data?.services || [];
  const allOk = services.length > 0 && services.every((s) => s.ok);

  return (
    <div className="min-h-screen bg-[#F4F5F8] dark:bg-[#0F172A] text-gray-900 dark:text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors mb-8">
          <ArrowLeft size={16} /> Back to Marketplace
        </button>

        <h1 className="text-2xl font-bold mb-1">System status</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
          Real, live checks against every external service this project depends on — not a claimed
          uptime history, just whether each one answers right now.
        </p>

        {loading && !data && (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Checking real connectivity…</div>
        )}
        {error && (
          <div className="text-sm text-red-600 dark:text-red-400">Couldn't reach the status endpoint ({error}).</div>
        )}

        {data && (
          <>
            <div className={`flex items-center gap-2 mb-6 px-4 py-3 rounded-2xl text-sm font-semibold ${
              allOk ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
            }`}>
              {allOk ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              {allOk ? 'All services reachable right now' : 'One or more services are not reachable right now'}
            </div>

            <div className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {services.map((s) => (
                <div key={s.name} className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-3">
                    {s.ok
                      ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                      : <XCircle size={18} className="text-red-500 shrink-0" />}
                    <div>
                      <div className="text-sm font-semibold">{s.name}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">{s.detail}</div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xs font-mono ${s.ok ? 'text-gray-600 dark:text-gray-300' : 'text-red-500'}`}>{s.response_ms}ms</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between mt-4 text-[11px] text-gray-400">
              <span>Checked {data.cache_age_seconds === 0 ? 'just now' : `${data.cache_age_seconds}s ago`} (cached up to 30s to protect rate-limited keys)</span>
              <button onClick={reload} disabled={loading} className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-40">
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
