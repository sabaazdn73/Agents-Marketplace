// AltanaSkillsPanel.jsx
//
// Live data from Altana's public Skills Registry
// (raw.githubusercontent.com/altananetwork/skills/main/index.json,
// confirmed live 9 Aug 2026: 10 fork-tested skills). Each skill is
// pre-built, audited protocol know-how (PancakeSwap trading, Venus
// lending, copy-trading, etc.) that an agent can use immediately.
//
// Designed for the "assume the user isn't crypto-native" requirement:
// every skill shows what it CAN and CANNOT do in plain sentences, and
// an example phrase, before any technical detail.
//
// Execution wallet, updated 2026-09-03: every transaction Skill (Venus,
// Aave, Lista, PancakeSwap, Four Meme) now runs ONLY through the user's
// own connected wallet — the Altana spend-capped passkey-wallet option was
// removed. Decisive finding before removal: a full scan of the complete
// ERC-8183 job index found zero jobs of any status ever completed through
// Altana's session path, and this project's own real Skill successes are
// all recorded via the direct-wallet path specifically (see docs/
// limitations.md and docs/features.md's Advantage Report). x402-payments
// is the one exception: it still uses a scoped Altana passkey session,
// since x402 settlement genuinely depends on Altana's own facilitator
// infrastructure — there is no direct-wallet equivalent for it.

import React, { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Sparkles, Loader2, CheckCircle2, XCircle, ChevronRight, Wallet } from 'lucide-react';
import { PERMIT2_ADDRESS } from '@altananetwork/sdk';
import { recoverAltanaWallet, createNewAltanaWallet, fetchWalletBalanceSnapshot, grantSkillSession, getAltanaExecutor, getMainnetReadClient } from './altana';
import { useDirectWalletExecutor } from './useDirectWalletExecutor';
import WalletConfirmStep from './WalletConfirmStep';
import { executeEnterPosition, PANCAKESWAP_ROUTER, WBNB, USDT_BSC } from './pancakeswapSkill';
import { venusSupply, venusSupplyPreflight, aaveSupply, listaStake, pancakeAddLiquidity, VENUS_VUSDT, AAVE_POOL, LISTA_MANAGER } from './defiSkills';
import { buyOnCurve, TOKEN_MANAGER_2, TOKEN_MANAGER_HELPER_3 } from './fourMemeSkill';
import { detectLeaderTrades } from './copyTradeSkill';
import { payOnce } from './x402Skill';
import { getTrendingBscTokens, getRecentWalletSwaps } from './researchSkills';

// Single source of truth for the backend base URL, matching the main app
// (web/mobile both read VITE_API_BASE_URL). Default suits local dev.
const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

// Bug fixed 2026-08-19: this used to be a direct browser fetch to
// raw.githubusercontent.com/altananetwork/skills/main/index.json — GitHub's
// raw-content CDN rate-limits by source IP, and that limit is SHARED across
// everyone behind the same IP (VPNs, corporate NAT, cloud/CGNAT egress), so
// a visitor could get a 429 through no fault of their own, and it wasn't
// reproducible from any one tester's machine. Now proxied through our own
// backend (GET /api/skills-registry), which fetches the registry
// server-side once and caches it — one fetch serves every visitor instead
// of one fetch per visitor.
const SKILLS_INDEX_URL = `${API_BASE}/api/skills-registry`;

// Whole units -> raw 18-decimal bigint (USDT, BNB, and most BSC tokens here).
const toRaw18 = (v) => BigInt(Math.round(Number(v) * 1e18));

// Wires each skill's guided-form values (registry input ids) to its
// execution function via the shared executor abstraction. `contracts` /
// `spendToken` scope the x402 skill's Altana session specifically (the
// only skill still using one). `play` selects which inputs the form shows
// and labels the recorded run.
const SKILL_EXEC = {
  'pancakeswap-trading': {
    play: 'enter-position', contracts: [PANCAKESWAP_ROUTER, USDT_BSC, WBNB], spendToken: USDT_BSC,
    ready: (v) => v.token && v.amountUsdt,
    run: (ex, v) => executeEnterPosition(ex, { tokenAddress: v.token, usdtAmount: Number(v.amountUsdt), slippagePct: Number(v.slippagePct || 1) }),
  },
  'venus-lending': {
    play: 'supply', contracts: [VENUS_VUSDT, USDT_BSC], spendToken: USDT_BSC,
    ready: (v) => v.amountUsdt,
    run: (ex, v) => venusSupply(ex, { usdtAmount: Number(v.amountUsdt) }),
    // Added 2026-08-28 (see defiSkills.js's own docstring for the full
    // incident this came from) — a read-only balance/gas check right
    // before an attempt runs. Never blocks; just surfaces a concrete
    // reason a doomed attempt would fail, instead of letting it hit the
    // relay and come back as a raw "0x/0x" revert.
    preflight: (readClient, walletAddress, v) => venusSupplyPreflight(readClient, walletAddress, Number(v.amountUsdt)),
  },
  'aave-v3-lending': {
    play: 'supply', contracts: [AAVE_POOL, USDT_BSC], spendToken: USDT_BSC,
    ready: (v) => v.amountUsdt,
    run: (ex, v) => aaveSupply(ex, { usdtAmount: Number(v.amountUsdt) }),
  },
  'lista-staking': {
    play: 'stake', contracts: [LISTA_MANAGER], spendToken: undefined,
    ready: (v) => v.amountBnb,
    run: (ex, v) => listaStake(ex, { bnbAmount: Number(v.amountBnb) }),
  },
  'four-meme': {
    play: 'buy-on-curve', contracts: [TOKEN_MANAGER_2, TOKEN_MANAGER_HELPER_3], spendToken: undefined,
    ready: (v) => v.token && v.amountBnb,
    run: (ex, v) => buyOnCurve(ex, { tokenAddress: v.token, bnbToSpend: Number(v.amountBnb), slippagePct: Number(v.slippagePct || 3) }),
  },
  'pancakeswap-liquidity': {
    play: 'add-liquidity', contracts: [PANCAKESWAP_ROUTER], spendToken: undefined,
    ready: (v) => v.tokenA && v.tokenB && v.amount,
    run: (ex, v) => pancakeAddLiquidity(ex, { tokenA: v.tokenA, tokenB: v.tokenB, amountADesired: toRaw18(v.amount), slippagePct: Number(v.slippagePct || 1) }),
  },

  // ── Read-only / detection skills (no wallet, no transactions) ──
  // These make no on-chain writes, so a wallet doesn't apply.
  // `run` gets a BSC mainnet read client and returns data for display.
  'dexscreener-token-radar': {
    play: 'trending-scan', kind: 'read',
    ready: () => true,
    run: async (_pc, v) => {
      const tokens = await getTrendingBscTokens();
      return { kind: 'trending', tokens: tokens.slice(0, Number(v.count) || 5) };
    },
  },
  'wallet-tracker': {
    play: 'profile-wallet', kind: 'read',
    ready: (v) => v.wallet,
    run: async (pc, v) => {
      const blockWindow = v.windowBlocks ? BigInt(Math.floor(Number(v.windowBlocks))) : 5000n;
      return { kind: 'swaps', ...(await getRecentWalletSwaps(pc, v.wallet, { blockWindow })) };
    },
  },
  'copy-trade': {
    play: 'detect', kind: 'read',
    ready: (v) => v.leaderWallet,
    run: async (pc, v) => {
      // Detection-only: surface what the leader traded. Mirroring is not
      // auto-executed (that would need a funded wallet acting on your behalf).
      const trades = await detectLeaderTrades(pc, v.leaderWallet, {});
      return { kind: 'leader-trades', detected: trades.length, trades: trades.slice(0, 10) };
    },
  },

  // ── x402 payment skill: needs a real session (a live facilitator settles
  // it) — the one skill that still uses Altana's passkey wallet. ──
  'x402-payments': {
    play: 'pay-once', kind: 'pay',
    contracts: [PERMIT2_ADDRESS, USDT_BSC], spendToken: USDT_BSC,
    ready: (v) => v.resourceUrl,
    run: async (session, v) => {
      const maxPriceRaw = v.maxPricePerPaymentUsd ? toRaw18(v.maxPricePerPaymentUsd) : undefined;
      const resp = await payOnce(session, v.resourceUrl, { maxPriceRaw });
      return { kind: 'x402', status: resp.status, ok: resp.ok, url: v.resourceUrl };
    },
  },
};

// Friendly copy for the user-facing error — the technical detail (status
// code, message) still goes to the console for anyone actually debugging
// it, never shown raw in the UI.
const SKILLS_LOAD_FRIENDLY_ERROR = "Couldn't load the skills list right now. This sometimes happens — give it another try.";

function useAltanaSkills() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const retry = () => setRetryTick((t) => t + 1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(SKILLS_INDEX_URL)
      .then((r) => { if (!r.ok) throw new Error(`Registry returned ${r.status}`); return r.json(); })
      .then((data) => { if (!cancelled) { setSkills(data.skills || []); setLoading(false); } })
      .catch((e) => {
        if (cancelled) return;
        console.error('[AltanaSkillsPanel] skills registry load failed:', e.message || e);
        setError(SKILLS_LOAD_FRIENDLY_ERROR);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [retryTick]);

  return { skills, loading, error, retry };
}

function SkillCard({ skill, accent, surface, mutedBorder, onSelect }) {
  return (
    <button onClick={() => onSelect(skill)} className={`text-left w-full rounded-2xl border p-5 ${mutedBorder} hover:border-opacity-60 transition-colors`} style={{ background: surface }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm">{skill.name}</span>
        <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full" style={{ background: `${accent}22`, color: accent }}>{skill.category}</span>
      </div>
      <p className="text-xs opacity-60 mb-3">{skill.description}</p>
      <div className="text-[11px] italic opacity-50 mb-3">"{skill.display?.exampleAsk}"</div>
      <div className="space-y-1">
        {(skill.display?.may || []).slice(0, 2).map((m, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={11} /> {m}</div>
        ))}
        {(skill.display?.mayNot || []).slice(0, 1).map((m, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] opacity-40"><XCircle size={11} /> {m}</div>
        ))}
      </div>
    </button>
  );
}

function SkillGuidedForm({ skill, accent, surface, mutedBorder, darkMode, onBack }) {
  const [values, setValues] = useState({});
  const [spendCap, setSpendCap] = useState(skill.scope?.spendCapSuggested?.match(/\d+/)?.[0] || 20);
  const [session, setSession] = useState(null);
  const [step, setStep] = useState(null); // null | 'funding' | 'wallet' | 'granting' | 'executing' | 'done' | 'error'
  const [error, setError] = useState(null);
  const [execResult, setExecResult] = useState(null);
  // Added 2026-08-28 — see altana.js's own docstring for the full incident
  // this fixes: wallet recovery failing no longer silently creates a
  // brand-new wallet. This flags that an explicit choice is needed from
  // the user instead. Only reachable for x402 now (the only skill still
  // using a passkey wallet).
  const [needsWalletChoice, setNeedsWalletChoice] = useState(false);
  // Added 2026-08-28 (see WalletConfirmStep.jsx) — a wallet that's been
  // recovered/created/connected but not yet confirmed by the user, and its
  // live BNB/USDT balance snapshot. Nothing proceeds to granting a session
  // (or, for a direct wallet, to signing anything) until the user
  // explicitly continues past this. Shape: { address, mode: 'passkey'|
  // 'direct', signer? } — signer only for passkey wallets.
  const [pendingWallet, setPendingWallet] = useState(null);
  const [walletSnapshot, setWalletSnapshot] = useState(null);
  const directExecutor = useDirectWalletExecutor();

  // Execution config for this skill. All 10 registry skills are wired; a
  // skill id not in SKILL_EXEC (shouldn't happen for the real registry) is
  // disclosed as not-yet-executable. `kind`: 'tx' (on-chain writes, always
  // the user's own connected wallet), 'read' (read-only/detection, no
  // wallet), 'pay' (x402, the one skill still using an Altana session).
  const exec = SKILL_EXEC[skill.id];
  const isExecutable = !!exec;
  const kind = exec?.kind || 'tx';
  const play = exec?.play || 'enter-position';
  const relevantInputs = (skill.inputs || []).filter((inp) => !inp.plays || inp.plays.includes(play));

  // Added 2026-08-28 (see WalletConfirmStep.jsx's own docstring for the
  // full incident this fixes) — a wallet was just recovered, created, or
  // connected; fetch its live balance snapshot and PAUSE here for an
  // explicit user confirmation, rather than silently proceeding straight
  // to granting a session or signing something against a wallet the user
  // never actually got to look at first.
  const presentWalletForConfirmation = async (walletLike) => {
    setStep(null);
    const snapshot = await fetchWalletBalanceSnapshot(walletLike.address, USDT_BSC);
    setPendingWallet(walletLike);
    setWalletSnapshot(snapshot);
  };

  // Shared "run against whichever executor we ended up with" — used by
  // both the x402 passkey path (after granting a session) and the direct
  // path (no session, no granting, the connected wallet itself).
  const runAgainstExecutor = async (executor) => {
    // Added 2026-08-28 — see defiSkills.js's own docstring for the full
    // incident this came from. A read-only check against this exact
    // wallet's own on-chain state, before spending a session grant + relay
    // attempt (or a direct signature) on something already known to fail.
    if (exec.preflight) {
      const pre = await exec.preflight(getMainnetReadClient(), executor.walletAddress, values);
      if (!pre.ok) {
        setStep('error');
        setError(`Issue with this wallet, checked before spending a real attempt on it:\n${pre.problems.join('\n')}`);
        return;
      }
    }
    if (exec.ready(values)) {
      setStep('executing');
      const result = await exec.run(executor, values);
      setExecResult(result);
    }
    setStep('done');
  };

  // The user's own already-connected wallet, direct signature, no new
  // wallet, no spend-cap session (see useDirectWalletExecutor.js for the
  // full tradeoff this trades away vs. gains). The only wallet path for
  // every 'tx' skill now.
  const handleUseDirectWallet = async () => {
    setError(null);
    setExecResult(null);
    if (!directExecutor) return; // not connected yet — the UI shows a ConnectButton for this
    await presentWalletForConfirmation({ address: directExecutor.walletAddress, mode: 'direct' });
  };

  // A scoped Altana passkey wallet — only ever used for x402-payments now
  // (x402 settlement genuinely depends on Altana's own facilitator
  // infrastructure; there's no direct-wallet equivalent for it). ONLY
  // ever tries to recover an existing wallet — never auto-creates a new
  // one on failure (see altana.js's own docstring for the incident this
  // fixes: several identically-labeled saved passkeys leading to orphaned,
  // empty wallets being silently created on every hiccup).
  const handleUsePasskeyWallet = async () => {
    setError(null);
    setExecResult(null);
    setNeedsWalletChoice(false);
    try {
      setStep('wallet');
      const wallet = await recoverAltanaWallet();
      await presentWalletForConfirmation({ ...wallet, mode: 'passkey' });
    } catch (e) {
      setStep('error');
      setNeedsWalletChoice(true);
      setError(e.message || String(e));
    }
  };

  // Top-level entry point the main button calls. 'read' runs immediately
  // (no wallet at all); 'pay' uses the Altana passkey session; 'tx' always
  // uses the connected wallet.
  const handleGrantAndRun = async () => {
    setError(null);
    setExecResult(null);
    if (kind === 'read') {
      setStep('reading');
      try {
        const result = await exec.run(getMainnetReadClient(), values);
        setExecResult(result);
        setStep('done');
      } catch (e) {
        setStep('error');
        setError(e.message || String(e));
      }
      return;
    }
    if (kind === 'pay') {
      await handleUsePasskeyWallet();
    } else {
      await handleUseDirectWallet();
    }
  };

  // The one, explicit, user-confirmed action that ever creates a brand-new
  // wallet — only reachable from the x402 recovery-error state.
  const handleConfirmNewWallet = async () => {
    setError(null);
    setNeedsWalletChoice(false);
    try {
      setStep('wallet');
      const wallet = await createNewAltanaWallet();
      await presentWalletForConfirmation({ ...wallet, mode: 'passkey' });
    } catch (e) {
      setStep('error');
      setError(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

  // The one place a session actually gets granted/executed (or, for a
  // direct wallet, the one place anything gets signed) — only ever
  // reached after the user has seen the real wallet + real balances above
  // and explicitly clicked through.
  const handleContinueWithWallet = async () => {
    const w = pendingWallet;
    setPendingWallet(null);
    setWalletSnapshot(null);
    try {
      if (w.mode === 'direct') {
        await runAgainstExecutor(directExecutor);
        return;
      }
      // Only x402 (kind === 'pay') reaches here now.
      setStep('granting');
      const s = await grantSkillSession(w, w.signer, {
        contractAddresses: exec.contracts || [], spendToken: exec.spendToken,
        spendCapUnits: Number(spendCap), expiryHours: 24,
      });
      setSession(s);
      setStep('executing');
      const result = await exec.run(s, values);
      setExecResult(result);
      setStep('done');
    } catch (e) {
      setStep('error');
      // Added 2026-08-28 (see altana.js's decodeAltanaExecutionError): an
      // execute() failure now carries a decoded `.realReason` alongside
      // its own original message — shown first when present, since it's
      // the more specific, actionable finding; the raw SDK message stays
      // too, never hidden.
      setError(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

  const handleTryDifferentPasskey = () => {
    setPendingWallet(null);
    setWalletSnapshot(null);
    handleUsePasskeyWallet();
  };

  return (
    <div className={`rounded-2xl border p-5 ${mutedBorder}`} style={{ background: surface }}>
      <button onClick={onBack} className="text-xs opacity-60 hover:opacity-100 mb-4 flex items-center gap-1"><ChevronRight size={13} className="rotate-180" /> Back to skills</button>
      <h3 className="font-bold text-lg mb-1">{skill.name}</h3>
      <p className="text-xs opacity-60 mb-5">Fill this in, in plain terms, no code.</p>

      {kind === 'tx' && (
        <div className="mb-5 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 text-[11px] text-indigo-700 dark:text-indigo-300">
          Through your own connected wallet: you sign it yourself, right then, actual money.
        </div>
      )}

      {/* Added 2026-08-28 (see useDirectWalletExecutor.js's own docstring
          for the full product question this answers), simplified 2026-09-03
          to a single path: every 'tx' skill runs through the user's own
          connected wallet, shown here before anything else. */}
      {kind === 'tx' && !directExecutor && !walletSnapshot && (
        <div className="mb-5 p-3 rounded-xl border border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2"><Wallet size={14} style={{ color: accent }} /> Connect your wallet</div>
          <p className="text-[11px] opacity-60 mb-2">You sign each run yourself, right then — no new wallet, nothing to fund separately.</p>
          <ConnectButton />
        </div>
      )}

      {kind === 'read' && (
        <div className="mb-5 p-3 rounded-xl border border-sky-500/30 bg-sky-500/5 text-[11px] text-sky-700 dark:text-sky-300">
          Just looking, not spending: this skill checks live information and shows it to you. It doesn't spend any money, so it needs no wallet and no spending limit.
        </div>
      )}
      {kind === 'pay' && (
        <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400">
          This makes a payment to a web address, handled by an outside payment service — so it needs a wallet with a spending limit you set.
        </div>
      )}

      {!isExecutable && (
        <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400">
          This skill isn't available to run yet.
        </div>
      )}

      <div className="space-y-4 mb-5">
        {relevantInputs.map((inp) => (
          <div key={inp.id}>
            <label className="text-xs font-semibold block mb-1">{inp.label}{inp.required && <span className="text-red-400"> *</span>}</label>
            <input
              type={inp.type === 'percent' || inp.type === 'usd' ? 'number' : 'text'}
              placeholder={inp.default !== undefined ? String(inp.default) : ''}
              value={values[inp.id] ?? ''}
              disabled={!!step && step !== 'error' && step !== 'done'}
              onChange={(e) => setValues((v) => ({ ...v, [inp.id]: e.target.value }))}
              className={`w-full p-2.5 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`}
            />
            {inp.help && <p className="text-[10px] opacity-40 mt-1">{inp.help}</p>}
          </div>
        ))}
      </div>

      {/* A directly-connected wallet has no on-chain session/spend-cap
          concept at all — this input only means anything for x402's
          spend-capped passkey wallet now. */}
      {kind === 'pay' && (
        <div className="mb-5">
          <label className="text-xs font-semibold block mb-1">Your spending limit</label>
          <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} disabled={!!step && step !== 'error' && step !== 'done'}
            className={`w-full p-2.5 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`} />
          <p className="text-[10px] opacity-40 mt-1">Suggested amount: {skill.scope?.spendCapSuggested}. This limit is enforced automatically, no matter what the skill tries to do.</p>
        </div>
      )}

      {kind === 'pay' && (skill.scope?.contracts || []).length > 0 && (
        <div className={`p-3 rounded-xl border ${mutedBorder} text-[11px] opacity-60 mb-5`}>
          What this can touch: {(skill.scope?.contracts || []).join(', ')}. Nothing else, ever, during this session.
        </div>
      )}

      {step && step !== 'error' && (
        <div className="mb-4 p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/10 text-xs flex items-center gap-2">
          {step !== 'done' && <Loader2 size={13} className="animate-spin" style={{ color: accent }} />}
          {step === 'done' && <CheckCircle2 size={13} className="text-green-500" />}
          {{
            reading: 'Looking up the live information...',
            wallet: 'Setting up your mini-wallet (confirm with Face ID or your fingerprint)...',
            granting: 'Setting your spending limit...',
            executing: kind === 'pay' ? 'Running it for real...' : 'Confirm this in your wallet...',
            done: execResult
              ? (execResult.expectedAmountOut
                  ? `Done. Expected ~${(Number(execResult.expectedAmountOut) / 1e18).toFixed(4)} tokens.`
                  : 'Done.')
              : 'Limit set.',
          }[step]}
        </div>
      )}
      {step === 'error' && error && (
        <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-500 space-y-2">
          <div className="whitespace-pre-wrap">{error}</div>
          <button onClick={handleGrantAndRun} className="text-[11px] font-semibold underline" style={{ color: accent }}>
            Try again
          </button>
          {/* Added 2026-08-28 — see altana.js's own docstring for the full
              incident this fixes. Never auto-creates a new wallet on a
              recovery failure anymore; this is the one, explicit,
              user-confirmed path that does. Only reachable for x402 now. */}
          {needsWalletChoice && (
            <div className="pt-2 mt-2 border-t border-red-500/20 space-y-1.5">
              <p className="text-gray-500 dark:text-gray-400">If you've set up a wallet here before, tap "Try again" above and pick that SAME saved passkey. Only tap below if this is genuinely your first time — it creates a brand-new, empty wallet.</p>
              <button onClick={handleConfirmNewWallet} className="w-full py-2 rounded-xl text-[11px] font-semibold border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10">
                This is genuinely my first time: create a new wallet
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'done' && execResult && execResult.kind && (
        <div className={`mb-4 p-3 rounded-xl border ${mutedBorder} text-[11px]`}>
          <div className="font-semibold mb-1 opacity-70">Result</div>
          <pre className="whitespace-pre-wrap break-all max-h-64 overflow-auto opacity-80">
{JSON.stringify(execResult, (k, val) => (typeof val === 'bigint' ? val.toString() : val), 2)}
          </pre>
        </div>
      )}

      {/* Added 2026-08-28 (see WalletConfirmStep.jsx) — a wallet was just
          recovered/created/connected; PAUSE here until the user explicitly
          confirms it, instead of the main run button below. */}
      {walletSnapshot ? (
        <div className="mb-4">
          <WalletConfirmStep
            snapshot={walletSnapshot}
            onContinue={handleContinueWithWallet}
            onTryDifferent={pendingWallet?.mode !== 'direct' ? handleTryDifferentPasskey : undefined}
            continueLabel={kind === 'pay' ? 'Set limit & pay' : 'Run this'}
          />
        </div>
      ) : (
        // For 'tx' skills, the connect-wallet prompt above is the entry
        // point until a wallet is connected; this button reappears once
        // one is (i.e. for "Run again" after a completed or errored
        // attempt), and is always the entry point for 'read'/'pay'.
        !(kind === 'tx' && !directExecutor) && (
          <button onClick={handleGrantAndRun} disabled={(!!step && step !== 'error' && step !== 'done') || !isExecutable} className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
            {step === 'done' ? 'Done ✓'
              : !isExecutable ? 'Not available'
              : kind === 'read' ? 'Look it up →'
              : kind === 'pay' ? 'Set limit & pay →'
              : (session || execResult) ? 'Run again'
              : 'Run this →'}
          </button>
        )
      )}
    </div>
  );
}

export default function AltanaSkillsPanel({ accent, surface, mutedBorder, darkMode, initialSkillId, onConsumedInitialSkill }) {
  const { skills, loading, error, retry } = useAltanaSkills();
  const [selected, setSelected] = useState(null);

  // Deep-link from the agent detail page's guidance panel ("Try it
  // yourself") — once the skills registry has loaded, auto-open the
  // specific skill it pointed at, once.
  useEffect(() => {
    if (!initialSkillId || loading || skills.length === 0) return;
    const match = skills.find((s) => s.id === initialSkillId);
    if (match) setSelected(match);
    onConsumedInitialSkill?.();
  }, [initialSkillId, loading, skills, onConsumedInitialSkill]);

  if (selected) {
    return <SkillGuidedForm skill={selected} accent={accent} surface={surface} mutedBorder={mutedBorder} darkMode={darkMode} onBack={() => setSelected(null)} />;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={16} style={{ color: accent }} />
        <span className="text-sm font-bold">Ready-made skills</span>
      </div>
      <p className="text-xs opacity-60 mb-4">
        Ready-made abilities you can try right away — tested safely beforehand. No building required, just fill in the blanks.
      </p>

      {loading && <div className="flex items-center gap-2 text-xs opacity-60 py-6"><Loader2 size={14} className="animate-spin" /> Loading the list of skills...</div>}
      {error && (
        <div className="py-4 space-y-2">
          <div className="text-xs text-red-500">{error}</div>
          <button onClick={retry} className="text-xs font-semibold underline" style={{ color: accent }}>Try again</button>
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {skills.map((s) => (
            <SkillCard key={s.id} skill={s} accent={accent} surface={surface} mutedBorder={mutedBorder} onSelect={setSelected} />
          ))}
        </div>
      )}
    </div>
  );
}
