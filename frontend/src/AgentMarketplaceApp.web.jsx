import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, Sliders, CheckCircle2, XCircle,
  LayoutGrid, Table2, GraduationCap, Store, ArrowUpDown, ChevronRight,
  Loader2, AlertTriangle, Wallet, ScanFace, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, ExternalLink, Zap, Coins, Search, Bell, Briefcase
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import iconLogo from './assets/icon_v2.svg';
import agentsHero from './assets/agents.png';
import { QRCodeCanvas } from 'qrcode.react';
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
import { SingleAgentDiagram, SequentialDiagram, ParallelDiagram, HierarchicalDiagram } from './AgentArchitectureDiagrams';

// QR linking to this same (responsive) site — a phone opens the mobile app.
// Level H (30% error correction) tolerates the centered, excavated logo.
function QrToMobile() {
  const url = import.meta.env?.VITE_MOBILE_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
  return (
    <div className="bg-white dark:bg-[#1E293B] p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4 lg:w-72 shrink-0">
      <div className="bg-white p-2 rounded-lg shrink-0">
        <QRCodeCanvas
          value={url}
          size={104}
          level="H"
          marginSize={3}
          bgColor="#ffffff"
          fgColor="#0B101B"
          imageSettings={{ src: iconLogo, height: 24, width: 24, excavate: true }}
        />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold">Open on your phone</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">Scan to launch the mobile app.</div>
      </div>
    </div>
  );
}
import { useHireAgent, buildHireStepList, useAgentQuote } from './useHireAgent';
import AltanaSessionPanel from './AltanaSessionPanel';
import AltanaSkillsPanel from './AltanaSkillsPanel';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import MyJobsPanel from './MyJobsPanel';
import AgentGuidancePanel from './AgentGuidancePanel';
import AdvantageReport from './AdvantageReport';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain' }; // mainnet-only

const CACHE_KEY = 'agents-marketplace-cache-v1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function mapAgent(a) {
  return {
    id: a.id, tokenId: a.token_id, name: a.name || 'Unnamed agent', category: a.category || 'Unclassified',
    network: a.network, chainId: a.chain_id, totalScore: a.total_score,
    starCount: a.star_count, totalFeedbacks: a.total_feedbacks, isVerified: a.is_verified,
    x402Supported: a.x402_supported, supportedProtocols: a.supported_protocols || [],
    ownerAddress: a.owner_address, ownerEns: a.owner_ens, ownerUsername: a.owner_username,
    imageUrl: a.image_url, strategy: a.description || 'No description provided.',
    financialDataAvailable: a.financial_data_available, tvlUsd: a.tvl_usd,
    defillamaUrl: a.defillama_url, ownerBnbBalance: a.owner_bnb_balance,
    possiblyDelisted: a.possibly_delisted, session: null,
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
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (agents.length > 0) setRefreshing(true);
    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => { if (!res.ok) throw new Error(`Backend returned ${res.status}`); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const mapped = (data.agents || []).map(mapAgent);
        setAgents(mapped);
        setLoading(false);
        setRefreshing(false);
        setError(null);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: mapped, savedAt: Date.now() })); } catch (e) {}
      })
      .catch((err) => {
        if (cancelled) return;
        setRefreshing(false);
        if (agents.length === 0) setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { agents, setAgents, loading, error, refreshing };
}

// Source: docs.bnbchain.org/developer-kit (BNB Agent SDK + BNB Agent Studio),
// provided directly, not searched, every term below matches the real docs.
// Confirmed-real source URLs (each verified to resolve, this session). Every
// factual claim below links to one of these next to the claim itself.
const SRC = {
  sdk: { label: 'BNB Agent SDK docs', url: 'https://docs.bnbchain.org/developer-kit/bnbagent-sdk/' },
  sdkArch: { label: 'BNB Agent SDK — architecture', url: 'https://docs.bnbchain.org/developer-kit/bnbagent-sdk/architecture/' },
  studio: { label: 'BNB Agent Studio docs', url: 'https://docs.bnbchain.org/developer-kit/bnbchain-studio/' },
  studioQuick: { label: 'BNB Agent Studio — Quickstart', url: 'https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/' },
  studioArch: { label: 'BNB Agent Studio — Architecture', url: 'https://docs.bnbchain.org/developer-kit/bnbchain-studio/architecture/' },
  altana: { label: 'Altana SDK docs', url: 'https://docs.altana.network' },
  skills: { label: 'Altana Skills Registry', url: 'https://raw.githubusercontent.com/altananetwork/skills/main/index.json' },
  venusSkill: { label: 'venus-lending SKILL.md', url: 'https://raw.githubusercontent.com/altananetwork/skills/main/skills/venus-lending/SKILL.md' },
};

const LEARN_TOPICS = [
  { title: 'Start here: the words we use, in plain English', body: [
    { h: 'A wallet', p: 'A wallet is just an account that can hold crypto and sign approvals — like an online account that can also say "yes, spend this." Here you can create one with Face ID / a passkey, so there\'s no seed phrase to write down.', plain: 'Think: a bank-card + signature, combined, that only you control.', src: SRC.altana },
    { h: 'Gas', p: 'Gas is the tiny network fee paid to record a transaction on the blockchain — like a stamp on a letter. Registering an agent here is gas-free: a "paymaster" called MegaFuel covers it, so you don\'t need to hold gas tokens.', plain: 'You don\'t pay a stamp to list an agent — the network sponsors it.', src: SRC.sdk },
    { h: 'Mainnet vs a practice fork', p: 'Mainnet is the real BNB Chain, where real money moves. Practice Mode instead runs on a "fork" — a live copy of mainnet loaded with free fake money — so you can try any agent or skill first at zero cost and zero risk.', plain: 'A fork is a sandbox clone of the real chain; nothing you do there spends real money.' },
    { h: 'Escrow', p: 'Escrow is a neutral on-chain vault. When you hire an agent, your payment is locked there; the agent is paid only when the work is accepted, and you can reclaim it if they never deliver.', plain: 'Your money is held by the rules, not by the agent, until the job is done.', src: SRC.sdk },
  ]},
  { title: 'The two standards every agent here uses', body: [
    { h: 'ERC-8004 — Identity', p: 'Every agent gets an on-chain identity token (an ERC-721 agentId), a discoverable profile (name, description, endpoints), and metadata. Registration is sponsored by the MegaFuel paymaster on BNB Chain, so it costs no gas.', plain: 'It\'s the agent\'s ID card, and putting it on-chain is free.', src: SRC.sdk },
    { h: 'ERC-8183 — Commerce', p: 'A trustless job protocol. A client (you) and a provider (the agent) transact through three contracts: AgenticCommerce (owns job state + escrow), EvaluatorRouter (routes each job to a settlement policy), and OptimisticPolicy (the default rule: silence past the review window counts as approval).', plain: 'Three small programs that hold the money and enforce the deal so neither side has to trust the other.', src: SRC.sdk },
  ]},
  { title: 'What "hiring" means here', body: [
    { h: 'A job, not a subscription', p: "Hiring creates a real ERC-8183 job — five wallet-signed steps: createJob → registerJob → setBudget → approve $U → fund. Payment is in $U (United Stables, a crypto dollar). Once funded, the budget sits in on-chain escrow; it is NOT a standing permission an agent can draw from repeatedly.", plain: 'You fund one specific job, once. The agent can never dip into your wallet again on its own.', src: SRC.sdk },
    { h: 'Provider submits, you get a receipt', p: 'The agent submits a deliverable; only a pointer/hash goes on-chain (the actual content is stored off-chain and looked up by URL). ', plain: 'The chain records the proof-of-delivery, not the file itself.', src: SRC.sdkArch },
    { h: 'Settlement is automatic, or disputable', p: 'Settling a job is permissionless — anyone can trigger it once the review window passes, releasing escrow to the provider. If the delivered work looks wrong, you dispute() during that window instead.', plain: 'Do nothing and the agent gets paid after the review window; object in time and it\'s contested.', src: SRC.sdk },
    { h: 'The real safety net: claimRefund', p: "If a job is never settled (agent went dark, nothing delivered) and its deadline passes, you call claimRefund() and get your escrowed funds back. It's the guaranteed exit — always available after expiry.", plain: 'Worst case, you wait out the deadline and take your money back.', src: SRC.sdk },
  ]},
  { title: 'The stages a hire goes through, one by one', body: [
    { h: 'OPEN', p: 'Job created, no budget escrowed yet.', plain: "You've started a job, but haven't paid for it yet." },
    { h: 'FUNDED', p: 'Budget escrowed. The provider can now start work.', plain: 'Your payment is on hold and the agent can now start the work.' },
    { h: 'SUBMITTED', p: 'Provider delivered a result, waiting out the review window.', plain: "The agent says it's done — you get a short window to check the work before it gets paid." },
    { h: 'COMPLETED', p: 'Verdict = approve (silence, or a resolved dispute). Payment released to the provider, minus platform fees.', plain: 'The job is finished and the agent has been paid (a small platform fee comes out first).' },
    { h: 'REJECTED', p: 'Either you cancelled before funding, or a dispute resolved against the provider. You get refunded.', plain: "Either you cancelled before paying, or you successfully disputed bad work — either way, you get your money back." },
    { h: 'EXPIRED', p: 'No settlement ever reached, past the deadline. Reclaim your funds anytime with claimRefund().', plain: 'The deadline passed with nothing delivered. You can get your money back anytime after that.' },
  ], src: SRC.sdk },
  { title: 'Ready-made Skills & Practice Mode', body: [
    { h: 'Skills = pre-built, fork-tested know-how', p: 'Instead of building an agent, you can use a ready-made Skill from Altana\'s public registry (PancakeSwap trading, Venus/Aave lending, Lista staking, four.meme, copy-trade, and more). Each Skill\'s exact contracts and steps are published and fork-tested.', plain: 'Skills are recipes an agent can run for you — no building required.', src: SRC.skills },
    { h: 'A passkey wallet + a scoped session', p: 'To run a Skill for real you create a passkey wallet (Face ID / Touch ID) and grant a session: a spend cap, an expiry, and an allow-list of exactly which contracts it may touch. The Skill can act only inside those limits, and you can revoke it.', plain: 'You hand the agent a prepaid card with a limit and an expiry, not your whole wallet.', src: SRC.altana },
    { h: 'Practice Mode: try it free first', p: 'Flip Practice Mode on to run any Skill against our live fork of BNB Chain with free faucet funds — no real money, no passkey. Every practice run is saved to your history (in a database), so it stays even though the fork itself can reset when the practice server restarts.', plain: 'Rehearse with fake money; the record of what you did is kept even if the sandbox is reset.', src: SRC.venusSkill },
  ]},
  { title: 'How agents are built', body: [
    { h: 'Single agent', p: 'One agent handles the whole task itself, start to finish — reads what it needs, does the work, hands back a result. This is the simplest pattern, and the one most agents listed here actually use.', Diagram: SingleAgentDiagram },
    { h: 'Sequential (chained steps)', p: 'The task moves through a fixed pipeline of steps, one after another — each step\'s output becomes the next step\'s input. Good for work that has a natural order, like "research, then draft, then check."', Diagram: SequentialDiagram },
    { h: 'Parallel (specialists working at once)', p: 'The task is split across several specialists that all work at the same time, and their results get combined into one answer. Good when different parts of a task don\'t depend on each other and can happen simultaneously.', Diagram: ParallelDiagram },
    { h: 'Hierarchical (an orchestrator delegating)', p: 'One orchestrator agent breaks the task into pieces and hands each piece to a sub-agent underneath it, then assembles what comes back. Good for complex work that benefits from a manager coordinating specialists.', Diagram: HierarchicalDiagram },
    { h: 'What\'s actually here right now', p: 'Honestly: fewer than 2% of the agents listed on this marketplace even mention multi-agent or orchestration language in their own description — the large majority present as single agents. That\'s not a shortcoming of this marketplace; the other three patterns are real, valid ways to build an agent, just not yet common among what\'s registered here today.' },
  ]},
];

// Real bag CLI workflow, from BNB Agent Studio docs. v0.0.1 is seller-only:
// this builds agents that EARN by fulfilling jobs, not buyer-side apps.
// Steps below reflect what our tested pipeline (backend/core/agent_builder.py)
// actually runs — notably: there is NO handle_fulfill (that was a doc-summary
// myth we disproved by reading a real generated project); the real edit point
// is the agent's instruction string in main.py.
const BUILD_STEPS = [
  { title: '1. Describe your agent, in plain English', body: 'Open Claude Code or Cursor and describe what you want: "Create a BNB agent that sells 3-day weather forecasts." BNB Agent Studio\'s "bag" tool reads that and scaffolds a working project for you — no blank file.', plain: 'You type a sentence; the tool writes the starter code.', src: SRC.studioQuick },
  { title: '2. It builds two things, not one', body: 'Layer A (the Agent, app/agent) holds the wallet + LLM and is the ONLY thing that ever signs. Layer B (the Service, app/service) is public, keyless, and just relays requests. The split exists because the Agent runtime (AWS Bedrock AgentCore) isn\'t publicly reachable, so a keyless relay (EC2/Fargate) fronts it.', plain: 'The part that holds keys stays private; a separate public part takes requests.', src: SRC.studioArch },
  { title: '3. You edit the agent\'s instructions, not plumbing', body: 'Wallet setup, ERC-8004 registration, and the ERC-8183 negotiate/fund/settle wiring are already there. What you change is the agent\'s instruction string in main.py — the plain description of what it should DO when a funded job asks it to "fulfill."', plain: 'You rewrite one paragraph telling the agent its job — not the wiring around it.', src: SRC.studioArch },
  { title: '4. Test locally before it touches real money', body: 'bag dev runs both layers on your machine. You can hit the real /negotiate endpoint, get a real signed price quote, and confirm the whole flow before deploying or spending anything. The default Pieverse LLM needs no funds.', plain: 'Run it on your laptop first; the default AI model is free.', src: SRC.studioQuick },
  { title: '5. Register, then deploy', body: 'bag erc8004 register makes your agent discoverable (the same identity every agent here shows). The one-click "Build it for real" button uses the free ~48h platform trial (no AWS account needed). To run it yourself instead, self-host Layer A on AWS Bedrock AgentCore and Layer B on EC2/Fargate.', plain: 'Try it free for 48h with one click, or host it yourself later.', src: SRC.studioArch },
];

const KID_FRIENDLY_FAQ = [
  { q: 'Do I need to know how to code?', a: 'No. You describe what you want in normal sentences; to build a custom agent you mostly edit one instruction paragraph, and to use a ready-made Skill you just fill in a form.', src: SRC.studioQuick },
  { q: 'What is Practice Mode?', a: 'A free rehearsal. It runs a Skill on a live copy ("fork") of BNB Chain with fake faucet money, so you can see exactly what would happen before spending anything real. Your run history is saved even though the fork can reset.', src: SRC.venusSkill },
  { q: 'What is a passkey wallet?', a: 'A crypto wallet you unlock with Face ID / Touch ID instead of a seed phrase. It signs approvals for you, and for Skills you grant it only a capped, expiring, contract-limited session.', src: SRC.altana },
  { q: 'Can it spend my money without asking?', a: 'No. Hiring funds one specific job you set and fund yourself; a Skill session has a spend cap, an expiry, and an allow-list of contracts. Neither is a standing permission it can redraw from.', src: SRC.sdk },
  { q: 'What if the agent never delivers?', a: "You're guaranteed to get your money back once the deadline passes — but it's not automatic. You'll need to come back and claim it yourself with one click. That guarantee is a built-in rule of the whole system, not a favor the agent has to grant you.", src: SRC.sdk },
  { q: 'Do I need my own cloud hosting account to build one?', a: "No. The \"Build it for real\" button uses a free trial (about 2 days) on a temporary practice wallet — no hosting account, no real money involved. Hosting it yourself long-term is optional, and only if you want to later.", src: SRC.studio },
  { q: 'What kind of agent can I build?', a: "Pretty much anything you can describe in a sentence: trading, research, writing, customer support, data analysis, games — you're not limited to a preset list. The category shown here is just how we label it afterward.", src: SRC.studioQuick },
  { q: 'Can it sell to people, not just other agents?', a: "Yes. Any buyer — a person or another agent — can hire it. It's not limited to agent-to-agent deals.", src: SRC.studioArch },
];

// Styled exactly like the "WEB3 WALLET MANAGER" from the provided image
const BSCSCAN = 'https://bscscan.com';

function DetailStat({ label, value, hint }) {
  return (
    <div title={hint} className="text-center p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50">
      <span className="block text-[10px] text-gray-500 uppercase mb-1">{label}</span>
      <span className="font-bold text-sm text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

function DetailBadge({ children, icon: Icon, hint }) {
  return (
    <span title={hint} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">
      {Icon && <Icon size={12} />}{children}
    </span>
  );
}

// Real per-agent track record from on-chain ERC-8183 job history (this agent's
// owner as the provider). Distinct from the Practice-Layer report — this is
// "how has THIS agent done when actually hired." Honest empty state when the
// agent has no real hires yet (expected for a new marketplace).
// Real bug found + fixed 2026-08-21: reported as "Reading on-chain job
// history…" stuck forever on a real agent's detail page. Backend
// (/api/agents/performance) itself DOES have a real 30s timeout on its own
// RPC calls, and responded fast/correctly on direct, repeated testing — the
// real structural gap was here: this fetch had NO client-side timeout at
// all, unlike DeliverableViewer's already-proven AbortController pattern
// elsewhere in this codebase. If a response is ever unusually slow, or a
// connection stalls without cleanly rejecting (a real possibility on a
// free-tier host under cold start or a transient RPC hiccup — directly
// observed multiple times this session with various BSC RPCs), there was
// no mechanism to ever leave "loading". Fixed with the same real timeout +
// retry pattern already proven for the deliverable fetch.
const AGENT_PERFORMANCE_FETCH_TIMEOUT_MS = 20_000;

function AgentPerformance({ agent, onTrySkill }) {
  const ownerAddress = agent.ownerAddress;
  const [perf, setPerf] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!ownerAddress) { setState('ready'); return; }
    let cancelled = false;
    setState('loading');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AGENT_PERFORMANCE_FETCH_TIMEOUT_MS);
    fetch(`${API_BASE_URL}/api/agents/performance?owner_address=${ownerAddress}`, { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setPerf(d); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [ownerAddress, retryTick]);

  return (
    <div className="mt-6">
      <h3 className="text-sm font-bold mb-2 flex items-center gap-1.5"><Activity size={14} /> Past Hires</h3>
      {state === 'loading' && <div className="flex items-center gap-2 text-gray-400 text-xs"><Loader2 size={13} className="animate-spin" /> Looking up this agent's hire history…</div>}
      {state === 'error' && (
        <div className="flex items-center gap-2 text-xs text-gray-400">
          Couldn't look up this agent's hire history right now.
          <button onClick={() => setRetryTick((t) => t + 1)} className="text-indigo-500 hover:underline font-medium">Try again</button>
        </div>
      )}
      {state === 'ready' && (!perf || !perf.hired) ? (
        <>
          <AgentGuidancePanel agent={agent} mutedBorder="border-gray-200 dark:border-gray-800" onTrySkill={onTrySkill} />
          {perf && <p className="text-[10px] text-gray-400 mt-1.5">We checked the last {perf.scanned_window} jobs on the whole marketplace and found none for this agent — it may just be new.</p>}
        </>
      ) : state === 'ready' && perf?.hired ? (
        <div className="p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 bg-indigo-50/60 dark:bg-indigo-500/5">
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div title="How many times people have hired this agent"><div className="text-[10px] uppercase text-gray-500">Times Hired</div><div className="text-lg font-bold" style={{ color: '#4F46E5' }}>{perf.hire_count}</div></div>
            <div title="Out of the jobs that finished, how many were successfully completed"><div className="text-[10px] uppercase text-gray-500">Success Rate</div><div className="text-lg font-bold">{perf.completion_rate != null ? `${Math.round(perf.completion_rate * 100)}%` : '—'}</div></div>
            <div title="Jobs currently underway, not finished yet"><div className="text-[10px] uppercase text-gray-500">In Progress</div><div className="text-lg font-bold">{perf.active}</div></div>
          </div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400" title="Rejected means the buyer wasn't happy with the finished work. Timed out means the agent never finished before the deadline.">Finished {perf.completed} · Work rejected by buyer {perf.rejected} · Missed deadline {perf.expired}{perf.completion_rate == null ? ' — none finished yet, so no rate to show' : ''}. Based on the last {perf.scanned_window} jobs across the whole marketplace.</div>
          {/* Real, data-driven reliability hint — see agentReliability.js for
              the exact thresholds and reasoning. No LLM guessing, no
              fabricated score, just the real EXPIRED/settled ratio. */}
          {(() => {
            const hint = getReliabilityHint(perf);
            return hint ? (
              <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300">
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

// Full agent detail view — everything the aggregated 8004scan/DefiLlama data
// actually holds for one agent. Shown full-screen in the market tab, matching
// the hire-flow navigation pattern.
function AgentDetail({ agent, onBack, onHire, onTrySkill }) {
  const [copied, setCopied] = useState(false);
  const onShare = async () => {
    const ok = await copyShareLink(agentShareUrl(agent));
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <div className="max-w-3xl mx-auto mt-4">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <ChevronRight size={16} className="rotate-180" /> Back to Marketplace
        </button>
        {/* Shareable per-agent link — send a client straight to this agent. */}
        <button onClick={onShare} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          <Link2 size={14} /> {copied ? 'Link copied!' : 'Share this agent'}
        </button>
      </div>
      <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xl">{agent.name.charAt(0)}</div>
            <div>
              <div className="flex items-center gap-2"><h2 className="text-2xl font-bold">{agent.name}</h2>{agent.isVerified && <BadgeCheck size={18} className="text-indigo-500" />}</div>
              <div className="flex items-center gap-2 mt-1">
                <span title={CATEGORY_HINTS[agent.category]} className="text-[11px] text-indigo-500 uppercase font-semibold tracking-wider">{agent.category}</span>
                {agent.possiblyDelisted && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" title="Not seen active in over a week">may no longer be active</span>}
              </div>
            </div>
          </div>
          <span className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 shrink-0">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <DetailStat label="Score" hint="How trustworthy this agent looks, based on real past feedback — higher is better" value={agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'} />
          <DetailStat label="Stars" hint="How many people rated this agent" value={agent.starCount ?? '—'} />
          <DetailStat label="Feedback" hint="How many written reviews this agent has" value={agent.totalFeedbacks ?? '—'} />
          <DetailStat label="Funds" hint="Total money this agent currently manages for people" value={agent.financialDataAvailable && agent.tvlUsd != null ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '—'} />
        </div>
        {agent.financialDataAvailable && agent.defillamaUrl && (
          <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1 mb-5">Where this money number comes from: DefiLlama <ExternalLink size={11} /></a>
        )}

        <div className="flex flex-wrap items-center gap-2 my-5">
          {agent.isVerified && <DetailBadge icon={BadgeCheck} hint="Registered on-chain — not a quality rating">Verified</DetailBadge>}
          {agent.x402Supported && <DetailBadge icon={Zap} hint="Can pay other agents automatically for tools or data it needs, without a person approving each payment">Pays other agents automatically</DetailBadge>}
          {(agent.supportedProtocols || []).map((p) => <DetailBadge key={p} icon={Coins} hint={`Works with ${p}, a real app it can act on for you`}>{p}</DetailBadge>)}
          <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} size="md" />
          {(!agent.serviceStatus || agent.serviceStatus === 'unknown') && (
            <span className="text-[11px] text-gray-400" title="Not checked yet, or the last check didn't go through">Not confirmed online yet</span>
          )}
        </div>
        {agent.serviceEndpoint && (
          <p className="text-[11px] text-gray-400 mb-2 -mt-3 break-all" title="The web address we contact to check whether this agent is turned on">Where we check on it: <span className="font-mono">{agent.serviceEndpoint}</span></p>
        )}

        <h3 className="text-sm font-bold mb-2">About</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-6 whitespace-pre-wrap">{agent.strategy}</p>

        <h3 className="text-sm font-bold mb-2 flex items-center gap-2">Who owns this agent <PasskeyBadge ownerAddress={agent.ownerAddress} /></h3>
        {agent.ownerAddress ? (
          <>
            <a href={`${BSCSCAN}/address/${agent.ownerAddress}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-indigo-500 hover:underline inline-flex items-center gap-1 break-all">
              {agent.ownerAddress} <ExternalLink size={11} className="shrink-0" />
            </a>
            <p className="text-[11px] text-gray-400 mt-1">This is the agent creator's wallet ID — a public account number anyone can look up, like a bank account number that's safe to share. Tap it to see its full activity record.</p>
          </>
        ) : (
          <p className="text-xs text-gray-400">We don't have an owner ID on record for this agent.</p>
        )}

        {/* A live number distinct from "Funds": the owner wallet's actual BNB
            (the network's own currency) balance. Deliberately labeled and
            placed apart from the "Funds" stat above so the two are never
            confused with one another. */}
        <div className="mt-4 flex items-center justify-between p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20">
          <span className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5" title="BNB is this network's own currency, used to pay small network fees. This is how much the owner's wallet holds right now — checked live, this instant."><Wallet size={13} /> Owner's wallet balance <span className="text-[10px] text-gray-400">(in BNB)</span></span>
          <span className="font-mono text-sm font-semibold">
            {agent.ownerBnbBalance != null ? `${agent.ownerBnbBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB` : <span className="text-gray-400 font-normal">not available</span>}
          </span>
        </div>

        <AgentPerformance agent={agent} onTrySkill={onTrySkill} />

        {agent.tokenId != null && <BuyAccessPanel agentId={String(agent.tokenId)} />}

        <div className="mt-6 p-3 rounded-xl border border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
          We don't yet track practice-run history per agent — only by which practice tool you tried under Build → Practice Mode. So there's nothing agent-specific to show here yet.
        </div>

        <button onClick={() => onHire(agent)} className="w-full mt-6 py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide">
          Hire this agent →
        </button>
      </div>
    </div>
  );
}

function HybridWalletConnect({ accent }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { ready, authenticated, user, login, logout } = usePrivy();
  const privyConnected = ready && authenticated;
  const activeAddress = wagmiConnected ? wagmiAddress : user?.wallet?.address;
  const isConnected = wagmiConnected || privyConnected;
  const shortAddress = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : null;

  return (
    <div className="bg-[#131825] border border-white/10 rounded-2xl p-4 mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Wallet size={14} className="text-gray-400" />
        <h3 className="text-xs font-bold text-gray-300 tracking-wider uppercase">Your Wallet</h3>
      </div>
      
      {isConnected ? (
        <div className="flex items-center justify-between bg-white/5 rounded-xl p-3 border border-white/5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="font-mono text-xs text-gray-200">{shortAddress}</span>
          </div>
          <button onClick={() => (wagmiConnected ? wagmiDisconnect() : logout())} className="text-gray-400 hover:text-white transition-colors">
            <LogOut size={14} />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <ConnectButton.Custom>
            {({ openConnectModal }) => (
              <button onClick={openConnectModal} className="w-full flex justify-between items-center bg-[#1E2433] hover:bg-[#252C3D] text-white text-sm font-medium py-3 px-4 rounded-xl transition-colors">
                <span>Connect a wallet</span>
                <ChevronRight size={16} className="text-gray-400" />
              </button>
            )}
          </ConnectButton.Custom>
          <button onClick={login} className="w-full flex justify-between items-center bg-transparent border border-white/10 hover:bg-white/5 text-gray-300 text-sm font-medium py-3 px-4 rounded-xl transition-colors">
            <div className="flex items-center gap-2">
              <ScanFace size={16} /> <span>Face ID / Email</span>
            </div>
          </button>
          <p className="text-[10px] text-gray-500 text-center mt-3">No wallet? You can keep browsing without connecting.</p>
        </div>
      )}
    </div>
  );
}

function SortHeader({ label, hint, sortKey, sortState, onSort }) {
  const active = sortState.key === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} title={hint} className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold transition-colors ${active ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
      {label}
      <ArrowUpDown size={12} className={active ? 'opacity-100' : 'opacity-40'} />
    </button>
  );
}

// The rebuilt Advantage Report: REAL aggregated practice-layer execution stats
// from MongoDB (/api/practice/stats), replacing the old hardcoded, unverifiable
// "with agent vs without agent" comparison array. Accent is the app's indigo
// (#4F46E5), consistent with the rest of the UI — no more green here.
const REPORT_ACCENT = '#4F46E5';

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

function PracticeStatsReport() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/practice/stats`)
      .then((r) => { if (!r.ok) throw new Error(`Backend returned ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) { setStats(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Loading practice stats…</div>;
  if (error) return <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/5 text-sm text-red-500">Couldn't load practice stats: {error}</div>;

  const skills = stats?.skills || [];
  const topCards = [
    { label: 'Total Practice Runs', value: (stats?.total_runs ?? 0).toLocaleString(), icon: Activity },
    { label: 'Different Practice Wallets', value: (stats?.distinct_wallets ?? 0).toLocaleString(), icon: Users },
    { label: 'Skills Tried', value: (stats?.skill_count ?? 0).toLocaleString(), icon: Zap },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {topCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
              <div className="p-3 rounded-xl" style={{ background: 'rgba(79,70,229,0.10)', color: REPORT_ACCENT }}><Icon size={20} /></div>
              <div><div className="text-2xl font-bold">{c.value}</div><div className="text-xs text-gray-500 font-medium">{c.label}</div></div>
            </div>
          );
        })}
      </div>

      {skills.length === 0 ? (
        <div className="p-6 rounded-2xl border border-gray-200 dark:border-gray-800 text-sm text-gray-500">
          No practice runs yet. Try a skill in Practice Mode (under Build) and its stats will show up here.
        </div>
      ) : (
        <div className="space-y-4">
          {skills.map((s) => (
            <div key={s.skill_id} className="bg-white dark:bg-[#1E293B] rounded-2xl p-6 border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-lg font-bold">{s.agent_name}</h3>
                  <span className="text-[11px] font-mono text-gray-400">{s.skill_id}</span>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full" style={{ background: 'rgba(79,70,229,0.10)', color: REPORT_ACCENT }}>Last run {reportTimeAgo(s.last_ran_at)}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50">
                  <div className="text-[10px] uppercase text-gray-500 mb-1">Times Run</div>
                  <div className="text-xl font-bold" style={{ color: REPORT_ACCENT }}>{s.executions}</div>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50">
                  <div className="text-[10px] uppercase text-gray-500 mb-1">Different Wallets</div>
                  <div className="text-xl font-bold">{s.distinct_wallets}</div>
                </div>
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50 col-span-2 sm:col-span-1">
                  <div className="text-[10px] uppercase text-gray-500 mb-1">Actions</div>
                  <div className="flex flex-wrap gap-1">
                    {(s.actions || []).map((a) => <span key={a} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">{a}</span>)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats?.note && (
        <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-200 dark:border-gray-800 pt-4">{stats.note}</p>
      )}
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'market', label: 'Marketplace', icon: Store },
  { id: 'my-agents', label: 'My Agents', icon: Briefcase },
  { id: 'report', label: 'Advantage Report', icon: FileBarChart },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'build', label: 'Build Your Agent', icon: Hammer },
  { id: 'sell', label: 'Sell Your Agent', icon: Coins },
];

export default function AgentMarketplaceApp() {
  const [darkMode, setDarkMode] = useState(false);
  const [nav, setNav] = useState('market');
  const [marketView, setMarketView] = useState('grid');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchInput, setSearchInput] = useState('');   // immediate input value
  const [searchQuery, setSearchQuery] = useState('');    // debounced, used for filtering
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [detailAgent, setDetailAgent] = useState(null); // full-screen agent detail view
  // Real deep-link from the agent guidance panel's "Try in Practice Mode" —
  // switches to Build and pre-opens that specific skill's guided form.
  const [pendingSkillId, setPendingSkillId] = useState(null);
  const handleTrySkill = (skillId) => { setDetailAgent(null); setNav('build'); setPendingSkillId(skillId); };
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
  const [spendCapTouched, setSpendCapTouched] = useState(false);
  // Advanced override for the on-chain job description (default: the plain
  // auto-generated string below). Needed for e.g. hiring an agent that
  // requires a signed-quote-anchored description (see build_job_description)
  // instead of a human-readable label. Collapsed by default — most hires
  // never need this. hire() already negotiates + anchors the signed quote
  // automatically (real fix, 2026-08-22 — see useHireAgent.js), so this is
  // only for the rare case someone wants to hand-craft the on-chain text.
  const [customDescription, setCustomDescription] = useState('');
  const [showCustomDescription, setShowCustomDescription] = useState(false);
  // Real, live price discovery — see useAgentQuote in useHireAgent.js.
  // Pre-fills the budget with the agent's real negotiated price once known,
  // so the user isn't guessing (real gap fixed 2026-08-22). Only fetched
  // while the hire modal for a given agent is actually open.
  const agentQuote = useAgentQuote(hiring ? selectedAgent : null);
  useEffect(() => {
    if (agentQuote.status === 'available' && !spendCapTouched) {
      setSpendCap(agentQuote.priceUnits);
    }
  }, [agentQuote.status, agentQuote.priceUnits, spendCapTouched]);
  // Hire-by-address: an escape hatch for an agent that isn't (yet) indexed
  // in the known_agents store / showing as a card — e.g. one registered
  // minutes ago. Builds a synthetic in-memory agent object and reuses the
  // exact same hire pipeline as a real card; touches no backend/DB state.
  const [showManualHire, setShowManualHire] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [stopLoss, setStopLoss] = useState(5000);
  const { agents, setAgents, loading, error, refreshing } = useMarketplaceAgents();

  // Deep link: ?agent=<tokenId|id> opens that agent's detail once agents load,
  // so a creator's shared link lands a client straight on their agent.
  const deepLinkIdRef = useRef(readDeepLinkAgentId());
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || !deepLinkIdRef.current || agents.length === 0) return;
    const match = agents.find((a) => matchesDeepLink(a, deepLinkIdRef.current));
    if (match) { deepLinkHandledRef.current = true; setNav('market'); setDetailAgent(match); }
  }, [agents]);

  const [sortState, setSortState] = useState({ key: 'totalScore', dir: 'desc' });
  const [showUnclassified, setShowUnclassified] = useState(true);
  const [onlyResponding, setOnlyResponding] = useState(false);

  const { isConnected: wagmiConnected } = useAccount();
  const { ready, authenticated } = usePrivy();
  const walletConnected = wagmiConnected || (ready && authenticated);

  // Soft Indigo replacing the old high-contrast colors
  const accent = '#6366F1'; 
  
  const handleRevoke = (agentId) => setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, session: null } : a)));

  const {
    hire, step: hireStep, error: hireError,
    completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps, stepHashes: hireStepHashes,
    notifySkipReason: hireNotifySkipReason,
  } = useHireAgent();

  const handleHireClick = (agent) => {
    if (!walletConnected) {
      alert('Connect a wallet first to hire this agent — sidebar: Connect Wallet or Face ID / Email.');
      return;
    }
    setSelectedAgent(agent);
    setHiring(true);
    setSpendCapTouched(false); // fresh agent — let its real price (if any) pre-fill again
  };

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("We don't have an owner ID on record for this agent, so we can't hire it.");
      return;
    }
    try {
      // REAL flow: creates + registers + budgets + approves (if needed) +
      // funds a genuine ERC-8183 job, the user's own connected wallet
      // signs every step, nothing here is simulated.
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
      // hireError (from the hook) already carries the real message,
      // surfaced in the modal UI, no silent failure.
    }
  };

  const handleSort = (key) => setSortState((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));

  // Debounce the search so filtering doesn't run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtered = useMemo(() => {
    const hasRealContent = (a) => a.name && a.name.trim().length > 2;
    let list = agents.filter(hasRealContent);
    if (!showUnclassified) list = list.filter((a) => a.category !== 'Unclassified');
    // Search AND category both apply together.
    list = list.filter((a) => activeCategory === 'All' || a.category === activeCategory);
    if (searchQuery) {
      list = list.filter((a) => `${a.name} ${a.strategy}`.toLowerCase().includes(searchQuery));
    }
    // Real filter: only agents whose registered endpoint answered a real
    // health-check (see core/agent_health.py) — the requested "let a user
    // filter to only see agents with a currently-responding endpoint".
    if (onlyResponding) list = list.filter((a) => a.serviceStatus === 'responding');
    return [...list].sort((a, b) => {
      const av = a[sortState.key] ?? -Infinity;
      const bv = b[sortState.key] ?? -Infinity;
      const mult = sortState.dir === 'desc' ? -1 : 1;
      return (av - bv) * mult;
    });
  }, [agents, activeCategory, sortState, showUnclassified, onlyResponding, searchQuery]);

  // Real, derived stats from actually-fetched agents, replacing the
  // earlier hardcoded numbers (which were 8004scan's own global platform
  // stats from a reference screenshot, not this marketplace's real data).
  const stats = useMemo(() => ({
    total: agents.length,
    verified: agents.filter((a) => a.isVerified).length,
    totalFeedbacks: agents.reduce((sum, a) => sum + (a.totalFeedbacks || 0), 0),
  }), [agents]);

  // Category chips derived from the REAL fetched data, so the newly-classified
  // categories (Trading Signals, Research, Payments, …) actually appear and are
  // filterable — the old hardcoded CATEGORIES only listed the original 4.
  const categories = useMemo(
    () => ['All', ...Array.from(new Set(agents.map((a) => a.category).filter(Boolean))).sort()],
    [agents]
  );

  return (
    <div className={`min-h-screen font-sans flex ${darkMode ? 'dark bg-[#0F172A]' : 'bg-[#F4F5F8]'}`}>
      
      {/* Sidebar: Deep Dark Navy, scrolls together with the page now, no independent region */}
      <aside className="w-[28rem] shrink-0 bg-[#0B101B] text-white border-r border-white/5 shadow-xl relative z-10">
        {/* Sticky wrapper: this content stays visible near the top of the
            viewport as you scroll through the taller main content, instead
            of scrolling away and leaving blank space, while the aside's
            own dark background still extends the full page height. */}
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-8 h-8 rounded-lg overflow-hidden shadow-lg shadow-indigo-500/20">
                <img src={iconLogo} alt="Agents Marketplace" className="w-full h-full object-contain" />
              </div>
              <h1 className="text-lg font-bold tracking-tight flex-1">Agents Marketplace</h1>
              <NotificationBell variant="dark" />
            </div>
            
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = nav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setNav(item.id); setHiring(false); }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                      active ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }`}
                  >
                    <Icon size={18} className={active ? 'text-indigo-400' : 'opacity-70'} /> 
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Hero image, same role as OnChain Oversight's hand+device visual, enlarged */}
          <div className="px-4 mb-2">
            <img src={agentsHero} alt="" className="w-full min-h-[280px] object-cover rounded-2xl border border-white/10" />
          </div>

          {/* WEB3 WALLET MANAGER card, matching the OnChain Oversight pattern */}
          <div className="p-6">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet size={16} className="opacity-70" />
                <span className="text-xs font-bold uppercase tracking-wide opacity-80">Your Wallet</span>
              </div>
              <HybridWalletConnect accent={accent} />
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-gray-500 px-2">
              <div className="flex items-center gap-1.5" title="Actions here use real money, not practice funds"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Real money — not practice</div>
              <button onClick={() => setDarkMode(!darkMode)} className="hover:text-gray-300 transition-colors">
                {darkMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 md:p-12 overflow-x-hidden text-gray-900 dark:text-gray-100 transition-colors duration-300">
        <div className="max-w-6xl mx-auto">
          
          {nav === 'market' && detailAgent && !hiring && (
            <AgentDetail
              agent={detailAgent}
              onBack={() => setDetailAgent(null)}
              onHire={(a) => { setDetailAgent(null); handleHireClick(a); }}
              onTrySkill={handleTrySkill}
            />
          )}

          {nav === 'market' && !hiring && !detailAgent && (
            <>
              {/* Real stats derived from actually-fetched agents, not global platform numbers */}
              <div className="flex flex-col lg:flex-row gap-4 mb-10 items-stretch">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
                  <div title="How many agents are shown below" className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"><Activity size={20} /></div>
                    <div><div className="text-2xl font-bold">{stats.total.toLocaleString()}</div><div className="text-xs text-gray-500 font-medium">Agents Listed</div></div>
                  </div>
                  <div title="Total written reviews left across all these agents" className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><MessageSquare size={20} /></div>
                    <div><div className="text-2xl font-bold">{stats.totalFeedbacks.toLocaleString()}</div><div className="text-xs text-gray-500 font-medium">Reviews</div></div>
                  </div>
                  <div title="Registered on-chain — not a quality rating" className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400"><Users size={20} /></div>
                    <div><div className="text-2xl font-bold">{stats.verified.toLocaleString()}</div><div className="text-xs text-gray-500 font-medium">Verified Agents</div></div>
                  </div>
                </div>
                <QrToMobile />
              </div>

              {/* #3 — honest data-ceiling note. Stated plainly rather than leaving
                  the user to wonder why the list is short. */}
              <div className="mb-8 flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
                <span>We're showing you a varied mix, not every agent that exists. Most of the agents signed up here were created in a few big batches and look almost identical to each other, so we limit how many near-duplicates show up. That's why this list is short on purpose — there really are more agents out there, we're just not cluttering your view with lookalikes.</span>
              </div>

              <ServiceHealthExplainer className="mb-8" />

              <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2">
                    Agent Marketplace
                    {refreshing && <Loader2 size={16} className="animate-spin text-gray-400" />}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Browse AI agents, check them out, and hire one with a spending limit you control.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setOnlyResponding((v) => !v)}
                    className={`px-4 py-2.5 rounded-xl text-xs font-medium border transition-colors ${
                      onlyResponding
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    title="Only show agents that responded just now"
                  >
                    {onlyResponding ? '✓ ' : ''}Only show online agents
                  </button>
                  <button onClick={() => setShowUnclassified((v) => !v)} className="px-4 py-2.5 rounded-xl text-xs font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    {showUnclassified ? 'Hide' : 'Show'} unclassified
                  </button>
                  <div className="flex bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 rounded-xl p-1">
                    <button onClick={() => setMarketView('grid')} className={`p-2 rounded-lg transition-all ${marketView === 'grid' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><LayoutGrid size={16} /></button>
                    <button onClick={() => setMarketView('table')} className={`p-2 rounded-lg transition-all ${marketView === 'table' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><Table2 size={16} /></button>
                  </div>
                </div>
              </div>

              <div className="mb-4 relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search agents by name or description…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E293B] text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Hire-by-address escape hatch — for an agent not yet indexed
                  as a card (e.g. just registered). Builds a synthetic agent
                  object and reuses the real hire flow; no backend involved. */}
              <div className="mb-8">
                <button type="button" onClick={() => setShowManualHire((v) => !v)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E293B] text-gray-600 dark:text-gray-300 hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                  <Search size={12} />{showManualHire ? 'Hide this' : "Know an agent's ID? Hire it directly"}
                </button>
                {showManualHire && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={manualAddress}
                      onChange={(e) => setManualAddress(e.target.value.trim())}
                      placeholder="0x… the agent owner's wallet ID"
                      className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E293B] text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={!/^0x[a-fA-F0-9]{40}$/.test(manualAddress)}
                      onClick={() => {
                        handleHireClick({ id: `manual-${manualAddress}`, name: `Custom agent (${manualAddress.slice(0, 6)}…${manualAddress.slice(-4)})`, ownerAddress: manualAddress, category: 'Unclassified' });
                        setShowManualHire(false);
                      }}
                      className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      Hire
                    </button>
                  </div>
                )}
              </div>

              <div className="mb-8 flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button key={cat} onClick={() => setActiveCategory(cat)} title={CATEGORY_HINTS[cat]} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                    activeCategory === cat ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-[#1E293B] dark:text-gray-300 dark:border-gray-700'
                  }`}>{cat}</button>
                ))}
              </div>

              {loading && (
                <div className="flex flex-col items-center justify-center py-32 gap-4 text-sm text-gray-500">
                  <Loader2 size={32} className="animate-spin text-indigo-500" />
                  Loading agents…
                </div>
              )}

              {error && !loading && (
                <div className="flex items-center gap-4 p-5 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 mb-8">
                  <div className="p-2 bg-red-100 dark:bg-red-900/50 rounded-full text-red-600 dark:text-red-400"><AlertTriangle size={20} /></div>
                  <div>
                    <div className="font-semibold text-red-800 dark:text-red-300">Couldn't load the agent list</div>
                    <div className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">{error}. Check your internet connection and try again.</div>
                  </div>
                </div>
              )}

              {!loading && !error && marketView === 'table' && (
                <div className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800">
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider" title="Which blockchain network this agent runs on">Network</th>
                        <th className="p-4"><SortHeader label="Score" hint="How trustworthy this agent looks, based on real past feedback — higher is better" sortKey="totalScore" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4"><SortHeader label="Stars" hint="How many people rated this agent, like a star rating on a store" sortKey="starCount" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4"><SortHeader label="Online?" hint="Whether we could reach this agent just now" sortKey="serviceRank" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider" title="Written comments people left after hiring this agent">Feedback</th>
                        <th className="p-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {filtered.map((agent) => (
                        <tr key={agent.id} onClick={() => setDetailAgent(agent)} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors group cursor-pointer">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <span className={`w-2 h-2 rounded-full ${agent.isVerified ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                              <div>
                                <div className="text-sm font-semibold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={14} className="text-indigo-500" title="Registered on-chain — not a quality rating" />}</div>
                                <div className="text-[11px] text-gray-500 mt-0.5" title={CATEGORY_HINTS[agent.category]}>{agent.category}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4"><span className="text-[10px] px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 font-medium tracking-wide">{CHAIN_LABELS[agent.chainId] || agent.network}</span></td>
                          <td className="p-4 text-sm font-semibold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</td>
                          <td className="p-4 text-sm text-gray-600 dark:text-gray-400">{agent.starCount ?? '—'}</td>
                          <td className="p-4"><ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} /></td>
                          <td className="p-4 text-sm text-gray-500">{agent.totalFeedbacks ?? '—'}</td>
                          <td className="p-4 text-right">
                            <button onClick={(e) => { e.stopPropagation(); agent.session ? (setSelectedAgent(agent), setHiring(true)) : handleHireClick(agent); }} className={`text-xs font-semibold px-4 py-2 rounded-xl transition-all ${agent.session ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 opacity-0 group-hover:opacity-100'}`}>
                              {agent.session ? 'Manage' : 'Hire'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!loading && !error && marketView === 'grid' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filtered.map((agent) => (
                    <div key={agent.id} className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden">
                      <div className="p-6 flex-1 cursor-pointer" onClick={() => setDetailAgent(agent)}>
                        <div className="flex justify-between items-start mb-5">
                          <div>
                            <span title={CATEGORY_HINTS[agent.category]} className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-1 block">{agent.category}</span>
                            <h3 className="text-lg font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={16} className="text-indigo-500" title="Registered on-chain — not a quality rating" />}</h3>
                          </div>
                          <span className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
                        </div>

                        {agent.serviceStatus && agent.serviceStatus !== 'unknown' && (
                          <div className="mb-3"><ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} /></div>
                        )}

                        <div className="grid grid-cols-3 gap-2 p-3 mb-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50">
                          <div className="text-center" title="How trustworthy this agent looks, based on real past feedback"><span className="block text-[10px] text-gray-500 uppercase mb-1">Score</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</span></div>
                          <div className="text-center border-l border-gray-200 dark:border-gray-700" title="How many people rated this agent"><span className="block text-[10px] text-gray-500 uppercase mb-1">Stars</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.starCount ?? '—'}</span></div>
                          <div className="text-center border-l border-gray-200 dark:border-gray-700" title="Total money this agent currently manages for people"><span className="block text-[10px] text-gray-500 uppercase mb-1">Funds</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : <span className="text-gray-400 font-normal">-</span>}</span></div>
                        </div>
                        
                        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">{agent.strategy}</p>
                      </div>
                      
                      <div className="p-5 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800">
                        {agent.session ? (
                          <div>
                            <div className="flex justify-between items-center mb-3 text-xs">
                              <span className="font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400"><ShieldAlert size={14} /> You've given this agent access</span>
                            </div>
                            <div className="mb-4">
                              <div className="flex justify-between text-[11px] mb-1.5 text-gray-600 dark:text-gray-400">
                                <span>Money spent so far</span>
                                <span className="font-medium">${agent.session.spendUtilized} / ${agent.session.spendCap}</span>
                              </div>
                              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(agent.session.spendUtilized / agent.session.spendCap) * 100}%` }} />
                              </div>
                            </div>
                            <button onClick={() => handleRevoke(agent.id)} className="w-full py-2.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-500/10 dark:hover:bg-red-500/20 transition-colors">Turn off access</button>
                          </div>
                        ) : (
                          <button onClick={() => handleHireClick(agent)} className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-all shadow-sm">Hire this agent</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Hiring Flow Overlay (Styled as a clean modal card) */}
          {hiring && selectedAgent && (
            <div className="max-w-2xl mx-auto mt-10">
              <button onClick={() => setHiring(false)} disabled={hireStep && hireStep !== 'done' && !hireError} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors disabled:opacity-40">
                <ChevronRight size={16} className="rotate-180" /> Back to Marketplace
              </button>

              <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 shadow-xl mb-6">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xl">{selectedAgent.name.charAt(0)}</div>
                  <div>
                    <h2 className="text-2xl font-bold">Hire {selectedAgent.name}</h2>
                    <p className="text-gray-500 text-sm mt-1">There are two ways to pay for this — pick whichever you prefer.</p>
                  </div>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 mb-8 text-sm text-amber-800 dark:text-amber-300">
                  Both options put real money on hold for this agent to do the work — you're not just browsing anymore. "Pay directly" below asks you to approve each step in your wallet. The other option, further down, lets you set up a spending limit once so you don't have to approve every future hire — handy if you plan to use this agent again.
                </div>

                <div className="mb-6">
                  <label className="flex items-center gap-2 text-sm font-semibold mb-3"><Sliders size={16} className="text-gray-400" /> How much to pay <span className="font-normal text-gray-400" title="$U is a type of digital dollar — 1 $U is worth about $1. It's what you pay agents with here.">($U, worth about $1 each)</span></label>

                  {/* Live price discovery (useAgentQuote) — real gap fixed
                      2026-08-22: users had no way to know what an agent
                      actually needed before hiring. Where a real price is
                      knowable, say so and pre-fill it; where it isn't, say
                      that plainly too, rather than leave a silent guess. */}
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

                  <input type="number" value={spendCap} onChange={(e) => { setSpendCap(e.target.value); setSpendCapTouched(true); }} disabled={hireStep && !hireError} className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50" />
                  <div className="mt-1.5"><GetULink /></div>
                </div>

                {/* Advanced: override the on-chain job description. Off by
                    default — only needed when the seller requires a specific
                    anchored description (e.g. a signed-quote JSON string)
                    instead of the plain auto-generated label. */}
                <div className="mb-6">
                  <button type="button" onClick={() => setShowCustomDescription((v) => !v)} disabled={hireStep && !hireError} className="text-xs font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50">
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
                        className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Only for advanced users — this replaces the automatic description above with your own text, permanently recorded. Leave it blank unless you have a specific reason to use this.</p>
                    </div>
                  )}
                </div>

                {/* Real step checklist — every row's state comes straight from
                    useHireAgent's own tracked state (step/completedSteps/
                    skippedSteps/stepHashes/error), see buildHireStepList in
                    useHireAgent.js. Only shown once the flow has started. */}
                {hireStep && (
                  <div className="mb-6 p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]">
                    <StepChecklist steps={buildHireStepList({
                      step: hireStep, completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps,
                      stepHashes: hireStepHashes, error: hireError, budgetUnits: spendCap,
                      notifySkipReason: hireNotifySkipReason,
                    })} />
                    {hireStep === 'done' && (
                      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                        <CheckCircle2 size={16} /> Done! Your payment is on hold and this agent has been notified to start work.
                      </div>
                    )}
                  </div>
                )}

                <button onClick={handleActivateSession} disabled={hireStep && hireStep !== 'done' && !hireError} className="w-full py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide disabled:opacity-50">
                  {hireStep === 'done' ? 'HIRED ✓' : hireError ? 'TRY AGAIN' : 'PAY DIRECTLY'}
                </button>
              </div>

              <AltanaSessionPanel
                accent={accent}
                surface={darkMode ? '#1E293B' : '#FFFFFF'}
                mutedBorder="border-gray-200 dark:border-gray-800"
                darkMode={darkMode}
                agent={selectedAgent}
              />
            </div>
          )}

          {/* My Agents Tab — every real ERC-8183 job where the connected
              wallet is the client, so a completed hire has somewhere to be
              found afterward. See MyJobsPanel.jsx for the real backing. */}
          {nav === 'my-agents' && (
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight mb-2">My Agents</h2>
              <p className="text-gray-500 mb-8">Every agent you've hired through here, and where things stand right now.</p>
              <MyJobsPanel accent={accent} mutedBorder="border-gray-200 dark:border-gray-800" />
            </div>
          )}

          {/* Report Tab — REAL practice-layer execution stats (not a fabricated
              comparison). Every number is aggregated from actual on-chain-fork
              runs persisted in MongoDB. */}
          {nav === 'report' && (
            <div className="max-w-4xl">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Advantage Report</h2>
              <p className="text-gray-500 mb-8">3 tasks, each done two ways — once using an agent, once by hand — so you can see the real time, cost, and quality difference for yourself.</p>
              <div className="mb-14">
                <AdvantageReport />
              </div>

              <h2 className="text-3xl font-bold tracking-tight mb-2">Practice Mode Activity</h2>
              <p className="text-gray-500 mb-2">Combined stats from actual Practice Mode runs on our live practice copy of the network, saved permanently.</p>
              <p className="text-[12px] text-gray-400 mb-10">Note: this reflects general Practice Mode <em>testing</em> activity across all users, not any specific listed agent's real-world hire track record. To see a specific agent's real hire history, open its detail page and look for "Past Hires".</p>
              <PracticeStatsReport />
            </div>
          )}

          {/* Sell Your Agent Tab — real creator listing flow (on-chain models 1&2
              via AgentAccessMarket + x402 config for model 3). Shared component,
              identical on web and mobile. */}
          {nav === 'sell' && <SellYourAgentForm />}

          {/* Learn Tab */}
          {nav === 'learn' && (
            <div className="max-w-3xl">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Learn</h2>
              <p className="text-gray-500 mb-6">What each agent does, and what authority you're granting when you hire one.</p>

              <div className="space-y-6">
                {LEARN_TOPICS.map((topic, i) => (
                  <div key={i} className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                    <div className="px-8 py-5 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800">
                      <h3 className="font-bold text-lg">{topic.title}</h3>
                      {topic.src && <a href={topic.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline">Source: {topic.src.label} →</a>}
                    </div>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800/50">
                      {topic.body.map((item, j) => (
                        <div key={j} className="p-8 flex gap-4">
                          <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center shrink-0 mt-0.5">
                            <ChevronRight size={16} className="text-indigo-500" />
                          </div>
                          <div>
                            <div className="font-bold text-sm mb-2">{item.h}</div>
                            {/* Copy audit (2026-08-23): plain-language version now
                                leads — used to be the small italic afterthought
                                below the jargon-heavy paragraph, which undercut a
                                section literally titled "in plain English". */}
                            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">{item.plain || item.p}</p>
                            {item.plain && <p className="text-[12px] text-gray-400 dark:text-gray-500 leading-relaxed mt-1.5">Technical details, if you want them: {item.p}</p>}
                            {item.Diagram && (
                              <div className="mt-3 p-4 rounded-2xl bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800">
                                <item.Diagram />
                              </div>
                            )}
                            {item.src && <a href={item.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-1.5 inline-block">Source: {item.src.label} →</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Build Tab */}
          {nav === 'build' && (
            <div className="max-w-3xl">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Sparkles size={24} /></div>
                <h2 className="text-3xl font-bold tracking-tight">Build Your Agent</h2>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-2">No coding required. If you can describe what you want in a sentence, you can build this.</p>
              <p className="text-xs text-gray-400 mb-1">Built on BNB Agent Studio (bnbagent-studio) and the ERC-8004/ERC-8183 standards.</p>
              <a href="https://docs.bnbchain.org/developer-kit" target="_blank" rel="noreferrer" className="text-xs text-indigo-500 underline mb-10 inline-block">Source: docs.bnbchain.org/developer-kit →</a>

              <div className="mb-10">
                <AltanaSkillsPanel accent={accent} surface={darkMode ? '#1E293B' : '#FFFFFF'} mutedBorder="border-gray-200 dark:border-gray-800" darkMode={darkMode} initialSkillId={pendingSkillId} onConsumedInitialSkill={() => setPendingSkillId(null)} />
              </div>

              <div className="flex items-center gap-3 mb-8">
                <div className={`flex-1 h-px ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`} />
                <span className="text-xs opacity-40 font-semibold uppercase">Or build something custom</span>
                <div className={`flex-1 h-px ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                {BUILD_STEPS.map((step, i) => (
                  <div key={i} className="bg-white dark:bg-[#1E293B] p-8 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
                    <h3 className="font-bold mb-3">{step.title}</h3>
                    {/* Copy audit (2026-08-23): the beginner-friendly explanation
                        now leads and reads at full size — it used to be the
                        secondary, italicized afterthought below the technical
                        paragraph, backwards for a "2 to 80" readability bar. */}
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{step.plain || step.body}</p>
                    {step.plain && <p className="text-[12px] text-gray-400 dark:text-gray-500 leading-relaxed mt-2">Technical details, if you want them: {step.body}</p>}
                    {step.src && <a href={step.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-2 inline-block">Source: {step.src.label} →</a>}
                  </div>
                ))}
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-500/20 rounded-3xl p-8 mb-8">
                <div className="flex items-center gap-2 mb-4 text-indigo-700 dark:text-indigo-400">
                  <Sparkles size={18} />
                  <h3 className="font-bold text-sm uppercase tracking-wide">Describe your agent</h3>
                </div>
                <textarea
                  value={buildDescription}
                  onChange={(e) => setBuildDescription(e.target.value)}
                  placeholder='e.g. "an agent that sells 3-day weather forecasts"'
                  rows={2}
                  disabled={buildStatus && buildStatus.step !== 'done' && buildStatus.step !== 'error'}
                  className="w-full p-4 rounded-2xl border border-indigo-200 dark:border-indigo-500/30 bg-white dark:bg-[#0F172A] text-sm mb-4 outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleRealBuild}
                    disabled={!buildDescription.trim() || (buildStatus && buildStatus.step !== 'done' && buildStatus.step !== 'error')}
                    className="px-6 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Build it for real (free trial, live ~2 days)
                  </button>
                  <button
                    onClick={() => setShowBuildCommand(true)}
                    disabled={!buildDescription.trim()}
                    className="px-6 py-3 rounded-xl font-semibold text-indigo-700 dark:text-indigo-400 bg-white dark:bg-transparent border border-indigo-200 dark:border-indigo-500/30 disabled:opacity-40"
                  >
                    Or just show me the command
                  </button>
                </div>

                {buildStatus && (
                  <div className="mt-6 p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-indigo-100 dark:border-indigo-500/30">
                    <div className="flex items-center gap-2 mb-2">
                      {buildStatus.step !== 'done' && buildStatus.step !== 'error' && <Loader2 size={16} className="animate-spin text-indigo-500" />}
                      {buildStatus.step === 'done' && <CheckCircle2 size={16} className="text-green-500" />}
                      {buildStatus.step === 'error' && <XCircle size={16} className="text-red-500" />}
                      <span className="font-semibold text-sm">
                        {{
                          queued: 'In line...', scaffolding: "Setting up your agent's project files...",
                          creating_wallet: 'Creating a practice wallet for it...', writing_logic: "Writing your agent's instructions...",
                          activating_llm: 'Turning on its AI (free to start)...', deploying: 'Publishing it live for your free trial...',
                          done: "Done! It's live now, for the next 2 days.", error: 'Build failed',
                        }[buildStatus.step] || buildStatus.step}
                      </span>
                    </div>
                    {buildStatus.step === 'done' && buildStatus.address && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Wallet: <span className="font-mono">{buildStatus.address}</span> — a temporary practice wallet made just for this trial. It can't hold or lose any real money.</p>
                    )}
                    {buildStatus.step === 'error' && (
                      <p className="text-xs text-red-500 mt-2 font-mono whitespace-pre-wrap">{buildStatus.error}</p>
                    )}
                  </div>
                )}

                {showBuildCommand && buildDescription.trim() && (
                  <div className="mt-6 font-mono text-xs p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-indigo-100 dark:border-indigo-500/30 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
{`# Or run this yourself, in your own terminal (Claude Code or Cursor):

pip install bnbagent-studio
bag skills install --target both --scope user

# Then, in your IDE, just say:
"Create a new BNB agent named ${buildDescription.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)} on testnet that ${buildDescription.trim()}."

# Or scaffold it directly:
bag init ${buildDescription.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20)} --network bsc-testnet`}
                  </div>
                )}
              </div>
              
              <h3 className="text-xl font-bold mb-6">Questions a total beginner would ask</h3>
              <div className="space-y-4 mb-10">
                {KID_FRIENDLY_FAQ.map((item, i) => (
                  <div key={i} className="bg-white dark:bg-[#1E293B] p-6 rounded-2xl border border-gray-200 dark:border-gray-800">
                    <div className="font-bold text-sm mb-2">{item.q}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{item.a}</div>
                    {item.src && <a href={item.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-2 inline-block">Source: {item.src.label} →</a>}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}