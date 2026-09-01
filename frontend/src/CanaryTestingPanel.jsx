// CanaryTestingPanel.jsx
//
// Real, human-triggered "canary probe" operator tool — see
// backend/core/canary.py's own docstring and docs/verification-
// methodology.md for the full real design and reasoning. Deliberately NOT
// linked from any nav item or the main marketplace UI (reachable only by
// navigating directly to /canary) — this is an operational/curation tool,
// not a buyer-facing feature, matching the same separation principle
// already used for the full-registry pipeline (docs/full-registry-
// analysis.md).
//
// REAL, DELIBERATE SAFETY DESIGN: every real canary hire here goes through
// the EXACT SAME real, client-side hire flow (useHireAgent.js) as any
// other hire in this product — the button below triggers a real wallet
// prompt for the CONNECTED OPERATOR'S OWN wallet; nothing here holds a key
// or spends anything automatically. The backend only ever proposes
// candidates (read-only) and logs a result AFTER the operator's own wallet
// has already broadcast the real transaction.

import React, { useState, useEffect, useCallback } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { Loader2, ShieldHalf, AlertTriangle, ChevronRight, ExternalLink } from 'lucide-react';
import { useHireAgent, buildHireStepList } from './useHireAgent';
import StepChecklist from './StepChecklist';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const DEFAULT_TEST_BUDGET = 0.1; // $U — matches backend/core/canary.py's own default

// Real bug found and fixed (2026-08-27): this fetch had NO client-side
// timeout at all — same real structural gap already found once this
// session in AgentMarketplaceApp.web.jsx's AgentPerformance component (see
// its own AGENT_PERFORMANCE_FETCH_TIMEOUT_MS comment for the full real
// investigation). /api/canary/candidates calls select_candidates(), which
// reads the full known_agents store (get_stored_agents()) AND does a real
// on-chain performance scan (get_all_agent_performance()) — real, measured
// at ~4-7s even after fixing get_stored_agents()'s own real O(k^2)
// clustering slowdown (see core/clustering.py). Without a timeout, any
// real connection stall (a real, observed failure mode on this free-tier
// host, same as the AgentPerformance investigation found) left
// `candidates` stuck at its initial `null` forever — rendering the
// "Loading real candidates…" spinner indefinitely, exactly the real
// symptom reported. Fixed with the same real timeout + retry pattern.
const CANARY_FETCH_TIMEOUT_MS = 20_000;

function useCanaryData() {
  const [candidates, setCandidates] = useState(null);
  const [budget, setBudget] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CANARY_FETCH_TIMEOUT_MS);
    Promise.all([
      fetch(`${API_BASE_URL}/api/canary/candidates`, { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); }),
      fetch(`${API_BASE_URL}/api/canary/budget-status`, { signal: controller.signal })
        .then((r) => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); }),
    ])
      .then(([c, b]) => { setCandidates(c.candidates || []); setBudget(b); })
      .catch((e) => setError(e.name === 'AbortError' ? 'Timed out reaching the backend — it may be slow right now.' : (e.message || String(e))))
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);

  useEffect(() => load(), [load]);
  return { candidates, budget, error, reload: load };
}

function CandidateRow({ agent, budget, onDone }) {
  const { hire, step, error, completedSteps, skippedSteps, stepHashes, notifySkipReason, jobId } = useHireAgent();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // { ok, message }

  const overCap = budget && DEFAULT_TEST_BUDGET > budget.remaining_units;

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const { jobId: newJobId, txHash } = await hire({
        providerAddress: agent.owner_address,
        budgetUnits: DEFAULT_TEST_BUDGET,
        description: `Canary test (Tnega verification): ${agent.name}`,
      });
      const rec = await fetch(`${API_BASE_URL}/api/canary/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_address: agent.owner_address,
          agent_name: agent.name,
          job_id: newJobId.toString(),
          budget_units: DEFAULT_TEST_BUDGET,
          tx_hash: txHash,
        }),
      }).then((r) => r.json());
      setResult({ ok: true, message: `Job #${newJobId} funded and logged as a real canary test.`, jobId: newJobId.toString() });
      onDone?.();
      if (rec.over_cap) {
        setResult((r) => ({ ...r, message: r.message + ' (Note: this pushed real spend over the weekly cap — pause before running more.)' }));
      }
    } catch (e) {
      setResult({ ok: false, message: e.message || String(e) });
    } finally {
      setRunning(false);
    }
  };

  const steps = running || step ? buildHireStepList({ step, completedSteps, skippedSteps, stepHashes, error, budgetUnits: DEFAULT_TEST_BUDGET, notifySkipReason }) : null;

  return (
    <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{agent.name}</div>
          <div className="text-[11px] text-gray-500">{agent.category} · <span className="font-mono">{agent.owner_address}</span></div>
        </div>
        <button
          onClick={handleRun}
          disabled={running || overCap}
          className="shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 flex items-center gap-1.5"
          title={overCap ? 'Would exceed the real weekly canary budget cap' : `Fund a real ${DEFAULT_TEST_BUDGET} $U test job — your connected wallet will prompt you to sign`}
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <ShieldHalf size={13} />}
          Run canary test ({DEFAULT_TEST_BUDGET} $U)
        </button>
      </div>
      {steps && <div className="mt-3"><StepChecklist steps={steps} /></div>}
      {result && (
        <div className={`mt-3 p-2.5 rounded-lg text-[11px] ${result.ok ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

export default function CanaryTestingPanel({ onBack }) {
  const { isConnected } = useAccount();
  const { candidates, budget, error, reload } = useCanaryData();

  return (
    <div className="min-h-screen bg-[#F4F5F8] dark:bg-[#0F172A] text-gray-900 dark:text-gray-100 p-6 md:p-10">
      <div className="max-w-3xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-6">
          <ChevronRight size={16} className="rotate-180" /> Back to Marketplace
        </button>

        <h1 className="text-2xl font-bold flex items-center gap-2 mb-2"><ShieldHalf size={22} className="text-teal-600" /> Canary Testing (operator tool)</h1>
        <p className="text-sm text-gray-500 mb-6">
          Proactively tests a small, real sample of "Responding, unproven" agents with a small, real, funded job —
          every job here is funded by YOUR connected wallet, exactly like any other real hire. See{' '}
          <a href="/docs/verification-methodology" className="text-teal-600 hover:underline inline-flex items-center gap-0.5">
            the real methodology <ExternalLink size={11} />
          </a>.
        </p>

        <div className="mb-6 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Weekly budget</div>
          {budget ? (
            <div className="flex items-center gap-6 text-sm">
              <div><span className="font-bold">{budget.spent_units}</span> <span className="text-gray-500">$U spent</span></div>
              <div><span className="font-bold">{budget.remaining_units}</span> <span className="text-gray-500">$U remaining</span></div>
              <div><span className="font-bold">{budget.tests_this_period}</span> <span className="text-gray-500">tests this week</span></div>
            </div>
          ) : <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>

        {!isConnected ? (
          <div className="p-8 rounded-2xl border border-gray-200 dark:border-gray-800 text-center">
            <p className="text-sm text-gray-500 mb-4">Connect the operator wallet to run canary tests.</p>
            <ConnectButton />
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertTriangle size={14} /> Couldn't load candidates: {error}
            <button onClick={reload} className="underline font-medium ml-2">Try again</button>
          </div>
        ) : candidates === null ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center"><Loader2 size={16} className="animate-spin" /> Loading candidates…</div>
        ) : candidates.length === 0 ? (
          <div className="p-8 rounded-2xl border border-gray-200 dark:border-gray-800 text-center text-sm text-gray-500">
            No real candidates right now — either nothing in the allowed scope is currently "Responding, unproven", or everything eligible was tested within the last {budget?.recent_test_cooldown_days ?? 30} days.
          </div>
        ) : (
          <div className="space-y-3">
            {candidates.map((c) => (
              <CandidateRow key={c.owner_address} agent={c} budget={budget} onDone={reload} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
