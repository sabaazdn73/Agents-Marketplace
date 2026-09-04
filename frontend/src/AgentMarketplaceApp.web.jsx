import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Sun, Moon, ShieldAlert, ShieldCheck, FileBarChart, Sliders, CheckCircle2, XCircle,
  LayoutGrid, Table2, GraduationCap, Store, ArrowUpDown, ChevronRight,
  Loader2, AlertTriangle, Wallet, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, ExternalLink, Zap, Coins, Search, Bell, Briefcase, Globe, HelpCircle, Bot, Clock
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import iconLogo from './assets/icon_v2.svg';
import agentsHero from './assets/agents.png';
import { QRCodeCanvas } from 'qrcode.react';
import NotificationBell from './NotificationBell';
import { useNavSync, useOverlayHistory } from './useViewHistory';
import { addNotification, trackJob } from './notifications';
import { recordFunded } from './jobTiming';
import SellYourAgentForm from './SellYourAgentForm';
import BuyAccessPanel from './BuyAccessPanel';
import PasskeyBadge from './PasskeyBadge';
import ServiceHealthBadge, { serviceRank } from './ServiceHealthBadge';
import { CATEGORY_HINTS } from './categoryHints';
import { agentShareUrl, copyShareLink, readDeepLinkAgentId, matchesDeepLink } from './shareLink';
import { useAgentPerformanceBulk } from './useAgentPerformanceBulk';
import { useCanaryStatus } from './useCanaryStatus';
import { withPerformance, withCanaryStatus, performanceComparator, agentHasRealHistory } from './agentRanking';
import { getVerificationTier, VERIFICATION_TIER, VERIFICATION_LABEL, withVerificationTierFirst } from './agentVerification';
import VerificationBadge, { VerificationTierDivider } from './VerificationBadge';
import VerificationExplainerSection from './VerificationExplainerSection';
import { CATEGORY_GROUPS, groupForCategory } from './categoryGroups';
import InfoTooltip from './InfoTooltip';
import { SingleAgentDiagram, SequentialDiagram, ParallelDiagram, HierarchicalDiagram } from './AgentArchitectureDiagrams';
import { useHireFlowEscrowGate, useEscrowCompatibility } from './EscrowCompatibilityWarning';
import UniversalSearchFallback from './UniversalSearchFallback';
import AgentMetrics from './AgentMetrics';
import QualityCenterPanel from './QualityCenterPanel';
import ContractVerificationBadge from './ContractVerificationBadge';
import Pagination from './Pagination';

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
import { useHireAgent, buildHireStepList, buildBatchHireStepList, useAgentQuote, useBatchHireCapability, CAN_BATCH_HIRE_STATUS } from './useHireAgent';
import { DEADLINE_MIN_MINUTES, DEADLINE_MAX_MINUTES, DEADLINE_DEFAULT_MINUTES, DEADLINE_PRESETS, formatDeadline, validateDeadlineMinutes } from './hireDeadline';
import SessionModesExplainer from './SessionModesExplainer';
import AltanaSkillsPanel from './AltanaSkillsPanel';
import NativeAgentMarketplace from './NativeAgentMarketplace';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import MyJobsPanel from './MyJobsPanel';
import AdvantageReport from './AdvantageReport';
import AgentAvatar from './AgentAvatar';
import DataSourcesFooter from './DataSourcesFooter';
import HackathonPartnersFooter from './HackathonPartnersFooter';
import DocsFooter from './DocsFooter';
import { useBnbPrice, formatBnbWithUsd } from './useBnbPrice';
import OnboardingTour from './OnboardingTour';
import { hasSeenOnboarding } from './onboarding';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain' }; // mainnet-only

// Bumped to v2 (2026-08-26): real, decisive investigation into a reported
// "Zerion portfolio button missing on web" bug found NO code-level
// divergence between web and mobile — a real headless render of both
// AgentDetail components with identical mock data produced byte-identical
// button markup on both. The most plausible remaining explanation is the
// same failure mode this project has hit before (see mapAgent's own
// "Parity fix" comment below): a stale 24h client cache on whichever
// device was tested holding agent data from before some field was
// correctly populated. Bumping the version forces every client to refetch
// once, clearing any such stale state regardless of the exact cause.
// Renamed to 'tnega-cache-v1' for the Tnega rebrand (2026-08-28) — a fresh
// key name, not just another version bump, since the old name literally
// spelled out the old brand. Same real effect as the earlier v1->v2 bump:
// every client refetches once, cleanly, no stale data carried over.
const CACHE_KEY = 'tnega-cache-v1';
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
    // Real, added 2026-08-29 — same DefiLlama match, zero extra API calls.
    // tvlChange7dPct: real TVL momentum. auditCount: DefiLlama's own real
    // disclosed audit count (0 is a real, honest signal, not missing data).
    // tvlDataFlagged: DefiLlama's own real misrepresentedTokens flag —
    // their own "this TVL may not be trustworthy" signal, surfaced as-is.
    tvlChange7dPct: a.tvl_change_7d_pct, auditCount: a.audit_count,
    tvlDataFlagged: a.tvl_data_flagged, mcapUsd: a.mcap_usd,
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
  // Real bug found and fixed (2026-08-27): the header stat cards (Agents
  // Listed / Reviews / Verified Agents) render unconditionally from
  // `agents`, with no gate of their own — so on a page load with a warm
  // localStorage cache, the FIRST paint shows whatever count was cached
  // (a real number from a real earlier fetch, not literally 0/null — but
  // possibly stale, e.g. from before a backend fix changed the real total),
  // then flashes to the real, fresh number once this hook's fetch resolves
  // a moment later. `loading`/`refreshing` can't gate this cleanly on their
  // own: `loading` is already false on the very first render whenever a
  // cache exists (by design, so the agent GRID can show cached cards
  // instantly), and `refreshing` doesn't flip true until this effect body
  // runs — which is AFTER the first paint — so relying on either still lets
  // the stale number paint for at least one real frame first.
  // `confirmedFresh` fixes this at the root: it starts `false` on every
  // single render, cache or no cache, and flips true exactly once, the
  // moment a real fetch actually settles (success or failure) — so the
  // stat cards can show a skeleton until the real, final count is known,
  // instead of a wrong intermediate one.
  const [confirmedFresh, setConfirmedFresh] = useState(false);

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
        setConfirmedFresh(true);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: mapped, savedAt: Date.now() })); } catch (e) {}
      })
      .catch((err) => {
        if (cancelled) return;
        setRefreshing(false);
        if (agents.length === 0) setError(err.message);
        // Even on a real failure, don't leave the stat cards skeleton-locked
        // forever: if we have cached data to fall back on, it's the best
        // real number available; if we don't, the error state below takes
        // over the whole section instead of the stat cards anyway.
        setConfirmedFresh(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { agents, setAgents, loading, error, refreshing, confirmedFresh };
}

// Real, honest placeholder for a stat number that isn't confirmed-fresh yet
// (see useMarketplaceAgents' confirmedFresh above) — a pulsing bar, never a
// number that might be wrong.
function StatSkeleton() {
  return <div className="h-7 w-14 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />;
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
  adk: { label: "Google's Agent Development Kit — multi-agent patterns", url: 'https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/' },
};

const LEARN_TOPICS = [
  { title: 'Start here: the words we use, in plain English', body: [
    { h: 'A wallet', p: 'A wallet is just an account that can hold crypto and sign approvals — like an online account that can also say "yes, spend this." Here you can create one with Face ID / a passkey, so there\'s no seed phrase to write down.', plain: 'Think: a bank-card + signature, combined, that only you control.', src: SRC.altana },
    { h: 'Gas', p: 'Gas is the tiny network fee paid to record a transaction on the blockchain — like a stamp on a letter. Registering an agent here is gas-free: a "paymaster" called MegaFuel covers it, so you don\'t need to hold gas tokens.', plain: 'You don\'t pay a stamp to list an agent — the network sponsors it.', src: SRC.sdk },
    { h: 'Mainnet', p: "Mainnet is BNB Chain's live network, where money moves for real. Everything on this site runs on mainnet, not a test network.", plain: 'This is the live network. Nothing here is a simulation.' },
    { h: 'Escrow', p: 'Escrow is a neutral on-chain vault. When you hire an agent, your payment is locked there; the agent is paid only when the work is accepted, and you can reclaim it if they never deliver.', plain: 'Your money is held by the rules, not by the agent, until the job is done.', src: SRC.sdk },
  ]},
  { title: 'The two standards every agent here uses', body: [
    { h: 'ERC-8004 — Identity', p: 'Every agent gets an on-chain identity token (an ERC-721 agentId), a discoverable profile (name, description, endpoints), and metadata. Registration is sponsored by the MegaFuel paymaster on BNB Chain, so it costs no gas.', plain: 'It\'s the agent\'s ID card, and putting it on-chain is free.', src: SRC.sdk },
    { h: 'ERC-8183 — Commerce', p: 'A trustless job protocol. A client (you) and a provider (the agent) transact through three contracts: AgenticCommerce (owns job state + escrow), EvaluatorRouter (routes each job to a settlement policy), and OptimisticPolicy (the default rule: silence past the review window counts as approval).', plain: 'Three small programs that hold the money and enforce the deal so neither side has to trust the other.', src: SRC.sdk },
  ]},
  { title: 'What "hiring" means here', body: [
    { h: 'A job, not a subscription', p: "Hiring creates an ERC-8183 job: five wallet-signed steps, createJob, registerJob, setBudget, approve $U, fund. Payment is in $U (United Stables, a crypto dollar). Once funded, the budget sits in on-chain escrow; it is NOT a standing permission an agent can draw from repeatedly.", plain: 'You fund one specific job, once. The agent can never dip into your wallet again on its own.', src: SRC.sdk },
    { h: 'Provider submits, you get a receipt', p: 'The agent submits a deliverable; only a pointer/hash goes on-chain (the actual content is stored off-chain and looked up by URL). ', plain: 'The chain records the proof-of-delivery, not the file itself.', src: SRC.sdkArch },
    { h: 'Settlement is automatic, or disputable', p: 'Settling a job is permissionless — anyone can trigger it once the review window passes, releasing escrow to the provider. If the delivered work looks wrong, you dispute() during that window instead.', plain: 'Do nothing and the agent gets paid after the review window; object in time and it\'s contested.', src: SRC.sdk },
    { h: 'The safety net: claimRefund', p: "If a job is never settled (agent went dark, nothing delivered) and its deadline passes, you call claimRefund() and get your escrowed funds back. It's the guaranteed exit, always available after expiry.", plain: 'Worst case, you wait out the deadline and take your money back.', src: SRC.sdk },
  ]},
  { custom: SessionModesExplainer },
  { title: 'The stages a hire goes through, one by one', body: [
    { h: 'OPEN', p: 'Job created, no budget escrowed yet.', plain: "You've started a job, but haven't paid for it yet." },
    { h: 'FUNDED', p: 'Budget escrowed. The provider can now start work.', plain: 'Your payment is on hold and the agent can now start the work.' },
    { h: 'SUBMITTED', p: 'Provider delivered a result, waiting out the review window.', plain: "The agent says it's done — you get a short window to check the work before it gets paid." },
    { h: 'COMPLETED', p: 'Verdict = approve (silence, or a resolved dispute). Payment released to the provider, minus platform fees.', plain: 'The job is finished and the agent has been paid (a small platform fee comes out first).' },
    { h: 'REJECTED', p: 'Either you cancelled before funding, or a dispute resolved against the provider. You get refunded.', plain: "Either you cancelled before paying, or you successfully disputed bad work — either way, you get your money back." },
    { h: 'EXPIRED', p: 'No settlement ever reached, past the deadline. Reclaim your funds anytime with claimRefund().', plain: 'The deadline passed with nothing delivered. You can get your money back anytime after that.' },
  ], src: SRC.sdk },
  { title: 'Ready-made Skills', body: [
    { h: 'Skills = pre-built, fork-tested know-how', p: 'Instead of building an agent, you can use a ready-made Skill from Altana\'s public registry (PancakeSwap trading, Venus/Aave lending, Lista staking, four.meme, copy-trade, and more). Each Skill\'s exact contracts and steps are published and fork-tested.', plain: 'Skills are recipes an agent can run for you — no building required.', src: SRC.skills },
    { h: 'A passkey wallet + a scoped session', p: 'To run a Skill you create a passkey wallet (Face ID / Touch ID) and grant a session: a spend cap, an expiry, and an allow-list of exactly which contracts it may touch. The Skill can act only inside those limits, and you can revoke it.', plain: 'You hand the agent a prepaid card with a limit and an expiry, not your whole wallet.', src: SRC.altana },
  ]},
  { title: 'How agents are built', body: [
    { h: 'Single agent', p: 'One agent handles the whole task itself, start to finish — reads what it needs, does the work, hands back a result. This is the simplest pattern, and the one most agents listed here actually use — including our own explainer agent on the Advantage Report tab.', Diagram: SingleAgentDiagram },
    { h: 'Sequential (chained steps)', p: 'The task moves through a fixed pipeline of steps, one after another — each step\'s output becomes the next step\'s input. Good for work that has a natural order, like "research, then draft, then check."', Diagram: SequentialDiagram },
    { h: 'Parallel (specialists working at once)', p: 'The task is split across several specialists that all work at the same time, and their results get combined into one answer. Good when different parts of a task don\'t depend on each other and can happen simultaneously.', Diagram: ParallelDiagram },
    { h: 'Hierarchical (an orchestrator delegating)', p: 'One orchestrator agent breaks the task into pieces and hands each piece to a sub-agent underneath it, then assembles what comes back. Good for complex work that benefits from a manager coordinating specialists.', Diagram: HierarchicalDiagram },
    { h: 'What\'s actually here right now', p: 'Fewer than 2% of the agents listed on this marketplace mention multi-agent or orchestration language in their own description; the large majority present as single agents, like our own explainer agent. That\'s not a shortcoming of this marketplace: the other three patterns are valid ways to build an agent, just not yet common among what\'s registered here today.' },
  ], src: SRC.adk },
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
  { title: '4. Test locally before it touches real money', body: 'bag dev runs both layers on your machine. You can hit the live /negotiate endpoint, get an actual signed price quote, and confirm the whole flow before deploying or spending anything. The default Pieverse LLM needs no funds.', plain: 'Run it on your laptop first; the default AI model is free.', src: SRC.studioQuick },
  { title: '5. Register, then deploy', body: 'bag erc8004 register makes your agent discoverable (the same identity every agent here shows). The one-click "Build it for real" button uses the free ~48h platform trial (no AWS account needed). To run it yourself instead, self-host Layer A on AWS Bedrock AgentCore and Layer B on EC2/Fargate.', plain: 'Try it free for 48h with one click, or host it yourself later.', src: SRC.studioArch },
];

const KID_FRIENDLY_FAQ = [
  { q: 'Do I need to know how to code?', a: 'No. You describe what you want in normal sentences; to build a custom agent you mostly edit one instruction paragraph, and to use a ready-made Skill you just fill in a form.', src: SRC.studioQuick },
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

// Full agent detail view — everything the aggregated 8004scan/DefiLlama data
// actually holds for one agent. Shown full-screen in the market tab, matching
// the hire-flow navigation pattern.
function AgentDetail({ agent, onBack, onHire, onTrySkill }) {
  const [copied, setCopied] = useState(false);
  const bnbUsdPrice = useBnbPrice();
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
            <AgentAvatar agent={agent} size={56} />
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
          <DetailStat label="On-chain Feedback" hint="On-chain ERC-8004 feedback entries for this agent — a count only, with no written text or rating behind it" value={agent.totalFeedbacks ?? '—'} />
          <DetailStat label="Funds" hint="Total money this agent currently manages for people" value={agent.financialDataAvailable && agent.tvlUsd != null ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '—'} />
        </div>
        {agent.financialDataAvailable && agent.defillamaUrl && (
          <div className="mb-5">
            <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1">Where this money number comes from: DefiLlama <ExternalLink size={11} /></a>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              {agent.tvlChange7dPct != null && (
                <span title="How this protocol's total funds have changed over the last 7 days: money flowing in vs out">
                  {agent.tvlChange7dPct >= 0 ? '▲' : '▼'} {Math.abs(agent.tvlChange7dPct).toFixed(1)}% (7d)
                </span>
              )}
              {agent.auditCount != null && (
                <span title="How many independent security audits this protocol has had, per DefiLlama's own records">
                  {agent.auditCount > 0 ? `${agent.auditCount} security audit${agent.auditCount === 1 ? '' : 's'}` : 'No security audits on record'}
                </span>
              )}
            </div>
            {agent.tvlDataFlagged && (
              <div className="mt-2 flex items-start gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                <span>DefiLlama flags this protocol's reported funds as possibly not representative of its real value.</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 my-5">
          {agent.isVerified && <DetailBadge icon={BadgeCheck} hint="Registered on-chain, not a quality rating">Verified</DetailBadge>}
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

        <h3 className="text-sm font-bold mb-2 flex items-center gap-2">Who owns this agent <PasskeyBadge ownerAddress={agent.ownerAddress} /> {agent.id && <ContractVerificationBadge agentId={agent.id} />}</h3>
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
            {agent.ownerBnbBalance != null ? formatBnbWithUsd(agent.ownerBnbBalance, bnbUsdPrice) : <span className="text-gray-400 font-normal">not available</span>}
          </span>
        </div>
        {/* Real, final, unified "Metrics" presentation — real interaction
            guidance (hire / hire-with-caution / visit-website, per the
            real, evidence-based per-agent classification) leading, then
            real metrics routed and ordered by the agent's real nature
            (fund-management agents lead with real cash flow/profit;
            everyone else leads with real delivery history). Replaces the
            two separate sections this session built in sequence
            (AgentEvaluationSection, AgentInvestigationSection) — see
            AgentMetrics.jsx's own header for the full real consolidation
            rationale. The harder, last-chance gate still lives in the
            actual funding modal (handleHireClick → useHireFlowEscrowGate),
            right before real money moves. */}
        <AgentMetrics agent={agent} onHire={onHire} onTrySkill={onTrySkill} />

        {agent.id && <QualityCenterPanel agentId={agent.id} />}

        {agent.tokenId != null && <BuyAccessPanel agentId={String(agent.tokenId)} />}
      </div>
    </div>
  );
}

function HybridWalletConnect({ accent }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { ready, authenticated, user, logout } = usePrivy();
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

const NAV_ITEMS = [
  { id: 'market', label: 'Marketplace', icon: Store },
  // Real, deliberate placement (2026-08-29, product/UX audit) — see
  // docs/skills-vs-marketplace.md for the full reasoning. A Skill (Venus
  // Lending, PancakeSwap, etc.) isn't a registered ERC-8004 agent being
  // hired for delivered work — it's a real, direct, self-executed on-chain
  // action, with no counterparty to evaluate and no job/delivery cycle.
  // Used to live buried inside the "Build Your Agent" tab, under a header
  // entirely about a different feature (scaffolding a NEW custom agent),
  // with no real presence in the marketplace's own primary navigation.
  // Promoted to its own top-level tab, a peer of Marketplace rather than a
  // sub-panel of Build, so "hire someone" vs "run this yourself" reads as
  // the real, first-level choice it actually is.
  // Real, own top-level tab (2026-09-01) — Tnega's own-designed,
  // autonomous, fee-bearing agents (real multi-factor comparison +
  // routing), distinct from both hiring a third-party agent
  // (Marketplace) and running a third-party protocol's own know-how for
  // free (Skills). See NativeAgentMarketplace.jsx. Ordered ahead of
  // Skills (2026-09-02, explicit tab-order request) since it's Tnega's
  // own higher-value-add offering.
  { id: 'native', label: 'Native Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Zap },
  { id: 'my-agents', label: 'My Agents', icon: Briefcase },
  { id: 'report', label: 'Advantage Report', icon: FileBarChart },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'build', label: 'Build Your Agent', icon: Hammer },
  { id: 'sell', label: 'Sell Your Agent', icon: Coins },
];

export default function AgentMarketplaceApp({ onOpenEcosystem, onOpenDataSources, onOpenPartners, onOpenDocs, initialNav, onNavChange } = {}) {
  const [darkMode, setDarkMode] = useState(false);
  // Real first-visit orientation — shows automatically once per browser
  // (localStorage-gated, see onboarding.js), reopenable anytime via the "?"
  // header button. Lazy-init so it doesn't flash open-then-closed for a
  // returning visitor.
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  // Real per-tab URL routing: `nav` still lives here (every existing
  // `nav === '...'` check throughout this file keeps working unchanged),
  // but it's now seeded from — and kept in sync with — the real URL App.jsx
  // owns, via `initialNav`/`onNavChange`. A user clicking a tab still gets
  // the same instant local setNav() below; onNavChange (see NAV_ITEMS click
  // handler) is what pushes that choice into a real, bookmarkable URL.
  // Browser back/forward changes `initialNav` from outside, which the
  // effect below resyncs onto `nav`.
  const [nav, setNav] = useState(initialNav || 'market');
  useEffect(() => {
    if (initialNav && initialNav !== nav) setNav(initialNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNav]);
  const [marketView, setMarketView] = useState('grid');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchInput, setSearchInput] = useState('');   // immediate input value
  const [searchQuery, setSearchQuery] = useState('');    // debounced, used for filtering
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [detailAgent, setDetailAgent] = useState(null); // full-screen agent detail view
  // Real Back-button support (2026-09-04). Opening an agent pushes a real
  // history entry and Back closes it, returning to the list underneath;
  // and the tab view follows the URL when Back/Forward changes it, which
  // it previously did not (initialNav was only ever read at mount).
  // See useViewHistory.js for the full reasoning.
  const [openAgentDetail, closeAgentDetail] = useOverlayHistory(detailAgent, setDetailAgent, 'agentDetail');
  // Follow the URL when Back/Forward changes it. `initialNav` is only read
  // by useState at mount, so without this the address bar moved but the
  // view did not -- the core of the "Back exits the site" bug.
  useNavSync(initialNav, nav, setNav);
  // Real deep-link from the agent guidance panel's "Try it yourself" —
  // switches to Build and pre-opens that specific skill's guided form.
  const [pendingSkillId, setPendingSkillId] = useState(null);
  const handleTrySkill = (skillId) => { setDetailAgent(null); setNav('skills'); setPendingSkillId(skillId); onNavChange?.('skills'); };
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
  // Real, user-facing job deadline (2026-09-09) — previously hardcoded to
  // DEADLINE_DEFAULT_MINUTES inside useHireAgent.js with no UI control at
  // all. Defaulting to that same value here preserves the exact prior
  // real behavior for anyone who never touches this field.
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEADLINE_DEFAULT_MINUTES);
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
  const { agents, setAgents, loading, error, refreshing, confirmedFresh } = useMarketplaceAgents();

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
  // Real, honest opt-in filter (see agentVerification.js) — off by default
  // so browsing stays broad; a buyer who specifically wants confirmed
  // delivery history can narrow to it.
  const [onlyVerified, setOnlyVerified] = useState(false);
  // Two-tier category filter (categoryGroups.js): pick a group first, then
  // optionally narrow to one of its real fine-grained categories.
  // 'All' = no group restriction. 'Unclassified' = the ungrouped bucket.
  const [activeGroup, setActiveGroup] = useState('All');

  // Real, marketplace-wide on-chain track record (agent_performance.py via
  // the bulk endpoint) — one fetch, merged onto every agent so "Most
  // hired" / "Highest success rate" can sort the whole list. See
  // agentRanking.js for the real tiering (real history first, no-history
  // agents after, never silently mixed in).
  const { byOwner: perfByOwner, indexComplete: perfIndexComplete, status: perfStatus, retry: retryPerf } = useAgentPerformanceBulk();
  const { byOwner: canaryByOwner } = useCanaryStatus();
  const agentsWithPerf = useMemo(
    () => withCanaryStatus(withPerformance(agents, perfByOwner), canaryByOwner),
    [agents, perfByOwner, canaryByOwner]
  );
  const PERFORMANCE_SORT_KEYS = new Set(['hireCount', 'winRate']);

  const { isConnected: wagmiConnected } = useAccount();
  const { ready, authenticated } = usePrivy();
  const walletConnected = wagmiConnected || (ready && authenticated);

  // Soft Indigo replacing the old high-contrast colors
  const accent = '#6366F1'; 
  
  const handleRevoke = (agentId) => setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, session: null } : a)));

  const {
    hire, hireBatched, step: hireStep, error: hireError,
    completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps, stepHashes: hireStepHashes,
    notifySkipReason: hireNotifySkipReason,
  } = useHireAgent();
  // Real "sign once" batched alternative (2026-08-27) — see useHireAgent.js's
  // own top-of-file note for the full real investigation. canBatchHire is a
  // real, live wallet_getCapabilities check, never assumed; the toggle only
  // ever appears once that check genuinely confirms support. Step-by-step
  // stays the default (signOnceForAllSteps starts false) — this is an
  // opt-in alternative, not a replacement.
  const canBatchHire = useBatchHireCapability();
  const [signOnceForAllSteps, setSignOnceForAllSteps] = useState(false);
  // Captured at the moment a hire actually starts, so switching the toggle
  // mid-flow (or between runs) never changes which step list a run IN
  // PROGRESS is described by.
  const [activeHireMode, setActiveHireMode] = useState('stepwise');

  const handleHireClick = (agent) => {
    if (!walletConnected) {
      alert('Connect a wallet first to hire this agent — use Connect a wallet in the sidebar.');
      return;
    }
    setSelectedAgent(agent);
    setHiring(true);
    setSpendCapTouched(false); // fresh agent — let its real price (if any) pre-fill again
    setDeadlineMinutes(DEADLINE_DEFAULT_MINUTES); // fresh agent — don't carry a prior custom deadline over
  };

  const deadlineError = validateDeadlineMinutes(deadlineMinutes);

  // Real, last-chance escrow-compatibility gate for whichever agent the
  // funding modal is currently open for — see EscrowCompatibilityWarning.jsx.
  const hireEscrowGate = useHireFlowEscrowGate(selectedAgent?.ownerAddress, selectedAgent?.id);

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("We don't have an owner ID on record for this agent, so we can't hire it.");
      return;
    }
    if (deadlineError) return; // real bounds — the button itself is also disabled on this, see below
    try {
      // REAL flow: creates + registers + budgets + approves (if needed) +
      // funds a genuine ERC-8183 job, the user's own connected wallet
      // signs every step, nothing here is simulated. Real, opt-in
      // alternative: hireBatched() does the exact same real on-chain work,
      // just with the register/budget/approve/fund steps signed once as a
      // real EIP-5792 batch instead of individually — only ever used when
      // signOnceForAllSteps is on AND the connected wallet has genuinely
      // confirmed real batch support (canBatchHire).
      const useBatch = signOnceForAllSteps && canBatchHire === CAN_BATCH_HIRE_STATUS.supported;
      setActiveHireMode(useBatch ? 'batched' : 'stepwise');
      const hireFn = useBatch ? hireBatched : hire;
      const { jobId } = await hireFn({
        providerAddress: selectedAgent.ownerAddress,
        providerAgentId: selectedAgent.id,
        budgetUnits: Number(spendCap),
        expiryMinutes: Number(deadlineMinutes),
        description: (showCustomDescription && customDescription.trim())
          ? customDescription.trim()
          : `Hire via Tnega: ${selectedAgent.name}`,
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
  // "Most hired" / "Highest success rate" are one-directional real rankings
  // (best real number first), not toggleable asc/desc like the table's own
  // column-header sort above — picking one from the dropdown always means
  // "show me the best first".
  const handleSortSelect = (key) => setSortState({ key, dir: 'desc' });

  // Debounce the search so filtering doesn't run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtered = useMemo(() => {
    const hasRealContent = (a) => a.name && a.name.trim().length > 2;
    let list = agentsWithPerf.filter(hasRealContent);
    if (!showUnclassified) list = list.filter((a) => a.category !== 'Unclassified');
    // Group first (categoryGroups.js — presentation-only grouping of the
    // real fine-grained categories), then the specific category within it.
    if (activeGroup === 'Unclassified') {
      list = list.filter((a) => a.category === 'Unclassified' || groupForCategory(a.category) == null);
    } else if (activeGroup !== 'All') {
      list = list.filter((a) => groupForCategory(a.category) === activeGroup);
    }
    // Search AND category both apply together.
    list = list.filter((a) => activeCategory === 'All' || a.category === activeCategory);
    if (searchQuery) {
      list = list.filter((a) => `${a.name} ${a.strategy}`.toLowerCase().includes(searchQuery));
    }
    // Real filter: only agents whose registered endpoint answered a real
    // health-check (see core/agent_health.py) — the requested "let a user
    // filter to only see agents with a currently-responding endpoint".
    if (onlyResponding) list = list.filter((a) => a.serviceStatus === 'responding');
    // Real, honest opt-in narrowing to agents with a confirmed delivered
    // job (see agentVerification.js) — off by default.
    if (onlyVerified) list = list.filter((a) => getVerificationTier(a) === VERIFICATION_TIER.VERIFIED);
    // "Most hired" / "Highest success rate" use the real tiered comparator
    // (agentRanking.js) — real history first, no-history agents after.
    // Every other sort keeps the original simple numeric sort, unchanged.
    const secondary = PERFORMANCE_SORT_KEYS.has(sortState.key)
      ? performanceComparator(sortState.key)
      : (a, b) => {
          const av = a[sortState.key] ?? -Infinity;
          const bv = b[sortState.key] ?? -Infinity;
          const mult = sortState.dir === 'desc' ? -1 : 1;
          return (av - bv) * mult;
        };
    // Real verification tier ALWAYS sorts first (see agentVerification.js)
    // — a confirmed delivery outranks any other sort criterion, so
    // "Verified working" agents are never buried behind an unproven one on
    // a different metric. Every sort option keeps its own ordering WITHIN
    // each tier.
    return [...list].sort(withVerificationTierFirst(secondary));
  }, [agentsWithPerf, activeGroup, activeCategory, sortState, showUnclassified, onlyResponding, onlyVerified, searchQuery]);

  // Real pagination — client-side, over the already-fully-fetched `filtered`
  // list (see useMarketplaceAgents: known_agents is fetched once, in full,
  // and cached; there's nothing server-side left to paginate). 24/page:
  // measured against this grid's real card height at 3 columns, 24 comes
  // out to 8 rows — a real single "page" of content, not the sprawling
  // scroll a higher count would produce (the exact thing this redesign is
  // meant to fix). Real reference for the page-control shape itself:
  // mercor.com's own live listing page.
  const PAGE_SIZE = 24;
  const [page, setPage] = useState(1);
  // Any filter/sort/search change must land back on page 1 — staying on
  // e.g. page 5 after a filter shrinks the real result count to 2 pages
  // would silently show an empty page instead of the new top results.
  useEffect(() => { setPage(1); }, [activeGroup, activeCategory, sortState, showUnclassified, onlyResponding, onlyVerified, searchQuery]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount); // clamp defensively (e.g. a background refresh shrinking the real list)
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  // Real, marketplace-wide tier counts (not just this page) — `filtered` is
  // always tier-sorted (withVerificationTierFirst), so this is an honest
  // tally of the real 3-tier split under the current filters.
  const tierCounts = useMemo(() => {
    const counts = { [VERIFICATION_TIER.VERIFIED]: 0, [VERIFICATION_TIER.RESPONDING]: 0, [VERIFICATION_TIER.UNPROVEN]: 0 };
    for (const a of filtered) counts[getVerificationTier(a)] += 1;
    return counts;
  }, [filtered]);
  // Marks the first row/card of each new tier on THIS page, so a divider
  // only renders where the tier actually changes — `paginated` is a
  // contiguous slice of the already tier-sorted `filtered` list, so a tier
  // never reappears once it's passed.
  const paginatedTierBreaks = useMemo(() => {
    let lastTier = null;
    return paginated.map((agent) => {
      const tier = getVerificationTier(agent);
      const isNewTier = tier !== lastTier;
      lastTier = tier;
      return isNewTier ? tier : null;
    });
  }, [paginated]);

  // Real, derived stats from actually-fetched agents, replacing the
  // earlier hardcoded numbers (which were 8004scan's own global platform
  // stats from a reference screenshot, not this marketplace's real data).
  //
  // Real bug found and fixed (2026-08-27): `verified` used to be
  // `agents.filter(a => a.isVerified).length`, where isVerified is
  // 8004scan's own raw is_verified field — confirmed live to be false
  // across the entire real registry, so this always showed 0 no matter how
  // many agents had passed our own real "Verified working" tier. Fixed to
  // use agentVerification.js's getVerificationTier (real on-chain-confirmed
  // delivered job), over agentsWithPerf (the performance-merged list — the
  // raw jobsCompleted/jobsSubmitted signal isn't on `agents` yet).
  const stats = useMemo(() => ({
    total: agentsWithPerf.length,
    verified: agentsWithPerf.filter((a) => getVerificationTier(a) === VERIFICATION_TIER.VERIFIED).length,
    totalFeedbacks: agentsWithPerf.reduce((sum, a) => sum + (a.totalFeedbacks || 0), 0),
  }), [agentsWithPerf]);

  // Real per-group counts (categoryGroups.js), so the group chips show an
  // actual tally rather than an unlabeled bucket — anything not mapped to a
  // group (including literal 'Unclassified') counts toward 'Unclassified'.
  const groupCounts = useMemo(() => {
    const counts = { Unclassified: 0 };
    for (const g of CATEGORY_GROUPS) counts[g.id] = 0;
    for (const a of agents) {
      const g = groupForCategory(a.category);
      if (g) counts[g] += 1; else counts.Unclassified += 1;
    }
    return counts;
  }, [agents]);

  // Fine-grained category chips, scoped to whichever group is active — only
  // real categories that actually have at least one agent are shown.
  const activeGroupCategories = useMemo(() => {
    if (activeGroup === 'All' || activeGroup === 'Unclassified') return [];
    const groupCats = CATEGORY_GROUPS.find((g) => g.id === activeGroup)?.categories || [];
    const present = new Set(agents.map((a) => a.category));
    return ['All', ...groupCats.filter((c) => present.has(c))];
  }, [agents, activeGroup]);

  // Picking a different group must clear any leftover fine-category pick
  // from the previous group — otherwise switching groups could silently
  // keep filtering on a category that isn't even in the new group.
  useEffect(() => { setActiveCategory('All'); }, [activeGroup]);

  return (
    <div className={`min-h-screen font-sans flex ${darkMode ? 'dark bg-[#0F172A]' : 'bg-[#F4F5F8]'}`}>
      {showOnboarding && <OnboardingTour onClose={() => setShowOnboarding(false)} />}

      {/* Sidebar: Deep Dark Navy, scrolls together with the page now, no independent region */}
      <aside className="w-[28rem] shrink-0 bg-[#0B101B] text-white border-r border-white/5 shadow-xl relative z-10">
        {/* Sticky wrapper: this content stays visible near the top of the
            viewport as you scroll through the taller main content, instead
            of scrolling away and leaving blank space, while the aside's
            own dark background still extends the full page height. */}
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-8">
              <a
                href="https://f2f-uzh.vercel.app"
                target="_blank"
                rel="noopener noreferrer"
                title="F2F Hub — all three projects in this portfolio"
                className="w-8 h-8 rounded-lg overflow-hidden shadow-lg shadow-indigo-500/20 block"
              >
                <img src={iconLogo} alt="Tnega" className="w-full h-full object-contain" />
              </a>
              <h1 className="text-lg font-bold tracking-tight flex-1">Tnega</h1>
              <button
                onClick={() => setShowOnboarding(true)}
                title="How this works"
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <HelpCircle size={16} />
              </button>
              <NotificationBell variant="dark" />
            </div>
            
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = nav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setNav(item.id); setHiring(false); onNavChange?.(item.id); }}
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

            {/* Separate, non-tab link — a purely visual page, not part of the
                Market/My Agents/Report/Learn/Build/Sell tab structure. */}
            {onOpenEcosystem && (
              <>
                <div className="my-3 border-t border-white/5" />
                <button
                  onClick={onOpenEcosystem}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all duration-200"
                >
                  <Globe size={16} className="opacity-70" /> Ecosystem view
                </button>
              </>
            )}
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

            <div className="mt-4 flex items-center justify-end text-xs text-gray-500 px-2">
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
              onBack={closeAgentDetail}
              onHire={(a) => { setDetailAgent(null); handleHireClick(a); }}
              onTrySkill={handleTrySkill}
            />
          )}

          {nav === 'market' && !hiring && !detailAgent && (
            <>
              {/* Real stats derived from actually-fetched agents, not global platform numbers.
                  The diversity-limit note (why this list is shorter than the full real
                  registry) and the badge legend used to each be a permanent paragraph
                  stacked below here — real information, but competing for attention
                  whether or not anyone needed it right now. Both now live behind small,
                  on-demand (i) icons instead, same real meaning, no permanent space. */}
              <div className="flex flex-col lg:flex-row gap-4 mb-6 items-stretch">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1">
                  <div className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"><Activity size={20} /></div>
                    <div>
                      {/* Real fix (2026-08-27): only ever render the real,
                          confirmed-fresh count — a skeleton until then,
                          never a stale cached number that later jumps. */}
                      {confirmedFresh ? <div className="text-2xl font-bold">{stats.total.toLocaleString()}</div> : <StatSkeleton />}
                      <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                        Agents Listed
                        <InfoTooltip label="" size={12}>
                          This is a varied mix, not every agent that exists. Most agents here were created in a few
                          big signup batches and look nearly identical, so we limit how many near-duplicates show up —
                          there are more agents out there, we're just not cluttering your view with lookalikes.
                        </InfoTooltip>
                      </div>
                    </div>
                  </div>
                  {/* Label corrected 2026-09-04. This was "Reviews", with a
                      tooltip reading "Total written reviews left across all
                      these agents" — both were wrong, confirmed by pulling
                      the real records rather than the aggregate count.
                      8004scan's per-agent feedback endpoint returns 1,899
                      real feedback records across the 29 highest-feedback
                      BSC agents, and 0 of them (0.0%) carry any comment
                      text, and 0 carry a rating score. They're on-chain
                      ERC-8004 Reputation Registry entries — real, and real
                      evidence of interaction, but not reviews in any sense
                      a reader would expect from that word. 96.4% of this
                      number also comes from a single automated cluster
                      (Ensoul), so the tooltip says so. */}
                  <div className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><MessageSquare size={20} /></div>
                    <div>
                      {confirmedFresh ? <div className="text-2xl font-bold">{stats.totalFeedbacks.toLocaleString()}</div> : <StatSkeleton />}
                      <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                        On-chain Feedback
                        <InfoTooltip label="" size={12}>
                          On-chain ERC-8004 feedback entries recorded against these agents. These are
                          counts only — they carry no written text and no star rating, so there's
                          nothing to read behind the number. Most of it also comes from one automated
                          cluster rather than many independent buyers. For evidence an agent actually
                          works, use "Verified Agents" instead — that means a real completed job.
                        </InfoTooltip>
                      </div>
                    </div>
                  </div>
                  <div title="Has at least one on-chain-confirmed delivered job, not just registered on-chain (see 'How we verify agents' below)" className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400"><Users size={20} /></div>
                    <div>
                      {confirmedFresh ? <div className="text-2xl font-bold">{stats.verified.toLocaleString()}</div> : <StatSkeleton />}
                      <div className="text-xs text-gray-500 font-medium">Verified Agents</div>
                    </div>
                  </div>
                </div>
                <QrToMobile />
              </div>

              {/* Real, permanently-accessible explainer (2026-08-27) — the
                  tier legend used to live ONLY behind the small tooltip
                  below, which only covered 2 of the 4 real tiers and
                  required already knowing to hover/click a small (i) icon.
                  This is a real, always-visible section instead (collapsed
                  by default to stay out of the way, but the toggle itself
                  is never hidden). See VerificationExplainerSection.jsx. */}
              <VerificationExplainerSection className="mb-4" />

              <div className="mb-8">
                <InfoTooltip label="What does the live 'Online now' badge mean?" size={12}>
                  <div className="space-y-2">
                    <p><strong>Online now</strong> — we just reached this agent's endpoint and it answered. No checkmark just means we haven't confirmed that recently, not that it's broken. Either way, it's not a quality signal by itself — see "How we verify agents" above for what actually counts as proof.</p>
                  </div>
                </InfoTooltip>
              </div>

              {/* Real tidiness pass (2026-08-28): sort/view (how the list is
                  displayed) get their own row, next to the heading; the 3
                  filter toggles (what's IN the list) get a second row of
                  their own, clearly labeled, instead of all 5 controls
                  running together in one cramped line. */}
              <div className="mb-8 flex flex-col gap-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2">
                      Marketplace
                      {refreshing && <Loader2 size={16} className="animate-spin text-gray-400" />}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Browse AI agents, check them out, and hire one with a spending limit you control.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={sortState.key}
                      onChange={(e) => handleSortSelect(e.target.value)}
                      title="Verified working agents always rank first (see the badges info above); ranks agents with an actual hire history first within that, agents with none yet listed after, not mixed in"
                      className="px-3 py-2.5 rounded-xl text-xs font-medium border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E293B] dark:text-gray-300 outline-none"
                    >
                      <option value="totalScore">Sort: Top score</option>
                      <option value="hireCount">Sort: Most hired</option>
                      <option value="winRate">Sort: Highest success rate</option>
                    </select>
                    <div className="flex bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 rounded-xl p-1">
                      <button onClick={() => setMarketView('grid')} className={`p-2 rounded-lg transition-all ${marketView === 'grid' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><LayoutGrid size={16} /></button>
                      <button onClick={() => setMarketView('table')} className={`p-2 rounded-lg transition-all ${marketView === 'table' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><Table2 size={16} /></button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-1 shrink-0">Filters</span>
                  <button
                    onClick={() => setOnlyVerified((v) => !v)}
                    className={`px-3.5 py-2 rounded-xl text-[11px] font-medium border transition-colors ${
                      onlyVerified
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    title="Only show agents with at least one confirmed delivered job"
                  >
                    {onlyVerified ? '✓ ' : ''}Only verified working
                  </button>
                  <button
                    onClick={() => setOnlyResponding((v) => !v)}
                    className={`px-3.5 py-2 rounded-xl text-[11px] font-medium border transition-colors ${
                      onlyResponding
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    title="Only show agents that responded just now"
                  >
                    {onlyResponding ? '✓ ' : ''}Only show online agents
                  </button>
                  <button onClick={() => setShowUnclassified((v) => !v)} className="px-3.5 py-2 rounded-xl text-[11px] font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    {showUnclassified ? 'Hide' : 'Show'} unclassified
                  </button>
                </div>

                {/* Real, honest failure state (2026-08-27) — a genuine
                    fetch failure here used to be silently indistinguishable
                    from "zero verified agents exist"; now it says so
                    plainly and offers a real retry. */}
                {perfStatus === 'error' && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={12} className="shrink-0" />
                    Couldn't load real verification/hire-history data — "Only verified working", "Most hired", and "Highest success rate" may be inaccurate right now.
                    <button onClick={retryPerf} className="underline font-medium">Try again</button>
                  </div>
                )}
              </div>

              <div className="mb-4 relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by name, or paste an agent id / wallet / contract address…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#1E293B] text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Real, honest disclosure for the two performance sorts — see
                  agentRanking.js: agents with real on-chain hire history for
                  the chosen metric rank first (by that real number); agents
                  with none yet are listed after, in the marketplace's usual
                  default order, never silently mixed in among real track
                  records. */}
              {PERFORMANCE_SORT_KEYS.has(sortState.key) && (
                <div className="mb-4 flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                  <Activity size={13} className="shrink-0 mt-0.5 text-indigo-500" />
                  <span>
                    Ranked by real on-chain hire history{sortState.key === 'hireCount' ? " — total real completed/in-progress jobs, most first" : " — real completed-or-delivered vs. rejected/expired jobs, highest rate first"}.
                    Agents with no real hires yet are listed after those with one, not mixed in.
                  </span>
                </div>
              )}

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

              {/* Two-tier category filter (categoryGroups.js): pick a real
                  top-level group first — the fine-grained categories inside
                  it (categorize.py's own, unchanged) only appear once a
                  group is picked, so browsing starts at 5 real choices
                  instead of 18+. */}
              <div className="mb-3 flex flex-wrap gap-2">
                <button onClick={() => setActiveGroup('All')} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                  activeGroup === 'All' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-[#1E293B] dark:text-gray-300 dark:border-gray-700'
                }`}>All</button>
                {/* Real fix (2026-08-27): same confirmedFresh gate as the
                    header stats — these counts come from the same `agents`
                    array, so showing them before a real fetch has settled
                    risked the exact same stale-cache-then-jump mismatch
                    (e.g. a stale cached total summing to far less than the
                    real, current known_agents count). '…' instead of a
                    number that might be wrong. */}
                {CATEGORY_GROUPS.map((g) => (
                  <button key={g.id} onClick={() => setActiveGroup(g.id)} title={g.categories.join(', ')} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                    activeGroup === g.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-[#1E293B] dark:text-gray-300 dark:border-gray-700'
                  }`}>{g.label} ({confirmedFresh ? (groupCounts[g.id] || 0) : '…'})</button>
                ))}
                <button onClick={() => setActiveGroup('Unclassified')} title="Agents whose description didn't clearly match a known category" className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                  activeGroup === 'Unclassified' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-[#1E293B] dark:text-gray-300 dark:border-gray-700'
                }`}>Unclassified ({confirmedFresh ? (groupCounts.Unclassified || 0) : '…'})</button>
              </div>

              {activeGroupCategories.length > 0 && (
                <div className="mb-8 flex flex-wrap gap-2 pl-2 border-l-2 border-gray-200 dark:border-gray-800">
                  {activeGroupCategories.map((cat) => (
                    <button key={cat} onClick={() => setActiveCategory(cat)} title={CATEGORY_HINTS[cat]} className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${
                      activeCategory === cat ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300 dark:bg-[#1E293B] dark:text-gray-400 dark:border-gray-700'
                    }`}>{cat}</button>
                  ))}
                </div>
              )}
              {activeGroupCategories.length === 0 && <div className="mb-8" />}

              {!loading && !error && filtered.length > 0 && (
                <div className="mb-4 text-xs text-gray-400">
                  Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()} agents
                </div>
              )}

              {/* Real, live search fallback (2026-08-29) — see
                  UniversalSearchFallback.jsx and docs/universal-search.md.
                  Only ever renders when the local name search came up
                  empty AND there's real search text to check — never
                  replaces the plain "nothing matched" case below for an
                  ordinary mistyped name. */}
              {!loading && !error && filtered.length === 0 && searchQuery && (
                <div className="mb-6">
                  <UniversalSearchFallback
                    query={searchQuery}
                    agentsWithPerf={agentsWithPerf}
                    onOpenAgent={(agent) => openAgentDetail(agent)}
                    accent={accent}
                    mutedBorder="border-gray-200 dark:border-gray-800"
                    darkMode={darkMode}
                    // Real, plain fallback for anything that doesn't look
                    // like an id/address at all (an ordinary mistyped
                    // name) — the component itself renders nothing for
                    // that case, so without this the empty grid used to
                    // just show nothing, no message at all.
                    plainEmptyMessage={`Nothing matches "${searchInput.trim()}" by name. If you're looking for a specific agent, try its exact id instead of its name — or paste a wallet or contract address.`}
                  />
                </div>
              )}

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
                        <th className="p-4"><SortHeader label="Score" hint="How trustworthy this agent looks, based on past feedback: higher is better" sortKey="totalScore" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4"><SortHeader label="Stars" hint="How many people rated this agent, like a star rating on a store" sortKey="starCount" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4"><SortHeader label="Online?" hint="Whether we could reach this agent just now" sortKey="serviceRank" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4">
                          <button
                            onClick={() => handleSortSelect('hireCount')}
                            title="ERC-8183 hire history for this agent, click to rank by most hired"
                            className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold transition-colors ${PERFORMANCE_SORT_KEYS.has(sortState.key) ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                          >
                            <ArrowUpDown size={12} className={PERFORMANCE_SORT_KEYS.has(sortState.key) ? 'opacity-100' : 'opacity-40'} />
                            Track record
                          </button>
                        </th>
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider" title="Written comments people left after hiring this agent">Feedback</th>
                        <th className="p-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {paginated.map((agent, i) => (
                        <React.Fragment key={agent.id}>
                          {paginatedTierBreaks[i] && (
                            <tr>
                              <td colSpan={8} className="px-4 pt-5 pb-2 bg-gray-50/50 dark:bg-gray-800/20">
                                <VerificationTierDivider tier={paginatedTierBreaks[i]} count={tierCounts[paginatedTierBreaks[i]]} />
                              </td>
                            </tr>
                          )}
                          <tr onClick={() => openAgentDetail(agent)} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors group cursor-pointer">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <AgentAvatar agent={agent} size={32} rounded="rounded-xl" />
                              <div>
                                <div className="text-sm font-semibold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={14} className="text-indigo-500" title="Registered on-chain, not a quality rating" />}</div>
                                <div className="text-[11px] text-gray-500 mt-0.5" title={CATEGORY_HINTS[agent.category]}>{agent.category}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4"><span className="text-[10px] px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 font-medium tracking-wide">{CHAIN_LABELS[agent.chainId] || agent.network}</span></td>
                          <td className="p-4 text-sm font-semibold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</td>
                          <td className="p-4 text-sm text-gray-600 dark:text-gray-400">{agent.starCount ?? '—'}</td>
                          <td className="p-4">
                            <div className="flex flex-col gap-1 items-start">
                              <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} />
                              <VerificationBadge agent={agent} />
                            </div>
                          </td>
                          <td className="p-4 text-xs">
                            {agentHasRealHistory(agent, 'hireCount')
                              ? <span className="text-gray-700 dark:text-gray-300 font-medium">{agent.hireCount} hire{agent.hireCount === 1 ? '' : 's'}{agent.winRate != null ? ` · ${Math.round(agent.winRate * 100)}%` : ''}</span>
                              : <span className="text-gray-400">No hires yet</span>}
                          </td>
                          <td className="p-4 text-sm text-gray-500">{agent.totalFeedbacks ?? '—'}</td>
                          <td className="p-4 text-right">
                            <button onClick={(e) => { e.stopPropagation(); agent.session ? (setSelectedAgent(agent), setHiring(true)) : handleHireClick(agent); }} className={`text-xs font-semibold px-4 py-2 rounded-xl transition-all ${agent.session ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 opacity-0 group-hover:opacity-100'}`}>
                              {agent.session ? 'Manage' : 'Hire'}
                            </button>
                          </td>
                          </tr>
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!loading && !error && marketView === 'grid' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {paginated.map((agent, i) => (
                    <React.Fragment key={agent.id}>
                      {paginatedTierBreaks[i] && (
                        <VerificationTierDivider
                          tier={paginatedTierBreaks[i]}
                          count={tierCounts[paginatedTierBreaks[i]]}
                          className={`col-span-full ${i === 0 ? '' : 'mt-2'}`}
                        />
                      )}
                    <div className="bg-white dark:bg-[#1E293B] rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden">
                      <div className="p-6 flex-1 cursor-pointer" onClick={() => openAgentDetail(agent)}>
                        <div className="flex justify-between items-start mb-5">
                          <div className="flex items-center gap-3">
                            <AgentAvatar agent={agent} size={40} />
                            <div>
                              <span title={CATEGORY_HINTS[agent.category]} className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-1 block">{agent.category}</span>
                              <h3 className="text-lg font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={16} className="text-indigo-500" title="Registered on-chain, not a quality rating" />}</h3>
                            </div>
                          </div>
                          <span className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
                        </div>

                        <div className="mb-3 flex flex-wrap items-center gap-1.5">
                          {agent.serviceStatus && agent.serviceStatus !== 'unknown' && (
                            <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} />
                          )}
                          <VerificationBadge agent={agent} />
                        </div>

                        <div className="grid grid-cols-3 gap-2 p-3 mb-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50">
                          <div className="text-center" title="How trustworthy this agent looks, based on past feedback"><span className="block text-[10px] text-gray-500 uppercase mb-1">Score</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</span></div>
                          <div className="text-center border-l border-gray-200 dark:border-gray-700" title="How many people rated this agent"><span className="block text-[10px] text-gray-500 uppercase mb-1">Stars</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.starCount ?? '—'}</span></div>
                          <div className="text-center border-l border-gray-200 dark:border-gray-700" title="Total money this agent currently manages for people"><span className="block text-[10px] text-gray-500 uppercase mb-1">Funds</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : <span className="text-gray-400 font-normal">-</span>}</span></div>
                        </div>

                        {/* Real on-chain hire track record — same data the
                            "Most hired"/"Highest success rate" sort ranks
                            by, shown plainly here so it's visible
                            regardless of which sort is active. */}
                        <div className="mb-4 text-[11px] text-gray-500 dark:text-gray-400" title={perfIndexComplete ? "ERC-8183 job history for this agent: the complete on-chain history, not a recent-only window" : "ERC-8183 job history for this agent: a one-time backfill of the complete history is still catching up"}>
                          {agentHasRealHistory(agent, 'hireCount')
                            ? <>{agent.hireCount} {agent.hireCount === 1 ? 'hire' : 'hires'}{agent.winRate != null ? ` · ${Math.round(agent.winRate * 100)}% success` : ''}</>
                            : <span className="text-gray-400 dark:text-gray-500">No hires yet</span>}
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
                    </React.Fragment>
                  ))}
                </div>
              )}

              {!loading && !error && <Pagination page={currentPage} pageCount={pageCount} onChange={setPage} />}
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
                  <AgentAvatar agent={selectedAgent} size={56} />
                  <div>
                    <h2 className="text-2xl font-bold">Hire {selectedAgent.name}</h2>
                    <p className="text-gray-500 text-sm mt-1">Approve each step yourself, in your wallet.</p>
                  </div>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 mb-8 text-sm text-amber-800 dark:text-amber-300">
                  This puts real money on hold for this agent to do the work — you're not just browsing anymore. You approve each step yourself, in your wallet, every time.
                </div>

                {/* Real, last-chance gate — see EscrowCompatibilityWarning.jsx.
                    Only renders (and only blocks the fund button below) when
                    this specific agent was flagged by a real, live protocol
                    probe against its own registered endpoint. */}
                {hireEscrowGate.node}

                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck size={16} className="text-indigo-500" />
                  <span className="text-xs font-bold uppercase tracking-wide opacity-70">Always Ask</span>
                </div>

                {/* Unified "how much and how long" step (2026-09-09) — the
                    real amount and the real deadline are both terms of the
                    same hire, so they live in one bordered section with
                    consistent visual treatment, not two disconnected
                    floating inputs. */}
                <div className="mb-6 p-5 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-white/[0.02] space-y-6">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold mb-3"><Sliders size={16} className="text-gray-400" /> How much are you funding this job for? <span className="font-normal text-gray-400" title="$U is a type of digital dollar — 1 $U is worth about $1. It's what you pay agents with here.">($U, worth about $1 each)</span></label>

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

                  {/* Real, user-facing job deadline (2026-09-09) — previously
                      hardcoded to 65 minutes with no control in this modal at
                      all (confirmed by reading useHireAgent.js's own hire()
                      signature before building this). Scoped to third-party
                      hiring only: Native Agents and Skills are atomic,
                      single-transaction actions with no delivery period, so
                      no deadline concept applies there — see hireDeadline.js. */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold mb-3"><Clock size={16} className="text-gray-400" /> How long does the agent have to deliver?</label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {DEADLINE_PRESETS.map((p) => (
                        <button
                          key={p.minutes}
                          type="button"
                          onClick={() => setDeadlineMinutes(p.minutes)}
                          disabled={hireStep && !hireError}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${Number(deadlineMinutes) === p.minutes ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-indigo-300'}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number" value={deadlineMinutes} disabled={hireStep && !hireError}
                      onChange={(e) => setDeadlineMinutes(e.target.value)}
                      className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50"
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      {deadlineError
                        ? <span className="text-red-500">{deadlineError}</span>
                        : <>Minutes ({formatDeadline(deadlineMinutes)}). If the agent hasn't delivered by then, you can reclaim your funds — real minimum {DEADLINE_MIN_MINUTES} min, real maximum {formatDeadline(DEADLINE_MAX_MINUTES)}.</>}
                    </p>
                  </div>
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
                        placeholder={`Hire via Tnega: ${selectedAgent.name}`}
                        rows={4}
                        className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Only for advanced users — this replaces the automatic description above with your own text, permanently recorded. Leave it blank unless you have a specific reason to use this.</p>
                    </div>
                  )}
                </div>

                {/* Real "sign once" toggle (2026-08-27) — only ever shown
                    once canBatchHire has genuinely confirmed real batch
                    support for the connected wallet (never while still
                    checking, never as a broken option for a wallet that
                    doesn't support it). Disabled once a hire is actively
                    running, same as every other pre-hire control. */}
                {!hireStep && canBatchHire === CAN_BATCH_HIRE_STATUS.supported && (
                  <div className="mb-4 flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]">
                    <div>
                      <div className="text-xs font-semibold">{signOnceForAllSteps ? 'Sign once for all steps' : 'Sign each step individually'}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {signOnceForAllSteps
                          ? 'Your wallet supports this — one signature covers the on-chain steps after the job is created.'
                          : "You'll approve each real on-chain step one at a time — the default, if you'd rather see each one."}
                      </div>
                    </div>
                    <button
                      onClick={() => setSignOnceForAllSteps((v) => !v)}
                      className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${signOnceForAllSteps ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-700'}`}
                      role="switch" aria-checked={signOnceForAllSteps} aria-label="Sign once for all steps"
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${signOnceForAllSteps ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                )}
                {/* Real, honest fallback message — only once the wallet's
                    real capability check has actually completed and
                    genuinely doesn't support batching (not while still
                    unknown, and never a broken half-batched attempt). */}
                {!hireStep && canBatchHire === CAN_BATCH_HIRE_STATUS.unsupported && (
                  <p className="mb-4 text-[11px] text-gray-400">
                    "Sign once for all steps" isn't available for your connected wallet — signing each step individually below.
                  </p>
                )}

                {/* Real step checklist — every row's state comes straight from
                    useHireAgent's own tracked state (step/completedSteps/
                    skippedSteps/stepHashes/error), see buildHireStepList /
                    buildBatchHireStepList in useHireAgent.js. Only shown once
                    the flow has started; the batched builder is used only for
                    a run that actually started in batched mode. */}
                {hireStep && (
                  <div className="mb-6 p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]">
                    <StepChecklist steps={(activeHireMode === 'batched' ? buildBatchHireStepList : buildHireStepList)({
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

                <button onClick={handleActivateSession} disabled={(hireStep && hireStep !== 'done' && !hireError) || hireEscrowGate.blocked || !!deadlineError} className="w-full py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide disabled:opacity-50">
                  {hireStep === 'done' ? 'HIRED ✓' : hireError ? 'TRY AGAIN' : hireEscrowGate.blocked ? 'CHECK THE BOX ABOVE TO CONTINUE' : deadlineError ? 'FIX THE DEADLINE ABOVE' : 'HIRE'}
                </button>
              </div>
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

          {/* Report Tab — real, same-task comparisons (AdvantageReport.jsx),
              not a fabricated array. */}
          {nav === 'report' && (
            <div className="max-w-4xl">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Advantage Report</h2>
              <p className="text-gray-500 mb-8">3 tasks, each done two ways: once using an agent, once by hand, so you can see the actual time, cost, and quality difference for yourself.</p>
              <AdvantageReport />
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
                  topic.custom ? (
                    <topic.custom key={i} />
                  ) : (
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
                  )
                ))}
              </div>
            </div>
          )}

          {/* Build Tab */}
          {/* Real, own top-level tab (2026-08-29) — see NAV_ITEMS' own
              comment above for the full reasoning this was moved out of
              "Build Your Agent" for. */}
          {nav === 'skills' && (
            <div className="max-w-3xl">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Zap size={24} /></div>
                <h2 className="text-3xl font-bold tracking-tight">Skills</h2>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-2">Pre-built, audited on-chain actions you run yourself: supply into Venus, trade on PancakeSwap, and more, through your own connected wallet or a spend-capped mini-wallet.</p>
              <p className="text-xs text-gray-400 mb-10">Different from hiring an agent from the Marketplace: there's no job, no delivery to wait on, and no third party doing the work on your behalf. This runs directly, right now, within a limit you set.</p>

              <AltanaSkillsPanel accent={accent} surface={darkMode ? '#1E293B' : '#FFFFFF'} mutedBorder="border-gray-200 dark:border-gray-800" darkMode={darkMode} initialSkillId={pendingSkillId} onConsumedInitialSkill={() => setPendingSkillId(null)} />
            </div>
          )}

          {/* Native Agent Marketplace Tab */}
          {nav === 'native' && (
            <div className="max-w-4xl">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Bot size={24} /></div>
                <h2 className="text-3xl font-bold tracking-tight">Native Agent Marketplace</h2>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-2">Tnega's own designed agents: autonomous, multi-factor decisions, not a hired third party and not a plain pass-through Skill.</p>
              <p className="text-xs text-gray-400 mb-10">Each agent evaluates candidate protocols itself (liquidity/risk first, yield second) and shows you exactly why it picked what it picked, before you sign anything.</p>

              <NativeAgentMarketplace accent={accent} surface={darkMode ? '#1E293B' : '#FFFFFF'} mutedBorder="border-gray-200 dark:border-gray-800" darkMode={darkMode} />
            </div>
          )}

          {nav === 'build' && (
            <div className="max-w-3xl">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-500/10 rounded-xl text-indigo-600 dark:text-indigo-400"><Sparkles size={24} /></div>
                <h2 className="text-3xl font-bold tracking-tight">Build Your Agent</h2>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mb-2">No coding required. If you can describe what you want in a sentence, you can build this.</p>
              <p className="text-xs text-gray-400 mb-1">Built on BNB Agent Studio (bnbagent-studio) and the ERC-8004/ERC-8183 standards.</p>
              <a href="https://docs.bnbchain.org/developer-kit" target="_blank" rel="noreferrer" className="text-xs text-indigo-500 underline mb-10 inline-block">Source: docs.bnbchain.org/developer-kit →</a>

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
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Wallet: <span className="font-mono">{buildStatus.address}</span>, a temporary practice wallet made just for this trial. It can't hold or lose any money.</p>
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

          <DataSourcesFooter onOpenDataSources={onOpenDataSources} />
          <HackathonPartnersFooter onOpenPartners={onOpenPartners} />
          <DocsFooter onOpenDocs={onOpenDocs} />
        </div>
      </main>
    </div>
  );
}