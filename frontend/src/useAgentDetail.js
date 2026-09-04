// useAgentDetail.js
//
// Fetches the fields GET /api/agents deliberately stopped sending.
//
// Added 2026-09-04 alongside the backend's list/detail split. That split
// exists because the backend was being oomKilled at its real 512Mi ceiling
// roughly every 9-11 hours: GET /api/agents was serving all 31 fields of
// all 16,162 served agents in one 16.75MB response, and holding those full
// records in a one-hour in-memory cache. The list now gets only the 17
// fields it actually renders, sorts, filters and searches on (9.71MB), and
// the 15 detail-only fields move here — fetched once, when a human opens
// one specific agent, which is a real, naturally-bounded trigger rather
// than something paid for on every page load.
//
// Deliberately non-blocking and failure-tolerant: the caller renders the
// slim agent immediately and this merges the richer fields in when they
// land. A failed or slow detail fetch therefore degrades to "the detail
// panel shows what the list already knew", never a spinner that blocks the
// panel or an error that hides an agent the user just clicked.

import { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

/** The detail-only fields, snake_case -> the camelCase shape both apps'
 * own mapAgent() already produces. Kept deliberately in one shared place:
 * web and mobile have separate mapAgent() copies, and letting them drift
 * on which fields the detail panel gets is exactly the kind of silent
 * web/mobile divergence this codebase keeps shared logic in .js modules
 * to avoid. */
function mapAgentDetailFields(a) {
  return {
    ownerAddress: a.owner_address, ownerEns: a.owner_ens,
    ownerUsername: a.owner_username, ownerBnbBalance: a.owner_bnb_balance,
    supportedProtocols: a.supported_protocols || [],
    x402Supported: a.x402_supported,
    defillamaUrl: a.defillama_url,
    tvlChange7dPct: a.tvl_change_7d_pct, tvlDataFlagged: a.tvl_data_flagged,
    mcapUsd: a.mcap_usd, auditCount: a.audit_count,
    serviceEndpoint: a.service_endpoint || null,
    // The list is served a 200-character description snippet (the card
    // clamps to three lines anyway); the detail panel is the one place
    // that renders it in full, so the full text is restored here.
    strategy: a.description || 'No description provided.',
  };
}

/** Returns `agent` enriched with its real detail-only fields once they
 * load. Returns the agent unchanged while in flight, if the fetch fails,
 * or if it has no id. */
export function useAgentDetail(agent) {
  const [enriched, setEnriched] = useState(agent);

  useEffect(() => {
    // Show what we already have immediately — never blank the panel while
    // the richer fields are in flight.
    setEnriched(agent);
    if (!agent?.id) return;

    let cancelled = false;
    fetch(`${API_BASE_URL}/api/agents/${encodeURIComponent(agent.id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEnriched({ ...agent, ...mapAgentDetailFields(data) });
      })
      .catch(() => { /* keep the slim record; see this module's own note */ });

    return () => { cancelled = true; };
  }, [agent?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  return enriched;
}
