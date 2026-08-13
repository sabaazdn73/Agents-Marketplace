// SellYourAgentForm.jsx
//
// The real "Sell Your Agent" listing form, shared VERBATIM by the web and
// mobile apps (imported by both) so the creator flow can never drift between
// platforms. All logic lives in the shared hooks in agentMarket.js.
//
// Scope guard: a creator may only list an agent they actually own. Ownership is
// verified on-chain against the real ERC-8004 registry (the same check the
// contract enforces in list()), so this works TODAY even before our own
// contract is deployed. On-chain listing (models 1 & 2) is gated behind
// VITE_AGENT_MARKET_ADDRESS; until it's set the UI says so honestly instead of
// pretending. Model 3 (x402 pay-per-call) needs no contract and is saved as
// local config.

import React, { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Coins, Hammer, Activity, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useAccount } from 'wagmi';
import {
  MODEL, isMarketConfigured, toRawUnits, ACCEPTED_TOKENS,
  useAgentOwnership, useListAgent, useFeeBps,
} from './agentMarket';
import { buildBazaarBlob } from './x402Skill';

const X402_KEY = 'aam_x402_listings_v1';
const ACCENT = '#4F46E5';

export default function SellYourAgentForm() {
  const { address, isConnected } = useAccount();
  const [agentId, setAgentId] = useState('');
  const [model, setModel] = useState(MODEL.ONE_TIME);
  const [price, setPrice] = useState('');
  const [token, setToken] = useState(ACCEPTED_TOKENS[1].address); // default USDT
  const [periodDays, setPeriodDays] = useState('30');
  const [endpoint, setEndpoint] = useState('');
  const [perCall, setPerCall] = useState('');
  const [x402Name, setX402Name] = useState('');
  const [x402Desc, setX402Desc] = useState('');
  const [bazaarOptIn, setBazaarOptIn] = useState(true);
  const [done, setDone] = useState(null); // {kind, msg}
  const [localErr, setLocalErr] = useState(null);

  const ownership = useAgentOwnership(agentId);
  const { listAgent, busy, error } = useListAgent();
  const { feeBps, feePct } = useFeeBps();

  const configured = isMarketConfigured();
  const idValid = /^\d+$/.test(agentId.trim());

  const submit = async (e) => {
    e.preventDefault();
    setLocalErr(null); setDone(null);

    if (model === MODEL.NONE) return;

    // Model 3 — x402 pay-per-call: no contract, saved as local config. If the
    // creator opts in, we build the REAL B402 Bazaar discovery blob now so their
    // endpoint can attach it on its x402 settle call and get indexed.
    if (model === 'x402') {
      if (!idValid) return setLocalErr('Enter your agent’s ERC-8004 token ID.');
      if (!ownership.isOwner) return setLocalErr('Only the on-chain owner of this agent can list it.');
      if (!/^https?:\/\//.test(endpoint.trim())) return setLocalErr('Enter your agent’s paid endpoint URL (https://…).');
      if (!perCall.trim()) return setLocalErr('Enter a per-call price.');
      const bazaar = bazaarOptIn
        ? buildBazaarBlob({ name: x402Name.trim() || undefined, description: x402Desc.trim() || undefined, method: 'GET' })
        : null;
      try {
        const cfg = JSON.parse(localStorage.getItem(X402_KEY) || '{}');
        cfg[agentId.trim()] = {
          endpoint: endpoint.trim(), perCall: perCall.trim(),
          name: x402Name.trim() || null, description: x402Desc.trim() || null,
          bazaar, owner: address, at: new Date().toISOString(),
        };
        localStorage.setItem(X402_KEY, JSON.stringify(cfg));
      } catch {}
      return setDone({ kind: 'x402', msg: bazaarOptIn
        ? 'Saved your x402 config with a real B402 Bazaar discovery blob. Buyers pay per call straight to your wallet; once your endpoint attaches this blob to its first x402 settle, B402 lists you (~30s) so agents can discover you.'
        : 'Saved your x402 pay-per-call config. Buyers pay per call directly to your wallet via the existing x402 flow — no marketplace contract needed.' });
    }

    // Models 1 & 2 — on-chain listing.
    if (!ownership.isOwner) return setLocalErr('Only the on-chain owner of this agent can list it.');
    if (!price.trim() || Number(price) <= 0) return setLocalErr('Enter a price greater than 0.');
    if (!configured) return setLocalErr('On-chain listing is not live on this network yet (contract pending deployment).');
    try {
      const priceRaw = toRawUnits(price, 18);
      const periodSeconds = model === MODEL.SUBSCRIPTION ? Math.max(1, Math.floor(Number(periodDays) * 86400)) : 0;
      const sym = ACCEPTED_TOKENS.find((t) => t.address === token)?.symbol || 'token';
      await listAgent({ agentId: agentId.trim(), token, model, priceRaw, periodSeconds });
      setDone({ kind: 'onchain', msg: `Listed agent #${agentId.trim()} priced in ${sym}. Buyers can now ${model === MODEL.SUBSCRIPTION ? 'subscribe' : 'purchase a license'} in ${sym} from its detail page. List again in another token to accept it too.` });
    } catch { /* error surfaced via hook */ }
  };

  const models = [
    { id: MODEL.ONE_TIME, icon: Coins, label: 'One-time license', desc: 'Buyer pays once for permanent access.' },
    { id: MODEL.SUBSCRIPTION, icon: Activity, label: 'Subscription', desc: 'Buyer pays per period; access expires unless renewed.' },
    { id: 'x402', icon: Hammer, label: 'Pay-per-call (x402)', desc: 'Charged per API call, settled directly to you off-contract.' },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Sell Your Agent</h2>
        <p className="text-sm text-gray-500">List an agent <strong>you own</strong> and choose how buyers pay. Ownership is verified on-chain against the ERC-8004 registry — you can only list your own agent.</p>
      </div>

      {!isConnected && (
        <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
          <AlertTriangle size={14} /> Connect your wallet to list an agent.
        </div>
      )}

      {!configured && (
        <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40 text-[11px] text-gray-500 flex items-start gap-2">
          <ShieldCheck size={14} className="shrink-0 mt-0.5" />
          <span>The AgentAccessMarket contract is verified on the practice fork but not yet deployed to this network, so on-chain listing (one-time / subscription) is disabled. Ownership verification and x402 config work now.</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="text-xs font-semibold block mb-1">Your agent’s ERC-8004 token ID</label>
          <input value={agentId} onChange={(e) => setAgentId(e.target.value)} inputMode="numeric" placeholder="e.g. 1024"
            className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none focus:ring-2 focus:ring-indigo-500/40" />
          {idValid && (
            <div className="mt-1.5 text-[11px] flex items-center gap-1.5">
              {ownership.status === 'checking' && <span className="text-gray-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> checking ownership…</span>}
              {ownership.status === 'notfound' && <span className="text-gray-400">No ERC-8004 identity found for that token ID.</span>}
              {ownership.status === 'done' && ownership.isOwner && <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> You own this agent (verified on-chain).</span>}
              {ownership.status === 'done' && !ownership.isOwner && <span className="text-red-500 flex items-center gap-1"><XCircle size={12} /> Owned by {ownership.owner?.slice(0, 6)}…{ownership.owner?.slice(-4)}, not your wallet.</span>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2">
          {models.map((m) => {
            const Icon = m.icon; const active = model === m.id;
            return (
              <button type="button" key={String(m.id)} onClick={() => setModel(m.id)}
                className={`text-left p-3 rounded-xl border flex gap-3 items-start transition-colors ${active ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/5' : 'border-gray-200 dark:border-gray-800'}`}>
                <div className="p-2 rounded-lg h-fit" style={{ background: 'rgba(79,70,229,0.10)', color: ACCENT }}><Icon size={15} /></div>
                <div><div className="text-sm font-semibold">{m.label}</div><div className="text-[11px] text-gray-500">{m.desc}</div></div>
              </button>
            );
          })}
        </div>

        {/* Payment token (all three accepted tokens supported). Creator prices
            in one; list again in another to accept it too. */}
        {model !== 'x402' && (
          <div>
            <label className="text-xs font-semibold block mb-1">Payment token</label>
            <div className="flex gap-2">
              {ACCEPTED_TOKENS.map((t) => (
                <button type="button" key={t.address} onClick={() => setToken(t.address)}
                  className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-colors ${token === t.address ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/5 text-indigo-600 dark:text-indigo-300' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}>
                  {t.symbol}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">All three are accepted — buyers pick which they pay with. List the same agent again in another token to offer it too.</p>
          </div>
        )}

        {model === MODEL.ONE_TIME && (
          <div>
            <label className="text-xs font-semibold block mb-1">Price ({ACCEPTED_TOKENS.find((t) => t.address === token)?.symbol})</label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 25"
              className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none" />
          </div>
        )}
        {model === MODEL.SUBSCRIPTION && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold block mb-1">Price/period ({ACCEPTED_TOKENS.find((t) => t.address === token)?.symbol})</label>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="e.g. 10"
                className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">Period (days)</label>
              <input value={periodDays} onChange={(e) => setPeriodDays(e.target.value)} inputMode="numeric" placeholder="30"
                className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none" />
            </div>
          </div>
        )}
        {model === 'x402' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold block mb-1">Your agent’s paid endpoint (x402)</label>
              <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://your-agent.example/api"
                className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-1">Price per call ($U)</label>
              <input value={perCall} onChange={(e) => setPerCall(e.target.value)} inputMode="decimal" placeholder="e.g. 0.05"
                className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-sm outline-none" />
            </div>
            <p className="text-[11px] text-gray-400">x402 charges per HTTP call and settles straight to your wallet — no marketplace contract. This saves the config; wiring your endpoint as an x402 resource is your own deploy step.</p>

            {/* B402 Bazaar opt-in (free discovery) */}
            <div className="p-3 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/50 dark:bg-indigo-500/5 space-y-2">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input type="checkbox" checked={bazaarOptIn} onChange={(e) => setBazaarOptIn(e.target.checked)} />
                List on Binance B402 Bazaar (free discovery)
              </label>
              <p className="text-[11px] text-gray-500">Attaches a real Bazaar metadata blob to your x402 settle call so AI agents can discover your endpoint. Opt-in, zero extra cost.</p>
              {bazaarOptIn && (
                <div className="grid grid-cols-1 gap-2 pt-1">
                  <input value={x402Name} onChange={(e) => setX402Name(e.target.value)} placeholder="Agent name (for discovery)"
                    className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-xs outline-none" />
                  <textarea value={x402Desc} onChange={(e) => setX402Desc(e.target.value)} placeholder="Short description of what your agent does" rows={2}
                    className="w-full p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0F172A] text-xs outline-none resize-none" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Live, on-chain platform fee (models 1 & 2). Read from feeBps() — never hardcoded. */}
        {model !== 'x402' && (
          <div className="text-[11px] text-gray-500 p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
            {feePct != null
              ? <>Platform fee: <strong style={{ color: ACCENT }}>{feePct}%</strong> — read live from the contract, so buyers see the real current rate. You keep the remaining {100 - feePct}%.</>
              : <>Platform fee is read live from the contract’s <code>feeBps</code> once deployed (2.5% on the practice-fork test). It’s never hardcoded, so it stays accurate if the rate changes.</>}
          </div>
        )}

        <button type="submit" disabled={!isConnected || busy || (model !== 'x402' && !ownership.isOwner)}
          className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-2" style={{ background: ACCENT }}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : null}
          {model === 'x402' ? 'Save x402 config' : busy ? 'Listing on-chain…' : 'List agent on-chain'}
        </button>

        {(localErr || error) && <div className="text-xs text-red-500 whitespace-pre-wrap">{localErr || error}</div>}
        {done && <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-600 dark:text-emerald-400 flex items-start gap-2"><CheckCircle2 size={14} className="shrink-0 mt-0.5" /> {done.msg}</div>}
      </form>
    </div>
  );
}
