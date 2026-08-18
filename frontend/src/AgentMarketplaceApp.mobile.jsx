import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, CheckCircle2, XCircle,
  GraduationCap, Store, ChevronRight, Loader2, AlertTriangle,
  Wallet, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, Menu, ScanFace,
  ExternalLink, Zap, Coins, Search
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import iconLogo from './assets/icon_v2.svg';
import agentsHero from './assets/agents.png';
import { useHireAgent, buildHireStepList } from './useHireAgent';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import NotificationBell from './NotificationBell';
import { addNotification, trackJob } from './notifications';
import SellYourAgentForm from './SellYourAgentForm';
import BuyAccessPanel from './BuyAccessPanel';
import PasskeyBadge from './PasskeyBadge';
import { agentShareUrl, copyShareLink, readDeepLinkAgentId, matchesDeepLink } from './shareLink';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain' }; // mainnet-only

// Source: docs.bnbchain.org/developer-kit — matches web's Learn content.
// Confirmed-real source URLs (each verified to resolve). Same set as web.
const SRC = {
  sdk: { label: 'BNB Agent SDK docs', url: 'https://docs.bnbchain.org/developer-kit/bnbagent-sdk/' },
  studio: { label: 'BNB Agent Studio docs', url: 'https://docs.bnbchain.org/developer-kit/bnbchain-studio/' },
  studioQuick: { label: 'Studio — Quickstart', url: 'https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/' },
  studioArch: { label: 'Studio — Architecture', url: 'https://docs.bnbchain.org/developer-kit/bnbchain-studio/architecture/' },
  altana: { label: 'Altana SDK docs', url: 'https://docs.altana.network' },
  skills: { label: 'Altana Skills Registry', url: 'https://raw.githubusercontent.com/altananetwork/skills/main/index.json' },
  venusSkill: { label: 'venus-lending SKILL.md', url: 'https://raw.githubusercontent.com/altananetwork/skills/main/skills/venus-lending/SKILL.md' },
};

const LEARN_TOPICS = [
  { h: 'Wallet, gas, mainnet — plain English', p: 'A wallet is an account that holds crypto and signs approvals (here, via Face ID — no seed phrase). Gas is the small fee to record a transaction. Mainnet is the real chain; a "fork" is a free fake-money copy used for practice.' },
  { h: 'ERC-8004 — Identity', p: 'Every agent gets an on-chain identity token (ERC-721) + profile. Registration is gas-free — sponsored by the MegaFuel paymaster.', src: SRC.sdk },
  { h: 'ERC-8183 — Commerce', p: 'A trustless job protocol: client + provider transact through AgenticCommerce (escrow), EvaluatorRouter (routing), OptimisticPolicy (silence = approve).', src: SRC.sdk },
  { h: 'Hiring = a real job, not a subscription', p: 'createJob → registerJob → setBudget → approve $U → fund, each signed by your wallet. Payment is $U (a crypto dollar) held in escrow — never a standing permission.', src: SRC.sdk },
  { h: 'Job lifecycle', p: 'OPEN → FUNDED → SUBMITTED → COMPLETED (settled) / REJECTED (disputed) / EXPIRED (never settled).', src: SRC.sdk },
  { h: 'The real safety net', p: 'claimRefund() after the deadline with no settlement — the guaranteed exit, always available.', src: SRC.sdk },
  { h: 'Dispute window', p: 'If a submitted result looks wrong, dispute() during the review window instead of letting it auto-settle.', src: SRC.sdk },
  { h: 'Skills + Practice Mode', p: 'Use ready-made, fork-tested Skills from Altana\'s registry via a passkey wallet + a capped, expiring session. Practice Mode runs them on a free fork first; your run history is saved even if the fork resets.', src: SRC.skills },
];

// Real bag CLI workflow. v0.0.1 is seller-only. Steps reflect our tested
// pipeline (agent_builder.py): there is NO handle_fulfill — you edit the
// agent's instruction string in main.py.
const BUILD_STEPS = [
  { h: '1. Describe it in plain English', p: 'Tell Claude Code or Cursor what you want, e.g. "a BNB agent that sells weather forecasts." BNB Agent Studio scaffolds the real project.', src: SRC.studioQuick },
  { h: '2. Two layers, automatically', p: 'Layer A (the Agent) holds the wallet + LLM, the only signer. Layer B (public, keyless) just relays requests.', src: SRC.studioArch },
  { h: '3. You edit the instructions', p: 'Everything else is wired. You change the agent\'s instruction string in main.py (what it does on "fulfill") — there is no handle_fulfill, verified against a real project.', src: SRC.studioArch },
  { h: '4. Test before spending anything', p: 'bag dev runs both layers locally; hit the real /negotiate endpoint. The default Pieverse LLM needs no funds.', src: SRC.studioQuick },
  { h: '5. Register, then deploy', p: 'bag erc8004 register makes it discoverable. The one-click build uses a free ~48h trial (no AWS); self-hosting puts Layer A on AgentCore and Layer B on EC2/Fargate.', src: SRC.studioArch },
];

// Beginner FAQ — mirrors the web app's, kept in sync.
const KID_FRIENDLY_FAQ = [
  { q: 'Do I need to code?', a: 'No — describe it in sentences; edit one instruction paragraph, or just fill a form for a ready-made Skill.', src: SRC.studioQuick },
  { q: 'What is Practice Mode?', a: 'A free rehearsal on a fake-money fork of BNB Chain. Your run history is saved even if the fork resets.', src: SRC.venusSkill },
  { q: 'Can it spend my money without asking?', a: 'No. A job is funded once by you; a Skill session has a spend cap, expiry, and a contract allow-list.', src: SRC.sdk },
  { q: 'Do I need my own AWS account?', a: 'No — the build button uses a free ~48h trial on a throwaway testnet wallet.', src: SRC.studio },
  { q: 'What kind of agent can I build?', a: 'Anything you can describe — trading, research, content, support, games. The scaffolder doesn\'t restrict you; the category is just how the marketplace labels it afterward.', src: SRC.studioQuick },
  { q: 'Can it sell to people, not just agents?', a: 'Yes. Any buyer, human or agent, can hire it — the public Service layer is a plain /negotiate HTTP endpoint.', src: SRC.studioArch },
];
const CACHE_KEY = 'agents-marketplace-cache-v1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function mapAgent(a) {
  return {
    id: a.id, tokenId: a.token_id, name: a.name || 'Unnamed', category: a.category || 'Unclassified',
    network: a.network, chainId: a.chain_id, totalScore: a.total_score,
    starCount: a.star_count, totalFeedbacks: a.total_feedbacks, isVerified: a.is_verified,
    // Parity fix: these were missing on mobile, so the detail page's owner link,
    // x402 badge, protocol badges and DefiLlama link silently rendered nothing.
    ownerAddress: a.owner_address, x402Supported: a.x402_supported,
    supportedProtocols: a.supported_protocols || [], defillamaUrl: a.defillama_url,
    strategy: a.description || 'No description provided.',
    financialDataAvailable: a.financial_data_available, tvlUsd: a.tvl_usd,
    ownerBnbBalance: a.owner_bnb_balance, possiblyDelisted: a.possibly_delisted, session: null,
  };
}

function useMarketplaceAgents() {
  const [agents, setAgents] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, savedAt } = JSON.parse(cached);
        if (Date.now() - savedAt < CACHE_MAX_AGE_MS) return data;
      }
    } catch (e) {}
    return [];
  });
  const [loading, setLoading] = useState(agents.length === 0);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const mapped = (data.agents || []).map(mapAgent);
        setAgents(mapped);
        setLoading(false);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: mapped, savedAt: Date.now() })); } catch (e) {}
      })
      .catch((err) => {
        if (cancelled) return;
        if (agents.length === 0) setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { agents, setAgents, loading, error };
}

const REPORT_ACCENT = '#4F46E5'; // app indigo — no green here (matches web)

function reportTimeAgo(iso) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Mobile equivalent of the web PracticeStatsReport — same real endpoint, same
// honest framing, same indigo accent. Functionally equivalent, not pixel-equal.
function PracticeStatsReportMobile() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/practice/stats`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setStats(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Loading real stats…</div>;
  if (error) return <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-sm text-red-500">Couldn't load practice stats: {error}</div>;

  const skills = stats?.skills || [];
  const cards = [
    { label: 'Runs', value: stats?.total_runs ?? 0, icon: Activity },
    { label: 'Wallets', value: stats?.distinct_wallets ?? 0, icon: Users },
    { label: 'Skills', value: stats?.skill_count ?? 0, icon: Zap },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white dark:bg-[#1E293B] p-3 rounded-2xl border border-gray-100 dark:border-gray-800 text-center">
              <Icon size={16} className="mx-auto mb-1" style={{ color: REPORT_ACCENT }} />
              <div className="text-lg font-bold">{c.value}</div>
              <div className="text-[10px] text-gray-500">{c.label}</div>
            </div>
          );
        })}
      </div>
      {skills.length === 0 ? (
        <div className="p-4 rounded-2xl border border-gray-100 dark:border-gray-800 text-sm text-gray-500">No practice runs yet. Run a Skill in Practice Mode and its real stats appear here.</div>
      ) : skills.map((s) => (
        <div key={s.skill_id} className="bg-white dark:bg-[#1E293B] rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <div><div className="font-bold text-sm">{s.agent_name}</div><div className="text-[10px] font-mono text-gray-400">{s.skill_id}</div></div>
            <span className="text-[9px] font-semibold uppercase px-2 py-1 rounded-full" style={{ background: 'rgba(79,70,229,0.10)', color: REPORT_ACCENT }}>{reportTimeAgo(s.last_ran_at)}</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div><span className="font-bold" style={{ color: REPORT_ACCENT }}>{s.executions}</span> <span className="text-[10px] text-gray-500 uppercase">runs</span></div>
            <div><span className="font-bold">{s.distinct_wallets}</span> <span className="text-[10px] text-gray-500 uppercase">wallets</span></div>
            <div className="flex flex-wrap gap-1">{(s.actions || []).map((a) => <span key={a} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">{a}</span>)}</div>
          </div>
        </div>
      ))}
      {stats?.note && <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-200 dark:border-gray-800 pt-3">{stats.note}</p>}
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'market', label: 'Market', icon: Store },
  { id: 'report', label: 'Report', icon: FileBarChart },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'build', label: 'Build', icon: Hammer },
  { id: 'sell', label: 'Sell', icon: Coins },
];

// Mobile-optimized Wallet Modal / Sheet
function MobileWalletSheet({ onClose }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { ready, authenticated, user, login, logout } = usePrivy();
  const privyConnected = ready && authenticated;
  const activeAddress = wagmiConnected ? wagmiAddress : user?.wallet?.address;
  const isConnected = wagmiConnected || privyConnected;
  const shortAddress = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full bg-white dark:bg-[#0F172A] rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
        <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mb-6" />
        <h3 className="text-lg font-bold mb-6 text-gray-900 dark:text-white text-center">Web3 Connection</h3>
        
        {isConnected ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between bg-gray-50 dark:bg-[#1E293B] rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-mono text-sm text-gray-700 dark:text-gray-200">{shortAddress}</span>
              </div>
            </div>
            <button 
              onClick={() => { wagmiConnected ? wagmiDisconnect() : logout(); onClose(); }} 
              className="w-full flex justify-center items-center gap-2 bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 py-4 rounded-xl font-semibold"
            >
              <LogOut size={18} /> Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button onClick={() => { openConnectModal(); onClose(); }} className="w-full flex justify-between items-center bg-indigo-600 text-white text-base font-semibold py-4 px-5 rounded-2xl">
                  <span>Connect Wallet</span>
                  <Wallet size={20} />
                </button>
              )}
            </ConnectButton.Custom>
            <button onClick={() => { login(); onClose(); }} className="w-full flex justify-between items-center bg-gray-100 dark:bg-[#1E293B] text-gray-900 dark:text-white text-base font-semibold py-4 px-5 rounded-2xl">
              <span>Face ID / Email</span>
              <ChevronRight size={20} className="text-gray-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Full-screen launch splash. Shown before the app UI. Unlock by tapping
// through, or via Face ID — which reuses the SAME Privy passkey login the
// wallet-connect flow uses (no duplicate auth logic; one PrivyProvider in
// main.jsx). A returning, already-authenticated Privy user unlocks instantly.
function SplashScreen({ onUnlock }) {
  const { ready, authenticated, login } = usePrivy();
  const [showControls, setShowControls] = useState(false);
  const [busy, setBusy] = useState(false);

  // Show the hero for a beat, then reveal the unlock controls.
  useEffect(() => {
    const t = setTimeout(() => setShowControls(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const handleFaceId = async () => {
    setBusy(true);
    try {
      // Returning user with a live Privy session: no re-prompt needed.
      if (ready && authenticated) { onUnlock(); return; }
      // Otherwise open Privy's passkey/email modal — the Face ID prompt on
      // capable devices — exactly the wallet-connect "Face ID / Email" path.
      await login();
      onUnlock();
    } catch {
      setBusy(false); // user dismissed the prompt; stay on the splash
    }
  };

  return (
    <div
      onClick={showControls && !busy ? onUnlock : undefined}
      className="fixed inset-0 z-50 bg-[#0B101B] text-white flex flex-col items-center justify-between p-8 select-none"
      role="button"
      aria-label="Tap to continue"
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">
        <img src={agentsHero} alt="Agents Marketplace" className="w-full max-w-xs rounded-3xl border border-white/10 shadow-2xl object-cover" />
        {!showControls ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="w-full flex flex-col items-center gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); handleFaceId(); }}
              disabled={busy}
              className="w-full max-w-xs flex items-center justify-center gap-2 bg-white text-[#0B101B] font-semibold py-3 rounded-2xl disabled:opacity-60"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ScanFace size={18} />}
              {ready && authenticated ? 'Unlock with Face ID' : 'Continue with Face ID'}
            </button>
            <p className="text-xs text-gray-400">or tap anywhere to continue</p>
          </div>
        )}
      </div>

      <div className="w-full flex flex-col items-center gap-2 pb-4 min-h-[48px] justify-end">
        <div className="flex items-center gap-2">
          <img src={iconLogo} alt="" className="w-7 h-7" />
          <h1 className="text-xl font-bold tracking-tight">Agents Marketplace</h1>
        </div>
      </div>
    </div>
  );
}

const BSCSCAN = 'https://bscscan.com';

// Real per-agent track record from on-chain ERC-8183 jobs (mobile equivalent).
function AgentPerformanceMobile({ ownerAddress }) {
  const [perf, setPerf] = useState(null);
  const [state, setState] = useState('loading');
  useEffect(() => {
    if (!ownerAddress) { setState('ready'); return; }
    let cancelled = false;
    setState('loading');
    fetch(`${API_BASE_URL}/api/agents/performance?owner_address=${ownerAddress}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setPerf(d); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [ownerAddress]);
  return (
    <div className="mt-4">
      <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5"><Activity size={13} /> Real Hire Performance <span className="text-[10px] font-normal text-gray-400">(on-chain)</span></h3>
      {state === 'loading' && <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> Reading on-chain job history…</div>}
      {state === 'error' && <div className="text-xs text-gray-400">Couldn't read on-chain job history right now.</div>}
      {state === 'ready' && (!perf || !perf.hired) ? (
        <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
          Not yet hired through this marketplace{perf ? ` (no ERC-8183 jobs in the most recent ${perf.scanned_window})` : ''}. An honest zero-history state, not poor performance.
        </div>
      ) : state === 'ready' && perf?.hired ? (
        <div className="p-3 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5">
          <div className="flex items-center gap-4 mb-1">
            <div><span className="text-lg font-bold" style={{ color: '#4F46E5' }}>{perf.hire_count}</span> <span className="text-[10px] text-gray-500 uppercase">hires</span></div>
            <div><span className="text-lg font-bold">{perf.completion_rate != null ? `${Math.round(perf.completion_rate * 100)}%` : '—'}</span> <span className="text-[10px] text-gray-500 uppercase">completed</span></div>
            <div><span className="text-lg font-bold">{perf.active}</span> <span className="text-[10px] text-gray-500 uppercase">active</span></div>
          </div>
          <div className="text-[10px] text-gray-500">Completed {perf.completed} · Rejected {perf.rejected} · Expired {perf.expired}. From the most recent {perf.scanned_window} jobs.</div>
        </div>
      ) : null}
    </div>
  );
}

// Full agent detail — a full-screen push (matching the hire flow), showing
// everything the aggregated data holds for one agent.
function AgentDetailMobile({ agent, onBack, onHire }) {
  const [copied, setCopied] = useState(false);
  const onShare = async () => {
    const ok = await copyShareLink(agentShareUrl(agent));
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <div className="p-5 animate-in slide-in-from-right-4 duration-300">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 font-medium">
          <ChevronRight size={18} className="rotate-180" /> Back
        </button>
        {/* Shareable per-agent link */}
        <button onClick={onShare} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
          <Link2 size={14} /> {copied ? 'Copied!' : 'Share'}
        </button>
      </div>
      <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{agent.category}</span>
              {agent.possiblyDelisted && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">possibly delisted</span>}
            </div>
            <h2 className="text-2xl font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={18} className="text-indigo-500" />}</h2>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 font-medium shrink-0">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3 text-center">
          {[['Score', agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'],
            ['Stars', agent.starCount ?? '—'],
            ['Feedback', agent.totalFeedbacks ?? '—'],
            ['TVL', agent.financialDataAvailable && agent.tvlUsd != null ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '—']].map(([l, v]) => (
            <div key={l} className="p-2 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <span className="block text-[9px] text-gray-500 uppercase">{l}</span>
              <span className="font-bold text-sm">{v}</span>
            </div>
          ))}
        </div>
        {agent.financialDataAvailable && agent.defillamaUrl && (
          <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 inline-flex items-center gap-1 mb-4">TVL source: DefiLlama <ExternalLink size={11} /></a>
        )}

        <div className="flex flex-wrap gap-2 my-4">
          {agent.isVerified && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><BadgeCheck size={12} />Verified</span>}
          {agent.x402Supported && <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><Zap size={12} />x402</span>}
          {(agent.supportedProtocols || []).map((p) => <span key={p} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><Coins size={12} />{p}</span>)}
        </div>

        <h3 className="text-sm font-bold mb-1">About</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">{agent.strategy}</p>

        <h3 className="text-sm font-bold mb-1 flex items-center gap-2">Owner <PasskeyBadge ownerAddress={agent.ownerAddress} /></h3>
        {agent.ownerAddress ? (
          <a href={`${BSCSCAN}/address/${agent.ownerAddress}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-indigo-500 inline-flex items-center gap-1 break-all">{agent.ownerAddress} <ExternalLink size={11} className="shrink-0" /></a>
        ) : <p className="text-xs text-gray-400">No on-chain owner address on record.</p>}

        {/* Real live native BNB of the owner wallet — a different metric from
            TVL, labeled and placed separately so the two are never conflated. */}
        <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20">
          <span className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><Wallet size={13} /> Owner On-Chain Balance <span className="text-[10px] text-gray-400">(BNB, live)</span></span>
          <span className="font-mono text-sm font-semibold">{agent.ownerBnbBalance != null ? `${agent.ownerBnbBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB` : <span className="text-gray-400 font-normal">n/a</span>}</span>
        </div>

        <AgentPerformanceMobile ownerAddress={agent.ownerAddress} />

        {agent.tokenId != null && <BuyAccessPanel agentId={String(agent.tokenId)} />}

        <div className="mt-4 p-3 rounded-xl border border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
          Practice-run history is per skill + practice wallet (Build → Practice Mode), not per marketplace agent — so there's no agent-specific practice history here (verified against the real schema).
        </div>

        <button onClick={() => onHire(agent)} className="w-full mt-5 py-4 rounded-xl font-bold text-white bg-indigo-600 active:scale-[0.98] transition-transform">
          Hire this agent →
        </button>
      </div>
    </div>
  );
}

// Default export: the splash gate wrapping the real app.
export default function AgentMarketplaceMobileRoot() {
  const [unlocked, setUnlocked] = useState(false);
  if (!unlocked) return <SplashScreen onUnlock={() => setUnlocked(true)} />;
  return <AgentMarketplaceMobile />;
}

function AgentMarketplaceMobile() {
  const [darkMode, setDarkMode] = useState(false);
  const [nav, setNav] = useState('market');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [detailAgent, setDetailAgent] = useState(null); // full-screen agent detail push
  const [hiring, setHiring] = useState(false);
  const [buildDescription, setBuildDescription] = useState('');
  const [showBuildCommand, setShowBuildCommand] = useState(false);
  const [buildStatus, setBuildStatus] = useState(null);

  const handleRealBuild = async () => {
    if (!buildDescription.trim()) return;
    setBuildStatus({ step: 'queued' });
    try {
      const res = await fetch(`${API_BASE_URL}/api/build?description=${encodeURIComponent(buildDescription.trim())}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const { slug } = await res.json();
      const poll = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE_URL}/api/build/${slug}/status`);
          const status = await statusRes.json();
          setBuildStatus(status);
          if (status.step === 'done' || status.step === 'error') clearInterval(poll);
        } catch (e) {
          setBuildStatus({ step: 'error', error: e.message });
          clearInterval(poll);
        }
      }, 4000);
    } catch (e) {
      setBuildStatus({ step: 'error', error: e.message });
    }
  };
  const [spendCap, setSpendCap] = useState(50000);
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const { agents, setAgents, loading, error } = useMarketplaceAgents();

  // Deep link: ?agent=<tokenId|id> opens that agent once agents load.
  const deepLinkIdRef = useRef(readDeepLinkAgentId());
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || !deepLinkIdRef.current || agents.length === 0) return;
    const match = agents.find((a) => matchesDeepLink(a, deepLinkIdRef.current));
    if (match) { deepLinkHandledRef.current = true; setNav('market'); setDetailAgent(match); }
  }, [agents]);

  const { isConnected: wagmiConnected } = useAccount();
  const { ready, authenticated } = usePrivy();
  const walletConnected = wagmiConnected || (ready && authenticated);

  const handleHireClick = (agent) => {
    if (!walletConnected) { setWalletSheetOpen(true); return; }
    setSelectedAgent(agent);
    setHiring(true);
  };

  const {
    hire, step: hireStep, error: hireError,
    completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps, stepHashes: hireStepHashes,
  } = useHireAgent();

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("This agent has no on-chain owner address on record, can't create a real job.");
      return;
    }
    try {
      const { jobId } = await hire({
        providerAddress: selectedAgent.ownerAddress,
        budgetUnits: Number(spendCap),
        description: `Hire via Agents Marketplace: ${selectedAgent.name}`,
      });
      trackJob(jobId.toString(), 'FUNDED');
      addNotification(`Job #${jobId} funded`, `You hired ${selectedAgent.name} (direct). The job is funded on-chain.`);
      setAgents((prev) => prev.map((a) => a.id === selectedAgent.id
        ? { ...a, session: { jobId: jobId.toString(), spendCap: Number(spendCap), status: 'FUNDED' } }
        : a));
      setSelectedAgent(null);
      setHiring(false);
    } catch (e) {
      // hireError from the hook is surfaced in the modal, no silent failure
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtered = useMemo(() => {
    let list = agents.filter(a => a.name && a.name.trim().length > 2);
    // Search AND category both apply together.
    list = list.filter((a) => activeCategory === 'All' || a.category === activeCategory);
    if (searchQuery) list = list.filter((a) => `${a.name} ${a.strategy}`.toLowerCase().includes(searchQuery));
    return list;
  }, [agents, activeCategory, searchQuery]);

  // Category chips derived from the REAL fetched data, so newly-classified
  // categories (Trading Signals, Research, Payments, …) actually appear and are
  // filterable — the old hardcoded list only had the original 4.
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(agents.map((a) => a.category).filter(Boolean))).sort()],
    [agents]
  );

  // Same real stat cards as web (Agents Shown / Feedback / Verified).
  const stats = useMemo(() => ({
    total: agents.length,
    verified: agents.filter((a) => a.isVerified).length,
    totalFeedbacks: agents.reduce((sum, a) => sum + (a.totalFeedbacks || 0), 0),
  }), [agents]);

  return (
    <div className={`flex flex-col h-[100dvh] font-sans ${darkMode ? 'dark bg-[#0B101B] text-white' : 'bg-[#F4F5F8] text-gray-900'}`}>
      
      {/* App Header (Sticky) */}
      <header className="shrink-0 flex items-center justify-between px-5 py-4 bg-white/80 dark:bg-[#0F172A]/80 backdrop-blur-md border-b border-gray-200/50 dark:border-white/5 z-20 pt-safe">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden">
            <img src={iconLogo} alt="Agents Marketplace" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">Agents Marketplace</h1>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-full bg-gray-100 dark:bg-white/10">
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button onClick={() => setWalletSheetOpen(true)} className="p-2 rounded-full bg-indigo-50 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
            <Menu size={18} />
          </button>
        </div>
      </header>

      {/* Main Scrollable Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-24">
        
        {hiring && selectedAgent ? (
          <div className="p-5 animate-in slide-in-from-right-4 duration-300">
            <button onClick={() => setHiring(false)} disabled={hireStep && hireStep !== 'done' && !hireError} className="flex items-center gap-1 text-sm text-gray-500 font-medium mb-6 disabled:opacity-40">
              <ChevronRight size={18} className="rotate-180" /> Back
            </button>
            <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-2xl mb-4">
                {selectedAgent.name.charAt(0)}
              </div>
              <h2 className="text-2xl font-bold mb-1">{selectedAgent.name}</h2>
              <p className="text-gray-500 text-sm mb-6">Real ERC-8183 hire — 5 wallet signatures, tracked below as they happen.</p>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">Job Budget ($U)</label>
                  <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} disabled={hireStep && !hireError} className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono outline-none disabled:opacity-50" />
                  <div className="mt-1.5"><GetULink /></div>
                </div>

                {/* Real step checklist — identical logic to web, via the
                    same shared buildHireStepList helper (useHireAgent.js),
                    so the two can't drift on what each step actually means. */}
                {hireStep && (
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]">
                    <StepChecklist steps={buildHireStepList({
                      step: hireStep, completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps,
                      stepHashes: hireStepHashes, error: hireError, budgetUnits: spendCap,
                    })} />
                    {hireStep === 'done' && (
                      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                        <CheckCircle2 size={16} /> Job funded. This agent is now genuinely hired.
                      </div>
                    )}
                  </div>
                )}

                <button onClick={handleActivateSession} disabled={hireStep && hireStep !== 'done' && !hireError} className="w-full py-4 rounded-xl font-bold text-white bg-indigo-600 active:scale-[0.98] transition-transform disabled:opacity-50">
                  {hireStep === 'done' ? 'HIRED ✓' : hireError ? 'RETRY' : 'SIGN & DEPLOY'}
                </button>
              </div>
            </div>
          </div>
        ) : detailAgent ? (
          <AgentDetailMobile
            agent={detailAgent}
            onBack={() => setDetailAgent(null)}
            onHire={(a) => { setDetailAgent(null); handleHireClick(a); }}
          />
        ) : (
          <div className="p-5">
            {nav === 'market' && (
              <>
                <div className="mb-4">
                  <h2 className="text-2xl font-bold mb-1">Marketplace</h2>
                  <p className="text-sm text-gray-500">Discover and hire AI agents.</p>
                </div>

                {/* Real stat cards (parity with web) */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Shown', value: stats.total, icon: Activity, color: '#2563EB' },
                    { label: 'Feedback', value: stats.totalFeedbacks, icon: MessageSquare, color: '#059669' },
                    { label: 'Verified', value: stats.verified, icon: Users, color: '#7C3AED' },
                  ].map((c) => {
                    const Icon = c.icon;
                    return (
                      <div key={c.label} className="bg-white dark:bg-[#1E293B] p-3 rounded-2xl border border-gray-100 dark:border-gray-800 text-center">
                        <Icon size={16} className="mx-auto mb-1" style={{ color: c.color }} />
                        <div className="text-lg font-bold">{c.value.toLocaleString()}</div>
                        <div className="text-[10px] text-gray-500">{c.label}</div>
                      </div>
                    );
                  })}
                </div>

                {/* #3 — honest data-ceiling note */}
                <div className="mb-4 flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
                  <span>Showing the most diverse agents on-chain. The BSC registry is ~68% one repetitive mass-registration campaign, so many agents share near-identical listings; we cap near-duplicates, which is why the list is intentionally short.</span>
                </div>

                <div className="mb-3 relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search agents…" className="w-full pl-10 pr-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-sm outline-none" />
                </div>

                {/* Horizontal Scroll Categories */}
                <div className="flex overflow-x-auto pb-4 -mx-5 px-5 gap-2 snap-x hide-scrollbar">
                  {categories.map((cat) => (
                    <button key={cat} onClick={() => setActiveCategory(cat)} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                      activeCategory === cat ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'
                    }`}>
                      {cat}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-indigo-500" /></div>
                ) : (
                  <div className="space-y-4">
                    {filtered.map((agent) => (
                      <div key={agent.id} onClick={() => setDetailAgent(agent)} className="bg-white dark:bg-[#1E293B] rounded-3xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col cursor-pointer">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">{agent.category}</span>
                            <h3 className="text-lg font-bold flex items-center gap-1">{agent.name}{agent.isVerified && <BadgeCheck size={14} className="text-indigo-500" />}</h3>
                          </div>
                          <span className="text-[10px] px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 font-medium">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
                        </div>
                        
                        <div className="flex gap-4 mb-4">
                          <div><span className="text-[10px] text-gray-500 uppercase block">Score</span><span className="font-bold text-sm">{agent.totalScore?.toFixed(1) || '—'}</span></div>
                          <div><span className="text-[10px] text-gray-500 uppercase block">TVL</span><span className="font-bold text-sm">{agent.tvlUsd ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '-'}</span></div>
                        </div>

                        {agent.session ? (
                          <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                            <div className="flex justify-between text-xs mb-2 text-gray-600 dark:text-gray-400">
                              <span>Spend: ${agent.session.spendUtilized}</span>
                              <span>Cap: ${agent.session.spendCap}</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, session: null } : a)); }} className="w-full py-3 rounded-xl text-sm font-bold text-red-600 bg-red-50 dark:bg-red-500/10">
                              Revoke Access
                            </button>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); handleHireClick(agent); }} className="w-full mt-auto py-3 rounded-xl text-sm font-bold bg-gray-900 text-white dark:bg-white dark:text-gray-900 active:scale-[0.98] transition-transform">
                            Hire Agent
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {nav === 'report' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Practice-Layer Report</h2>
                  <p className="text-sm text-gray-500">Real, aggregated stats from actual Practice-Mode runs on our live BSC-mainnet fork — not a projection.</p>
                  <p className="text-[11px] text-gray-400 mt-1">Note: general Practice-Mode <em>testing</em> activity, not a specific agent's real hire record — for that, open an agent → “Real Hire Performance”.</p>
                </div>
                <PracticeStatsReportMobile />
              </div>
            )}

            {nav === 'sell' && <SellYourAgentForm />}

            {nav === 'learn' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Learn</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">What each agent does, and what you're actually granting.</p>
                </div>
                <div className="space-y-3">
                  {LEARN_TOPICS.map((item, i) => (
                    <div key={i} className="bg-white dark:bg-[#1E293B] rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="font-bold text-sm mb-1">{item.h}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{item.p}</div>
                      {item.src && <a href={item.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-1.5 inline-block">Source: {item.src.label} →</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {nav === 'build' && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold mb-1">Build Your Agent</h2>
                <div className="bg-indigo-600 text-white p-6 rounded-3xl shadow-lg shadow-indigo-600/20">
                  <Sparkles size={24} className="mb-3" />
                  <h3 className="font-bold text-lg mb-2">No code required</h3>
                  <p className="text-sm text-indigo-100 mb-4 leading-relaxed">Describe what you want in plain English. Powered by BNB Agent Studio.</p>
                  <a href="https://docs.bnbchain.org/developer-kit" target="_blank" rel="noreferrer" className="text-xs text-indigo-200 underline">Source: docs.bnbchain.org/developer-kit →</a>
                </div>
                <div className="space-y-3">
                  {BUILD_STEPS.map((step, i) => (
                    <div key={i} className="bg-white dark:bg-[#1E293B] rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="font-bold text-sm mb-1">{step.h}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.p}</div>
                      {step.src && <a href={step.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-1.5 inline-block">Source: {step.src.label} →</a>}
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase text-gray-500 mb-1">Questions a beginner would ask</div>
                  {KID_FRIENDLY_FAQ.map((item, i) => (
                    <div key={i} className="bg-white dark:bg-[#1E293B] rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="font-bold text-sm mb-1">{item.q}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{item.a}</div>
                      {item.src && <a href={item.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-1.5 inline-block">Source: {item.src.label} →</a>}
                    </div>
                  ))}
                </div>

                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 mb-2"><Link2 size={13} /><span className="text-xs font-bold uppercase text-gray-500">Scope, stated honestly</span></div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">v0.0.1 is seller-only: builds agents that earn by fulfilling jobs. The build trial runs on BSC testnet; the marketplace and hiring run on BSC mainnet.</p>
                </div>

                <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-500/20 rounded-2xl p-4">
                  <textarea
                    value={buildDescription}
                    onChange={(e) => setBuildDescription(e.target.value)}
                    placeholder='e.g. "an agent that sells weather forecasts"'
                    rows={2}
                    disabled={buildStatus && buildStatus.step !== 'done' && buildStatus.step !== 'error'}
                    className="w-full p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-white dark:bg-[#0F172A] text-sm mb-3 outline-none disabled:opacity-50"
                  />
                  <button
                    onClick={handleRealBuild}
                    disabled={!buildDescription.trim() || (buildStatus && buildStatus.step !== 'done' && buildStatus.step !== 'error')}
                    className="w-full py-3 rounded-xl bg-indigo-600 text-white font-bold text-sm disabled:opacity-40 mb-2"
                  >
                    Build it for real (48h trial)
                  </button>
                  <button
                    onClick={() => setShowBuildCommand(true)}
                    disabled={!buildDescription.trim()}
                    className="w-full py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-400 font-semibold text-xs disabled:opacity-40"
                  >
                    Or just show me the command
                  </button>

                  {buildStatus && (
                    <div className="mt-4 p-4 rounded-xl bg-white dark:bg-[#0F172A] border border-indigo-100 dark:border-indigo-500/30">
                      <div className="flex items-center gap-2 mb-1">
                        {buildStatus.step !== 'done' && buildStatus.step !== 'error' && <Loader2 size={14} className="animate-spin text-indigo-500" />}
                        {buildStatus.step === 'done' && <CheckCircle2 size={14} className="text-green-500" />}
                        {buildStatus.step === 'error' && <XCircle size={14} className="text-red-500" />}
                        <span className="font-semibold text-xs">
                          {{
                            queued: 'Queued...', scaffolding: 'Scaffolding (bag init)...', creating_wallet: 'Creating testnet wallet...',
                            writing_logic: 'Writing agent instructions...', activating_llm: 'Activating LLM...',
                            deploying: 'Deploying (48h trial)...', done: 'Deployed, live for 48h.', error: 'Build failed',
                          }[buildStatus.step] || buildStatus.step}
                        </span>
                      </div>
                      {buildStatus.step === 'done' && buildStatus.address && (
                        <p className="text-[10px] text-gray-500 mt-1 font-mono">{buildStatus.address}</p>
                      )}
                      {buildStatus.step === 'error' && (
                        <p className="text-[10px] text-red-500 mt-1 font-mono whitespace-pre-wrap">{buildStatus.error}</p>
                      )}
                    </div>
                  )}

                  {showBuildCommand && buildDescription.trim() && (
                    <div className="mt-4 font-mono text-[10px] p-4 rounded-xl bg-white dark:bg-[#0F172A] border border-indigo-100 dark:border-indigo-500/30 text-gray-700 dark:text-gray-300 whitespace-pre-wrap overflow-x-auto">
{`# Run in your own terminal:
pip install bnbagent-studio
bag skills install --target both --scope user

# In Claude Code or Cursor, say:
"Create a BNB agent named ${buildDescription.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)} on testnet that ${buildDescription.trim()}."

# Or scaffold directly:
bag init ${buildDescription.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)} --network bsc-testnet`}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* App-like Bottom Navigation */}
      <nav className="shrink-0 bg-white dark:bg-[#0B101B] border-t border-gray-200 dark:border-gray-800 pb-safe z-20">
        <div className="flex justify-around items-center px-2 pt-2 pb-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setNav(item.id); setHiring(false); }}
                className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
              >
                <Icon size={20} className={`mb-1 transition-transform ${active ? 'scale-110' : ''}`} />
                <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      {walletSheetOpen && <MobileWalletSheet onClose={() => setWalletSheetOpen(false)} />}
      
      {/* Hide Scrollbar style for horizontal list */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .pb-safe { padding-bottom: env(safe-area-inset-bottom, 20px); }
        .pt-safe { padding-top: env(safe-area-inset-top, 0px); }
      `}} />
    </div>
  );
}