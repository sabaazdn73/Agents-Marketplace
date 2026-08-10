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
import { Sparkles, Loader2, CheckCircle2, XCircle, ChevronRight, FlaskConical } from 'lucide-react';
import { getOrCreateAltanaWallet, grantSkillSession, getAltanaExecutor } from './altana';
import { getPracticeExecutor } from './practiceWallet';
import { executeEnterPosition, PANCAKESWAP_ROUTER, WBNB, USDT_BSC } from './pancakeswapSkill';
import { venusSupply, aaveSupply, listaStake, pancakeAddLiquidity, VENUS_VUSDT, AAVE_POOL, LISTA_MANAGER } from './defiSkills';
import { buyOnCurve, TOKEN_MANAGER_2, TOKEN_MANAGER_HELPER_3 } from './fourMemeSkill';

const API_BASE = import.meta.env?.VITE_API_BASE || '';

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

  // Execution config for this skill (undefined for skills without a wired
  // execution path yet, e.g. copy-trade / research skills — honestly disclosed).
  const exec = SKILL_EXEC[skill.id];
  const isExecutable = !!exec;
  const play = exec?.play || 'enter-position';
  const relevantInputs = (skill.inputs || []).filter((inp) => !inp.plays || inp.plays.includes(play));

  const handleGrantAndRun = async () => {
    setError(null);
    try {
      let executor;

      if (practiceMode) {
        // Practice path: a throwaway burner wallet on our persistent Anvil
        // fork, funded with free faucet BNB + USDT via the backend. No real
        // Altana session, no real money — the relay only talks to real chains.
        setStep('funding');
        executor = getPracticeExecutor();
        await fetch(`${API_BASE}/api/practice/init`, { method: 'POST' });
        const fundRes = await fetch(
          `${API_BASE}/api/practice/fund?address=${executor.walletAddress}&bnb_amount=10`,
          { method: 'POST' },
        );
        if (!fundRes.ok) throw new Error(`Practice funding failed: ${await fundRes.text()}`);
      } else {
        // Real path: passkey wallet + a real, scoped on-chain Altana session.
        setStep('wallet');
        const wallet = await getOrCreateAltanaWallet();

        setStep('granting');
        // Scope the real session to exactly this skill's contracts + spend token.
        const contractAddresses = exec?.contracts || [];
        const spendToken = exec?.spendToken;

        const s = await grantSkillSession(wallet, wallet.signer, {
          contractAddresses, spendToken, spendCapUnits: Number(spendCap), expiryHours: 24,
        });
        setSession(s);
        executor = getAltanaExecutor(s);
      }

      if (isExecutable && exec.ready(values)) {
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
            body: JSON.stringify({
              inputs: values,
              expectedAmountOut: result?.expectedAmountOut ? String(result.expectedAmountOut) : undefined,
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

      {!isExecutable && (
        <div className="mb-5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-700 dark:text-amber-400">
          This skill can grant a real, scoped session, but real execution is only wired up for PancakeSwap Trading so far. The session will be created; running the actual trade isn't connected yet for this one.
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

      <div className="mb-5">
        <label className="text-xs font-semibold block mb-1">Your real spend cap</label>
        <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} disabled={!!step && step !== 'error' && step !== 'done'}
          className={`w-full p-2.5 rounded-lg border text-sm outline-none disabled:opacity-50 ${mutedBorder} ${darkMode ? 'bg-[#0F172A]' : 'bg-white'}`} />
        <p className="text-[10px] opacity-40 mt-1">Suggested by this skill: {skill.scope?.spendCapSuggested}. This is a real, on-chain limit, enforced regardless of what the agent does.</p>
      </div>

      <div className={`p-3 rounded-xl border ${mutedBorder} text-[11px] opacity-60 mb-5`}>
        Contracts this skill can touch: {(skill.scope?.contracts || []).join(', ')}. Nothing else, ever, for this session.
      </div>

      {step && step !== 'error' && (
        <div className="mb-4 p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-900/10 text-xs flex items-center gap-2">
          {step !== 'done' && <Loader2 size={13} className="animate-spin" style={{ color: accent }} />}
          {step === 'done' && <CheckCircle2 size={13} className="text-green-500" />}
          {{
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

      <button onClick={handleGrantAndRun} disabled={!!step && step !== 'error' && step !== 'done'} className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: accent }}>
        {step === 'done' ? 'Done ✓'
          : practiceMode ? 'Try it free in Practice Mode →'
          : session ? 'Run again'
          : isExecutable ? 'Grant session & run this trade →'
          : 'Grant a real session for this skill →'}
      </button>
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
    </div>
  );
}
