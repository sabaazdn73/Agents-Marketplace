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

import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Loader2, CheckCircle2, XCircle, ChevronRight, FlaskConical, History, RefreshCw } from 'lucide-react';
import { PERMIT2_ADDRESS } from '@altananetwork/sdk';
import { getOrCreateAltanaWallet, grantSkillSession, getAltanaExecutor, getMainnetReadClient } from './altana';
import { getPracticeExecutor, getPracticeAddressIfExists } from './practiceWallet';
import { executeEnterPosition, PANCAKESWAP_ROUTER, WBNB, USDT_BSC } from './pancakeswapSkill';
import { venusSupply, aaveSupply, listaStake, pancakeAddLiquidity, VENUS_VUSDT, AAVE_POOL, LISTA_MANAGER } from './defiSkills';
import { buyOnCurve, TOKEN_MANAGER_2, TOKEN_MANAGER_HELPER_3 } from './fourMemeSkill';
import { detectLeaderTrades } from './copyTradeSkill';
import { payOnce } from './x402Skill';
import { getTrendingBscTokens, getRecentWalletSwaps } from './researchSkills';

// Single source of truth for the backend base URL, matching the main app
// (web/mobile both read VITE_API_BASE_URL). Default suits local dev.
const API_BASE = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

const SKILLS_INDEX_URL = 'https://raw.githubusercontent.com/altananetwork/skills/main/index.json';

// Whole units -> raw 18-decimal bigint (USDT, BNB, and most BSC tokens here).
const toRaw18 = (v) => BigInt(Math.round(Number(v) * 1e18));

// Wires each skill's guided-form values (real registry input ids) to its
// execution function via the shared executor abstraction. `contracts` /
// `spendToken` scope the REAL Altana session (ignored in practice mode).
// `play` selects which inputs the form shows and labels the recorded run.
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
  // These make no on-chain writes, so Practice Mode / a session don't apply.
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
  // it), so it runs real-only, never in Practice Mode. ──
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

function useAltanaSkills() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(SKILLS_INDEX_URL)
      .then((r) => { if (!r.ok) throw new Error(`Registry returned ${r.status}`); return r.json(); })
      .then((data) => { if (!cancelled) { setSkills(data.skills || []); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return { skills, loading, error };
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
  // Practice Mode: run against our persistent Anvil fork with free faucet
  // funds instead of the real Altana session on mainnet.
  const [practiceMode, setPracticeMode] = useState(false);

  // Execution config for this skill. All 10 registry skills are wired; a skill
  // id not in SKILL_EXEC (shouldn't happen for the real registry) is disclosed
  // as not-yet-executable. `kind`: 'tx' (on-chain writes, supports Practice
  // Mode), 'read' (read-only/detection, no wallet), 'pay' (x402, real session).
  const exec = SKILL_EXEC[skill.id];
  const isExecutable = !!exec;
  const kind = exec?.kind || 'tx';
  const play = exec?.play || 'enter-position';
  const relevantInputs = (skill.inputs || []).filter((inp) => !inp.plays || inp.plays.includes(play));

  const handleGrantAndRun = async () => {
    setError(null);
    setExecResult(null);
    try {
      // ── Read-only / detection skills: no wallet, no session, no funding ──
      if (kind === 'read') {
        setStep('reading');
        const result = await exec.run(getMainnetReadClient(), values);
        setExecResult(result);
        setStep('done');
        return;
      }

      // ── x402 payment: real Altana session only (no Practice Mode) ──
      if (kind === 'pay') {
        setStep('wallet');
        const wallet = await getOrCreateAltanaWallet();
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

      // ── Transaction skills: Practice (burner on the fork) or real session ──
      let executor;
      if (practiceMode) {
        // A throwaway burner wallet on our persistent Anvil fork, funded with
        // free faucet BNB + USDT via the backend. No real money.
        setStep('funding');
        executor = getPracticeExecutor();
        await fetch(`${API_BASE}/api/practice/init`, { method: 'POST' });
        const fundRes = await fetch(
          `${API_BASE}/api/practice/fund?address=${executor.walletAddress}&bnb_amount=10`,
          { method: 'POST' },
        );
        if (!fundRes.ok) throw new Error(`Practice funding failed: ${await fundRes.text()}`);
      } else {
        // Passkey wallet + a real, scoped on-chain Altana session.
        setStep('wallet');
        const wallet = await getOrCreateAltanaWallet();
        setStep('granting');
        const s = await grantSkillSession(wallet, wallet.signer, {
          contractAddresses: exec.contracts || [], spendToken: exec.spendToken,
          spendCapUnits: Number(spendCap), expiryHours: 24,
        });
        setSession(s);
        executor = getAltanaExecutor(s);
      }

      if (exec.ready(values)) {
        setStep('executing');
        const result = await exec.run(executor, values);
        setExecResult(result);

        // In practice mode, persist the run so it survives (keyed by the
        // burner address), exactly like real practice history.
        if (practiceMode) {
          const qs = new URLSearchParams({
            wallet_address: executor.walletAddress,
            agent_id: skill.id, agent_name: skill.name, skill_id: skill.id, action: play,
          }).toString();
          await fetch(`${API_BASE}/api/practice/record?${qs}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            // Canonical practice_runs.result shape — kept consistent so readers
            // (e.g. the agent detail page) never handle two schemas:
            //   { inputs: {...}, expectedAmountOut: string | null }
            body: JSON.stringify({
              inputs: values,
              expectedAmountOut: result?.expectedAmountOut ? String(result.expectedAmountOut) : null,
            }),
          });
        }
      }
      setStep('done');
    } catch (e) {
      setStep('error');
      setError(e.message || String(e));
    }
  };

  return (
    <div className={`rounded-2xl border p-5 ${mutedBorder}`} style={{ background: surface }}>
      <button onClick={onBack} className="text-xs opacity-60 hover:opacity-100 mb-4 flex items-center gap-1"><ChevronRight size={13} className="rotate-180" /> Back to skills</button>
      <h3 className="font-bold text-lg mb-1">{skill.name}</h3>
      <p className="text-xs opacity-60 mb-5">Fill this in, in plain terms, no code.</p>

      {/* Practice Mode only applies to on-chain transaction skills. */}
      {kind === 'tx' && (
      <button
        type="button"
        onClick={() => setPracticeMode((p) => !p)}
        disabled={!!step && step !== 'error' && step !== 'done'}
        className={`w-full mb-5 p-3 rounded-xl border flex items-center gap-2.5 text-left text-xs transition-colors disabled:opacity-50 ${practiceMode ? 'border-emerald-500/50 bg-emerald-500/10' : mutedBorder}`}
      >
        <FlaskConical size={15} className={practiceMode ? 'text-emerald-500' : 'opacity-50'} />
        <span className="flex-1">
          <span className="font-semibold">Practice Mode {practiceMode ? 'ON' : 'OFF'}</span>
          <span className="block opacity-60">
            {practiceMode
              ? 'Runs on a real fork of BSC mainnet with free faucet funds. No real money, no passkey. Note: the fork can reset if the practice server restarts, so a position may disappear — but your run history is saved and always viewable.'
              : 'Runs for real: passkey wallet + a scoped on-chain session on BNB mainnet, spending real funds.'}
          </span>
        </span>
        <span className={`shrink-0 w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${practiceMode ? 'bg-emerald-500 justify-end' : 'bg-gray-400/40 justify-start'}`}>
          <span className="w-4 h-4 rounded-full bg-white" />
        </span>
      </button>
      )}

      {kind === 'read' && (
        <div className="mb-5 p-3 rounded-xl border border-sky-500/30 bg-sky-500/5 text-[11px] text-sky-700 dark:text-sky-300">
          Read-only: this skill just reads live BNB Chain data and reports back. It makes no transactions and needs no wallet, spend cap, or Practice Mode.
        </div>
      )}
      {kind === 'pay' && (
        <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400">
          This pays a real x402 endpoint for real, settled by a live facilitator — so it needs a real session and isn't available in Practice Mode.
        </div>
      )}

      {!isExecutable && (
        <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400">
          This skill isn't wired for execution yet. (All 10 registry skills are wired; you'd only see this for an unrecognized skill id.)
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
          <label className="text-xs font-semibold block mb-1">Your real spend cap</label>
          <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} disabled={!!step && step !== 'error' && step !== 'done'}
            className={`w-full p-2.5 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`} />
          <p className="text-[10px] opacity-40 mt-1">Suggested by this skill: {skill.scope?.spendCapSuggested}. This is a real, on-chain limit, enforced regardless of what the agent does.</p>
        </div>
      )}

      {kind !== 'read' && (skill.scope?.contracts || []).length > 0 && (
        <div className={`p-3 rounded-xl border ${mutedBorder} text-[11px] opacity-60 mb-5`}>
          Contracts this skill can touch: {(skill.scope?.contracts || []).join(', ')}. Nothing else, ever, for this session.
        </div>
      )}

      {step && step !== 'error' && (
        <div className="mb-4 p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/10 text-xs flex items-center gap-2">
          {step !== 'done' && <Loader2 size={13} className="animate-spin" style={{ color: accent }} />}
          {step === 'done' && <CheckCircle2 size={13} className="text-green-500" />}
          {{
            reading: 'Reading live BNB Chain data...',
            funding: 'Funding your practice wallet on the fork (free faucet)...',
            wallet: 'Creating your passkey wallet (biometric prompt)...',
            granting: 'Granting a real, scoped on-chain session...',
            executing: practiceMode ? 'Executing on the practice fork...' : 'Executing through your session...',
            done: execResult
              ? (execResult.expectedAmountOut
                  ? `Done${practiceMode ? ' (practice)' : ''}. Expected ~${(Number(execResult.expectedAmountOut) / 1e18).toFixed(4)} tokens.`
                  : `Done${practiceMode ? ' (practice)' : ''}.`)
              : 'Session granted.',
          }[step]}
        </div>
      )}
      {step === 'error' && error && (
        <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs text-red-500 whitespace-pre-wrap">{error}</div>
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
          : !isExecutable ? 'Not executable'
          : kind === 'read' ? 'Run this (read-only) →'
          : kind === 'pay' ? 'Grant session & pay →'
          : practiceMode ? 'Try it free in Practice Mode →'
          : session ? 'Run again'
          : 'Grant session & run this →'}
      </button>
    </div>
  );
}

// Your past Practice Mode runs, read from MongoDB via /api/practice/history,
// keyed by the practice burner wallet. This is what makes the Practice Mode
// promise "your run history is saved and always viewable" literally true.
function PracticeHistoryPanel({ accent, surface, mutedBorder }) {
  const [address] = useState(() => getPracticeAddressIfExists());
  const [runs, setRuns] = useState(address ? null : []); // null = loading
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!address) { setRuns([]); return; }
    setError(null);
    setRuns(null);
    try {
      const res = await fetch(`${API_BASE}/api/practice/history/${address}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRuns(await res.json());
    } catch (e) {
      setError(e.message);
      setRuns([]);
    }
  }, [address]);

  useEffect(() => { load(); }, [load]);

  const fmtInputs = (result) => {
    const inputs = result?.inputs;
    if (!inputs || typeof inputs !== 'object') return '';
    return Object.entries(inputs).map(([k, v]) => `${k}: ${v}`).join(', ');
  };

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <History size={15} style={{ color: accent }} />
          <span className="text-sm font-bold">Your practice history</span>
        </div>
        {address && (
          <button onClick={load} className="text-[11px] opacity-60 hover:opacity-100 flex items-center gap-1">
            <RefreshCw size={11} /> Refresh
          </button>
        )}
      </div>
      <p className="text-xs opacity-60 mb-3">Every Practice Mode run is saved permanently, keyed by your practice wallet — it stays even after the fork resets.</p>

      {!address && (
        <p className="text-xs opacity-50">No practice runs yet — try a skill in Practice Mode and it'll show up here.</p>
      )}
      {address && runs === null && (
        <div className="flex items-center gap-2 text-xs opacity-60 py-2"><Loader2 size={13} className="animate-spin" /> Loading your history…</div>
      )}
      {error && <p className="text-xs text-red-500">Couldn't load history: {error}</p>}
      {address && runs && runs.length === 0 && !error && (
        <p className="text-xs opacity-50">No practice runs yet — try a skill in Practice Mode and it'll show up here.</p>
      )}
      {runs && runs.length > 0 && (
        <div className="space-y-2">
          {runs.map((r) => (
            <div key={r._id} className={`p-3 rounded-xl border ${mutedBorder} text-xs`} style={{ background: surface }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{r.agent_name || r.skill_id}</span>
                <span className="opacity-50 text-[10px] shrink-0">{new Date(r.ran_at).toLocaleString()}</span>
              </div>
              <div className="opacity-60 mt-0.5">
                {r.action}{fmtInputs(r.result) ? ` · ${fmtInputs(r.result)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {address && (
        <p className="text-[10px] opacity-40 mt-2 font-mono">practice wallet: {address.slice(0, 8)}…{address.slice(-6)}</p>
      )}
    </div>
  );
}

export default function AltanaSkillsPanel({ accent, surface, mutedBorder, darkMode }) {
  const { skills, loading, error } = useAltanaSkills();
  const [selected, setSelected] = useState(null);

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
        Real, fork-tested skills from Altana's public registry. No building required, just fill in the blanks.
      </p>

      {loading && <div className="flex items-center gap-2 text-xs opacity-60 py-6"><Loader2 size={14} className="animate-spin" /> Loading the real skills registry...</div>}
      {error && <div className="text-xs text-red-500 py-4">Could not load the skills registry: {error}</div>}

      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {skills.map((s) => (
            <SkillCard key={s.id} skill={s} accent={accent} surface={surface} mutedBorder={mutedBorder} onSelect={setSelected} />
          ))}
        </div>
      )}

      <PracticeHistoryPanel accent={accent} surface={surface} mutedBorder={mutedBorder} />
    </div>
  );
}
