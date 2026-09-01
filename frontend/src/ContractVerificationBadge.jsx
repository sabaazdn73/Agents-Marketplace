// ContractVerificationBadge.jsx
//
// Real, on-demand check of whether this agent's owner_address is a plain
// wallet or an actual smart contract (backend: GET
// /api/agents/{id}/contract-verification — see that route's own docstring
// and adapters/contract_verification.py's module docstring for the full
// real investigation behind this, including the real, checked prevalence:
// ~8% of real, sampled agent owner addresses are contracts at all).
//
// Deliberately renders NOTHING for the overwhelmingly common real case
// (is_contract: false, a plain wallet — nothing to flag) rather than a
// "not applicable" badge that would clutter ~92% of real agent detail
// pages with a signal that doesn't apply to them. Only shows something
// when there's a real, structural fact worth knowing: a verified
// contract (real reassurance) or an unverified one (a real, honest risk
// signal — its behavior can't be independently audited).

import React from 'react';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { useResilientFetch } from './useResilientFetch';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function ContractVerificationBadge({ agentId }) {
  const url = agentId ? `${API_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/contract-verification` : null;
  const { data } = useResilientFetch(url, () => fetchJson(url), { enabled: !!agentId });

  if (!data || !data.is_contract) return null; // real, honest "nothing to flag" — plain wallet or unknown

  if (data.verified) {
    return (
      <span
        title={`This agent's owner is a verified smart contract${data.contract_name ? ` (${data.contract_name})` : ''} — its real code is publicly auditable on BscScan.`}
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
      >
        <ShieldCheck size={11} /> Verified contract owner
      </span>
    );
  }
  if (data.verified === false) {
    return (
      <span
        title="This agent's owner is a smart contract whose source code is NOT verified on BscScan. Its behavior can't be independently audited."
        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
      >
        <ShieldAlert size={11} /> Unverified contract owner
      </span>
    );
  }
  return null; // is_contract true but verified unknown (a real, honest "couldn't check" — say nothing rather than guess)
}
