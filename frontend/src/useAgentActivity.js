// useAgentActivity.js
//
// Real, opt-in fetch for one job's "Agent activity" transparency view — see
// AgentActivityPanel.jsx's own docstring for the full real feature. This is
// NOT a useEffect-driven auto-fetch: `fetchActivity` is called manually,
// only when a user actually expands the section, matching this project's
// established real Zerion rate-budget discipline (the same "opt-in,
// on-demand, one agent's detail page at a time" rule get_wallet_portfolio
// already follows — see backend/adapters/zerion.py).

import { useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const ACTIVITY_FETCH_TIMEOUT_MS = 15_000;

export function useAgentActivity() {
  const [state, setState] = useState({ status: 'idle' }); // idle | loading | ready | error

  const fetchActivity = async (ownerAddress, minMinedAtMs, maxMinedAtMs) => {
    setState({ status: 'loading' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ACTIVITY_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/agents/activity?owner_address=${ownerAddress}&min_mined_at=${minMinedAtMs}&max_mined_at=${maxMinedAtMs}`,
        { signal: controller.signal }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState({ status: 'ready', data });
    } catch (e) {
      setState({ status: 'error' });
    } finally {
      clearTimeout(timeout);
    }
  };

  return { state, fetchActivity };
}
