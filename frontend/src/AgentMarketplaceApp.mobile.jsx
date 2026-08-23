import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, CheckCircle2, XCircle,
  GraduationCap, Store, ChevronRight, Loader2, AlertTriangle,
  Wallet, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, Menu, ScanFace,
  ExternalLink, Zap, Coins, Search, Briefcase
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import iconLogo from './assets/icon_v2.svg';
import agentsHero from './assets/agents.png';
import { useHireAgent, buildHireStepList, useAgentQuote } from './useHireAgent';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import MyJobsPanel from './MyJobsPanel';
import AgentGuidancePanel from './AgentGuidancePanel';
import AdvantageReport from './AdvantageReport';
import AltanaSkillsPanel from './AltanaSkillsPanel';
import NotificationBell from './NotificationBell';
import { addNotification, trackJob } from './notifications';
import { recordFunded } from './jobTiming';
import SellYourAgentForm from './SellYourAgentForm';
import BuyAccessPanel from './BuyAccessPanel';
import PasskeyBadge from './PasskeyBadge';
import ServiceHealthBadge, { ServiceHealthExplainer, serviceRank } from './ServiceHealthBadge';
import { CATEGORY_HINTS } from './categoryHints';
import { agentShareUrl, copyShareLink, readDeepLinkAgentId, matchesDeepLink } from './shareLink';
import { getReliabilityHint } from './agentReliability';

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

// Copy audit (2026-08-23): this array previously had NO plain-language
// layer at all — just condensed jargon (raw function-call chains, contract
// names) for what's meant to be the beginner glossary. Rewritten with a
// real `p` (plain, leads) + `tech` (secondary, for anyone curious) split —
// kept in sync in spirit with web's LEARN_TOPICS, condensed to one card
// per topic for mobile's layout.
const LEARN_TOPICS = [
  { h: 'A wallet', p: 'An account that holds your crypto and approves payments — like a bank card, but only you control it. Here you can make one with Face ID, no password to write down.', tech: 'A wallet signs on-chain approvals. This app supports passkey wallets (WebAuthn/Face ID), so there\'s no seed phrase.', src: SRC.altana },
  { h: 'Gas', p: "The tiny fee normally paid to record something permanently — like a stamp on a letter. Registering an agent here is free; we cover that fee for you.", tech: 'A "paymaster" (MegaFuel) sponsors registration gas on BNB Chain.', src: SRC.sdk },
  { h: 'Mainnet vs. practice', p: "Mainnet is the real network, where real money moves. Practice Mode is a free copy of it loaded with fake money, so you can try anything first at zero risk.", tech: 'Practice Mode runs against a "fork" — a live copy of mainnet state.' },
  { h: 'Escrow', p: 'When you hire an agent, your payment is held by the system, not the agent — it only gets paid once the work is accepted, and you can get it back if nothing is delivered.', tech: 'Your payment sits in an on-chain vault (AgenticCommerce) until settlement.', src: SRC.sdk },
  { h: 'The agent\'s ID card (ERC-8004)', p: "Every agent gets a permanent, public identity anyone can look up — like an ID card. Free to register.", tech: 'An on-chain ERC-721 identity token + a discoverable profile (name, description, endpoints).', src: SRC.sdk },
  { h: 'The payment rulebook (ERC-8183)', p: "A set of automatic rules that hold the money and enforce the deal, so neither you nor the agent has to just trust the other.", tech: 'Three contracts: AgenticCommerce (job + escrow), EvaluatorRouter (routes to a settlement policy), OptimisticPolicy (silence past the review window = approved).', src: SRC.sdk },
  { h: 'Hiring = one job, not a subscription', p: "You fund one specific job, once. The agent can never dip into your wallet again on its own.", tech: 'createJob → registerJob → setBudget → approve $U → fund, each signed by your wallet.', src: SRC.sdk },
  { h: 'The stages a hire goes through', p: 'Not paid yet → Payment on hold → Delivered → Finished (paid) — or Refunded, if you cancel, dispute successfully, or the deadline passes with nothing delivered.', tech: 'OPEN → FUNDED → SUBMITTED → COMPLETED, or REJECTED / EXPIRED.', src: SRC.sdk },
  { h: 'The guaranteed exit', p: "If a job's deadline passes with nothing delivered, you can get your money back, anytime, no one's permission needed.", tech: 'claimRefund() after expiry — always available, guaranteed by the contract.', src: SRC.sdk },
  { h: "If something looks wrong", p: "You get a short window after delivery to flag a problem before payment is automatically released.", tech: 'Call dispute() during the review window instead of letting it auto-settle.', src: SRC.sdk },
  { h: 'Ready-made Skills + Practice Mode', p: "Skills are pre-built recipes an agent can run for you — no building required. You can try any of them for free first with practice money before using your own.", tech: "Fork-tested Skills from Altana's public registry, run via a passkey wallet + a capped, expiring session.", src: SRC.skills },
];

// Real bag CLI workflow. v0.0.1 is seller-only. Steps reflect our tested
// pipeline (agent_builder.py): there is NO handle_fulfill — you edit the
// agent's instruction string in main.py.
// Copy audit (2026-08-23): each step now leads with a plain-language
// explanation (`p`); the real technical detail moves to `tech`, shown
// smaller/secondary — kept in sync with the equivalent BUILD_STEPS array
// in AgentMarketplaceApp.web.jsx (that one keeps the original field names
// body/plain for its own historical reasons; same content here, mobile's
// own naming).
const BUILD_STEPS = [
  { h: '1. Describe your agent, in plain English', p: 'You type a sentence describing what you want; a tool writes the starter code for you.', tech: 'Tell Claude Code or Cursor what you want, e.g. "a BNB agent that sells weather forecasts." BNB Agent Studio\'s "bag" tool reads that and scaffolds a real, working project.', src: SRC.studioQuick },
  { h: '2. It builds two things, not one', p: 'The part that holds the keys to real money stays private; a separate public part takes requests from the outside world.', tech: 'Layer A (the Agent) holds the wallet + LLM and is the only thing that ever signs. Layer B (the Service) is public, keyless, and just relays requests.', src: SRC.studioArch },
  { h: '3. You edit the instructions, not the plumbing', p: "You rewrite one paragraph telling the agent its job — not the technical wiring around it.", tech: 'Wallet setup and the on-chain registration/payment wiring are already there. What you change is the instruction string in main.py describing what it should do when a funded job asks it to work.', src: SRC.studioArch },
  { h: '4. Test it before it touches real money', p: 'Run it on your own computer first, with a free AI model, before deploying or spending anything.', tech: 'bag dev runs both layers on your machine. You can hit the real negotiate step, get a real signed price quote, and confirm the whole flow first.', src: SRC.studioQuick },
  { h: '5. Register, then publish it', p: 'Try it free for about 2 days with one click, or host it yourself permanently later.', tech: 'bag erc8004 register makes your agent discoverable. The one-click "Build it for real" button uses a free trial (no cloud hosting account needed).', src: SRC.studioArch },
];

// Beginner FAQ — mirrors the web app's, kept in sync.
const KID_FRIENDLY_FAQ = [
  { q: 'Do I need to know how to code?', a: 'No. You describe what you want in normal sentences; to build a custom agent you mostly edit one instruction paragraph, and to use a ready-made Skill you just fill in a form.', src: SRC.studioQuick },
  { q: 'What is Practice Mode?', a: 'A free rehearsal. It runs a Skill on a live copy of BNB Chain with fake money, so you can see exactly what would happen before spending anything real. Your run history is saved even though the practice copy can reset.', src: SRC.venusSkill },
  { q: 'Can it spend my money without asking?', a: "No. Hiring funds one specific job you set and fund yourself; a Skill's spending permission has a cap, an expiry, and a limited list of what it can touch. Neither is a standing permission it can dip into freely.", src: SRC.sdk },
  { q: 'What if the agent never delivers?', a: "You're guaranteed to get your money back once the deadline passes — but it's not automatic. You'll need to come back and claim it yourself with one click. That guarantee is a built-in rule of the whole system, not a favor the agent has to grant you.", src: SRC.sdk },
  { q: 'Do I need my own cloud hosting account to build one?', a: 'No. The build button uses a free trial (about 2 days) on a temporary practice wallet — no hosting account, no real money involved.', src: SRC.studio },
  { q: 'What kind of agent can I build?', a: "Pretty much anything you can describe in a sentence: trading, research, writing, customer support, data analysis, games — you're not limited to a preset list.", src: SRC.studioQuick },
  { q: 'Can it sell to people, not just other agents?', a: "Yes. Any buyer — a person or another agent — can hire it. It's not limited to agent-to-agent deals.", src: SRC.studioArch },
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
    // Real, server-checked service-liveness signal — see core/agent_health.py.
    serviceStatus: a.service_status || null, serviceEndpoint: a.service_endpoint || null,
    serviceCheckedAt: a.service_checked_at || null, serviceRank: serviceRank(a.service_status),
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

  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Loading practice stats…</div>;
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
        <div className="p-4 rounded-2xl border border-gray-100 dark:border-gray-800 text-sm text-gray-500">No practice runs yet. Try a skill in Practice Mode and its stats will show up here.</div>
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
  { id: 'my-agents', label: 'My Agents', icon: Briefcase },
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
        <h3 className="text-lg font-bold mb-6 text-gray-900 dark:text-white text-center">Your Wallet</h3>
        
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
// Real bug fixed 2026-08-21 — see the matching comment on AgentPerformance
// (web) in AgentMarketplaceApp.web.jsx: this fetch had no client-side
// timeout, so a slow/stalled response could leave "loading" stuck forever.
const AGENT_PERFORMANCE_FETCH_TIMEOUT_MS_MOBILE = 20_000;

function AgentPerformanceMobile({ agent, onTrySkill }) {
  const ownerAddress = agent.ownerAddress;
  const [perf, setPerf] = useState(null);
  const [state, setState] = useState('loading');
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!ownerAddress) { setState('ready'); return; }
    let cancelled = false;
    setState('loading');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AGENT_PERFORMANCE_FETCH_TIMEOUT_MS_MOBILE);
    fetch(`${API_BASE_URL}/api/agents/performance?owner_address=${ownerAddress}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setPerf(d); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [ownerAddress, retryTick]);
  return (
    <div className="mt-4">
      <h3 className="text-sm font-bold mb-1 flex items-center gap-1.5"><Activity size={13} /> Past Hires <span className="text-[10px] font-normal text-gray-400" title="Checked directly from the blockchain, the permanent public record every job here is written to — can't be faked.">(checked directly)</span></h3>
      {state === 'loading' && <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={12} className="animate-spin" /> Looking up this agent's hire history…</div>}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          Couldn't look up this agent's hire history right now.
          <button onClick={() => setRetryTick((t) => t + 1)} className="text-indigo-500 font-medium underline">Try again</button>
        </div>
      )}
      {state === 'ready' && (!perf || !perf.hired) ? (
        <>
          {/* Practice Mode is now real on mobile (2026-08-19 port) — the real
              working "try this skill" deep-link renders here too. */}
          <AgentGuidancePanel agent={agent} mutedBorder="border-gray-200 dark:border-gray-800" onTrySkill={onTrySkill} />
          {perf && <p className="text-[10px] text-gray-400 mt-1.5">We checked the last {perf.scanned_window} jobs on the whole marketplace and found none for this agent — it may just be new.</p>}
        </>
      ) : state === 'ready' && perf?.hired ? (
        <div className="p-3 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5">
          <div className="flex items-center gap-4 mb-1">
            <div title="How many times people have hired this agent"><span className="text-lg font-bold" style={{ color: '#4F46E5' }}>{perf.hire_count}</span> <span className="text-[10px] text-gray-500 uppercase">hires</span></div>
            <div title="Out of finished jobs, how many succeeded"><span className="text-lg font-bold">{perf.completion_rate != null ? `${Math.round(perf.completion_rate * 100)}%` : '—'}</span> <span className="text-[10px] text-gray-500 uppercase">succeeded</span></div>
            <div title="Jobs still underway"><span className="text-lg font-bold">{perf.active}</span> <span className="text-[10px] text-gray-500 uppercase">in progress</span></div>
          </div>
          <div className="text-[10px] text-gray-500" title="Rejected means the buyer wasn't happy with the finished work. Timed out means the agent never finished by the deadline.">Finished {perf.completed} · Rejected by buyer {perf.rejected} · Missed deadline {perf.expired}. From the last {perf.scanned_window} jobs marketplace-wide.</div>
          {/* Real, data-driven reliability hint — see agentReliability.js. */}
          {(() => {
            const hint = getReliabilityHint(perf);
            return hint ? (
              <div className="mt-2.5 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>{hint.message}</span>
              </div>
            ) : null;
          })()}
        </div>
      ) : null}
    </div>
  );
}

// Full agent detail — a full-screen push (matching the hire flow), showing
// everything the aggregated data holds for one agent.
function AgentDetailMobile({ agent, onBack, onHire, onTrySkill }) {
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
              <span title={CATEGORY_HINTS[agent.category]} className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{agent.category}</span>
              {agent.possiblyDelisted && <span title="We haven't seen this agent show up anywhere in over a week. It might be gone, or it might just not have come up in our latest check." className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">may no longer be active</span>}
            </div>
            <h2 className="text-2xl font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={18} className="text-indigo-500" title="Confirmed as a real, registered agent — not a promise it's good" />}</h2>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 font-medium shrink-0">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3 text-center">
          {[['Score', agent.totalScore != null ? agent.totalScore.toFixed(1) : '—', 'How trustworthy this agent looks, based on real past feedback'],
            ['Stars', agent.starCount ?? '—', 'How many people rated this agent'],
            ['Feedback', agent.totalFeedbacks ?? '—', 'How many written reviews this agent has'],
            ['Funds', agent.financialDataAvailable && agent.tvlUsd != null ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '—', 'Total money this agent currently manages for people']].map(([l, v, hint]) => (
            <div key={l} title={hint} className="p-2 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <span className="block text-[9px] text-gray-500 uppercase">{l}</span>
              <span className="font-bold text-sm">{v}</span>
            </div>
          ))}
        </div>
        {agent.financialDataAvailable && agent.defillamaUrl && (
          <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 inline-flex items-center gap-1 mb-4">Where this money number comes from: DefiLlama <ExternalLink size={11} /></a>
        )}

        <div className="flex flex-wrap items-center gap-2 my-4">
          {agent.isVerified && <span title="Confirmed as a real, registered agent — not a promise it's good" className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><BadgeCheck size={12} />Verified</span>}
          {agent.x402Supported && <span title="Can pay other agents automatically for tools or data it needs, without a person approving each payment" className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><Zap size={12} />Pays other agents automatically</span>}
          {(agent.supportedProtocols || []).map((p) => <span key={p} title={`Works with ${p}, a real app it can act on for you`} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><Coins size={12} />{p}</span>)}
          <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} size="md" />
          {(!agent.serviceStatus || agent.serviceStatus === 'unknown') && (
            <span className="text-[11px] text-gray-400">Not confirmed online yet</span>
          )}
        </div>
        {agent.serviceEndpoint && (
          <p className="text-[11px] text-gray-400 mb-3 -mt-2 break-all" title="The web address we contact to check whether this agent is turned on">Where we check on it: <span className="font-mono">{agent.serviceEndpoint}</span></p>
        )}

        <h3 className="text-sm font-bold mb-1">About</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">{agent.strategy}</p>

        <h3 className="text-sm font-bold mb-1 flex items-center gap-2">Who owns this agent <PasskeyBadge ownerAddress={agent.ownerAddress} /></h3>
        {agent.ownerAddress ? (
          <>
            <a href={`${BSCSCAN}/address/${agent.ownerAddress}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-indigo-500 inline-flex items-center gap-1 break-all">{agent.ownerAddress} <ExternalLink size={11} className="shrink-0" /></a>
            <p className="text-[11px] text-gray-400 mt-1">This is the agent creator's wallet ID — a public account number anyone can look up, like a bank account number that's safe to share.</p>
          </>
        ) : <p className="text-xs text-gray-400">We don't have an owner ID on record for this agent.</p>}

        {/* Real live BNB balance of the owner wallet — a different metric from
            "Funds", labeled and placed separately so the two are never
            confused with one another. */}
        <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20">
          <span title="BNB is this network's own currency, used to pay small network fees. This is how much the owner's wallet holds right now." className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><Wallet size={13} /> Owner's wallet balance <span className="text-[10px] text-gray-400">(in BNB)</span></span>
          <span className="font-mono text-sm font-semibold">{agent.ownerBnbBalance != null ? `${agent.ownerBnbBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB` : <span className="text-gray-400 font-normal">n/a</span>}</span>
        </div>

        <AgentPerformanceMobile agent={agent} onTrySkill={onTrySkill} />

        {agent.tokenId != null && <BuyAccessPanel agentId={String(agent.tokenId)} />}

        <div className="mt-4 p-3 rounded-xl border border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
          We don't yet track practice-run history per agent — only by which practice tool you tried under Build → Practice Mode. So there's nothing agent-specific to show here yet.
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
  const [onlyResponding, setOnlyResponding] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [detailAgent, setDetailAgent] = useState(null); // full-screen agent detail push
  const [hiring, setHiring] = useState(false);
  // Real deep-link from the agent guidance panel's "Try in Practice Mode" —
  // switches to Build and pre-opens that specific skill's guided form.
  // Mirrors web's identical handleTrySkill now that Practice Mode is real
  // on mobile too.
  const [pendingSkillId, setPendingSkillId] = useState(null);
  const handleTrySkill = (skillId) => { setDetailAgent(null); setNav('build'); setPendingSkillId(skillId); };
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
  const [spendCapTouched, setSpendCapTouched] = useState(false);
  // Advanced override for the on-chain job description — see the matching
  // comment in AgentMarketplaceApp.web.jsx (kept in sync with web).
  const [customDescription, setCustomDescription] = useState('');
  const [showCustomDescription, setShowCustomDescription] = useState(false);
  // Real, live price discovery — see useAgentQuote in useHireAgent.js /
  // the matching comment in AgentMarketplaceApp.web.jsx (kept in sync).
  const agentQuote = useAgentQuote(hiring ? selectedAgent : null);
  useEffect(() => {
    if (agentQuote.status === 'available' && !spendCapTouched) {
      setSpendCap(agentQuote.priceUnits);
    }
  }, [agentQuote.status, agentQuote.priceUnits, spendCapTouched]);
  // Hire-by-address escape hatch — see the matching comment in
  // AgentMarketplaceApp.web.jsx (kept in sync with web).
  const [showManualHire, setShowManualHire] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
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
    setSpendCapTouched(false); // fresh agent — let its real price (if any) pre-fill again
  };

  const {
    hire, step: hireStep, error: hireError,
    completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps, stepHashes: hireStepHashes,
  } = useHireAgent();

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("We don't have an owner ID on record for this agent, so we can't hire it.");
      return;
    }
    try {
      const { jobId } = await hire({
        providerAddress: selectedAgent.ownerAddress,
        budgetUnits: Number(spendCap),
        description: (showCustomDescription && customDescription.trim())
          ? customDescription.trim()
          : `Hire via Agents Marketplace: ${selectedAgent.name}`,
      });
      trackJob(jobId.toString(), 'FUNDED');
      recordFunded(jobId.toString()); // the real moment funding confirmed — see jobTiming.js
      addNotification(`Job #${jobId}: Payment on hold`, `You hired ${selectedAgent.name} — your payment is on hold until the work is done.`);
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
    // Real filter: only agents whose registered endpoint answered a real
    // health-check (see core/agent_health.py) — the requested "let a user
    // filter to only see agents with a currently-responding endpoint".
    if (onlyResponding) list = list.filter((a) => a.serviceStatus === 'responding');
    return list;
  }, [agents, activeCategory, searchQuery, onlyResponding]);

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
              <p className="text-gray-500 text-sm mb-6">You'll approve a few quick steps in your wallet — tracked below as they happen.</p>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">How much to pay <span className="font-normal text-gray-400" title="$U is a type of digital dollar — 1 $U is worth about $1.">($U, worth about $1 each)</span></label>

                  {/* Live price discovery — see the matching comment
                      in AgentMarketplaceApp.web.jsx (kept in sync). */}
                  {agentQuote.status === 'loading' && (
                    <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
                      <Loader2 size={12} className="animate-spin" /> Checking what this agent charges…
                    </div>
                  )}
                  {agentQuote.status === 'available' && (
                    <div className="mb-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300">
                      <strong>This agent charges {agentQuote.priceUnits} $U.</strong> We got this straight from the agent itself — filled in below, no need to guess.
                      {spendCapTouched && Number(spendCap) < agentQuote.priceUnits && (
                        <span className="block mt-1 text-amber-700 dark:text-amber-400">You've entered less than that — we'll automatically pay at least {agentQuote.priceUnits} $U, since the agent won't accept less.</span>
                      )}
                    </div>
                  )}
                  {agentQuote.status === 'unavailable' && (
                    <div className="mb-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
                      This agent hasn't told us what it charges, so you're picking the amount yourself. Heads up: if you enter too little, the agent may not accept the job.
                    </div>
                  )}

                  <input type="number" value={spendCap} onChange={(e) => { setSpendCap(e.target.value); setSpendCapTouched(true); }} disabled={hireStep && !hireError} className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono outline-none disabled:opacity-50" />
                  <div className="mt-1.5"><GetULink /></div>
                </div>

                <div>
                  <button type="button" onClick={() => setShowCustomDescription((v) => !v)} disabled={hireStep && !hireError} className="text-xs font-semibold text-gray-400 disabled:opacity-50">
                    {showCustomDescription ? '− Hide advanced option' : '+ Advanced: write your own job description'}
                  </button>
                  {showCustomDescription && (
                    <div className="mt-3">
                      <textarea
                        value={customDescription}
                        onChange={(e) => setCustomDescription(e.target.value)}
                        disabled={hireStep && !hireError}
                        placeholder={`Hire via Agents Marketplace: ${selectedAgent.name}`}
                        rows={4}
                        className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-xs font-mono outline-none disabled:opacity-50"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Only for advanced users — this replaces the automatic description above with your own text, permanently recorded. Leave it blank unless you have a specific reason to use this.</p>
                    </div>
                  )}
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
                        <CheckCircle2 size={16} /> Done! Your payment is on hold and this agent has been notified to start work.
                      </div>
                    )}
                  </div>
                )}

                <button onClick={handleActivateSession} disabled={hireStep && hireStep !== 'done' && !hireError} className="w-full py-4 rounded-xl font-bold text-white bg-indigo-600 active:scale-[0.98] transition-transform disabled:opacity-50">
                  {hireStep === 'done' ? 'HIRED ✓' : hireError ? 'TRY AGAIN' : 'PAY DIRECTLY'}
                </button>
              </div>
            </div>
          </div>
        ) : detailAgent ? (
          <AgentDetailMobile
            agent={detailAgent}
            onBack={() => setDetailAgent(null)}
            onHire={(a) => { setDetailAgent(null); handleHireClick(a); }}
            onTrySkill={handleTrySkill}
          />
        ) : (
          <div className="p-5">
            {nav === 'market' && (
              <>
                <div className="mb-4">
                  <h2 className="text-2xl font-bold mb-1">Marketplace</h2>
                  <p className="text-sm text-gray-500">Browse AI agents and hire one with a spending limit you control.</p>
                </div>

                {/* Real stat cards (parity with web) */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Listed', value: stats.total, icon: Activity, color: '#2563EB', hint: 'How many agents are shown below' },
                    { label: 'Reviews', value: stats.totalFeedbacks, icon: MessageSquare, color: '#059669', hint: 'Total written reviews left across all these agents' },
                    { label: 'Verified', value: stats.verified, icon: Users, color: '#7C3AED', hint: "Confirmed as a real, registered agent — not a promise it's good" },
                  ].map((c) => {
                    const Icon = c.icon;
                    return (
                      <div key={c.label} title={c.hint} className="bg-white dark:bg-[#1E293B] p-3 rounded-2xl border border-gray-100 dark:border-gray-800 text-center">
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
                  <span>We're showing you a varied mix, not every agent that exists. Most agents here were created in a few big batches and look almost identical, so we limit how many lookalikes show up — that's why this list is short on purpose.</span>
                </div>

                <ServiceHealthExplainer className="mb-4" />

                <div className="mb-3 relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search agents…" className="w-full pl-10 pr-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-sm outline-none" />
                </div>

                <button
                  onClick={() => setOnlyResponding((v) => !v)}
                  className={`mb-4 px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
                    onlyResponding
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                      : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {onlyResponding ? '✓ ' : ''}Only show online agents
                </button>

                {/* Hire-by-address escape hatch — see the matching block in
                    AgentMarketplaceApp.web.jsx. */}
                <div className="mb-4">
                  <button type="button" onClick={() => setShowManualHire((v) => !v)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E293B] text-gray-600 dark:text-gray-300">
                    <Search size={12} />{showManualHire ? 'Hide this' : "Know an agent's ID? Hire it directly"}
                  </button>
                  {showManualHire && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={manualAddress}
                        onChange={(e) => setManualAddress(e.target.value.trim())}
                        placeholder="0x… the agent owner's wallet ID"
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-sm font-mono outline-none"
                      />
                      <button
                        type="button"
                        disabled={!/^0x[a-fA-F0-9]{40}$/.test(manualAddress)}
                        onClick={() => {
                          handleHireClick({ id: `manual-${manualAddress}`, name: `Custom agent (${manualAddress.slice(0, 6)}…${manualAddress.slice(-4)})`, ownerAddress: manualAddress, category: 'Unclassified' });
                          setShowManualHire(false);
                        }}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Hire
                      </button>
                    </div>
                  )}
                </div>

                {/* Horizontal Scroll Categories */}
                <div className="flex overflow-x-auto pb-4 -mx-5 px-5 gap-2 snap-x hide-scrollbar">
                  {categories.map((cat) => (
                    <button key={cat} onClick={() => setActiveCategory(cat)} title={CATEGORY_HINTS[cat]} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
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

                        {agent.serviceStatus && agent.serviceStatus !== 'unknown' && (
                          <div className="mb-3"><ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} /></div>
                        )}

                        <div className="flex gap-4 mb-4">
                          <div title="How trustworthy this agent looks, based on real past feedback"><span className="text-[10px] text-gray-500 uppercase block">Score</span><span className="font-bold text-sm">{agent.totalScore?.toFixed(1) || '—'}</span></div>
                          <div title="Total money this agent currently manages for people"><span className="text-[10px] text-gray-500 uppercase block">Funds</span><span className="font-bold text-sm">{agent.tvlUsd ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '-'}</span></div>
                        </div>

                        {agent.session ? (
                          <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                            <div className="flex justify-between text-xs mb-2 text-gray-600 dark:text-gray-400">
                              <span>Spent: ${agent.session.spendUtilized}</span>
                              <span>Limit: ${agent.session.spendCap}</span>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, session: null } : a)); }} className="w-full py-3 rounded-xl text-sm font-bold text-red-600 bg-red-50 dark:bg-red-500/10">
                              Turn off access
                            </button>
                          </div>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); handleHireClick(agent); }} className="w-full mt-auto py-3 rounded-xl text-sm font-bold bg-gray-900 text-white dark:bg-white dark:text-gray-900 active:scale-[0.98] transition-transform">
                            Hire this agent
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {nav === 'my-agents' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold mb-1">My Agents</h2>
                  <p className="text-sm text-gray-500">Every agent you've hired through here, and where things stand right now.</p>
                </div>
                <MyJobsPanel accent="#4F46E5" mutedBorder="border-gray-100 dark:border-gray-800" />
              </div>
            )}

            {nav === 'report' && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Advantage Report</h2>
                  <p className="text-sm text-gray-500">3 tasks, each done two ways — once using an agent, once by hand — so you can see the real time, cost, and quality difference for yourself.</p>
                </div>
                <AdvantageReport />

                <div className="pt-4">
                  <h2 className="text-2xl font-bold mb-1">Practice Mode Activity</h2>
                  <p className="text-sm text-gray-500">Combined stats from actual Practice Mode runs on our live practice copy of the network.</p>
                  <p className="text-[11px] text-gray-400 mt-1">Note: general Practice Mode <em>testing</em> activity, not a specific agent's real hire record — for that, open an agent and look for "Past Hires".</p>
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
                      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{item.p}</div>
                      {item.tech && <div className="text-[12px] text-gray-400 dark:text-gray-500 leading-relaxed mt-1.5">Technical details, if you want them: {item.tech}</div>}
                      {item.src && <a href={item.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-1.5 inline-block">Source: {item.src.label} →</a>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {nav === 'build' && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold mb-1">Build Your Agent</h2>

                {/* Real, fork-tested skills from Altana's public registry —
                    the same AltanaSkillsPanel web uses, verbatim (2026-08-19
                    port). Its own JSX was already touch/mobile-friendly
                    Tailwind (rounded-2xl cards, compact text, single-column
                    grid on narrow widths) — no separate mobile rewrite of
                    the execution logic, matching every other shared
                    component in this app (BuyAccessPanel, StepChecklist,
                    JobStatusPanel, MyJobsPanel all work the same way). */}
                <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                  <AltanaSkillsPanel accent={REPORT_ACCENT} surface={darkMode ? '#1E293B' : '#FFFFFF'} mutedBorder="border-gray-200 dark:border-gray-800" darkMode={darkMode} initialSkillId={pendingSkillId} onConsumedInitialSkill={() => setPendingSkillId(null)} />
                </div>

                <div className="flex items-center gap-3 py-1">
                  <div className={`flex-1 h-px ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`} />
                  <span className="text-[10px] opacity-40 font-semibold uppercase">Or build something custom</span>
                  <div className={`flex-1 h-px ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`} />
                </div>

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
                      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{step.p}</div>
                      {step.tech && <div className="text-[12px] text-gray-400 dark:text-gray-500 leading-relaxed mt-1.5">Technical details, if you want them: {step.tech}</div>}
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
                  <div className="flex items-center gap-2 mb-2"><Link2 size={13} /><span className="text-xs font-bold uppercase text-gray-500">Good to know</span></div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Right now, this tool only builds agents that earn money by doing jobs for others (not ones that hire other agents themselves). The free build trial runs on a practice network; hiring agents in the Marketplace uses real money on the real network.</p>
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
                    Build it for real (free trial, ~2 days)
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
                            queued: 'In line...', scaffolding: "Setting up your agent's files...", creating_wallet: 'Creating a practice wallet...',
                            writing_logic: "Writing your agent's instructions...", activating_llm: 'Turning on its AI (free to start)...',
                            deploying: 'Publishing it live for your free trial...', done: "Done! It's live for the next 2 days.", error: 'Build failed',
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
                className={`flex flex-col items-center justify-center flex-1 max-w-[72px] h-14 rounded-xl transition-colors ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
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