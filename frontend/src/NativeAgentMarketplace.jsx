// NativeAgentMarketplace.jsx
//
// Tnega's own "Native Agent Marketplace" — genuinely different from both
// the third-party Marketplace (hiring a registered ERC-8004 agent) and
// the existing "Ready-made Skills" (third-party protocol know-how pulled
// verbatim from Altana's public registry, zero Tnega-designed logic,
// zero fee). Every card here is a real, autonomous, multi-factor Tnega
// agent: it evaluates real candidates itself and states its own real
// reasoning, rather than just handing the user a sorted list.
//
// First real agent built (2026-09-01): Staking, comparing the only two
// BSC liquid-staking protocols this codebase can actually execute a
// stake through (Lista DAO, Ankr) — see backend/adapters/native_staking.py
// for the full real decision logic and backend/server.py's
// /api/native-agents/staking/recommendation for the live data this reads.
//
// Lending/Borrowing and Perpetuals are real, intentional "Coming Soon"
// placeholders — visible so the real, full scope of the vision reads
// clearly, but neither is wired to any execution path yet (per the
// explicit instruction: ship the Staking agent completely correct first,
// rather than several agents half-built).

import React, { useState, useEffect } from 'react';
import { Bot, Sparkles, Loader2, CheckCircle2, ChevronRight, Wallet, Fingerprint, Landmark, TrendingUp, Lock, Info, Building2 } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { recoverAltanaWallet, createNewAltanaWallet, fetchWalletBalanceSnapshot, grantSkillSession, getAltanaExecutor, getMainnetReadClient } from './altana';
import { useDirectWalletExecutor } from './useDirectWalletExecutor';
import WalletConfirmStep from './WalletConfirmStep';
import {
  USDT_BSC, LISTA_MANAGER, ANKR_BNB_STAKING_POOL,
  listaStakePreflight, ankrStakePreflight, runNativeStake,
  computeNativeAgentFee, NATIVE_AGENT_ENTRY_FEE_BPS, NATIVE_AGENT_FEE_WALLET,
} from './defiSkills';

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';
const STAKING_RECOMMENDATION_URL = `${API_BASE}/api/native-agents/staking/recommendation`;

const PROTOCOL_CONTRACTS = { lista: LISTA_MANAGER, ankr: ANKR_BNB_STAKING_POOL };
const PREFLIGHT_FNS = { lista: listaStakePreflight, ankr: ankrStakePreflight };

function useStakingRecommendation() {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(STAKING_RECOMMENDATION_URL)
      .then((r) => { if (!r.ok) throw new Error(`Server returned ${r.status}`); return r.json(); })
      .then((data) => { if (!cancelled) setState({ loading: false, data, error: null }); })
      .catch((e) => {
        if (cancelled) return;
        console.error('[NativeAgentMarketplace] staking recommendation load failed:', e.message || e);
        setState({ loading: false, data: null, error: "Couldn't reach the live comparison data right now. Give it another try." });
      });
    return () => { cancelled = true; };
  }, [retryTick]);
  return { ...state, retry: () => setRetryTick((t) => t + 1) };
}

/** Real, honest "how many months of yield does this fee cost" — shown so
 * the fee is fully legible, never a hidden line item. Computed straight
 * from the candidate's own real, live APY. */
function feeInYieldMonths(feeBnb, bnbAmount, apyPct) {
  if (!apyPct || apyPct <= 0 || bnbAmount <= 0) return null;
  const annualYieldBnb = bnbAmount * (apyPct / 100);
  if (annualYieldBnb <= 0) return null;
  return (feeBnb / annualYieldBnb) * 12;
}

function CandidateRow({ candidate, isRecommended, isSelected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(candidate.id)}
      className={`w-full text-left p-3 rounded-xl border transition-colors ${isSelected ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-500/10' : 'border-gray-200 dark:border-gray-800 hover:border-indigo-300'}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{candidate.protocol_label}</span>
          <span className="text-[10px] font-mono opacity-50">{candidate.token_symbol}</span>
          {isRecommended && (
            <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Recommended</span>
          )}
        </div>
        {isSelected && <CheckCircle2 size={14} className="text-indigo-500" />}
      </div>
      <div className="flex gap-4 mt-1.5 text-[11px] opacity-70">
        <span>TVL: <span className="font-mono font-semibold">${Number(candidate.tvl_usd).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></span>
        <span>APY: <span className="font-mono font-semibold">{Number(candidate.apy).toFixed(2)}%</span></span>
      </div>
    </button>
  );
}

function StakingNativeAgentCard({ accent, surface, mutedBorder, darkMode }) {
  const { loading, data, error, retry } = useStakingRecommendation();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [bnbAmount, setBnbAmount] = useState('');
  const [spendCap, setSpendCap] = useState(1);
  const [walletMode, setWalletMode] = useState(null);
  const [step, setStep] = useState(null);
  const [error2, setError2] = useState(null);
  const [needsWalletChoice, setNeedsWalletChoice] = useState(false);
  const [pendingWallet, setPendingWallet] = useState(null);
  const [walletSnapshot, setWalletSnapshot] = useState(null);
  const [execResult, setExecResult] = useState(null);
  const directExecutor = useDirectWalletExecutor();

  useEffect(() => {
    if (data?.recommended && !selectedId) setSelectedId(data.recommended.id);
  }, [data, selectedId]);

  const candidates = data?.candidates || [];
  const selected = candidates.find((c) => c.id === selectedId) || data?.recommended;
  const amountNum = Number(bnbAmount) || 0;
  const { feeBnb } = amountNum > 0 ? computeNativeAgentFee(amountNum) : { feeBnb: 0 };
  const yieldMonths = selected ? feeInYieldMonths(feeBnb, amountNum, selected.apy) : null;

  const presentWalletForConfirmation = async (walletLike) => {
    setStep(null);
    const snapshot = await fetchWalletBalanceSnapshot(walletLike.address, USDT_BSC);
    setPendingWallet(walletLike);
    setWalletSnapshot(snapshot);
  };

  const runAgainstExecutor = async (executor) => {
    const preflight = PREFLIGHT_FNS[selected.id];
    const pre = await preflight(getMainnetReadClient(), executor.walletAddress, amountNum);
    if (!pre.ok) {
      setStep('error');
      setError2(`Issue with this wallet, checked before spending a real attempt on it:\n${pre.problems.join('\n')}`);
      return;
    }
    setStep('executing');
    const result = await runNativeStake(executor, { protocolId: selected.id, bnbAmount: amountNum });
    setExecResult(result);
    setStep('done');
  };

  const handleUseDirectWallet = async () => {
    setError2(null); setExecResult(null); setNeedsWalletChoice(false); setWalletMode('direct');
    if (!directExecutor) return;
    await presentWalletForConfirmation({ address: directExecutor.walletAddress, mode: 'direct' });
  };

  const handleUsePasskeyWallet = async () => {
    setError2(null); setExecResult(null); setNeedsWalletChoice(false); setWalletMode('passkey');
    try {
      setStep('wallet');
      const wallet = await recoverAltanaWallet();
      await presentWalletForConfirmation({ ...wallet, mode: 'passkey' });
    } catch (e) {
      setStep('error'); setNeedsWalletChoice(true); setError2(e.message || String(e));
    }
  };

  const handleConfirmNewWallet = async () => {
    setError2(null); setNeedsWalletChoice(false);
    try {
      setStep('wallet');
      const wallet = await createNewAltanaWallet();
      await presentWalletForConfirmation({ ...wallet, mode: 'passkey' });
    } catch (e) {
      setStep('error'); setError2(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

  const handleContinueWithWallet = async () => {
    const w = pendingWallet;
    setPendingWallet(null); setWalletSnapshot(null);
    try {
      if (w.mode === 'direct') { await runAgainstExecutor(directExecutor); return; }
      setStep('granting');
      // Real: the session must be allowed to call BOTH the real protocol
      // contract and the real fee wallet — runNativeStake batches a call
      // to each in one execute(), so both need to be in scope.
      const s = await grantSkillSession(w, w.signer, {
        contractAddresses: [PROTOCOL_CONTRACTS[selected.id], NATIVE_AGENT_FEE_WALLET],
        spendToken: undefined,
        spendCapUnits: Number(spendCap), expiryHours: 24,
      });
      await runAgainstExecutor(getAltanaExecutor(s));
    } catch (e) {
      setStep('error');
      setError2(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

  const handleTryDifferentPasskey = () => { setPendingWallet(null); setWalletSnapshot(null); handleUsePasskeyWallet(); };

  const canRun = selected && amountNum > 0;

  return (
    <div className={`rounded-2xl border p-5 ${mutedBorder}`} style={{ background: surface }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: `${accent}1a` }}><Landmark size={16} style={{ color: accent }} /></div>
          <span className="font-bold text-sm">Staking Agent</span>
        </div>
        <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">Native</span>
      </div>
      <p className="text-xs opacity-60 mb-4">
        An autonomous agent that compares BSC liquid-staking protocols by liquidity/risk first, yield second, and stakes through whichever it (or you) picks, non-custodially.
      </p>

      {loading && <div className="flex items-center gap-2 text-xs opacity-60 py-4"><Loader2 size={14} className="animate-spin" /> Comparing live protocol data...</div>}
      {error && (
        <div className="py-3 space-y-2">
          <div className="text-xs text-red-500">{error}</div>
          <button onClick={retry} className="text-xs font-semibold underline" style={{ color: accent }}>Try again</button>
        </div>
      )}
      {data && !data.available && <div className="text-xs text-amber-600 dark:text-amber-400 py-3">{data.reason}</div>}

      {data?.available && !open && (
        <button onClick={() => setOpen(true)} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: accent }}>
          Compare & stake →
        </button>
      )}

      {data?.available && open && (
        <div className="space-y-4">
          <div className="p-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 text-[11px] text-emerald-700 dark:text-emerald-400">
            <span className="font-semibold">Why: </span>{data.reasoning}
          </div>

          <div className="space-y-2">
            {candidates.map((c) => (
              <CandidateRow key={c.id} candidate={c} isRecommended={c.id === data.recommended.id} isSelected={c.id === selectedId} onSelect={setSelectedId} />
            ))}
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1">Amount to stake (BNB)</label>
            <input
              type="number" value={bnbAmount} disabled={!!step && step !== 'error' && step !== 'done'}
              onChange={(e) => setBnbAmount(e.target.value)}
              placeholder={selected ? `min ${selected.min_stake_bnb}` : ''}
              className={`w-full p-2.5 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`}
            />
          </div>

          {amountNum > 0 && selected && (
            <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>
                Entry fee: {(NATIVE_AGENT_ENTRY_FEE_BPS / 100).toFixed(2)}% = <span className="font-mono font-semibold">{feeBnb.toFixed(6)} BNB</span>, disclosed here before you sign, never hidden.
                {yieldMonths != null && <> That's roughly <span className="font-semibold">{yieldMonths < 1 ? '<1' : yieldMonths.toFixed(1)}</span> {yieldMonths < 1.5 ? 'month' : 'months'} of this position's projected yield at {selected.apy.toFixed(2)}% APY.</>}
              </span>
            </div>
          )}

          {walletMode === null && !walletSnapshot && (
            <div className="space-y-2">
              <button onClick={handleUseDirectWallet} className={`w-full p-3 rounded-xl border text-left ${mutedBorder} hover:border-indigo-400`} disabled={!canRun}>
                <div className="flex items-center gap-2 text-sm font-semibold"><Wallet size={14} style={{ color: accent }} /> Use my connected wallet</div>
                <p className="text-[11px] opacity-60 mt-0.5">
                  {directExecutor ? `Uses ${directExecutor.walletAddress.slice(0, 6)}...${directExecutor.walletAddress.slice(-4)} directly.` : 'No spend-cap session — you sign each run yourself.'}
                </p>
                {!directExecutor && <div className="mt-2"><ConnectButton /></div>}
              </button>
              <button onClick={handleUsePasskeyWallet} className={`w-full p-3 rounded-xl border text-left ${mutedBorder} hover:border-indigo-400`} disabled={!canRun}>
                <div className="flex items-center gap-2 text-sm font-semibold"><Fingerprint size={14} style={{ color: accent }} /> Use a Face ID mini-wallet</div>
                <p className="text-[11px] opacity-60 mt-0.5">A separate, seedless wallet with a spending limit you set once.</p>
              </button>
            </div>
          )}

          {walletMode !== 'direct' && walletMode !== null && !walletSnapshot && step === null && (
            <div>
              <label className="text-xs font-semibold block mb-1">Your spending limit (BNB/day)</label>
              <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)}
                className={`w-full p-2.5 rounded-lg border text-sm outline-none ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`} />
              <p className="text-[10px] opacity-40 mt-1">Covers both the stake amount and the entry fee. Set it comfortably above {(amountNum + feeBnb).toFixed(4) || 'your stake amount'} BNB.</p>
            </div>
          )}

          {step && step !== 'error' && (
            <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/10 text-xs flex items-center gap-2">
              {step !== 'done' && <Loader2 size={13} className="animate-spin" style={{ color: accent }} />}
              {step === 'done' && <CheckCircle2 size={13} className="text-green-500" />}
              {{ wallet: 'Setting up your mini-wallet...', granting: 'Setting your spending limit...', executing: 'Staking now...', done: `Done. Staked through ${selected?.protocol_label}, fee paid.` }[step]}
            </div>
          )}
          {step === 'error' && error2 && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-500 space-y-2">
              <div className="whitespace-pre-wrap">{error2}</div>
              {needsWalletChoice && (
                <button onClick={handleConfirmNewWallet} className="w-full py-2 rounded-xl text-[11px] font-semibold border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10">
                  This is genuinely my first time: create a new wallet
                </button>
              )}
            </div>
          )}

          {walletSnapshot ? (
            <WalletConfirmStep snapshot={walletSnapshot} onContinue={handleContinueWithWallet} onTryDifferent={pendingWallet?.mode !== 'direct' ? handleTryDifferentPasskey : undefined} continueLabel="Set limit & stake" />
          ) : (
            walletMode !== null && step !== 'wallet' && (
              <button onClick={walletMode === 'direct' ? handleUseDirectWallet : handleUsePasskeyWallet} disabled={!canRun || (!!step && step !== 'error' && step !== 'done')}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
                {step === 'done' ? 'Done ✓' : 'Continue →'}
              </button>
            )
          )}

          <button onClick={() => setOpen(false)} className="text-xs opacity-60 hover:opacity-100 flex items-center gap-1"><ChevronRight size={13} className="rotate-180" /> Collapse</button>
        </div>
      )}
    </div>
  );
}

function ComingSoonAgentCard({ icon: Icon, title, blurb, accent, surface, mutedBorder }) {
  return (
    <div className={`rounded-2xl border p-5 opacity-70 ${mutedBorder}`} style={{ background: surface }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-gray-500/10"><Icon size={16} className="opacity-60" /></div>
          <span className="font-bold text-sm">{title}</span>
        </div>
        <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-gray-500/15 text-gray-500 flex items-center gap-1"><Lock size={9} /> Coming Soon</span>
      </div>
      <p className="text-xs opacity-60">{blurb}</p>
    </div>
  );
}

export default function NativeAgentMarketplace({ accent, surface, mutedBorder, darkMode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Bot size={16} style={{ color: accent }} />
        <span className="text-sm font-bold">Native Agent Marketplace</span>
      </div>
      <p className="text-xs opacity-60 mb-1">
        Tnega's own designed agents, not a hired third party, not a plain pass-through Skill. Each one autonomously compares candidates and states its own reasoning before you act.
      </p>
      <p className="text-[11px] opacity-40 mb-4 flex items-center gap-1"><Sparkles size={11} /> A disclosed {(NATIVE_AGENT_ENTRY_FEE_BPS / 100).toFixed(2)}% entry fee applies here, higher-value-add routing than the free, third-party Skills above, always shown before you sign.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StakingNativeAgentCard accent={accent} surface={surface} mutedBorder={mutedBorder} darkMode={darkMode} />
        <ComingSoonAgentCard icon={TrendingUp} title="Lending / Borrowing Agent" accent={accent} surface={surface} mutedBorder={mutedBorder}
          blurb="Autonomous collateral and health-factor management across Venus and Aave. Needs its own dedicated liquidation-risk UI, so it's being built as its own complete piece, not bundled in half-finished." />
        <ComingSoonAgentCard icon={Bot} title="Perpetuals Agent" accent={accent} surface={surface} mutedBorder={mutedBorder}
          blurb="A dashboard for your own existing Hyperliquid / Avantis positions. Live execution needs cross-chain infrastructure Tnega doesn't have yet; investigated, not started." />
        {/* Tokenized RWA data feasibility, checked live 2026-09-02 against
            CoinGecko's real API (no key, public tier): /rwas/list,
            /rwas/markets, /rwas/{id}, /rwas/issuers/list, and
            /rwas/issuers/{id} all returned 200 with real data (647 tracked
            assets, 34 issuers) with no API key at all. Only /tickers and
            /market_chart (historical) returned a real 401, "exclusive to
            Basic plan or above" — confirmed directly, not assumed. A future
            comparison agent (asset name/price/market cap/issuer) is
            genuinely buildable on the free tier; only deep history/venue-
            level tickers would need a paid upgrade, and those are
            secondary, not blockers for a useful first version. */}
        <ComingSoonAgentCard icon={Building2} title="Tokenized Assets Agent" accent={accent} surface={surface} mutedBorder={mutedBorder}
          blurb="Discover and compare tokenized real-world assets, stocks, commodities, pre-IPO shares, bridging crypto-native users into traditional markets and back. Data source checked and free-tier feasible; not built yet." />
      </div>
    </div>
  );
}
