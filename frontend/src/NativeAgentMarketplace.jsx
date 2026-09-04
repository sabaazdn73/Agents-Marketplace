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
// Execution wallet, updated 2026-09-03: runs only through the user's own
// connected wallet now — the Altana passkey option was removed. Decisive
// finding: a full scan of the complete ERC-8183 job index found zero jobs
// of any status ever completed through Altana's session path, anywhere in
// this project, and this agent had no organic usage of its own yet to
// weigh against that. See docs/limitations.md for the full finding.
//
// Second real agent built (2026-09-05): Trading, real spot buys of any
// BSC token via PancakeSwap's own router — see pancakeswapSkill.js's own
// "Trading Agent" section for the real risk-signal computation (price
// impact, liquidity depth) and the real feasibility check confirming this
// stays inside the simple, direct-wallet, single-transaction pattern
// (unlike the investigated-and-rejected Avantis perpetuals concept).
//
// Lending/Borrowing, Perpetuals, and Web2 Agents + PayBox are real,
// intentional "Coming Soon" placeholders — visible so the real, full
// scope of the vision reads clearly, but none of the three is wired to
// any execution path yet.
//
// Web2 Agents + PayBox (added 2026-09-10): a vision/roadmap card only,
// no code behind it — see docs/future-tnega-paybox.md for the full real
// research this summarizes (Anthropic's open-source Commerce Agents
// blueprint, MoonPay's confirmed direct BSC support). Explicitly two
// real parts of very different scope: a near-term-demonstrable Web2
// shopping-agent + PayBox settlement concept, and a genuinely separate,
// much larger "describe an agent in a prompt, get one built and wired to
// payment automatically" platform — comparable in scope to BNB Agent
// Studio or Claude Code itself, not attempted here or anywhere in this
// codebase.

import React, { useState, useEffect } from 'react';
import { Bot, Sparkles, Loader2, CheckCircle2, ChevronRight, Wallet, Landmark, TrendingUp, Lock, Info, Building2, ArrowRightLeft, AlertTriangle, ShoppingBag } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { fetchWalletBalanceSnapshot, getMainnetReadClient } from './altana';
import { useDirectWalletExecutor } from './useDirectWalletExecutor';
import WalletConfirmStep from './WalletConfirmStep';
import {
  USDT_BSC,
  listaStakePreflight, ankrStakePreflight, runNativeStake,
  computeNativeAgentFee, NATIVE_AGENT_ENTRY_FEE_BPS,
} from './defiSkills';
import { getTokenMeta, getTradeQuote, getPriceTrend, spotTradePreflight, runNativeSpotTrade } from './tradingAgent';

/** Real, human labels for the holder-risk fields Binance's Market API
 * can genuinely have no data for — used to say "no data for Snipers"
 * honestly instead of showing a fabricated 0%. */
const HOLDER_FIELD_LABELS = {
  top10_holders_pct: 'Top 10 wallets',
  dev_holding_pct: 'Developer',
  sniper_holding_pct: 'Snipers',
  insider_holding_pct: 'Insiders',
  bundler_holding_pct: 'Bundlers',
  new_wallet_holding_pct: 'New wallets',
};

const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';
const STAKING_RECOMMENDATION_URL = `${API_BASE}/api/native-agents/staking/recommendation`;

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
      <div className="flex gap-4 mt-1 text-[10px] opacity-50">
        {candidate.audit_count != null && <span>{candidate.audit_count} audit{candidate.audit_count === 1 ? '' : 's'}</span>}
        {candidate.days_tracked != null && <span>Tracked {candidate.days_tracked} days</span>}
      </div>
    </button>
  );
}

function StakingNativeAgentCard({ accent, surface, mutedBorder, darkMode }) {
  const { loading, data, error, retry } = useStakingRecommendation();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [bnbAmount, setBnbAmount] = useState('');
  const [step, setStep] = useState(null);
  const [error2, setError2] = useState(null);
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

  const handleUseDirectWallet = async () => {
    setError2(null); setExecResult(null);
    if (!directExecutor) return;
    setStep(null);
    const snapshot = await fetchWalletBalanceSnapshot(directExecutor.walletAddress, USDT_BSC);
    setWalletSnapshot(snapshot);
  };

  const handleContinueWithWallet = async () => {
    setWalletSnapshot(null);
    try {
      const preflight = PREFLIGHT_FNS[selected.id];
      const pre = await preflight(getMainnetReadClient(), directExecutor.walletAddress, amountNum);
      if (!pre.ok) {
        setStep('error');
        setError2(`Issue with this wallet, checked before spending a real attempt on it:\n${pre.problems.join('\n')}`);
        return;
      }
      setStep('executing');
      const result = await runNativeStake(directExecutor, { protocolId: selected.id, bnbAmount: amountNum });
      setExecResult(result);
      setStep('done');
    } catch (e) {
      setStep('error');
      setError2(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

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
        An autonomous agent that compares BSC liquid-staking protocols by liquidity/risk first, yield second, and stakes through whichever it (or you) picks, non-custodially, through your own connected wallet.
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
                Fee: {(NATIVE_AGENT_ENTRY_FEE_BPS / 100).toFixed(2)}% (<span className="font-mono font-semibold">{feeBnb.toFixed(6)} BNB</span>)
              </span>
            </div>
          )}

          {!walletSnapshot && (
            <div className={`p-3 rounded-xl border text-left ${mutedBorder}`}>
              <div className="flex items-center gap-2 text-sm font-semibold mb-1"><Wallet size={14} style={{ color: accent }} /> Your connected wallet</div>
              <p className="text-[11px] opacity-60 mb-2">
                {directExecutor ? `Uses ${directExecutor.walletAddress.slice(0, 6)}...${directExecutor.walletAddress.slice(-4)} directly. You sign this yourself, right then.` : 'Connect a wallet to continue — you sign this yourself, right then.'}
              </p>
              {!directExecutor && <ConnectButton />}
            </div>
          )}

          {step && step !== 'error' && (
            <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/10 text-xs flex items-center gap-2">
              {step !== 'done' && <Loader2 size={13} className="animate-spin" style={{ color: accent }} />}
              {step === 'done' && <CheckCircle2 size={13} className="text-green-500" />}
              {{ executing: 'Confirm this in your wallet...', done: `Done. Staked through ${selected?.protocol_label}, fee paid.` }[step]}
            </div>
          )}
          {step === 'error' && error2 && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-500 space-y-2">
              <div className="whitespace-pre-wrap">{error2}</div>
            </div>
          )}

          {walletSnapshot ? (
            <WalletConfirmStep snapshot={walletSnapshot} onContinue={handleContinueWithWallet} continueLabel="Stake" />
          ) : (
            <button onClick={handleUseDirectWallet} disabled={!canRun || !directExecutor || (!!step && step !== 'error' && step !== 'done')}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
              {step === 'done' ? 'Done ✓' : execResult ? 'Run again' : 'Continue →'}
            </button>
          )}

          <button onClick={() => setOpen(false)} className="text-xs opacity-60 hover:opacity-100 flex items-center gap-1"><ChevronRight size={13} className="rotate-180" /> Collapse</button>
        </div>
      )}
    </div>
  );
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Real, debounced quote — re-reads real, live quotes from EVERY DEX this
 * agent compares (see tradingAgent.js) 400ms after the user stops typing/
 * changing the amount, not on every keystroke. Real, honest states: idle
 * (nothing valid entered yet), loading, error (a real, live read failed —
 * e.g. no real, tradeable route on any compared DEX), or a real result. */
function useTradeQuote(tokenAddress, usdtAmount) {
  const [state, setState] = useState({ status: 'idle', meta: null, quote: null, trend: null, error: null });
  useEffect(() => {
    const amountNum = Number(usdtAmount) || 0;
    if (!ADDRESS_RE.test(tokenAddress || '') || amountNum <= 0) {
      setState({ status: 'idle', meta: null, quote: null, trend: null, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    const t = setTimeout(async () => {
      try {
        const client = getMainnetReadClient();
        const usdtAmountRaw = BigInt(Math.round(amountNum * 1e18));
        // Real, small price-trend context (DefiLlama, no key) fetched
        // alongside the real quote — never lets a trend-fetch failure
        // block the trade itself; getPriceTrend already returns null
        // rather than throwing on any real failure.
        const [meta, quote, trend] = await Promise.all([
          getTokenMeta(client, tokenAddress),
          getTradeQuote(client, tokenAddress, usdtAmountRaw),
          getPriceTrend(tokenAddress),
        ]);
        if (!cancelled) setState({ status: 'ready', meta, quote, trend, error: null });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', meta: null, quote: null, trend: null, error: e.message || String(e) });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tokenAddress, usdtAmount]);
  return state;
}

function TradingNativeAgentCard({ accent, surface, mutedBorder, darkMode }) {
  const [open, setOpen] = useState(false);
  const [tokenAddress, setTokenAddress] = useState('');
  const [usdtAmount, setUsdtAmount] = useState('');
  const [ackRisk, setAckRisk] = useState(false);
  const [step, setStep] = useState(null);
  const [error2, setError2] = useState(null);
  const [walletSnapshot, setWalletSnapshot] = useState(null);
  const [execResult, setExecResult] = useState(null);
  const directExecutor = useDirectWalletExecutor();

  const { status: quoteStatus, meta, quote, trend, error: quoteError } = useTradeQuote(tokenAddress, usdtAmount);
  const amountNum = Number(usdtAmount) || 0;
  const feeUsdt = amountNum > 0 ? (amountNum * NATIVE_AGENT_ENTRY_FEE_BPS) / 10000 : 0;
  const hasWarnings = (quote?.warnings?.length || 0) > 0;
  const canRun = quoteStatus === 'ready' && quote && (!hasWarnings || ackRisk);

  // Real, honest reset: a genuinely different token/amount invalidates
  // any earlier risk acknowledgment — never carries a stale "I accept
  // this risk" past the trade it was actually shown for.
  useEffect(() => { setAckRisk(false); }, [tokenAddress, usdtAmount]);

  const formattedOut = (() => {
    if (!quote?.winner?.amountOut || !meta) return null;
    const decimals = meta.decimals ?? 18;
    const n = Number(quote.winner.amountOut) / 10 ** decimals;
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${meta.symbol || 'tokens'}`;
  })();

  const handleUseDirectWallet = async () => {
    setError2(null); setExecResult(null);
    if (!directExecutor) return;
    setStep(null);
    const snapshot = await fetchWalletBalanceSnapshot(directExecutor.walletAddress, USDT_BSC);
    setWalletSnapshot(snapshot);
  };

  const handleContinueWithWallet = async () => {
    setWalletSnapshot(null);
    try {
      const pre = await spotTradePreflight(getMainnetReadClient(), directExecutor.walletAddress, amountNum);
      if (!pre.ok) {
        setStep('error');
        setError2(`Issue with this wallet, checked before spending a real attempt on it:\n${pre.problems.join('\n')}`);
        return;
      }
      setStep('executing');
      const result = await runNativeSpotTrade(directExecutor, { tokenAddress, usdtAmount: amountNum });
      setExecResult(result);
      setStep('done');
    } catch (e) {
      setStep('error');
      setError2(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

  return (
    <div className={`rounded-2xl border p-5 ${mutedBorder}`} style={{ background: surface }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg" style={{ background: `${accent}1a` }}><ArrowRightLeft size={16} style={{ color: accent }} /></div>
          <span className="font-bold text-sm">Trading Agent</span>
        </div>
        <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">Native</span>
      </div>
      <p className="text-xs opacity-60 mb-4">
        Compares real, live quotes for any BSC token across PancakeSwap, Biswap, and ApeSwap, and spot-buys through whichever genuinely offers the best price, with a real price-impact and liquidity-depth check shown before you sign, non-custodially, through your own connected wallet.
      </p>

      {!open && (
        <button onClick={() => setOpen(true)} className="w-full py-3 rounded-xl text-sm font-semibold text-white" style={{ background: accent }}>
          Trade →
        </button>
      )}

      {open && (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold block mb-1">Token address to buy</label>
            <input
              type="text" value={tokenAddress} disabled={!!step && step !== 'error' && step !== 'done'}
              onChange={(e) => setTokenAddress(e.target.value.trim())}
              placeholder="0x..."
              className={`w-full p-2.5 rounded-lg border text-sm font-mono outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`}
            />
          </div>

          <div>
            <label className="text-xs font-semibold block mb-1">Amount to spend (USDT)</label>
            <input
              type="number" value={usdtAmount} disabled={!!step && step !== 'error' && step !== 'done'}
              onChange={(e) => setUsdtAmount(e.target.value)}
              placeholder="10"
              className={`w-full p-2.5 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`}
            />
          </div>

          {quoteStatus === 'loading' && <div className="flex items-center gap-2 text-xs opacity-60"><Loader2 size={13} className="animate-spin" /> Reading the live pool...</div>}
          {quoteStatus === 'error' && <div className="text-xs text-red-500">{quoteError}</div>}

          {quoteStatus === 'ready' && quote && (
            <div className="p-3 rounded-xl border border-indigo-500/25 bg-indigo-500/5 text-[11px] text-indigo-700 dark:text-indigo-400 space-y-1">
              <div className="font-semibold mb-1">
                {quote.comparedCount > 1
                  ? `Why ${quote.winner.label}: real, live quotes checked on ${quote.comparedCount} DEXs — ${quote.winner.label} genuinely offered the best real price.`
                  : `Only ${quote.winner.label} had real, meaningful liquidity for this pair — the others checked (${quote.allQuotes.filter((q) => q.id !== quote.winner.id).map((q) => q.label).join(', ')}) didn't, shown honestly rather than a fabricated comparison.`}
              </div>
              {quote.allQuotes.map((q) => (
                <div key={q.id} className="flex justify-between opacity-80">
                  <span>{q.label}{q.id === quote.winner.id ? ' (used)' : ''}</span>
                  <span className="font-mono">
                    {q.amountOut > 0n && meta
                      ? (Number(q.amountOut) / 10 ** (meta.decimals ?? 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })
                      : 'no real route'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {quoteStatus === 'ready' && quote && (
            <div className="p-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 text-[11px] text-emerald-700 dark:text-emerald-400 space-y-1">
              <div><span className="font-semibold">You'd get: </span>{formattedOut || '...'}</div>
              <div className="flex gap-4">
                <span>Price impact: <span className="font-mono font-semibold">{quote.priceImpactPct != null ? `${quote.priceImpactPct.toFixed(2)}%` : 'n/a'}</span></span>
                <span>Pool depth used: <span className="font-mono font-semibold">{quote.tradeSizePctOfReserve != null ? `${quote.tradeSizePctOfReserve.toFixed(2)}%` : 'n/a'}</span></span>
              </div>
            </div>
          )}

          {/* Real, small price-trend CONTEXT only — not a recommendation,
              not technical analysis. Shown only when DefiLlama genuinely
              tracks this token; a real "not covered" case (trend===null)
              shows nothing rather than a fabricated 0%. */}
          {quoteStatus === 'ready' && trend && (
            <div className={`p-2.5 rounded-lg border text-[11px] opacity-70 flex items-center justify-between ${mutedBorder}`}>
              <span>
                {meta?.symbol || 'This token'} is {trend.pct24h >= 0 ? 'up' : 'down'}{' '}
                <span className={`font-mono font-semibold ${trend.pct24h >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {Math.abs(trend.pct24h).toFixed(2)}%
                </span>{' '}
                over 24h — context only, not a recommendation.
              </span>
              <span className="opacity-50 shrink-0 ml-2">via {trend.source}</span>
            </div>
          )}

          {/* Real holder composition from Binance's own Web3 Market API —
              a genuinely independent second risk source, since every
              signal above is derived from the same DEX pair reserves and
              so can describe the trade but never who holds the token.
              Shows only the fields Binance genuinely returns for this
              token and names the ones it has no data for, rather than
              rendering a missing value as a reassuring 0% — the same
              discipline as the trend block above. */}
          {quoteStatus === 'ready' && quote?.holderRisk && (
            <div className={`p-2.5 rounded-lg border text-[11px] space-y-1.5 ${mutedBorder}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold opacity-80">Who holds this token</span>
                <span className="opacity-50 shrink-0 ml-2">via Binance Market API</span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 opacity-80">
                {quote.holderRisk.top10_holders_pct != null && (
                  <span>Top 10 wallets: <span className="font-mono font-semibold">{quote.holderRisk.top10_holders_pct.toFixed(1)}%</span></span>
                )}
                {quote.holderRisk.dev_holding_pct != null && (
                  <span>Developer: <span className="font-mono font-semibold">{quote.holderRisk.dev_holding_pct.toFixed(2)}%</span></span>
                )}
                {quote.holderRisk.sniper_holding_pct != null && (
                  <span>Snipers: <span className="font-mono font-semibold">{quote.holderRisk.sniper_holding_pct.toFixed(1)}%</span></span>
                )}
                {quote.holderRisk.bundler_holding_pct != null && (
                  <span>Bundlers: <span className="font-mono font-semibold">{quote.holderRisk.bundler_holding_pct.toFixed(1)}%</span></span>
                )}
                {quote.holderRisk.new_wallet_holding_pct != null && (
                  <span>New wallets: <span className="font-mono font-semibold">{quote.holderRisk.new_wallet_holding_pct.toFixed(1)}%</span></span>
                )}
                {quote.holderRisk.holders != null && (
                  <span>Holders: <span className="font-mono font-semibold">{Number(quote.holderRisk.holders).toLocaleString()}</span></span>
                )}
              </div>
              {(quote.holderRisk.unavailable_fields?.length || 0) > 0 && (
                <div className="opacity-50">
                  No data for: {quote.holderRisk.unavailable_fields
                    .map((f) => HOLDER_FIELD_LABELS[f] || f).join(', ')} — genuinely
                  unreported for this token, not measured as zero.
                </div>
              )}
            </div>
          )}

          {hasWarnings && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-[11px] text-red-600 dark:text-red-400 space-y-2">
              {quote.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</div>
              ))}
              <label className="flex items-center gap-1.5 pt-1 cursor-pointer">
                <input type="checkbox" checked={ackRisk} onChange={(e) => setAckRisk(e.target.checked)} />
                I understand this trade's real risk and want to continue anyway.
              </label>
            </div>
          )}

          {amountNum > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <Info size={13} className="shrink-0 mt-0.5" />
              <span>
                Fee: {(NATIVE_AGENT_ENTRY_FEE_BPS / 100).toFixed(2)}% (<span className="font-mono font-semibold">{feeUsdt.toFixed(4)} USDT</span>)
              </span>
            </div>
          )}

          {!walletSnapshot && (
            <div className={`p-3 rounded-xl border text-left ${mutedBorder}`}>
              <div className="flex items-center gap-2 text-sm font-semibold mb-1"><Wallet size={14} style={{ color: accent }} /> Your connected wallet</div>
              <p className="text-[11px] opacity-60 mb-2">
                {directExecutor ? `Uses ${directExecutor.walletAddress.slice(0, 6)}...${directExecutor.walletAddress.slice(-4)} directly. You sign this yourself, right then.` : 'Connect a wallet to continue — you sign this yourself, right then.'}
              </p>
              {!directExecutor && <ConnectButton />}
            </div>
          )}

          {step && step !== 'error' && (
            <div className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/10 text-xs flex items-center gap-2">
              {step !== 'done' && <Loader2 size={13} className="animate-spin" style={{ color: accent }} />}
              {step === 'done' && <CheckCircle2 size={13} className="text-green-500" />}
              {{ executing: 'Confirm this in your wallet...', done: `Done. Traded on ${execResult?.dexLabel || 'the selected DEX'}, fee paid.` }[step]}
            </div>
          )}
          {step === 'error' && error2 && (
            <div className="p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-500 space-y-2">
              <div className="whitespace-pre-wrap">{error2}</div>
            </div>
          )}

          {walletSnapshot ? (
            <WalletConfirmStep snapshot={walletSnapshot} onContinue={handleContinueWithWallet} continueLabel="Trade" />
          ) : (
            <button onClick={handleUseDirectWallet} disabled={!canRun || !directExecutor || (!!step && step !== 'error' && step !== 'done')}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
              {step === 'done' ? 'Done ✓' : execResult ? 'Run again' : 'Continue →'}
            </button>
          )}

          <button onClick={() => setOpen(false)} className="text-xs opacity-60 hover:opacity-100 flex items-center gap-1"><ChevronRight size={13} className="rotate-180" /> Collapse</button>
        </div>
      )}
    </div>
  );
}

function ComingSoonAgentCard({ icon: Icon, title, blurb, accent, surface, mutedBorder, learnMoreHref }) {
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
      {learnMoreHref && (
        <a href={learnMoreHref} className="text-xs font-semibold mt-2 inline-block hover:underline" style={{ color: accent }}>
          Read the full research →
        </a>
      )}
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
        <TradingNativeAgentCard accent={accent} surface={surface} mutedBorder={mutedBorder} darkMode={darkMode} />
        <ComingSoonAgentCard icon={TrendingUp} title="Lending / Borrowing Agent" accent={accent} surface={surface} mutedBorder={mutedBorder}
          blurb="Autonomous collateral and health-factor management across Venus and Aave. Needs its own dedicated liquidation-risk UI, so it's being built as its own complete piece, not bundled in half-finished." />
        {/* Real finding, 2026-09-04: checked Avantis's own docs + Base's
            official MCP plugin docs directly. The earlier "no bridge from
            BSC" blocker is stale -- Base is a standard chain a connected
            wallet can just switch to. The REAL blocker found instead:
            Avantis trades aren't self-encodable (calldata is built via a
            live call to their own tx-builder.avantisfi.com, not a known,
            fixed ABI) and don't settle atomically (a signed order fills
            asynchronously, "usually within seconds," and genuinely
            expires unfilled after ~15-30s) -- a materially different,
            more complex integration shape than every other Native Agent
            here, not a smaller version of the same pattern. Not built;
            copy below states this honestly instead of the old, now-wrong
            reasoning. */}
        <ComingSoonAgentCard icon={Bot} title="Perpetuals Agent" accent={accent} surface={surface} mutedBorder={mutedBorder}
          blurb="Investigated (2026-09-04): Avantis (Base) trades require a live call to their own off-chain calldata-builder API and settle asynchronously, filling within seconds or expiring unfilled -- a real, structurally different pattern than the direct, atomic, single-transaction agents here. Not built; a plain positions dashboard remains a real, smaller, honest option if wanted later." />
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
        {/* Vision/roadmap card only — no code behind this one, unlike
            Staking/Trading above. See this file's own top-of-file comment
            and docs/future-tnega-paybox.md for the full real research. */}
        <ComingSoonAgentCard icon={ShoppingBag} title="Web2 Agents + PayBox" accent={accent} surface={surface} mutedBorder={mutedBorder}
          learnMoreHref="/docs/future-tnega-paybox"
          blurb="Bridges Web2 AI shopping/commerce agents, like Anthropic's open-source Commerce Agents blueprint, which builds a complete, tailored cart (age, size, culture, event) but stops at checkout, never completing payment, to on-chain settlement via Tnega PayBox. MoonPay's confirmed direct BSC support is the near-term rail; multi-chain later. A separate, much larger idea, describe an agent in a prompt and get one built and wired to payment automatically, is its own future project, not scoped here." />
      </div>
    </div>
  );
}
