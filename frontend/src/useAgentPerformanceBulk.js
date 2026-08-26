// useAgentPerformanceBulk.js
//
// Real, marketplace-wide on-chain track record — GET /api/agents/performance/bulk
// (backend/core/agent_performance.py's get_all_agent_performance(), a bulk
// version of the same cached scan the agent detail page's "Past Hires"
// panel already reads one owner at a time). One fetch for the whole
// marketplace, not one request per agent — the real data behind the
// "Most hired" / "Highest success rate" sort options. Shared by web and
// mobile so both rank agents from the exact same real numbers.
import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
let _cached = null; // one real fetch per page session — the backend's own 30-min TTL already covers freshness

export function useAgentPerformanceBulk() {
  const [byOwner, setByOwner] = useState(_cached?.by_owner || null);

  useEffect(() => {
    if (_cached) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/agents/performance/bulk`)
      .then((r) => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); })
      .then((d) => {
        if (cancelled) return;
        _cached = d;
        setByOwner(d.by_owner || {});
      })
      .catch(() => {
        // Real failure — stays null. The ranking helper below already
        // treats "no data" as "no real track record", so callers degrade
        // to the marketplace's normal default order rather than breaking.
      });
    return () => { cancelled = true; };
  }, []);

  return byOwner; // real object keyed by lowercase owner_address, or null until loaded/if it failed
}
