import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Sun, Moon, ShieldAlert, ShieldCheck, FileBarChart, CheckCircle2, XCircle,
  GraduationCap, Store, ChevronRight, Loader2, AlertTriangle,
  Wallet, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, Menu,
  ExternalLink, Zap, Coins, Search, Briefcase, Globe, HelpCircle, Bot, Clock
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import iconLogo from './assets/icon_v2.svg';
import { useNavSync, useOverlayHistory } from './useViewHistory';
import agentsHero from './assets/agents.png';
import { useHireAgent, buildHireStepList, buildBatchHireStepList, useAgentQuote, useBatchHireCapability, CAN_BATCH_HIRE_STATUS } from './useHireAgent';
import { DEADLINE_MIN_MINUTES, DEADLINE_MAX_MINUTES, DEADLINE_DEFAULT_MINUTES, DEADLINE_PRESETS, formatDeadline, validateDeadlineMinutes } from './hireDeadline';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import MyJobsPanel from './MyJobsPanel';
import AdvantageReport from './AdvantageReport';
import AltanaSkillsPanel from './AltanaSkillsPanel';
import NativeAgentMarketplace from './NativeAgentMarketplace';
import NotificationBell from './NotificationBell';
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
import { getVerificationTier, VERIFICATION_TIER, withVerificationTierFirst } from './agentVerification';
import VerificationBadge, { VerificationTierDivider } from './VerificationBadge';
import VerificationExplainerSection from './VerificationExplainerSection';
import InfoTooltip from './InfoTooltip';
import { CATEGORY_GROUPS, groupForCategory } from './categoryGroups';
import { SingleAgentDiagram, SequentialDiagram, ParallelDiagram, HierarchicalDiagram } from './AgentArchitectureDiagrams';
import { useHireFlowEscrowGate, useEscrowCompatibility } from './EscrowCompatibilityWarning';
import UniversalSearchFallback from './UniversalSearchFallback';
import AgentMetrics from './AgentMetrics';
import QualityCenterPanel from './QualityCenterPanel';
import ContractVerificationBadge from './ContractVerificationBadge';
import AgentAvatar from './AgentAvatar';
import DataSourcesFooter from './DataSourcesFooter';
import HackathonPartnersFooter from './HackathonPartnersFooter';
import DocsFooter from './DocsFooter';
import SessionModesExplainer from './SessionModesExplainer';
import { useBnbPrice, formatBnbWithUsd } from './useBnbPrice';
import OnboardingTour from './OnboardingTour';
import { hasSeenOnboarding } from './onboarding';

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
  adk: { label: "Google's Agent Development Kit — multi-agent patterns", url: 'https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/' },
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
  { h: 'Mainnet', p: "Mainnet is the live network, where money moves for real. Everything on this site runs on mainnet, not a test network.", tech: 'This is the live network. Nothing here is a simulation.' },
  { h: 'Escrow', p: 'When you hire an agent, your payment is held by the system, not the agent — it only gets paid once the work is accepted, and you can get it back if nothing is delivered.', tech: 'Your payment sits in an on-chain vault (AgenticCommerce) until settlement.', src: SRC.sdk },
  { h: 'The agent\'s ID card (ERC-8004)', p: "Every agent gets a permanent, public identity anyone can look up — like an ID card. Free to register.", tech: 'An on-chain ERC-721 identity token + a discoverable profile (name, description, endpoints).', src: SRC.sdk },
  { h: 'The payment rulebook (ERC-8183)', p: "A set of automatic rules that hold the money and enforce the deal, so neither you nor the agent has to just trust the other.", tech: 'Three contracts: AgenticCommerce (job + escrow), EvaluatorRouter (routes to a settlement policy), OptimisticPolicy (silence past the review window = approved).', src: SRC.sdk },
  { h: 'Hiring = one job, not a subscription', p: "You fund one specific job, once. The agent can never dip into your wallet again on its own.", tech: 'createJob → registerJob → setBudget → approve $U → fund, each signed by your wallet.', src: SRC.sdk },
  { custom: SessionModesExplainer },
  { h: 'The stages a hire goes through', p: 'Not paid yet → Payment on hold → Delivered → Finished (paid) — or Refunded, if you cancel, dispute successfully, or the deadline passes with nothing delivered.', tech: 'OPEN → FUNDED → SUBMITTED → COMPLETED, or REJECTED / EXPIRED.', src: SRC.sdk },
  { h: 'The guaranteed exit', p: "If a job's deadline passes with nothing delivered, you can get your money back, anytime, no one's permission needed.", tech: 'claimRefund() after expiry — always available, guaranteed by the contract.', src: SRC.sdk },
  { h: "If something looks wrong", p: "You get a short window after delivery to flag a problem before payment is automatically released.", tech: 'Call dispute() during the review window instead of letting it auto-settle.', src: SRC.sdk },
  { h: 'Ready-made Skills', p: "Skills are pre-built recipes an agent can run for you — no building required, just a passkey wallet and a spending limit you set.", tech: "Fork-tested Skills from Altana's public registry, run via a passkey wallet + a capped, expiring session.", src: SRC.skills },
  { h: 'How agents are built: single agent', p: 'One agent handles the whole task itself, start to finish — reads what it needs, does the work, hands back a result. This is the simplest pattern, and the one most agents listed here actually use — including our own explainer agent on the Advantage Report tab.', Diagram: SingleAgentDiagram, src: SRC.adk },
  { h: 'How agents are built: sequential (chained steps)', p: 'The task moves through a fixed pipeline of steps, one after another — each step\'s output becomes the next step\'s input. Good for work that has a natural order, like "research, then draft, then check."', Diagram: SequentialDiagram },
  { h: 'How agents are built: parallel (specialists working at once)', p: 'The task is split across several specialists that all work at the same time, and their results get combined into one answer. Good when different parts of a task don\'t depend on each other and can happen simultaneously.', Diagram: ParallelDiagram },
  { h: 'How agents are built: hierarchical (an orchestrator delegating)', p: 'One orchestrator agent breaks the task into pieces and hands each piece to a sub-agent underneath it, then assembles what comes back. Good for complex work that benefits from a manager coordinating specialists.', Diagram: HierarchicalDiagram },
  { h: "What's actually here right now", p: 'Fewer than 2% of the agents listed on this marketplace mention multi-agent or orchestration language in their own description; the large majority present as single agents, like our own explainer agent. That\'s not a shortcoming of this marketplace: the other three patterns are valid ways to build an agent, just not yet common among what\'s registered here today.' },
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
  { h: '1. Describe your agent, in plain English', p: 'You type a sentence describing what you want; a tool writes the starter code for you.', tech: 'Tell Claude Code or Cursor what you want, e.g. "a BNB agent that sells weather forecasts." BNB Agent Studio\'s "bag" tool reads that and scaffolds a working project.', src: SRC.studioQuick },
  { h: '2. It builds two things, not one', p: 'The part that holds the keys to real money stays private; a separate public part takes requests from the outside world.', tech: 'Layer A (the Agent) holds the wallet + LLM and is the only thing that ever signs. Layer B (the Service) is public, keyless, and just relays requests.', src: SRC.studioArch },
  { h: '3. You edit the instructions, not the plumbing', p: "You rewrite one paragraph telling the agent its job — not the technical wiring around it.", tech: 'Wallet setup and the on-chain registration/payment wiring are already there. What you change is the instruction string in main.py describing what it should do when a funded job asks it to work.', src: SRC.studioArch },
  { h: '4. Test it before it touches real money', p: 'Run it on your own computer first, with a free AI model, before deploying or spending anything.', tech: 'bag dev runs both layers on your machine. You can hit the live negotiate step, get an actual signed price quote, and confirm the whole flow first.', src: SRC.studioQuick },
  { h: '5. Register, then publish it', p: 'Try it free for about 2 days with one click, or host it yourself permanently later.', tech: 'bag erc8004 register makes your agent discoverable. The one-click "Build it for real" button uses a free trial (no cloud hosting account needed).', src: SRC.studioArch },
];

// Beginner FAQ — mirrors the web app's, kept in sync.
const KID_FRIENDLY_FAQ = [
  { q: 'Do I need to know how to code?', a: 'No. You describe what you want in normal sentences; to build a custom agent you mostly edit one instruction paragraph, and to use a ready-made Skill you just fill in a form.', src: SRC.studioQuick },
  { q: 'Can it spend my money without asking?', a: "No. Hiring funds one specific job you set and fund yourself; a Skill's spending permission has a cap, an expiry, and a limited list of what it can touch. Neither is a standing permission it can dip into freely.", src: SRC.sdk },
  { q: 'What if the agent never delivers?', a: "You're guaranteed to get your money back once the deadline passes — but it's not automatic. You'll need to come back and claim it yourself with one click. That guarantee is a built-in rule of the whole system, not a favor the agent has to grant you.", src: SRC.sdk },
  { q: 'Do I need my own cloud hosting account to build one?', a: 'No. The build button uses a free trial (about 2 days) on a temporary practice wallet — no hosting account, no real money involved.', src: SRC.studio },
  { q: 'What kind of agent can I build?', a: "Pretty much anything you can describe in a sentence: trading, research, writing, customer support, data analysis, games — you're not limited to a preset list.", src: SRC.studioQuick },
  { q: 'Can it sell to people, not just other agents?', a: "Yes. Any buyer — a person or another agent — can hire it. It's not limited to agent-to-agent deals.", src: SRC.studioArch },
];
// Bumped to v2 alongside the web app — see AgentMarketplaceApp.web.jsx's
// CACHE_KEY comment for the real reason (a stale-client-cache theory from
// investigating a reported web-only missing-button bug that a real
// headless render proved isn't a code-level divergence).
// Renamed to 'tnega-cache-v1' alongside web + EcosystemGlobePage for the
// Tnega rebrand — see AgentMarketplaceApp.web.jsx's CACHE_KEY comment.
const CACHE_KEY = 'tnega-cache-v1';
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
    // Real, added 2026-08-29 — same DefiLlama match as tvlUsd, zero extra
    // API calls — see the matching web.jsx comment for the full real
    // reasoning behind each field.
    tvlChange7dPct: a.tvl_change_7d_pct, auditCount: a.audit_count,
    tvlDataFlagged: a.tvl_data_flagged, mcapUsd: a.mcap_usd,
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
  // Real bug found and fixed (2026-08-27), matching web — see
  // AgentMarketplaceApp.web.jsx's useMarketplaceAgents for the full real
  // investigation. Short version: `loading` is already false on the very
  // first render whenever a warm cache exists (by design, so the agent
  // list can show cached cards instantly), so the header stat count was
  // rendering the real-but-possibly-stale cached number on the very first
  // paint, then flashing to the real, fresh number once this effect's
  // fetch resolved. `confirmedFresh` starts false on every render (cache
  // or not) and flips true only once a real fetch actually settles.
  const [confirmedFresh, setConfirmedFresh] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const mapped = (data.agents || []).map(mapAgent);
        setAgents(mapped);
        setLoading(false);
        setConfirmedFresh(true);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: mapped, savedAt: Date.now() })); } catch (e) {}
      })
      .catch((err) => {
        if (cancelled) return;
        if (agents.length === 0) setError(err.message);
        setConfirmedFresh(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { agents, setAgents, loading, error, confirmedFresh };
}

// Real, honest placeholder for a stat number that isn't confirmed-fresh yet
// (see useMarketplaceAgents' confirmedFresh above) — a pulsing bar, never a
// number that might be wrong. Parity with web's StatSkeleton.
function StatSkeleton() {
  return <div className="h-5 w-10 mx-auto rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />;
}

const NAV_ITEMS = [
  { id: 'market', label: 'Market', icon: Store },
  // Real, deliberate placement (2026-08-29, product/UX audit) — mirrors
  // web's identical NAV_ITEMS change; see that file's own comment for the
  // full reasoning. A Skill isn't a registered ERC-8004 agent being hired
  // for delivered work — it's a real, direct, self-executed on-chain
  // action, promoted out of the "Build" tab (a different feature) into
  // its own top-level tab.
  // Real, own top-level tab (2026-09-01) — mirrors web's identical
  // NAV_ITEMS change; see that file's own comment for the full reasoning.
  // Ordered ahead of Skills (2026-09-02, explicit tab-order request).
  { id: 'native', label: 'Native Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Zap },
  { id: 'my-agents', label: 'My Agents', icon: Briefcase },
  { id: 'report', label: 'Report', icon: FileBarChart },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'build', label: 'Build', icon: Hammer },
  { id: 'sell', label: 'Sell', icon: Coins },
];

// Real bottom-bar trim (2026-09-04): eight tabs in a phone-width bar left
// each one ~40px wide with a 10px label -- crowded and hard to hit
// accurately. The bar now carries only the three genuinely primary
// destinations and everything else moves into the existing menu sheet, so
// nothing becomes unreachable, it just stops competing for thumb space.
//
// Which three, and why these: Market is the app's whole reason to exist
// (browsing and hiring registered agents); Native Agents is Tnega's own
// first-party execution surface, the thing that is not just a directory
// listing; My Agents is where a user returns to see work they already paid
// for. The rest are either occasional (Report, Learn), one-off setup
// (Build, Sell), or a secondary execution path (Skills).
const PRIMARY_NAV_IDS = ['market', 'native', 'my-agents'];
const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((i) => PRIMARY_NAV_IDS.includes(i.id));
const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((i) => !PRIMARY_NAV_IDS.includes(i.id));

// Mobile-optimized Wallet Modal / Sheet
function MobileWalletSheet({ onClose, nav, onNavigate }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { ready, authenticated, user, logout } = usePrivy();
  const privyConnected = ready && authenticated;
  const activeAddress = wagmiConnected ? wagmiAddress : user?.wallet?.address;
  const isConnected = wagmiConnected || privyConnected;
  const shortAddress = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full bg-white dark:bg-[#0F172A] rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
        <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mb-6" />
        {/* Secondary destinations, moved out of the bottom bar (2026-09-04).
            Reachable in one tap from the menu the header already had. */}
        {onNavigate && (
          <div className="mb-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-3 px-1">Go to</h3>
            <div className="grid grid-cols-3 gap-2">
              {SECONDARY_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = nav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); onClose(); }}
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border transition-colors ${active
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                      : 'border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-[#1E293B] text-gray-600 dark:text-gray-300'}`}
                  >
                    <Icon size={18} />
                    <span className="text-[11px] font-medium">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

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
          </div>
        )}
      </div>
    </div>
  );
}

// Full-screen launch splash. Shown before the app UI; tap anywhere to
// continue.
//
// The "Continue with Face ID" button was removed 2026-09-04. It worked, but
// it was misleading: it promised biometrics and actually opened Privy's
// passkey/email modal. What that label implies -- an OS-level biometric
// unlock of the app itself -- is not something a web app can do, so the
// honest fix was to stop offering it rather than to reword it.
function SplashScreen({ onUnlock }) {
  const [showControls, setShowControls] = useState(false);

  // Show the hero for a beat, then reveal the unlock controls.
  useEffect(() => {
    const t = setTimeout(() => setShowControls(true), 1200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      onClick={showControls ? onUnlock : undefined}
      className="fixed inset-0 z-50 bg-[#0B101B] text-white flex flex-col items-center justify-between p-8 select-none"
      role="button"
      aria-label="Tap to continue"
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-6 w-full">
        <img src={agentsHero} alt="Tnega" className="w-full max-w-xs rounded-3xl border border-white/10 shadow-2xl object-cover" />
        {!showControls ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : (
          <p className="text-xs text-gray-400">Tap anywhere to continue</p>
        )}
      </div>

      <div className="w-full flex flex-col items-center gap-2 pb-4 min-h-[48px] justify-end">
        <div className="flex items-center gap-2">
          <img src={iconLogo} alt="" className="w-7 h-7" />
          <h1 className="text-xl font-bold tracking-tight">Tnega</h1>
        </div>
      </div>
    </div>
  );
}

const BSCSCAN = 'https://bscscan.com';

// Full agent detail — a full-screen push (matching the hire flow), showing
// everything the aggregated data holds for one agent.
function AgentDetailMobile({ agent, onBack, onHire, onTrySkill }) {
  const [copied, setCopied] = useState(false);
  const bnbUsdPrice = useBnbPrice();
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
          <div className="flex items-center gap-3">
            <AgentAvatar agent={agent} size={44} />
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span title={CATEGORY_HINTS[agent.category]} className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{agent.category}</span>
                {agent.possiblyDelisted && <span title="Not seen active in over a week" className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">may no longer be active</span>}
              </div>
              <h2 className="text-2xl font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={18} className="text-indigo-500" title="Registered on-chain, not a quality rating" />}</h2>
            </div>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 font-medium shrink-0">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3 text-center">
          {[['Score', agent.totalScore != null ? agent.totalScore.toFixed(1) : '—', 'How trustworthy this agent looks, based on real past feedback'],
            ['Stars', agent.starCount ?? '—', 'How many people rated this agent'],
            ['On-chain Feedback', agent.totalFeedbacks ?? '—', 'On-chain ERC-8004 feedback entries for this agent — a count only, with no written text or rating behind it'],
            ['Funds', agent.financialDataAvailable && agent.tvlUsd != null ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '—', 'Total money this agent currently manages for people']].map(([l, v, hint]) => (
            <div key={l} title={hint} className="p-2 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <span className="block text-[9px] text-gray-500 uppercase">{l}</span>
              <span className="font-bold text-sm">{v}</span>
            </div>
          ))}
        </div>
        {agent.financialDataAvailable && agent.defillamaUrl && (
          <div className="mb-4">
            <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 inline-flex items-center gap-1">Where this money number comes from: DefiLlama <ExternalLink size={11} /></a>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
              {agent.tvlChange7dPct != null && (
                <span title="How this protocol's total funds have changed over the last 7 days">{agent.tvlChange7dPct >= 0 ? '▲' : '▼'} {Math.abs(agent.tvlChange7dPct).toFixed(1)}% (7d)</span>
              )}
              {agent.auditCount != null && (
                <span title="Independent security audits, per DefiLlama">{agent.auditCount > 0 ? `${agent.auditCount} security audit${agent.auditCount === 1 ? '' : 's'}` : 'No security audits on record'}</span>
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

        <div className="flex flex-wrap items-center gap-2 my-4">
          {agent.isVerified && <span title="Registered on-chain, not a quality rating" className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><BadgeCheck size={12} />Verified</span>}
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

        <h3 className="text-sm font-bold mb-1 flex items-center gap-2">Who owns this agent <PasskeyBadge ownerAddress={agent.ownerAddress} /> {agent.id && <ContractVerificationBadge agentId={agent.id} />}</h3>
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
          <span className="font-mono text-sm font-semibold">{agent.ownerBnbBalance != null ? formatBnbWithUsd(agent.ownerBnbBalance, bnbUsdPrice) : <span className="text-gray-400 font-normal">n/a</span>}</span>
        </div>
        {/* Real, final, unified "Metrics" presentation — see the matching
            comment on AgentDetail (web) / AgentMetrics.jsx's own header
            for the full real consolidation rationale (same file web
            uses). The harder, last-chance gate still lives in the actual
            funding modal below. */}
        <AgentMetrics agent={agent} onHire={onHire} onTrySkill={onTrySkill} />

        {agent.id && <QualityCenterPanel agentId={agent.id} />}

        {agent.tokenId != null && <BuyAccessPanel agentId={String(agent.tokenId)} />}
      </div>
    </div>
  );
}

// Default export: the splash gate wrapping the real app.
export default function AgentMarketplaceMobileRoot({ onOpenEcosystem, onOpenDataSources, onOpenPartners, onOpenDocs, initialNav, onNavChange } = {}) {
  const [unlocked, setUnlocked] = useState(false);
  if (!unlocked) return <SplashScreen onUnlock={() => setUnlocked(true)} />;
  return <AgentMarketplaceMobile onOpenEcosystem={onOpenEcosystem} onOpenDataSources={onOpenDataSources} onOpenPartners={onOpenPartners} onOpenDocs={onOpenDocs} initialNav={initialNav} onNavChange={onNavChange} />;
}

function AgentMarketplaceMobile({ onOpenEcosystem, onOpenDataSources, onOpenPartners, onOpenDocs, initialNav, onNavChange } = {}) {
  // Real bug found and fixed (2026-08-27, full mobile/web parity audit):
  // this file referenced an undefined `REPORT_ACCENT` (never defined or
  // imported anywhere in the codebase) on AltanaSkillsPanel — a guaranteed
  // ReferenceError crash the moment a user opened that tab. (At the time,
  // AltanaSkillsPanel lived on the Build tab; it moved to its own Skills
  // tab 2026-08-29 — see NAV_ITEMS' own comment above.) Same real accent
  // value web uses (AgentMarketplaceApp.web.jsx).
  const accent = '#6366F1';
  const [darkMode, setDarkMode] = useState(false);
  // Real first-visit orientation — see AgentMarketplaceApp.web.jsx's
  // matching comment and onboarding.js for the real reasoning.
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());
  // Real per-tab URL routing — see the matching comment in
  // AgentMarketplaceApp.web.jsx; identical mechanism here.
  const [nav, setNav] = useState(initialNav || 'market');
  useEffect(() => {
    if (initialNav && initialNav !== nav) setNav(initialNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNav]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyResponding, setOnlyResponding] = useState(false);
  // Real, honest opt-in filter (see agentVerification.js) — off by default.
  const [onlyVerified, setOnlyVerified] = useState(false);
  // Two-tier category filter (categoryGroups.js) — matches web.
  const [activeGroup, setActiveGroup] = useState('All');
  // Real sort — mobile had no sort control at all before this (the list
  // just showed the backend's own default, score-sorted order). 'default'
  // keeps that; 'hireCount'/'winRate' switch to the real tiered comparator
  // (agentRanking.js — same logic web uses, see its own comment for why
  // real history sorts first and no-history agents are listed after,
  // never mixed in).
  const [sortKey, setSortKey] = useState('default');
  const { byOwner: perfByOwner, indexComplete: perfIndexComplete, status: perfStatus, retry: retryPerf } = useAgentPerformanceBulk();
  const { byOwner: canaryByOwner } = useCanaryStatus();
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [detailAgent, setDetailAgent] = useState(null); // full-screen agent detail push
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
  const [hiring, setHiring] = useState(false);
  // Real deep-link from the agent guidance panel's "Try it yourself" —
  // switches to Build and pre-opens that specific skill's guided form.
  // Mirrors web's identical handleTrySkill.
  const [pendingSkillId, setPendingSkillId] = useState(null);
  const handleTrySkill = (skillId) => { setDetailAgent(null); setNav('skills'); setPendingSkillId(skillId); onNavChange?.('skills'); };
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
  // Real, user-facing job deadline — see the matching comment in
  // AgentMarketplaceApp.web.jsx (kept in sync) and hireDeadline.js.
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEADLINE_DEFAULT_MINUTES);
  const deadlineError = validateDeadlineMinutes(deadlineMinutes);
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
  const { agents, setAgents, loading, error, confirmedFresh } = useMarketplaceAgents();
  // Real bug fix, 2026-08-26: this used to sit up near `sortKey` (right
  // after the state declarations, before `agents` itself existed yet) —
  // `agents` is a `const` from useMarketplaceAgents() below, and JS's
  // temporal dead zone means referencing a `const` before its own
  // declaration line throws ReferenceError, on every single render. That
  // crashed the ENTIRE mobile app (web was fine — there, `agents` happens
  // to be destructured near the top, before its own agentsWithPerf line,
  // so the same code never hit this). Real fix: declare it here, right
  // after `agents` itself, matching web's real ordering.
  const agentsWithPerf = useMemo(
    () => withCanaryStatus(withPerformance(agents, perfByOwner), canaryByOwner),
    [agents, perfByOwner, canaryByOwner]
  );

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
    setDeadlineMinutes(DEADLINE_DEFAULT_MINUTES); // fresh agent — don't carry a prior custom deadline over
  };

  // Real, last-chance escrow-compatibility gate, parity with web — see
  // EscrowCompatibilityWarning.jsx.
  const hireEscrowGate = useHireFlowEscrowGate(selectedAgent?.ownerAddress, selectedAgent?.id);

  const {
    hire, hireBatched, step: hireStep, error: hireError,
    completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps, stepHashes: hireStepHashes,
    notifySkipReason: hireNotifySkipReason,
  } = useHireAgent();
  // Real "sign once" batched alternative (2026-08-27), parity with web —
  // see useHireAgent.js's own top-of-file note for the full real
  // investigation. Step-by-step stays the default.
  const canBatchHire = useBatchHireCapability();
  const [signOnceForAllSteps, setSignOnceForAllSteps] = useState(false);
  const [activeHireMode, setActiveHireMode] = useState('stepwise');

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("We don't have an owner ID on record for this agent, so we can't hire it.");
      return;
    }
    if (deadlineError) return; // real bounds — the button itself is also disabled on this, see below
    try {
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
      // hireError from the hook is surfaced in the modal, no silent failure
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filtered = useMemo(() => {
    let list = agentsWithPerf.filter(a => a.name && a.name.trim().length > 2);
    // Group first (categoryGroups.js), then the specific category within it.
    if (activeGroup === 'Unclassified') {
      list = list.filter((a) => a.category === 'Unclassified' || groupForCategory(a.category) == null);
    } else if (activeGroup !== 'All') {
      list = list.filter((a) => groupForCategory(a.category) === activeGroup);
    }
    // Search AND category both apply together.
    list = list.filter((a) => activeCategory === 'All' || a.category === activeCategory);
    if (searchQuery) list = list.filter((a) => `${a.name} ${a.strategy}`.toLowerCase().includes(searchQuery));
    // Real filter: only agents whose registered endpoint answered a real
    // health-check (see core/agent_health.py) — the requested "let a user
    // filter to only see agents with a currently-responding endpoint".
    if (onlyResponding) list = list.filter((a) => a.serviceStatus === 'responding');
    // Real, honest opt-in narrowing to agents with a confirmed delivered
    // job (see agentVerification.js) — off by default.
    if (onlyVerified) list = list.filter((a) => getVerificationTier(a) === VERIFICATION_TIER.VERIFIED);
    // "Most hired" / "Highest success rate" — real tiered comparator; any
    // other value ('default') keeps the backend's own already-sorted order.
    const secondary = (sortKey === 'hireCount' || sortKey === 'winRate')
      ? performanceComparator(sortKey)
      : () => 0; // 'default': preserve the backend's own already-sorted order within each tier
    // Real verification tier ALWAYS sorts first — see the matching comment
    // in AgentMarketplaceApp.web.jsx (kept in sync).
    return [...list].sort(withVerificationTierFirst(secondary));
  }, [agentsWithPerf, activeGroup, activeCategory, searchQuery, onlyResponding, onlyVerified, sortKey]);

  // Real pagination, mobile pattern: "Load more" instead of web's numbered
  // pages — a narrow single-column layout makes small numbered tap targets
  // awkward, and appending is the familiar mobile-app convention (vs. a
  // desktop-style page-jump control). Same underlying real requirement as
  // web though: don't render the entire filtered list at once. 12/page —
  // smaller than web's 24 since these cards are full-width and taller
  // (one column, not three), so 12 already fills a real, substantial
  // screen's worth before "Load more" is needed. Purely client-side, same
  // reason as web: the full list is already in memory.
  const MOBILE_PAGE_SIZE = 12;
  const [visibleCount, setVisibleCount] = useState(MOBILE_PAGE_SIZE);
  useEffect(() => { setVisibleCount(MOBILE_PAGE_SIZE); }, [activeGroup, activeCategory, searchQuery, onlyResponding, onlyVerified, sortKey]);
  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Real per-group counts (categoryGroups.js) — matches web.
  const groupCounts = useMemo(() => {
    const counts = { Unclassified: 0 };
    for (const g of CATEGORY_GROUPS) counts[g.id] = 0;
    for (const a of agents) {
      const g = groupForCategory(a.category);
      if (g) counts[g] += 1; else counts.Unclassified += 1;
    }
    return counts;
  }, [agents]);

  // Fine-grained category chips scoped to the active group — matches web.
  const activeGroupCategories = useMemo(() => {
    if (activeGroup === 'All' || activeGroup === 'Unclassified') return [];
    const groupCats = CATEGORY_GROUPS.find((g) => g.id === activeGroup)?.categories || [];
    const present = new Set(agents.map((a) => a.category));
    return ['All', ...groupCats.filter((c) => present.has(c))];
  }, [agents, activeGroup]);
  useEffect(() => { setActiveCategory('All'); }, [activeGroup]);

  // Real, marketplace-wide tier counts + per-card tier-break markers — see
  // the matching comment in AgentMarketplaceApp.web.jsx (kept in sync).
  const tierCounts = useMemo(() => {
    const counts = { [VERIFICATION_TIER.VERIFIED]: 0, [VERIFICATION_TIER.RESPONDING]: 0, [VERIFICATION_TIER.UNPROVEN]: 0 };
    for (const a of filtered) counts[getVerificationTier(a)] += 1;
    return counts;
  }, [filtered]);
  const visibleTierBreaks = useMemo(() => {
    let lastTier = null;
    return visible.map((agent) => {
      const tier = getVerificationTier(agent);
      const isNewTier = tier !== lastTier;
      lastTier = tier;
      return isNewTier ? tier : null;
    });
  }, [visible]);

  // Same real stat cards as web (Agents Shown / Feedback / Verified).
  //
  // Real bug found and fixed (2026-08-27), matching web: `verified` used
  // isVerified (8004scan's own raw is_verified field, confirmed always
  // false across the real registry — always showed 0). Fixed to use
  // agentVerification.js's getVerificationTier over agentsWithPerf (has the
  // real jobsCompleted/jobsSubmitted signal merged in).
  const stats = useMemo(() => ({
    total: agentsWithPerf.length,
    verified: agentsWithPerf.filter((a) => getVerificationTier(a) === VERIFICATION_TIER.VERIFIED).length,
    totalFeedbacks: agentsWithPerf.reduce((sum, a) => sum + (a.totalFeedbacks || 0), 0),
  }), [agentsWithPerf]);

  return (
    <div className={`flex flex-col h-[100dvh] font-sans ${darkMode ? 'dark bg-[#0B101B] text-white' : 'bg-[#F4F5F8] text-gray-900'}`}>
      {showOnboarding && <OnboardingTour onClose={() => setShowOnboarding(false)} />}

      {/* App Header (Sticky) */}
      <header className="shrink-0 flex items-center justify-between px-5 py-4 bg-white/80 dark:bg-[#0F172A]/80 backdrop-blur-md border-b border-gray-200/50 dark:border-white/5 z-20 pt-safe">
        <div className="flex items-center gap-2">
          <a
            href="https://f2f-uzh.vercel.app"
            target="_blank"
            rel="noopener noreferrer"
            title="F2F Hub — all three projects in this portfolio"
            className="w-8 h-8 rounded-lg overflow-hidden block"
          >
            <img src={iconLogo} alt="Tnega" className="w-full h-full object-contain" />
          </a>
          <h1 className="text-lg font-bold tracking-tight">Tnega</h1>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          {onOpenEcosystem && (
            <button onClick={onOpenEcosystem} title="Ecosystem view" className="p-2 rounded-full bg-gray-100 dark:bg-white/10">
              <Globe size={16} />
            </button>
          )}
          <button onClick={() => setShowOnboarding(true)} title="How this works" className="p-2 rounded-full bg-gray-100 dark:bg-white/10">
            <HelpCircle size={16} />
          </button>
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
              <div className="mb-4">
                <AgentAvatar agent={selectedAgent} size={64} />
              </div>
              <h2 className="text-2xl font-bold mb-1">{selectedAgent.name}</h2>
              <p className="text-gray-500 text-sm mb-4">You'll approve a few quick steps in your wallet, tracked below as they happen.</p>

              {/* Real, last-chance gate, parity with web — see
                  EscrowCompatibilityWarning.jsx. */}
              {hireEscrowGate.node}

              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={16} className="text-indigo-500" />
                <span className="text-xs font-bold uppercase tracking-wide opacity-70">Always Ask</span>
              </div>

              <div className="space-y-6">
                {/* Unified "how much and how long" step (2026-09-09) — see
                    the matching comment in AgentMarketplaceApp.web.jsx
                    (kept in sync). */}
                <div className="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-white/[0.02] space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">How much are you funding this job for? <span className="font-normal text-gray-400" title="$U is a type of digital dollar — 1 $U is worth about $1.">($U, worth about $1 each)</span></label>

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

                {/* Real, user-facing job deadline (2026-09-09) — see the
                    matching comment in AgentMarketplaceApp.web.jsx (kept in
                    sync) and hireDeadline.js. Scoped to third-party hiring
                    only — Native Agents and Skills are atomic,
                    single-transaction actions with no delivery period. */}
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold mb-2"><Clock size={16} className="text-gray-400" /> How long does the agent have to deliver?</label>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {DEADLINE_PRESETS.map((p) => (
                      <button
                        key={p.minutes}
                        type="button"
                        onClick={() => setDeadlineMinutes(p.minutes)}
                        disabled={hireStep && !hireError}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${Number(deadlineMinutes) === p.minutes ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number" value={deadlineMinutes} disabled={hireStep && !hireError}
                    onChange={(e) => setDeadlineMinutes(e.target.value)}
                    className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono outline-none disabled:opacity-50"
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    {deadlineError
                      ? <span className="text-red-500">{deadlineError}</span>
                      : <>Minutes ({formatDeadline(deadlineMinutes)}). If the agent hasn't delivered by then, you can reclaim your funds — real minimum {DEADLINE_MIN_MINUTES} min, real maximum {formatDeadline(DEADLINE_MAX_MINUTES)}.</>}
                  </p>
                </div>
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
                        placeholder={`Hire via Tnega: ${selectedAgent.name}`}
                        rows={4}
                        className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-xs font-mono outline-none disabled:opacity-50"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Only for advanced users — this replaces the automatic description above with your own text, permanently recorded. Leave it blank unless you have a specific reason to use this.</p>
                    </div>
                  )}
                </div>

                {/* Real "sign once" toggle (2026-08-27) — parity with web,
                    only ever shown once canBatchHire genuinely confirms
                    real batch support for the connected wallet. */}
                {!hireStep && canBatchHire === CAN_BATCH_HIRE_STATUS.supported && (
                  <div className="mb-3 flex items-center justify-between gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]">
                    <div>
                      <div className="text-xs font-semibold">{signOnceForAllSteps ? 'Sign once for all steps' : 'Sign each step individually'}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {signOnceForAllSteps
                          ? 'Your wallet supports this — one signature covers the on-chain steps after the job is created.'
                          : "You'll approve each real on-chain step one at a time — the default."}
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
                {!hireStep && canBatchHire === CAN_BATCH_HIRE_STATUS.unsupported && (
                  <p className="mb-3 text-[11px] text-gray-400">
                    "Sign once for all steps" isn't available for your connected wallet — signing each step individually below.
                  </p>
                )}

                {/* Real step checklist — identical logic to web, via the
                    same shared buildHireStepList/buildBatchHireStepList
                    helpers (useHireAgent.js), so the two can't drift on
                    what each step actually means. */}
                {hireStep && (
                  <div className="p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A]">
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

                <button onClick={handleActivateSession} disabled={(hireStep && hireStep !== 'done' && !hireError) || hireEscrowGate.blocked || !!deadlineError} className="w-full py-4 rounded-xl font-bold text-white bg-indigo-600 active:scale-[0.98] transition-transform disabled:opacity-50">
                  {hireStep === 'done' ? 'HIRED ✓' : hireError ? 'TRY AGAIN' : hireEscrowGate.blocked ? 'CHECK THE BOX ABOVE' : deadlineError ? 'FIX THE DEADLINE ABOVE' : 'HIRE'}
                </button>
              </div>
            </div>
          </div>
        ) : detailAgent ? (
          <AgentDetailMobile
            agent={detailAgent}
            onBack={closeAgentDetail}
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

                {/* Real stat cards (parity with web). The diversity-limit note and
                    badge legend used to each be a permanent paragraph stacked below
                    here — now behind small on-demand (i) icons instead, same real
                    meaning, no permanent space. */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {[
                    { label: 'Listed', value: stats.total, icon: Activity, color: '#2563EB', info: (
                      <>This is a varied mix, not every agent that exists. Most agents here were created in a few
                      big signup batches and look nearly identical, so we limit how many near-duplicates show up —
                      there are more agents out there, we're just not cluttering your view with lookalikes.</>
                    ) },
                    { label: 'On-chain Feedback', value: stats.totalFeedbacks, icon: MessageSquare, color: '#059669', hint: 'On-chain ERC-8004 feedback entries recorded against these agents. Counts only — no written text and no star rating, so there is nothing to read behind the number. Most of it comes from one automated cluster rather than many independent buyers.' },
                    { label: 'Verified', value: stats.verified, icon: Users, color: '#7C3AED', hint: "Has at least one real, on-chain-confirmed delivered job — not just registered on-chain (see 'How we verify agents' below)" },
                  ].map((c) => {
                    const Icon = c.icon;
                    return (
                      <div key={c.label} title={c.hint} className="bg-white dark:bg-[#1E293B] p-3 rounded-2xl border border-gray-100 dark:border-gray-800 text-center">
                        <Icon size={16} className="mx-auto mb-1" style={{ color: c.color }} />
                        {/* Real fix (2026-08-27): only render the real,
                            confirmed-fresh count — a skeleton until then,
                            never a stale cached number that later jumps. */}
                        {confirmedFresh ? <div className="text-lg font-bold">{c.value.toLocaleString()}</div> : <StatSkeleton />}
                        <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5">
                          {c.label}
                          {c.info && <InfoTooltip label="" size={11} align="right">{c.info}</InfoTooltip>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Real, permanently-accessible explainer (2026-08-27) —
                    parity with web. See VerificationExplainerSection.jsx. */}
                <VerificationExplainerSection className="mb-4" />

                <div className="mb-4">
                  <InfoTooltip label="What does the live 'Online now' badge mean?" size={12}>
                    <div className="space-y-2">
                      <p><strong>Online now</strong> — we just reached this agent's endpoint and it answered. No checkmark just means we haven't confirmed that recently, not that it's broken. Either way, it's not a quality signal by itself — see "How we verify agents" above for what actually counts as proof.</p>
                    </div>
                  </InfoTooltip>
                </div>

                <div className="mb-3 relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search by name, id, or address…" className="w-full pl-10 pr-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-sm outline-none" />
                </div>

                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  title="Ranks agents with an actual hire history first; agents with none yet are listed after, not mixed in"
                  className="mb-3 w-full px-4 py-3 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-sm outline-none"
                >
                  <option value="default">Sort: Top score</option>
                  <option value="hireCount">Sort: Most hired</option>
                  <option value="winRate">Sort: Highest success rate</option>
                </select>

                {(sortKey === 'hireCount' || sortKey === 'winRate') && (
                  <div className="mb-4 flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800">
                    <Activity size={13} className="shrink-0 mt-0.5 text-indigo-500" />
                    <span>
                      Ranked by on-chain hire history{sortKey === 'hireCount' ? ', most jobs first' : ', highest success rate first'}.
                      Agents with no hires yet are listed after those with one, not mixed in.
                    </span>
                  </div>
                )}

                <div className="mb-4 flex items-center gap-2 flex-wrap pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-1 shrink-0 w-full">Filters</span>
                  <button
                    onClick={() => setOnlyVerified((v) => !v)}
                    className={`px-3.5 py-2 rounded-xl text-[11px] font-medium border transition-colors ${
                      onlyVerified
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400'
                        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-gray-600 dark:text-gray-300'
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
                        : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-[#1E293B] text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {onlyResponding ? '✓ ' : ''}Only show online agents
                  </button>
                </div>

                {/* Real, honest failure state (2026-08-27) — see the
                    matching comment on AgentMarketplaceApp.web.jsx. */}
                {perfStatus === 'error' && (
                  <div className="mb-3 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={12} className="shrink-0" />
                    Couldn't load real hire-history data — filters/sorts using it may be inaccurate.
                    <button onClick={retryPerf} className="underline font-medium">Try again</button>
                  </div>
                )}

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

                {/* Two-tier category filter (categoryGroups.js) — group
                    first, real fine-grained categories only shown once a
                    group is picked. Matches web. */}
                <div className="flex overflow-x-auto pb-3 -mx-5 px-5 gap-2 snap-x hide-scrollbar">
                  <button onClick={() => setActiveGroup('All')} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                    activeGroup === 'All' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'
                  }`}>All</button>
                  {/* Real fix (2026-08-27), matches web: same
                      confirmedFresh gate as the header stats — '…' instead
                      of a count that might be a stale, pre-fetch number. */}
                  {CATEGORY_GROUPS.map((g) => (
                    <button key={g.id} onClick={() => setActiveGroup(g.id)} title={g.categories.join(', ')} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                      activeGroup === g.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'
                    }`}>
                      {g.label} ({confirmedFresh ? (groupCounts[g.id] || 0) : '…'})
                    </button>
                  ))}
                  <button onClick={() => setActiveGroup('Unclassified')} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                    activeGroup === 'Unclassified' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'
                  }`}>
                    Unclassified ({confirmedFresh ? (groupCounts.Unclassified || 0) : '…'})
                  </button>
                </div>

                {activeGroupCategories.length > 0 && (
                  <div className="flex overflow-x-auto pb-4 -mx-5 px-5 gap-2 snap-x hide-scrollbar">
                    {activeGroupCategories.map((cat) => (
                      <button key={cat} onClick={() => setActiveCategory(cat)} title={CATEGORY_HINTS[cat]} className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-medium snap-start transition-colors ${
                        activeCategory === cat ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400'
                      }`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {!loading && filtered.length > 0 && (
                  <div className="text-xs text-gray-400 mb-3">
                    Showing {visible.length} of {filtered.length.toLocaleString()} agents
                  </div>
                )}

                {/* Real, live search fallback (2026-08-29) — mirrors web
                    exactly, see UniversalSearchFallback.jsx and
                    docs/universal-search.md. */}
                {!loading && filtered.length === 0 && searchQuery && (
                  <div className="mb-5">
                    <UniversalSearchFallback
                      query={searchQuery}
                      agentsWithPerf={agentsWithPerf}
                      onOpenAgent={(agent) => openAgentDetail(agent)}
                      accent={accent}
                      mutedBorder="border-gray-200 dark:border-gray-800"
                      darkMode={darkMode}
                      plainEmptyMessage={`Nothing matches "${searchInput.trim()}" by name. If you're looking for a specific agent, try its exact id instead of its name — or paste a wallet or contract address.`}
                    />
                  </div>
                )}

                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-indigo-500" /></div>
                ) : (
                  <div className="space-y-4">
                    {visible.map((agent, i) => (
                      <React.Fragment key={agent.id}>
                        {visibleTierBreaks[i] && (
                          <VerificationTierDivider tier={visibleTierBreaks[i]} count={tierCounts[visibleTierBreaks[i]]} className={i === 0 ? '' : 'pt-2'} />
                        )}
                      <div onClick={() => openAgentDetail(agent)} className="bg-white dark:bg-[#1E293B] rounded-3xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col cursor-pointer">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                            <AgentAvatar agent={agent} size={36} rounded="rounded-xl" />
                            <div>
                              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">{agent.category}</span>
                              <h3 className="text-lg font-bold flex items-center gap-1">{agent.name}{agent.isVerified && <BadgeCheck size={14} className="text-indigo-500" />}</h3>
                            </div>
                          </div>
                          <span className="text-[10px] px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 font-medium">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
                        </div>

                        <div className="mb-3 flex flex-wrap items-center gap-1.5">
                          {agent.serviceStatus && agent.serviceStatus !== 'unknown' && (
                            <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} />
                          )}
                          <VerificationBadge agent={agent} />
                        </div>

                        <div className="flex gap-4 mb-2">
                          <div title="How trustworthy this agent looks, based on past feedback"><span className="text-[10px] text-gray-500 uppercase block">Score</span><span className="font-bold text-sm">{agent.totalScore?.toFixed(1) || '—'}</span></div>
                          <div title="Total money this agent currently manages for people"><span className="text-[10px] text-gray-500 uppercase block">Funds</span><span className="font-bold text-sm">{agent.tvlUsd ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '-'}</span></div>
                        </div>

                        {/* Real on-chain hire track record — same data the
                            sort dropdown ranks by, shown here regardless of
                            which sort is active. */}
                        <div className="mb-4 text-[11px] text-gray-500 dark:text-gray-400" title={perfIndexComplete ? "ERC-8183 job history for this agent: the complete on-chain history, not a recent-only window" : "ERC-8183 job history for this agent: a one-time backfill of the complete history is still catching up"}>
                          {agentHasRealHistory(agent, 'hireCount')
                            ? <>{agent.hireCount} {agent.hireCount === 1 ? 'hire' : 'hires'}{agent.winRate != null ? ` · ${Math.round(agent.winRate * 100)}% success` : ''}</>
                            : <span className="text-gray-400 dark:text-gray-500">No hires yet</span>}
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
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {!loading && visibleCount < filtered.length && (
                  <button
                    onClick={() => setVisibleCount((v) => v + MOBILE_PAGE_SIZE)}
                    className="w-full mt-5 py-3.5 rounded-2xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 active:scale-[0.98] transition-transform"
                  >
                    Load more agents
                  </button>
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
                  <p className="text-sm text-gray-500">3 tasks, each done two ways: once using an agent, once by hand, so you can see the actual time, cost, and quality difference for yourself.</p>
                </div>
                <AdvantageReport />
              </div>
            )}

            {nav === 'sell' && <SellYourAgentForm />}

            {nav === 'learn' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Learn</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">What each agent does, and what you're granting.</p>
                </div>

                <div className="space-y-3">
                  {LEARN_TOPICS.map((item, i) => (
                    item.custom ? (
                      <item.custom key={i} />
                    ) : (
                    <div key={i} className="bg-white dark:bg-[#1E293B] rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="font-bold text-sm mb-1">{item.h}</div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{item.p}</div>
                      {item.tech && <div className="text-[12px] text-gray-400 dark:text-gray-500 leading-relaxed mt-1.5">Technical details, if you want them: {item.tech}</div>}
                      {item.Diagram && (
                        <div className="mt-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800">
                          <item.Diagram compact />
                        </div>
                      )}
                      {item.src && <a href={item.src.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline mt-1.5 inline-block">Source: {item.src.label} →</a>}
                    </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* Real, own top-level tab (2026-08-29) — see NAV_ITEMS' own
                comment above for the full reasoning this was moved out of
                "Build" for. Same AltanaSkillsPanel web uses, verbatim. */}
            {nav === 'skills' && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold mb-1">Skills</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">Pre-built, audited on-chain actions you run yourself: supply into Venus, trade on PancakeSwap, and more, through your own connected wallet or a spend-capped mini-wallet.</p>
                <p className="text-[11px] text-gray-400">Different from hiring an agent from the Market tab: there's no job, no delivery to wait on, and no third party doing the work on your behalf. This runs directly, right now, within a limit you set.</p>

                <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                  <AltanaSkillsPanel accent={accent} surface={darkMode ? '#1E293B' : '#FFFFFF'} mutedBorder="border-gray-200 dark:border-gray-800" darkMode={darkMode} initialSkillId={pendingSkillId} onConsumedInitialSkill={() => setPendingSkillId(null)} />
                </div>
              </div>
            )}

            {/* Real, own top-level tab (2026-09-01) — mirrors web's
                identical NativeAgentMarketplace section, verbatim. */}
            {nav === 'native' && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold mb-1">Native Agent Marketplace</h2>
                <p className="text-sm text-gray-600 dark:text-gray-300">Tnega's own designed agents: autonomous, multi-factor decisions, not a hired third party and not a plain pass-through Skill.</p>
                <p className="text-[11px] text-gray-400">Each agent evaluates candidate protocols itself (liquidity/risk first, yield second) and shows you exactly why it picked what it picked, before you sign anything.</p>

                <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                  <NativeAgentMarketplace accent={accent} surface={darkMode ? '#1E293B' : '#FFFFFF'} mutedBorder="border-gray-200 dark:border-gray-800" darkMode={darkMode} />
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
                  <p className="text-xs text-gray-500 dark:text-gray-400">Right now, this tool only builds agents that earn money by doing jobs for others (not ones that hire other agents themselves). The free build trial runs on a practice network; hiring agents in the Marketplace spends actual money on mainnet.</p>
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

        <div className="px-5">
          <DataSourcesFooter onOpenDataSources={onOpenDataSources} />
          <HackathonPartnersFooter onOpenPartners={onOpenPartners} />
          <DocsFooter onOpenDocs={onOpenDocs} />
        </div>
      </main>

      {/* App-like Bottom Navigation */}
      {/* Frosted-glass bottom bar (2026-09-04). Matches the header's existing
          translucent + backdrop-blur treatment rather than inventing a new
          material, so the two edges of the app read as the same surface.
          Explicit light AND dark values (not a single translucent white)
          because a blur over a dark page needs its own tint to stay legible. */}
      <nav className="shrink-0 bg-white/75 dark:bg-[#0B101B]/75 backdrop-blur-xl border-t border-gray-200/60 dark:border-white/10 pb-safe z-20 supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-[#0B101B]/60">
        <div className="flex justify-around items-center px-2 pt-2 pb-1">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setNav(item.id); setHiring(false); onNavChange?.(item.id); }}
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
      {walletSheetOpen && <MobileWalletSheet onClose={() => setWalletSheetOpen(false)} nav={nav} onNavigate={(id) => { setNav(id); setHiring(false); onNavChange?.(id); }} />}
      
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