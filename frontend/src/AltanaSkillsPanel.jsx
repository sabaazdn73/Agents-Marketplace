// AltanaSkillsPanel.jsx
//
// Real, live data from Altana's public Skills Registry
// (raw.githubusercontent.com/altananetwork/skills/main/index.json,
// confirmed live 9 Aug 2026: 10 real, fork-tested skills). Each skill
// is pre-built, audited protocol know-how (PancakeSwap trading, Venus
// lending, copy-trading, etc.) that an agent can use immediately,
// scoped by a real on-chain session with a spend cap the user sets.
//
// Designed for the "assume the user isn't crypto-native" requirement:
// every skill shows what it CAN and CANNOT do in plain sentences, and
// a real example phrase, before any technical detail.

import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import { PERMIT2_ADDRESS } from '@altananetwork/sdk';
import { recoverAltanaWallet, createNewAltanaWallet, grantSkillSession, getAltanaExecutor, getMainnetReadClient } from './altana';
import { executeEnterPosition, PANCAKESWAP_ROUTER, WBNB, USDT_BSC } from './pancakeswapSkill';
import { venusSupply, venusSupplyPreflight, aaveSupply, listaStake, pancakeAddLiquidity, VENUS_VUSDT, AAVE_POOL, LISTA_MANAGER } from './defiSkills';
import { buyOnCurve, TOKEN_MANAGER_2, TOKEN_MANAGER_HELPER_3 } from './fourMemeSkill';
import { detectLeaderTrades } from './copyTradeSkill';
import { payOnce } from './x402Skill';
import { getTrendingBscTokens, getRecentWalletSwaps } from './researchSkills';

// Single source of truth for the backend base URL, matching the main app
// (web/mobile both read VITE_API_BASE_URL). Default suits local dev.
const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

// Real bug fixed 2026-08-19: this used to be a direct browser fetch to
// raw.githubusercontent.com/altananetwork/skills/main/index.json — GitHub's
// raw-content CDN rate-limits by source IP, and that limit is SHARED across
// everyone behind the same IP (VPNs, corporate NAT, cloud/CGNAT egress), so
// a real visitor could get a real 429 through no fault of their own, and it
// wasn't reproducible from any one tester's machine. Now proxied through our
// own backend (GET /api/skills-registry), which fetches the real registry
// server-side once and caches it — one fetch serves every visitor instead of
// one fetch per visitor.
const SKILLS_INDEX_URL = `${API_BASE}/api/skills-registry`;

// Whole units -> raw 18-decimal bigint (USDT, BNB, and most BSC tokens here).
const toRaw18 = (v) => BigInt(Math.round(Number(v) * 1e18));

// Wires each skill's guided-form values (real registry input ids) to its
// execution function via the shared executor abstraction. `contracts` /
// `spendToken` scope the real Altana session. `play` selects which inputs
// the form shows and labels the recorded run.
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
    // Real, added 2026-08-28 (see defiSkills.js's own docstring for the
    // full real incident this came from) — a real, read-only balance/gas
    // check right before a real attempt. Never blocks; just surfaces a
    // real, concrete reason a doomed attempt would fail, instead of
    // letting it hit the relay and come back as a raw "0x/0x" revert.
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
  // These make no on-chain writes, so a session doesn't apply.
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
      // auto-executed (that would need a real session + funded wallet).
      const trades = await detectLeaderTrades(pc, v.leaderWallet, {});
      return { kind: 'leader-trades', detected: trades.length, trades: trades.slice(0, 10) };
    },
  },

  // ── x402 payment skill: needs a real session (a live facilitator settles
  // it). ──
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

// Honest, friendly copy for the user-facing error — the real technical
// detail (status code, message) still goes to the console for anyone
// actually debugging it, never shown raw in the UI.
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
  // Real, added 2026-08-28 — see altana.js's own docstring for the full
  // real incident this fixes: wallet recovery failing no longer silently
  // creates a brand-new wallet. This flags that a real, explicit choice
  // is needed from the user instead.
  const [needsWalletChoice, setNeedsWalletChoice] = useState(false);

  // Execution config for this skill. All 10 registry skills are wired; a skill
  // id not in SKILL_EXEC (shouldn't happen for the real registry) is disclosed
  // as not-yet-executable. `kind`: 'tx' (on-chain writes), 'read' (read-only/
  // detection, no wallet), 'pay' (x402, real session).
  const exec = SKILL_EXEC[skill.id];
  const isExecutable = !!exec;
  const kind = exec?.kind || 'tx';
  const play = exec?.play || 'enter-position';
  const relevantInputs = (skill.inputs || []).filter((inp) => !inp.plays || inp.plays.includes(play));

  // Real continuation once a real wallet (recovered OR freshly, explicitly
  // created) is in hand — shared by both the normal recovery path and
  // handleConfirmNewWallet below, for 'pay' and 'tx' skills alike.
  const runWithWallet = async (wallet) => {
    if (kind === 'pay') {
      setStep('granting');
      const s = await grantSkillSession(wallet, wallet.signer, {
        contractAddresses: exec.contracts || [], spendToken: exec.spendToken,
        spendCapUnits: Number(spendCap), expiryHours: 24,
      });
      setSession(s);
      setStep('executing');
      const result = await exec.run(s, values);
      setExecResult(result);
      setStep('done');
      return;
    }

    // Real, added 2026-08-28 — see defiSkills.js's own docstring for the
    // full real incident this came from. A real, read-only check against
    // this exact wallet's own real on-chain state, before spending a
    // real session grant + relay attempt on something already known to
    // fail. Stops here ONLY on a real, high-confidence finding (this
    // exact wallet's own real balance is genuinely insufficient) — real,
    // wasted gas/relay cost otherwise, for an attempt that couldn't have
    // succeeded regardless. Doesn't rule out every real cause (e.g. a
    // session-scope rejection isn't checkable this way), so a clean
    // preflight never claims the real attempt WILL succeed, only that
    // this specific, checkable real reason isn't why it would fail.
    if (exec.preflight) {
      const pre = await exec.preflight(getMainnetReadClient(), wallet.address, values);
      if (!pre.ok) {
        setStep('error');
        setError(`Real, current issue with this wallet, checked before spending a real attempt on it:\n${pre.problems.join('\n')}`);
        return;
      }
    }

    setStep('granting');
    const s = await grantSkillSession(wallet, wallet.signer, {
      contractAddresses: exec.contracts || [], spendToken: exec.spendToken,
      spendCapUnits: Number(spendCap), expiryHours: 24,
    });
    setSession(s);
    const executor = getAltanaExecutor(s);

    if (exec.ready(values)) {
      setStep('executing');
      const result = await exec.run(executor, values);
      setExecResult(result);
    }
    setStep('done');
  };

  const handleGrantAndRun = async () => {
    setError(null);
    setExecResult(null);
    setNeedsWalletChoice(false);
    try {
      // ── Read-only / detection skills: no wallet, no session, no funding ──
      if (kind === 'read') {
        setStep('reading');
        const result = await exec.run(getMainnetReadClient(), values);
        setExecResult(result);
        setStep('done');
        return;
      }

      // ── 'pay' and 'tx' skills both need a real wallet first. Real,
      // deliberate: ONLY ever tries to recover an existing real wallet
      // here — never auto-creates a new one on failure (see altana.js's
      // own docstring for the real incident this fixes: several
      // identically-labeled saved passkeys leading to real, orphaned,
      // empty wallets being silently created on every recovery hiccup). ──
      setStep('wallet');
      let wallet;
      try {
        wallet = await recoverAltanaWallet();
      } catch (e) {
        setStep('error');
        setNeedsWalletChoice(true);
        setError(e.message || String(e));
        return;
      }
      await runWithWallet(wallet);
    } catch (e) {
      setStep('error');
      // Real, added 2026-08-28 (see altana.js's decodeAltanaExecutionError):
      // a real execute() failure now carries a real, decoded `.realReason`
      // alongside its own original message — shown first when present,
      // since it's the more real, specific, actionable finding; the raw
      // SDK message stays too, never hidden.
      setError(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

  // Real, explicit, user-confirmed action — the ONLY real path that ever
  // creates a brand-new wallet now, never an automatic fallback.
  const handleConfirmNewWallet = async () => {
    setError(null);
    setNeedsWalletChoice(false);
    try {
      setStep('wallet');
      const wallet = await createNewAltanaWallet();
      await runWithWallet(wallet);
    } catch (e) {
      setStep('error');
      setError(e.realReason ? `${e.realReason}\n\n(Raw: ${e.message || String(e)})` : (e.message || String(e)));
    }
  };

  return (
    <div className={`rounded-2xl border p-5 ${mutedBorder}`} style={{ background: surface }}>
      <button onClick={onBack} className="text-xs opacity-60 hover:opacity-100 mb-4 flex items-center gap-1"><ChevronRight size={13} className="rotate-180" /> Back to skills</button>
      <h3 className="font-bold text-lg mb-1">{skill.name}</h3>
      <p className="text-xs opacity-60 mb-5">Fill this in, in plain terms, no code.</p>

      {kind === 'tx' && (
        <div className="mb-5 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 text-[11px] text-indigo-700 dark:text-indigo-300">
          Runs for real: a wallet that unlocks with Face ID, with a spending limit you set — this spends real money, never more than that limit.
        </div>
      )}

      {kind === 'read' && (
        <div className="mb-5 p-3 rounded-xl border border-sky-500/30 bg-sky-500/5 text-[11px] text-sky-700 dark:text-sky-300">
          Just looking, not spending: this skill checks live information and shows it to you. It doesn't spend any money, so it needs no wallet and no spending limit.
        </div>
      )}
      {kind === 'pay' && (
        <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400">
          This makes a payment to a web address, handled by an outside payment service — so it needs your real wallet.
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

      {kind !== 'read' && (
        <div className="mb-5">
          <label className="text-xs font-semibold block mb-1">Your spending limit</label>
          <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} disabled={!!step && step !== 'error' && step !== 'done'}
            className={`w-full p-2.5 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`} />
          <p className="text-[10px] opacity-40 mt-1">Suggested amount: {skill.scope?.spendCapSuggested}. This limit is enforced automatically, no matter what the skill tries to do.</p>
        </div>
      )}

      {kind !== 'read' && (skill.scope?.contracts || []).length > 0 && (
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
            wallet: 'Setting up your wallet (confirm with Face ID or your fingerprint)...',
            granting: 'Setting your spending limit...',
            executing: 'Running it for real...',
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
          {/* Real, added 2026-08-28 — see altana.js's own docstring for the
              full real incident this fixes. Never auto-creates a new
              wallet on a recovery failure anymore; this is the one, real,
              explicit, user-confirmed path that does. */}
          {needsWalletChoice && (
            <div className="pt-2 mt-2 border-t border-red-500/20 space-y-1.5">
              <p className="text-gray-500 dark:text-gray-400">If you've set up a wallet here before, "Try again" above and pick that SAME saved passkey. Only tap below if this is genuinely your first time — it creates a brand-new, empty wallet.</p>
              <button onClick={handleConfirmNewWallet} className="w-full py-2 rounded-xl text-[11px] font-semibold border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10">
                This is genuinely my first time — create a new wallet
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

      <button onClick={handleGrantAndRun} disabled={(!!step && step !== 'error' && step !== 'done') || !isExecutable} className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
        {step === 'done' ? 'Done ✓'
          : !isExecutable ? 'Not available'
          : kind === 'read' ? 'Look it up →'
          : kind === 'pay' ? 'Set limit & pay →'
          : session ? 'Run again'
          : 'Set limit & run this →'}
      </button>
    </div>
  );
}

export default function AltanaSkillsPanel({ accent, surface, mutedBorder, darkMode, initialSkillId, onConsumedInitialSkill }) {
  const { skills, loading, error, retry } = useAltanaSkills();
  const [selected, setSelected] = useState(null);

  // Real deep-link from the agent detail page's guidance panel ("Try it
  // yourself") — once the real skills registry has loaded, auto-open the
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
