import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ShieldAlert, ShieldCheck, Sliders, CheckCircle2, XCircle,
  LayoutGrid, Table2, Store, ArrowUpDown, ChevronRight,
  Loader2, AlertTriangle, Wallet, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, ExternalLink, Zap, Coins, Search, Bell, Briefcase, HelpCircle, Bot, Clock, CreditCard, Plug, Compass,
} from 'lucide-react';
// The clay app mark, used by the QR code below (QrToMobile).
import iconLogo from './assets/app-icon.png';

import { QRCodeCanvas } from 'qrcode.react';
import NotificationBell from './NotificationBell';
import { useNavSync, useOverlayHistory } from './useViewHistory';
import { addNotification, trackJob, getActiveWallet } from './notifications';
import { recordFunded } from './jobTiming';
import BuyAccessPanel from './BuyAccessPanel';
import PasskeyBadge from './PasskeyBadge';
import ServiceHealthBadge, { serviceRank } from './ServiceHealthBadge';
import { CATEGORY_HINTS } from './categoryHints';
import { agentShareUrl, copyShareLink, readDeepLinkAgentId, matchesDeepLink, agentPath } from './shareLink';
import {
  useMarketplacePage, useMarketplaceFacets, fetchAgentById, useLatch,
  groupCountsFromFacets, hackathonCountsFromFacets, SERVE_READ_CAP,
} from './marketplaceQuery';
import { updatePageMeta } from './seoMeta';
import ChainViewTabs, { resetChainChoice } from './chainViews/ChainViewTabs';
import HireModePicker, { HIRE_MODE } from './HireModePicker';
import BudgetHirePanel from './BudgetHirePanel';
import { useBudgetModeStatus } from './budgetEscrow';
import { useAgentPerformanceBulk } from './useAgentPerformanceBulk';
import { useCanaryStatus } from './useCanaryStatus';
import { withPerformance, withCanaryStatus, performanceComparator, agentHasRealHistory } from './agentRanking';
import { getVerificationTier, VERIFICATION_TIER, VERIFICATION_LABEL, VERIFICATION_LABEL_SHORT, VERIFIED_MEANING, withVerificationTierFirst } from './agentVerification';
import VerificationBadge, { VerificationTierDivider } from './VerificationBadge';
import VerificationExplainerSection from './VerificationExplainerSection';
import DeliveryProvenance from './DeliveryProvenance';
import { CATEGORY_GROUPS, groupForCategory } from './categoryGroups';
import { HACKATHON_CATEGORIES, hackathonForCategory } from './hackathonCategories';
import InfoTooltip from './InfoTooltip';
import { useHireFlowEscrowGate, useEscrowCompatibility } from './EscrowCompatibilityWarning';
import UniversalSearchFallback from './UniversalSearchFallback';
import AgentMetrics from './AgentMetrics';
import QualityCenterPanel from './QualityCenterPanel';
import ContractVerificationBadge from './ContractVerificationBadge';
import Pagination from './Pagination';

// QR linking to this same (responsive) site, a phone opens the mobile app.
// Level H (30% error correction) tolerates the centered, excavated logo.
function QrToMobile() {
  const url = import.meta.env?.VITE_MOBILE_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
  return (
    <div className="bg-surface p-3 rounded-md border border-line flex items-center gap-3 lg:w-72 shrink-0">
      {/* 120px code, 24px mark, 4-module quiet zone.
          This did not scan at all before, confirmed by decoding the live
          canvas rather than assuming: it returned nothing.
          What matters is the RATIO of mark to code, and it was measured with
          the real payload. An earlier probe used the dev server's own URL and
          was misleading: a different string produces a different module
          pattern, so the same mark destroys a different amount of data.
          Against the production URL: 28/128 and 34/148 decode, 32/128 and
          40/148 do not. The limit sits near 22% of the code's width.
          24/120 is 20%, inside that with room to spare, because a phone
          camera at an angle in poor light has a harder job than a decoder
          reading clean pixels.
          marginSize is 4 rather than 3, which is the quiet zone the spec
          asks for. The code is smaller than before so this card, which sets
          the height of the whole stats band, gets shorter with it. */}
      <div className="bg-white p-1.5 rounded-lg shrink-0">
        <QRCodeCanvas
          value={url}
          size={120}
          level="H"
          marginSize={4}
          bgColor="#ffffff"
          fgColor="#0B101B"
              imageSettings={{ src: iconLogo, height: 24, width: 24, excavate: true }}
        />
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold">Open on your phone</div>
        <div className="text-xs text-muted">Scan to launch the mobile app.</div>
      </div>
    </div>
  );
}
import { useHireAgent, buildHireStepList, buildBatchHireStepList, useAgentQuote, useBatchHireCapability, CAN_BATCH_HIRE_STATUS } from './useHireAgent';
import { DEADLINE_MIN_MINUTES, DEADLINE_MAX_MINUTES, DEADLINE_DEFAULT_MINUTES, DEADLINE_PRESETS, formatDeadline, validateDeadlineMinutes } from './hireDeadline';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import MyJobsPanel from './MyJobsPanel';
import AgentAvatar from './AgentAvatar';
import InteractionLine from './InteractionLine';
import DeliveryRecord from './DeliveryRecord';
import BudgetRecord from './BudgetRecord';
import SiteLinks from './SiteLinks';
import ThemeToggle from './theme/ThemeToggle';
import HeaderNav from './shell/HeaderNav';
import Wordmark from './shell/Wordmark';
import TopSearch from './shell/TopSearch';
import { PRODUCT_NAV } from './shell/productNav';
import Dashboard from './pages/Dashboard';
import Stocks from './pages/Stocks';
import Vaults from './pages/Vaults';
import MyEtfs from './pages/MyEtfs';
import UseWithAi from './pages/UseWithAi';
import { BnbPriceSource } from './shell/DataAttribution';
import WalletIdentity from './wallet/WalletIdentity';
import { useConnectedWallet } from './wallet/useConnectedWallet';
import { useSignIn } from './wallet/SignInProvider';
import { useTheme } from './theme/ThemeProvider';
import { ChainCardBadge } from './chainViews/chainMarks';
import { useBnbQuote, labelledBnbUsd, formatBnbWithUsd } from './useBnbPrice';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain' }; // mainnet-only

// Bumped to v2 (2026-08-26): real, decisive investigation into a reported
// "Zerion portfolio button missing on web" bug found NO code-level
// divergence between web and mobile, a headless render of both
// AgentDetail components with identical mock data produced byte-identical
// button markup on both. The most plausible remaining explanation is the
// same failure mode this project has hit before (see mapAgent's own
// "Parity fix" comment below): a stale 24h client cache on whichever
// device was tested holding agent data from before some field was
// correctly populated. Bumping the version forces every client to refetch
// once, clearing any such stale state regardless of the exact cause.
// Renamed to 'tnega-cache-v1' for the Tnega rebrand (2026-08-28), a fresh
// key name, not just another version bump, since the old name literally
// spelled out the old brand. Same effect as the earlier v1->v2 bump:
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
    // Carried through as-is. This mapper renames the API's snake_case into
    // the shape the app uses, and anything it does not name is dropped: that
    // is why the interaction sentence rendered on the chain views and nowhere
    // on BNB Chain until this line existed.
    interaction: a.interaction,
    financialDataAvailable: a.financial_data_available, tvlUsd: a.tvl_usd,
    defillamaUrl: a.defillama_url, ownerBnbBalance: a.owner_bnb_balance,
 // Real, added 2026-08-29, same DefiLlama match, zero extra API calls.
 // tvlChange7dPct: TVL momentum. auditCount: DefiLlama's own real
 // disclosed audit count (0 is a real, signal, not missing data).
 // tvlDataFlagged: DefiLlama's own misrepresentedTokens flag,
    // their own "this TVL may not be trustworthy" signal, surfaced as-is.
    tvlChange7dPct: a.tvl_change_7d_pct, auditCount: a.audit_count,
    tvlDataFlagged: a.tvl_data_flagged, mcapUsd: a.mcap_usd,
    possiblyDelisted: a.possibly_delisted, session: null,
 // Real, server-checked service-liveness signal, see core/agent_health.py.
    serviceStatus: a.service_status || null, serviceEndpoint: a.service_endpoint || null,
    serviceCheckedAt: a.service_checked_at || null, serviceRank: serviceRank(a.service_status),
  };
}

// The backend is OOM-killed by its 512Mi cap roughly 0.4 times an hour and
// restarts in seconds (see docs/memory-ceiling.md). A single fetch that
// happens to land in one of those windows fails, and with no cached data
// the whole marketplace rendered an error with every count at 0, even
// though the backend was back moments later.
//
// So the list fetch retries instead of giving up on the first failure.
// Delays are short because a restart is short; four attempts span about
// 17 seconds, which comfortably covers it. This is the same discipline
// useResilientFetch already applies to the per-agent panels, applied to
// the one fetch that decides whether the page has any content at all.
const AGENT_FETCH_RETRY_MS = [1500, 4000, 11000];

// Real, placeholder for a stat number that isn't confirmed-fresh yet
// (see useMarketplacePage's confirmedFresh in marketplaceQuery.js), a
// pulsing bar, never a
// number that might be wrong.
function StatSkeleton() {
  return <div className="h-7 w-14 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />;
}

// Styled exactly like the "WEB3 WALLET MANAGER" from the provided image
const BSCSCAN = 'https://bscscan.com';

function DetailStat({ label, value, hint }) {
  return (
    <div title={hint} className="text-center p-3 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-line/50">
      <span className="block text-[10px] text-gray-500 uppercase mb-1">{label}</span>
      <span className="font-bold text-sm text-fg">{value}</span>
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

// Full agent detail view, everything the aggregated 8004scan/DefiLlama data
// holds for one agent. Shown full-screen in the market tab, matching
// the hire-flow navigation pattern.
function AgentDetail({ agent, onBack, onHire, onTrySkill }) {
  const [copied, setCopied] = useState(false);
  const bnbQuote = useBnbQuote();
  // A dollar value only when the answer is the labelled on-chain average;
  // otherwise the balance is shown in BNB alone.
  const bnbUsdPrice = labelledBnbUsd(bnbQuote);
  const onShare = async () => {
    const ok = await copyShareLink(agentShareUrl(agent));
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };
  return (
    <div className="w-full mt-4">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
          <ChevronRight size={16} className="rotate-180" /> Back to Explore
        </button>
        {/* Shareable per-agent link, send a client straight to this agent. */}
        <button onClick={onShare} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
          <Link2 size={14} /> {copied ? 'Link copied!' : 'Share this agent'}
        </button>
      </div>
      <div className="bg-surface rounded-md p-8 border border-line shadow-xl">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <AgentAvatar agent={agent} size={56} />
            <div>
              <div className="flex items-center gap-2"><h2 className="text-h1 font-bold">{agent.name}</h2>{agent.isVerified && <BadgeCheck size={18} className="text-indigo-500" />}</div>
              <div className="flex items-center gap-2 mt-1">
                <span title={CATEGORY_HINTS[agent.category]} className="text-[11px] text-indigo-500 uppercase font-semibold tracking-wider">{agent.category}</span>
                {agent.possiblyDelisted && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400" title="Not seen active in over a week">may no longer be active</span>}
              </div>
            </div>
          </div>
          <span className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 shrink-0">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <DetailStat label="Score" hint="How trustworthy this agent looks, based on past feedback. Higher is better." value={agent.totalScore != null ? agent.totalScore.toFixed(1) : 'n/a'} />
          <DetailStat label="Stars" hint="How many people rated this agent" value={agent.starCount ?? 'n/a'} />
          <DetailStat label="On-chain Feedback" hint="On-chain ERC-8004 feedback entries for this agent. A count only, with no written text or rating behind it" value={agent.totalFeedbacks ?? 'n/a'} />
          <DetailStat label="Funds" hint="Total money this agent currently manages for people" value={agent.financialDataAvailable && agent.tvlUsd != null ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : 'n/a'} />
        </div>
        {agent.financialDataAvailable && agent.defillamaUrl && (
          <div className="mb-5">
            <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 hover:underline inline-flex items-center gap-1">Where this money number comes from: DefiLlama <ExternalLink size={11} /></a>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-muted">
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
                <span>DefiLlama flags this protocol's reported funds as possibly unrepresentative of its value.</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 my-5">
          {agent.isVerified && <DetailBadge icon={BadgeCheck} hint="Registered on-chain, not a quality rating">Verified</DetailBadge>}
          {agent.x402Supported && <DetailBadge icon={Zap} hint="Can pay other agents automatically for tools or data it needs, without a person approving each payment">Pays other agents automatically</DetailBadge>}
          {(agent.supportedProtocols || []).map((p) => <DetailBadge key={p} icon={Coins} hint={`Works with ${p}, an app it can act on for you`}>{p}</DetailBadge>)}
          <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} size="md" />
          {(!agent.serviceStatus || agent.serviceStatus === 'unknown') && (
            <span className="text-[11px] text-gray-400" title="Not checked yet, or the last check didn't go through">Not confirmed online yet</span>
          )}
        </div>
        {agent.serviceEndpoint && (
          <p className="text-[11px] text-gray-400 mb-2 -mt-3 break-all" title="The web address we contact to check whether this agent is turned on">Where we check on it: <span className="font-mono">{agent.serviceEndpoint}</span></p>
        )}

        {/* Same sentence as the card, same component, so moving between
            the list and this page cannot change what an agent means. */}
        <InteractionLine interaction={agent.interaction} className="mb-5"
          deliveredCount={(agent.jobsCompleted ?? 0) + (agent.jobsSubmitted ?? 0)} />

        {/* Who paid for the deliveries behind the tier. Renders nothing for an
            agent nobody has hired. */}
        <DeliveryProvenance agent={agent} className="mb-5" />

        <DeliveryRecord agent={agent} className="mb-5" />
        {/* BNB Chain has both hire paths, so it gets both records. The
            ERC-8183 one above covers escrow jobs; this covers drawable
            budgets, which the job index cannot see at all. */}
        <BudgetRecord agent={agent} className="mb-5" />

        <h3 className="text-sm font-bold mb-2">About</h3>
        <p className="text-sm text-muted leading-relaxed mb-6 whitespace-pre-wrap">{agent.strategy}</p>

        <h3 className="text-sm font-bold mb-2 flex items-center gap-2">Who owns this agent <PasskeyBadge ownerAddress={agent.ownerAddress} /> {agent.id && <ContractVerificationBadge agentId={agent.id} />}</h3>
        {agent.ownerAddress ? (
          <>
            <a href={`${BSCSCAN}/address/${agent.ownerAddress}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-indigo-500 hover:underline inline-flex items-center gap-1 break-all">
              {agent.ownerAddress} <ExternalLink size={11} className="shrink-0" />
            </a>
            <p className="text-[11px] text-gray-400 mt-1">This is the agent creator's wallet ID. A public account number anyone can look up, like a bank account number that's safe to share. Tap it to see its full activity record.</p>
          </>
        ) : (
          <p className="text-xs text-gray-400">We don't have an owner ID on record for this agent.</p>
        )}

 {/* A live number distinct from "Funds": the owner wallet's BNB
            (the network's own currency) balance. Deliberately labeled and
            placed apart from the "Funds" stat above so the two are never
            confused with one another. */}
        <div className="mt-4 flex items-center justify-between p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20">
          <span className="text-xs text-muted flex items-center gap-1.5" title="BNB is this network's own currency, used to pay small network fees. This is how much the owner's wallet holds right now, checked live, this instant."><Wallet size={13} /> Owner's wallet balance <span className="text-[10px] text-gray-400">(in BNB)</span></span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-sm font-semibold">
              {agent.ownerBnbBalance != null ? formatBnbWithUsd(agent.ownerBnbBalance, bnbUsdPrice) : <span className="text-muted font-normal">not available</span>}
            </span>
            {/* What the dollar figure is: the on-chain BNB/USD average, its
                label, window and block. Shown only when a dollar value is. */}
            {agent.ownerBnbBalance != null && bnbUsdPrice != null && <BnbPriceSource quote={bnbQuote} className="text-right" />}
          </span>
        </div>
 {/* Real, final, unified "Metrics" presentation, interaction
            guidance (hire / hire-with-caution / visit-website, per the
 real, evidence-based per-agent classification) leading, then
 metrics routed and ordered by the agent's nature
 (fund-management agents lead with cash flow/profit;
 everyone else leads with delivery history). Replaces the
            two separate sections this session built in sequence
            (AgentEvaluationSection, AgentInvestigationSection), see
            AgentMetrics.jsx's own header for the full consolidation
            rationale. The harder, last-chance gate still lives in the
 funding modal (handleHireClick → useHireFlowEscrowGate),
 right before money moves. */}
        <AgentMetrics agent={agent} onHire={onHire} onTrySkill={onTrySkill} />

        {agent.id && <QualityCenterPanel agentId={agent.id} />}

        {agent.tokenId != null && <BuyAccessPanel agentId={String(agent.tokenId)} />}
      </div>
    </div>
  );
}

function SortHeader({ label, hint, sortKey, sortState, onSort }) {
  const active = sortState.key === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} title={hint} className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold transition-colors ${active ? 'text-fg' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
      {label}
      <ArrowUpDown size={12} className={active ? 'opacity-100' : 'opacity-40'} />
    </button>
  );
}

// The main navigation is the product's five pages, shared with the mobile
// bottom bar through shell/productNav.js so the two cannot drift. Explore
// (/market) and My Agents (/my-agents) are still tabs of this component, and
// are reached from the footer (SiteLinks.jsx).
const NAV_ITEMS = PRODUCT_NAV;

export default function AgentMarketplaceApp({ onOpenEcosystem, onOpenDataSources, onOpenPartners, onOpenDocs, onNavigate, path = '/', query = '', initialNav, onNavChange } = {}) {
  // The theme is the site's, not this component's: see theme/ThemeProvider.jsx.
  // `darkMode` is still handed to the few panels that take it as a prop.
  const { dark: darkMode } = useTheme();
  // The first-visit tour (OnboardingTour.jsx) is no longer opened here: it
  // walked through the agent tabs (Learn, Report, Build, Sell), which left the
  // navigation on 2026-09-25, so it pointed at pages that now redirect.
 // per-tab URL routing: `nav` still lives here (every existing
  // `nav === '...'` check throughout this file keeps working unchanged),
  // but it's now seeded from, and kept in sync with, the URL App.jsx
  // owns, via `initialNav`/`onNavChange`. A user clicking a tab still gets
  // the same instant local setNav() below; onNavChange (see NAV_ITEMS click
 // handler) is what pushes that choice into a real, bookmarkable URL.
  // Browser back/forward changes `initialNav` from outside, which the
  // effect below resyncs onto `nav`.
  const [nav, setNav] = useState(initialNav || 'dashboard');
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
 // Back-button support (2026-09-04). Opening an agent pushes a real
  // history entry and Back closes it, returning to the list underneath;
  // and the tab view follows the URL when Back/Forward changes it, which
  // it previously did not (initialNav was only ever read at mount).
  // See useViewHistory.js for the full reasoning.
  const [openAgentDetail, closeAgentDetail, dismissAgentDetail] = useOverlayHistory(detailAgent, setDetailAgent, 'agentDetail', '/market');
  // Follow the URL when Back/Forward changes it. `initialNav` is only read
  // by useState at mount, so without this the address bar moved but the
  // view did not -- the core of the "Back exits the site" bug.
  useNavSync(initialNav, nav, setNav);
  // An open agent is its own page as far as search is concerned, so it says
  // so. Without this every agent inherited the homepage's title, description
  // and canonical URL, which told Google that ~14,900 distinct pages were all
  // duplicates of "/" -- the long tail of this site asking not to be indexed.
  //
  // Written from the agent itself rather than a route table, because the
  // useful words are its own name and what it claims to do, and those are
  // only known once it has loaded. Closing the overlay changes the path,
  // which re-runs App.jsx's route effect and restores the list's meta.
  useEffect(() => {
    if (!detailAgent) return;
    const name = detailAgent.name || `Agent #${detailAgent.tokenId ?? ''}`.trim();
    // `network` is not a chain name: on a BSC agent it reads "mainnet", which
    // produced titles like "Buyback Agent, an AI agent on mainnet". This view
    // is the BNB Chain marketplace, so anything that is not already a proper
    // name gets the real one.
    const raw = (detailAgent.network || '').trim();
    const chain = (!raw || /^(main|test)net$/i.test(raw)) ? 'BNB Chain' : raw;
    const own = (detailAgent.strategy || '').replace(/\s+/g, ' ').trim();
    updatePageMeta({
      docTitle: `${name}, an AI agent on ${chain} | Tnega`,
      description: own
        ? (own.length > 155 ? `${own.slice(0, 152)}\u2026` : own)
        : `${name} is an ERC-8004 agent on ${chain}. See its verification status, delivery record and hire it on-chain through Tnega.`,
      path: agentPath(detailAgent),
    });
  }, [detailAgent]);

  const [hiring, setHiring] = useState(false);
  const [spendCap, setSpendCap] = useState(50000);
  const [spendCapTouched, setSpendCapTouched] = useState(false);
 // Real, user-facing job deadline (2026-09-09), previously hardcoded to
  // DEADLINE_DEFAULT_MINUTES inside useHireAgent.js with no UI control at
  // all. Defaulting to that same value here preserves the exact prior
 // behavior for anyone who never touches this field.
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEADLINE_DEFAULT_MINUTES);
  // Advanced override for the on-chain job description (default: the plain
  // auto-generated string below). Needed for e.g. hiring an agent that
  // requires a signed-quote-anchored description (see build_job_description)
  // instead of a human-readable label. Collapsed by default, most hires
  // never need this. hire() already negotiates + anchors the signed quote
 // automatically (fix, 2026-08-22, see useHireAgent.js), so this is
  // only for the rare case someone wants to hand-craft the on-chain text.
  const [customDescription, setCustomDescription] = useState('');
  const [showCustomDescription, setShowCustomDescription] = useState(false);
 // Real, live price discovery, see useAgentQuote in useHireAgent.js.
 // Pre-fills the budget with the agent's negotiated price once known,
 // so the user isn't guessing (gap fixed 2026-08-22). Only fetched
 // while the hire modal for a given agent is open.
  const agentQuote = useAgentQuote(hiring ? selectedAgent : null);
  useEffect(() => {
    if (agentQuote.status === 'available' && !spendCapTouched) {
      setSpendCap(agentQuote.priceUnits);
    }
  }, [agentQuote.status, agentQuote.priceUnits, spendCapTouched]);
  // Hire-by-address: an escape hatch for an agent that isn't (yet) indexed
  // in the known_agents store / showing as a card, e.g. one registered
  // minutes ago. Builds a synthetic in-memory agent object and reuses the
  // exact same hire pipeline as a card; touches no backend/DB state.
  const [showManualHire, setShowManualHire] = useState(false);
  // Escrow by default, always. Budget mode is a reduction in buyer
  // protection, so it is never the state a user lands in without choosing.
  const [hireMode, setHireMode] = useState(HIRE_MODE.ESCROW);
  // Asked per agent, not per contract: the escrow being deployed does not
  // mean THIS agent can draw from it. Defaults to unavailable while it
  // loads, so a possible dead end is never offered before it is ruled out.
  const budgetMode = useBudgetModeStatus(selectedAgent?.ownerAddress || selectedAgent?.owner_address);
  const [manualAddress, setManualAddress] = useState('');
  const [stopLoss, setStopLoss] = useState(5000);
  // Catalogue-wide counts for the stat cards and the category chips. One
  // small request, unfiltered, because everything it feeds describes the whole
  // marketplace rather than the current view.
  //
  // Explore's data (this, the page of agents, the performance and canary
  // bulks) is requested only once Explore has been shown. The Dashboard on
  // "/" used to download all four on every visit and show none of them.
  const exploreShown = useLatch(nav === 'market');
  const facets = useMarketplaceFacets({ enabled: exploreShown });

  // Deep link: ?agent=<tokenId|id> opens that agent's detail, so a creator's
  // shared link lands a client straight on their agent. Resolved by its own
  // lookup rather than by searching the loaded list: the grid now holds one
  // page, and the linked agent is usually not on it.
  const deepLinkIdRef = useRef(readDeepLinkAgentId());
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current || !deepLinkIdRef.current) return;
    deepLinkHandledRef.current = true;
    fetchAgentById(deepLinkIdRef.current)
      .then((raw) => {
        if (raw) { setNav('market'); setDetailAgent(mapAgent(raw)); return; }
        // No such agent. Its address would otherwise stay in the bar and be
        // published as the canonical URL of a page that does not exist, so
        // it is replaced with Explore's own. A failed request (the catch)
        // leaves the address alone: the agent may well exist.
        onNavigate?.('/market', { replace: true });
      })
      .catch(() => {});
  }, []);

  const [sortState, setSortState] = useState({ key: 'totalScore', dir: 'desc' });
  const [showUnclassified, setShowUnclassified] = useState(true);
  const [onlyResponding, setOnlyResponding] = useState(false);
 // Real, opt-in filter (see agentVerification.js), off by default
  // so browsing stays broad; a buyer who specifically wants confirmed
  // delivery history can narrow to it.
  const [onlyVerified, setOnlyVerified] = useState(false);
  // Two-tier category filter (categoryGroups.js): pick a group first, then
  // optionally narrow to one of its fine-grained categories.
  // 'All' = no group restriction. 'Unclassified' = the ungrouped bucket.
  const [activeGroup, setActiveGroup] = useState('All');
  // Which lens the category filter is showing. 'categories' is the
  // taxonomy this project built from what the registry actually contains.
  // 'defi' is the four hackathon labels mapped on top of it
  // (hackathonCategories.js). It is a VIEW: no agent is reclassified, and
  // switching back shows exactly what it showed before.
  const [categoryView, setCategoryView] = useState('categories');
  const [activeHackathon, setActiveHackathon] = useState('All');

  // Paging, now server-side. 24/page is unchanged: measured against this
  // grid's card height at 3 columns, it comes out to 8 rows, a single page of
  // content rather than the sprawling scroll a higher count produces.
  //
  // What changed is where the slice happens. This used to cut a page out of a
  // fully-downloaded, fully-filtered array; the request below asks for exactly
  // the page being shown. Every filter is part of the query, so a filter
  // change is a new request rather than a re-filter of 15,000 local records.
  const [page, setPage] = useState(1);
  const {
    agents, setAgents, total: filteredTotal, tiers: filteredTiers,
    loading, error, refreshing, confirmedFresh,
  } = useMarketplacePage({
    categoryView, activeGroup, activeCategory, activeHackathon,
    searchQuery, showUnclassified, onlyResponding, onlyVerified,
    sortKey: sortState.key, sortDir: sortState.dir, page,
  }, mapAgent, { enabled: exploreShown });

 // Real, marketplace-wide on-chain track record (agent_performance.py via
  // the bulk endpoint), one fetch, merged onto every agent so "Most
  // hired" / "Highest success rate" can sort the whole list. See
 // agentRanking.js for the tiering (history first, no-history
  // agents after, never silently mixed in).
  const { byOwner: perfByOwner, indexComplete: perfIndexComplete, storeWideTotals: perfStoreWide, status: perfStatus, retry: retryPerf } = useAgentPerformanceBulk({ enabled: exploreShown });
  const { byOwner: canaryByOwner } = useCanaryStatus({ enabled: exploreShown });
  const agentsWithPerf = useMemo(
    () => withCanaryStatus(withPerformance(agents, perfByOwner), canaryByOwner),
    [agents, perfByOwner, canaryByOwner]
  );
  const PERFORMANCE_SORT_KEYS = new Set(['hireCount', 'winRate']);

  // Hiring needs a connected wallet, not a signed-in one: the wallet signs
  // each hire transaction itself, which is a stronger proof than sign-in.
  const { isConnected: walletConnected } = useConnectedWallet();
  const { openSignIn } = useSignIn();

  // Soft Indigo replacing the old high-contrast colors
  const accent = '#6366F1'; 
  
  const handleRevoke = (agentId) => setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, session: null } : a)));

  const {
    hire, hireBatched, step: hireStep, error: hireError,
    completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps, stepHashes: hireStepHashes,
    notifySkipReason: hireNotifySkipReason,
  } = useHireAgent();
 // Real "sign once" batched alternative (2026-08-27), see useHireAgent.js's
  // own top-of-file note for the full investigation. canBatchHire is a
 // real, live wallet_getCapabilities check, never assumed; the toggle only
 // ever appears once that check genuinely confirms support. Step-by-step
  // stays the default (signOnceForAllSteps starts false), this is an
  // opt-in alternative, not a replacement.
  const canBatchHire = useBatchHireCapability();
  const [signOnceForAllSteps, setSignOnceForAllSteps] = useState(false);
 // Captured at the moment a hire starts, so switching the toggle
  // mid-flow (or between runs) never changes which step list a run IN
  // PROGRESS is described by.
  const [activeHireMode, setActiveHireMode] = useState('stepwise');

  // The hire itself, without the wallet check, so "Continue to hire" in the
  // connect modal can carry on with the same agent once a wallet is connected.
  const startHire = (agent) => {
    setSelectedAgent(agent);
    setHiring(true);
    setSpendCapTouched(false); // fresh agent, let its price (if any) pre-fill again
    setDeadlineMinutes(DEADLINE_DEFAULT_MINUTES); // fresh agent, don't carry a prior custom deadline over
  };

  const handleHireClick = (agent) => {
    if (!walletConnected) {
      // Opens on connecting, says hiring needs a connected wallet only, and
      // offers "Continue to hire" once connected. Signing in stays optional.
      openSignIn({ purpose: 'hire', onContinue: () => startHire(agent) });
      return;
    }
    startHire(agent);
  };

  const deadlineError = validateDeadlineMinutes(deadlineMinutes);

 // Real, last-chance escrow-compatibility gate for whichever agent the
  // funding modal is currently open for, see EscrowCompatibilityWarning.jsx.
  const hireEscrowGate = useHireFlowEscrowGate(selectedAgent?.ownerAddress, selectedAgent?.id);

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("We don't have an owner ID on record for this agent, so we can't hire it.");
      return;
    }
 if (deadlineError) return; // bounds, the button itself is also disabled on this, see below
    // The hire awaits several confirmations; file its notifications under the
    // wallet that started it, not whichever is connected when it ends.
    const owner = getActiveWallet();
    try {
 // flow: creates + registers + budgets + approves (if needed) +
      // funds an ERC-8183 job, the user's own connected wallet
 // signs every step, nothing here is simulated. Real, opt-in
      // alternative: hireBatched() does the exact same on-chain work,
      // just with the register/budget/approve/fund steps signed once as a
 // EIP-5792 batch instead of individually, only ever used when
 // signOnceForAllSteps is on AND the connected wallet has genuinely
 // confirmed batch support (canBatchHire).
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
      trackJob(jobId.toString(), 'FUNDED', owner);
      recordFunded(jobId.toString()); // the moment funding confirmed, see jobTiming.js
      addNotification(`Job #${jobId}: Payment on hold`, `You hired ${selectedAgent.name}, your payment is on hold until the work is done.`, owner);
      setAgents((prev) => prev.map((a) => a.id === selectedAgent.id
        ? { ...a, session: { jobId: jobId.toString(), spendCap: Number(spendCap), status: 'FUNDED' } }
        : a));
      setSelectedAgent(null);
      setHiring(false);
    } catch (e) {
      // A hire that fails after a funding transaction is already on chain is
      // the case that most needs a notification, and it was the only one that
      // produced none: the notify call above sits past this throw, so a
      // receipt that timed out took it down with it. writeAndConfirm attaches
      // the hash and the step to exactly those errors.
      if (e?.hash) {
        addNotification(
          'Hire sent, not yet confirmed',
          `A step of your hire of ${selectedAgent?.name || 'this agent'} was sent but could not be `
          + 'confirmed in time. It may still confirm. Check it before trying again, '
          + `otherwise you could pay twice: https://bscscan.com/tx/${e.hash}`,
          owner,
        );
      }
      // hireError (from the hook) already carries the message,
      // surfaced in the modal UI, no silent failure.
    }
  };

  const handleSort = (key) => setSortState((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
 // "Most hired" / "Highest success rate" are one-directional rankings
 // (best number first), not toggleable asc/desc like the table's own
  // column-header sort above, picking one from the dropdown always means
  // "show me the best first".
  const handleSortSelect = (key) => setSortState({ key, dir: 'desc' });

  // Debounce the search so filtering doesn't run on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // The grid renders exactly what the server returned. Filtering, sorting and
  // the tier-first ordering all moved to core/agents_index.py, because a page
  // cannot be cut correctly until the filters have been applied: filtering a
  // page the client already holds gives the wrong page, not a slower one.
  //
  // The one thing still done here is the performance merge, which decorates
  // the 24 cards on screen with their on-chain track record. That fetch is
  // 35KB for the whole marketplace, so it stays a single bulk request.
  const paginated = agentsWithPerf;

  // Paging state lives with the request (see useMarketplacePage above). The
  // server returns the page and the size of the whole filtered set, so the
  // page count is derived from that total rather than from a local array.
  const PAGE_SIZE = 24;
  // Any filter/sort/search change must land back on page 1: staying on e.g.
  // page 5 after a filter shrinks the result to 2 pages would ask the server
  // for an offset past the end and show an empty grid.
  useEffect(() => { setPage(1); }, [activeGroup, activeCategory, categoryView, activeHackathon, sortState, showUnclassified, onlyResponding, onlyVerified, searchQuery]);
  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);

 // Real, marketplace-wide tier counts (not just this page), `filtered` is
 // always tier-sorted (withVerificationTierFirst), so this is an honest
 // tally of the real 3-tier split under the current filters.
  // These come back with the page, computed over the whole filtered selection
  // rather than the 24 rows on screen. Counting the page instead would report
  // "3 verified" when the filter actually matches three hundred.
  const tierCounts = useMemo(() => ({
    [VERIFICATION_TIER.VERIFIED]: filteredTiers?.verified ?? 0,
    [VERIFICATION_TIER.CANARY_VERIFIED]: filteredTiers?.canary_verified ?? 0,
    [VERIFICATION_TIER.RESPONDING]: filteredTiers?.responding ?? 0,
    [VERIFICATION_TIER.UNPROVEN]: filteredTiers?.unproven ?? 0,
    [VERIFICATION_TIER.UNCHECKED]: filteredTiers?.unchecked ?? 0,
  }), [filteredTiers]);
  // Marks the first row/card of each new tier on THIS page, so a divider
 // only renders where the tier changes, `paginated` is a
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
 // stats from a reference screenshot, not this marketplace's data).
  //
 // bug found and fixed (2026-08-27): `verified` used to be
  // `agents.filter(a => a.isVerified).length`, where isVerified is
  // 8004scan's own raw is_verified field, confirmed live to be false
 // across the entire registry, so this always showed 0 no matter how
 // many agents had passed our own real "Verified working" tier. Fixed to
 // use agentVerification.js's getVerificationTier (on-chain-confirmed
  // delivered job), over agentsWithPerf (the performance-merged list, the
  // raw jobsCompleted/jobsSubmitted signal isn't on `agents` yet).
  //
  // Now served by /api/agents/facets rather than reduced over a local array.
  // The verification tier is still agentVerification.js's definition, computed
  // from the same delivered-job evidence, just applied server-side where the
  // whole catalogue is. `real_names_only=false` on that request keeps these
  // three numbers identical to what this reduce produced.
  const stats = useMemo(() => ({
    total: facets.total,
    verified: facets.tiers?.verified ?? 0,
    totalFeedbacks: facets.totalFeedbacks,
  }), [facets]);

 // per-group counts (categoryGroups.js), so the group chips show an
 // tally rather than an unlabeled bucket, anything not mapped to a
  // group (including literal 'Unclassified') counts toward 'Unclassified'.
  // Rolled up from the facet counts. The grouping stays here on purpose:
  // CATEGORY_GROUPS is a presentation concern the two apps share, and moving
  // it server-side would put a display decision behind an API version.
  const groupCounts = useMemo(
    () => groupCountsFromFacets(facets.categories), [facets.categories]);

  // Fine-grained category chips, scoped to whichever group is active, only
 // categories that have at least one agent are shown.
  const hackathonCounts = useMemo(
    () => hackathonCountsFromFacets(facets.categories), [facets.categories]);

  const activeGroupCategories = useMemo(() => {
    if (activeGroup === 'All' || activeGroup === 'Unclassified') return [];
    const groupCats = CATEGORY_GROUPS.find((g) => g.id === activeGroup)?.categories || [];
    // Which categories actually exist, from the facet counts rather than from
    // whatever happens to be on the current page. Reading it off the page
    // would hide a category's chip whenever its agents fell on page two.
    const present = new Set((facets.categories || []).map((c) => c.category));
    return ['All', ...groupCats.filter((c) => present.has(c))];
  }, [facets.categories, activeGroup]);

  // Picking a different group must clear any leftover fine-category pick
  // from the previous group, otherwise switching groups could silently
  // keep filtering on a category that isn't even in the new group.
  useEffect(() => { setActiveCategory('All'); }, [activeGroup]);

  // Tab changes from the header and the footer go through one function, so
  // the two cannot drift in what they reset.
  const goTo = (id) => {
    dismissAgentDetail();
    // Explore opens on its chain list. Without this, clicking the tab you
    // are already on did nothing visible, and the chain list had no entry
    // point at all once a chain was picked.
    if (id === 'market') resetChainChoice();
    setNav(id); setHiring(false); onNavChange?.(id);
  };

  return (
    <div className="min-h-screen font-sans flex flex-col bg-page text-fg">

      {/* THE HEADER, following the reference dashboard (2026-09-25): the
          wordmark on the left, the search beside it, the pages on the right,
          then the bell, the theme and the wallet. 56px on the surface colour
          with a 1px rule under it, sticky, capped at the same 1440 width and
          gutters as the content, so the wordmark lines up with the first
          card. The tabs that do not fit go into a More menu
          (shell/HeaderNav.jsx); under 1280px the search becomes an icon that
          opens Stocks & ETFs.

          WIDTH BUDGET. All five pages show at 1280 and up, a connected wallet
          included (its badge is about 250px). What pays for it: the tabs are
          words without icons, the theme control is one 32px button, and the
          search field shows from 1280, 244px wide (the width at which its
          placeholder is not cut off) and 260px from 1440, with an icon button
          in its place below 1280. Measured at 1280 with a connected, unsigned
          wallet (the widest badge, 298px): all five tabs and 15px
          to spare. If a platform's fonts are wider, the last tab moves to
          More rather than anything overlapping. */}
      <header className="sticky top-0 z-30 bg-surface border-b border-line">
        <div className="max-w-[1440px] mx-auto h-14 px-6 xl:px-14 flex items-center gap-3">
          <a
            href="/"
            onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); goTo('dashboard'); }}
            className="shrink-0 text-fg"
          >
            <Wordmark className="text-[22px]" />
          </a>

          <TopSearch
            key={query}
            initial={query}
            onSearch={(to) => { dismissAgentDetail(); onNavigate?.(to); }}
            className="hidden xl:flex w-[244px] min-[1440px]:w-[260px] shrink min-w-[160px] ml-2"
          />
          <button
            type="button"
            onClick={() => goTo('stocks')}
            aria-label="Search stocks, ETFs or vaults"
            title="Search stocks, ETFs or vaults"
            className="xl:hidden w-8 h-8 shrink-0 rounded flex items-center justify-center text-muted hover:text-fg hover:bg-inset"
          >
            <Search size={16} />
          </button>

          <HeaderNav items={NAV_ITEMS} active={nav} onSelect={goTo} align="end" />

          <div className="flex items-center gap-1 shrink-0">
            <NotificationBell />
            <ThemeToggle />
            <div className="ml-1.5">
              {/* "Sign in" opens /signin with no wallet connected, and the
                  sign-in modal once one is. Shared with the mobile sheet:
                  wallet/WalletIdentity.jsx. */}
              <WalletIdentity layout="bar" onOpenSignInPage={() => onNavigate?.('/signin')} />
            </div>
          </div>
        </div>
      </header>

      {/* Main content. The same 1440 cap and gutters as the header: at a
          1440 window that is a 1328px column, 56px either side. */}
      <main className="flex-1 flex flex-col w-full max-w-[1440px] mx-auto px-6 xl:px-14 pt-6 pb-8 overflow-x-hidden">
        <div className="w-full flex-1">
          {/* The product pages. One component each, shared with the mobile
              app; `layout` changes spacing and never content. */}
          {nav === 'dashboard' && <Dashboard layout="web" />}
          {nav === 'stocks' && <Stocks layout="web" query={query} />}
          {nav === 'vaults' && <Vaults layout="web" />}
          {nav === 'my-etfs' && <MyEtfs layout="web" />}
          {nav === 'ai' && <UseWithAi layout="web" />}

          {nav === 'market' && detailAgent && !hiring && (
            <AgentDetail
              agent={detailAgent}
              onBack={closeAgentDetail}
              onHire={(a) => { setDetailAgent(null); handleHireClick(a); }}
            />
          )}

          {/* The page's one h1, for screen readers and search: the visible
              headings below belong to whichever chain view is open, so none
              of them can stand for the page. Same in the mobile app. */}
          {nav === 'market' && !hiring && !detailAgent && <h1 className="sr-only">Explore agents</h1>}
          {nav === 'market' && !hiring && !detailAgent && (
            <ChainViewTabs mutedBorder="border-line">
              {/* The BNB Chain view below is the original marketplace,
                  unchanged. ChainViewTabs renders it as-is when the BNB tab
                  is active and swaps in a separate module for the others, so
                  this working path is preserved by construction. */}
              <>
 {/* stats derived from actually-fetched agents, not global platform numbers.
 The diversity-limit note (why this list is shorter than the full real
                  registry) and the badge legend used to each be a permanent paragraph
 stacked below here, information, but competing for attention
                  whether or not anyone needed it right now. Both now live behind small,
                  on-demand (i) icons instead, same meaning, no permanent space. */}
              {/* Tightened 2026-09-11. Measured on the live page, the header put
                    789px above the first agent card on a 979px viewport, so almost
                    no agents were visible without scrolling. Of that, 248px was
                    gap rather than content. */}
              <div className="flex flex-col lg:flex-row gap-3 mb-3 items-stretch">
                {/* One card with three columns, not three cards. Each stat is a
                    number and a short label, roughly 120px of content, and as
                    separate cards they were each given a third of the row: about
                    270px, leaving half of every card empty. A single card with
                    dividers removes two borders, two gaps and all of that dead
                    space, and reads as one block of figures, which is what it is. */}
                <div className="flex-1 bg-surface rounded-md border border-line grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line">
                  <div className="px-4 py-3 flex items-center justify-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0"><Activity size={18} /></div>
                    <div>
 {/* fix (2026-08-27): only ever render the real,
                          confirmed-fresh count, a skeleton until then,
                          never a stale cached number that later jumps. */}
                      {confirmedFresh && facets.loaded ? <div className="text-xl font-bold leading-tight">{stats.total.toLocaleString()}</div> : <StatSkeleton />}
                      <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                        Agents Listed
                        <InfoTooltip label="" size={12}>
                          This is a varied mix, not every agent that exists. Most agents here were created in a few
                          big signup batches and look nearly identical, so we limit how many near-duplicates show up,
                          there are more agents out there, we're just not cluttering your view with lookalikes. The count is
                          also bounded by our read cap: we serve at most {SERVE_READ_CAP.toLocaleString()} agents, so this is the size of
                          what we serve, not of the registry.
                        </InfoTooltip>
                      </div>
                      {/* Beside the number, not only in the tooltip: the served
                          set stops at the backend read cap, so without this the
                          figure reads as a registry total. */}
                      <div className="text-[11px] text-muted leading-tight">served, read capped at {SERVE_READ_CAP.toLocaleString()}</div>
                    </div>
                  </div>
                  {/* Label corrected 2026-09-04. This was "Reviews", with a
                      tooltip reading "Total written reviews left across all
                      these agents", both were wrong, confirmed by pulling
                      the records rather than the aggregate count.
                      8004scan's per-agent feedback endpoint returns 1,899
 feedback records across the 29 highest-feedback
                      BSC agents, and 0 of them (0.0%) carry any comment
                      text, and 0 carry a rating score. They're on-chain
 ERC-8004 Reputation Registry entries, real, and real
                      evidence of interaction, but not reviews in any sense
                      a reader would expect from that word. 96.4% of this
                      number also comes from a single automated cluster
                      (Ensoul), so the tooltip says so. */}
                  <div className="px-4 py-3 flex items-center justify-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0"><MessageSquare size={18} /></div>
                    <div>
                      {confirmedFresh && facets.loaded ? <div className="text-xl font-bold leading-tight">{stats.totalFeedbacks.toLocaleString()}</div> : <StatSkeleton />}
                      <div className="text-xs text-gray-500 font-medium flex items-center gap-1">
                        On-chain Feedback
                        <InfoTooltip label="" size={12}>
                          On-chain ERC-8004 feedback entries recorded against these agents. These are
                          counts only. They carry no written text and no star rating, so there's
                          nothing to read behind the number. Most of it also comes from one automated
 cluster rather than many independent buyers. For evidence an agent actually
                          works, use the "Marked delivered" count instead: a buyer other than the owner funded
                          an on-chain job and the agent then marked it delivered.
                        </InfoTooltip>
                      </div>
                    </div>
                  </div>
                  <div title={`${VERIFIED_MEANING} (see 'How we verify agents' below)`} className="px-4 py-3 flex items-center justify-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 shrink-0"><Users size={18} /></div>
                    <div>
                      {confirmedFresh && facets.loaded ? <div className="text-xl font-bold leading-tight">{stats.verified.toLocaleString()}</div> : <StatSkeleton />}
                      <div className="text-xs text-gray-500 font-medium">{VERIFICATION_LABEL_SHORT[VERIFICATION_TIER.VERIFIED]}</div>
                    </div>
                  </div>
                </div>
                <QrToMobile />
              </div>

 {/* Real, permanently-accessible explainer (2026-08-27), the
                  tier legend used to live ONLY behind the small tooltip
 below, which only covered 2 of the 5 tiers and
                  required already knowing to hover/click a small (i) icon.
 This is a real, always-visible section instead (collapsed
                  by default to stay out of the way, but the toggle itself
                  is never hidden). See VerificationExplainerSection.jsx. */}
              {/* Both explainers on one row. They were stacked bands of 50px
                  and 24px for what is a toggle and a tooltip link, and
                  neither needs a line to itself. */}
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <VerificationExplainerSection className="flex-1 min-w-[260px]" storeWideTotals={perfStoreWide} livenessCoverage={facets.livenessCoverage} />

              <div className="shrink-0">
                <InfoTooltip label="What does the live 'Online now' badge mean?" size={12}>
                  <div className="space-y-2">
                    <p><strong>Online now</strong> means we reached this agent's endpoint just now and it answered. No checkmark only means we haven't confirmed recently, not that anything is broken. Either way it isn't a quality signal on its own. See "How we verify agents" above for what counts as proof.</p>
                  </div>
                </InfoTooltip>
              </div>
              </div>

 {/* tidiness pass (2026-08-28): sort/view (how the list is
                  displayed) get their own row, next to the heading; the 3
                  filter toggles (what's IN the list) get a second row of
                  their own, clearly labeled, instead of all 5 controls
                  running together in one cramped line. */}
              <div className="mb-3 flex flex-col gap-3">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-3">
                  <div>
                    <h2 className="text-h1 font-bold mb-1.5 flex items-center gap-2">
                      Explore
                      {refreshing && <Loader2 size={16} className="animate-spin text-gray-400" />}
                    </h2>
                    <p className="text-sm text-muted">Browse AI agents, check them out, and hire one with a spending limit you control.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={sortState.key}
                      onChange={(e) => handleSortSelect(e.target.value)}
                      title="Buyer-funded, marked-delivered agents always rank first (see the badges info above). Within that, agents with a hire history come before those without, and the two groups stay separate"
                      className="px-3 py-2.5 rounded-xl text-xs font-medium border border-line bg-surface dark:text-gray-300 outline-none"
                    >
                      <option value="totalScore">Sort: Top score</option>
                      <option value="hireCount">Sort: Most hired</option>
                      <option value="winRate">Sort: Highest success rate</option>
                    </select>
                    <div className="flex bg-surface border border-line rounded-xl p-1">
                      <button onClick={() => setMarketView('grid')} className={`p-2 rounded-lg transition-all ${marketView === 'grid' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><LayoutGrid size={16} /></button>
                      <button onClick={() => setMarketView('table')} className={`p-2 rounded-lg transition-all ${marketView === 'table' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><Table2 size={16} /></button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-line">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-1 shrink-0">Filters</span>
                  <button
                    onClick={() => setOnlyVerified((v) => !v)}
                    className={`px-3.5 py-2 rounded-xl text-[11px] font-medium border transition-colors ${
                      onlyVerified
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400'
                        : 'border-line hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    title={VERIFIED_MEANING}
                  >
                    {onlyVerified ? '✓ ' : ''}Only {VERIFICATION_LABEL_SHORT[VERIFICATION_TIER.VERIFIED].toLowerCase()}
                  </button>
                  <button
                    onClick={() => setOnlyResponding((v) => !v)}
                    className={`px-3.5 py-2 rounded-xl text-[11px] font-medium border transition-colors ${
                      onlyResponding
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                        : 'border-line hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    title="Only show agents that responded just now"
                  >
                    {onlyResponding ? '✓ ' : ''}Only show online agents
                  </button>
                  <button onClick={() => setShowUnclassified((v) => !v)} className="px-3.5 py-2 rounded-xl text-[11px] font-medium border border-line hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    {showUnclassified ? 'Hide' : 'Show'} unclassified
                  </button>
                </div>

 {/* Real, failure state (2026-08-27), a genuine
                    fetch failure here used to be silently indistinguishable
                    from "zero verified agents exist"; now it says so
                    plainly and offers a retry. */}
                {perfStatus === 'error' && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={12} className="shrink-0" />
                    Couldn't load verification and hire-history data, so "Only marked delivered", "Most hired" and "Highest success rate" may be inaccurate right now.
                    <button onClick={retryPerf} className="underline font-medium">Try again</button>
                  </div>
                )}
              </div>

              {/* Search and the hire-by-id button on one line. The button used
                  to own a full-width row of its own to carry eight words, and
                  the two belong together anyway: both are "I already know what
                  I am looking for". */}
              <div className="mb-3 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    placeholder="Search by name, or paste an agent id / wallet / contract address…"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-line bg-surface text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button type="button" onClick={() => setShowManualHire((v) => !v)} className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold border border-line bg-surface text-muted hover:border-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                  <Search size={12} />{showManualHire ? 'Hide this' : 'Hire by ID'}
                </button>
              </div>

 {/* Real, disclosure for the two performance sorts, see
 agentRanking.js: agents with on-chain hire history for
                  the chosen metric rank first (by that number); agents
                  with none yet are listed after, in the marketplace's usual
 default order, never silently mixed in among track
                  records. */}
              {PERFORMANCE_SORT_KEYS.has(sortState.key) && (
                <div className="mb-4 flex items-start gap-2 text-[11px] text-muted p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-line">
                  <Activity size={13} className="shrink-0 mt-0.5 text-indigo-500" />
                  <span>
 Ranked by on-chain hire history{sortState.key === 'hireCount' ? ", total completed/in-progress jobs, most first" : ", completed-or-delivered vs. rejected/expired jobs, highest rate first"}.
                    Agents with no hires yet are listed after those with one, not mixed in.
                  </span>
                </div>
              )}

              {/* Hire-by-address escape hatch, for an agent not yet indexed
                  as a card (e.g. just registered). Builds a synthetic agent
                  object and reuses the hire flow; no backend involved. */}
              {/* The button that opens this now lives in the search row above;
                  only the panel it reveals is left here, so nothing occupies
                  vertical space while it is closed. */}
              <div className={showManualHire ? 'mb-4' : ''}>
                {showManualHire && (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={manualAddress}
                      onChange={(e) => setManualAddress(e.target.value.trim())}
                      placeholder="0x… the agent owner's wallet ID"
                      className="flex-1 px-4 py-2.5 rounded-xl border border-line bg-surface text-sm font-mono outline-none focus:ring-2 focus:ring-indigo-500"
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
                  top-level group first, the fine-grained categories inside
                  it (categorize.py's own, unchanged) only appear once a
 group is picked, so browsing starts at 5 choices
                  instead of 18+. */}
              {/* Two lenses on the same classification. The DeFi view maps
                  the four hackathon labels onto the categories that belong
                  under them; it reclassifies nothing. */}
              {/* The toggles and the chips they switch between share one
                  wrapping row. "Browse by" used to sit on a line by itself,
                  25px of header to label two buttons. */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 text-[11px]">
                <span className="opacity-40 mr-1">Browse by</span>
                {[['categories', 'Categories'], ['defi', 'DeFi categories']].map(([id, label]) => (
                  <button key={id} onClick={() => setCategoryView(id)} className={`px-3 py-1 rounded-full font-semibold transition-all ${
                    categoryView === id ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                  }`}>{label}</button>
                ))}
              </div>

              {categoryView === 'defi' && (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setActiveHackathon('All')} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                    activeHackathon === 'All' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-surface dark:text-gray-300 dark:border-gray-700'
                  }`}>All four</button>
                  {HACKATHON_CATEGORIES.map((h) => (
                    <button key={h.id} onClick={() => setActiveHackathon(h.id)} title={`Includes: ${h.categories.join(', ')}`} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                      activeHackathon === h.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-surface dark:text-gray-300 dark:border-gray-700'
                    }`}>{h.label} ({confirmedFresh ? (hackathonCounts[h.id] || 0) : '…'})</button>
                  ))}
                </div>
              )}

              <div className={`flex flex-wrap gap-2 ${categoryView === 'defi' ? 'hidden' : ''}`}>
                <button onClick={() => setActiveGroup('All')} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                  activeGroup === 'All' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-surface dark:text-gray-300 dark:border-gray-700'
                }`}>All</button>
 {/* fix (2026-08-27): same confirmedFresh gate as the
                    header stats, these counts come from the same `agents`
                    array, so showing them before a fetch has settled
                    risked the exact same stale-cache-then-jump mismatch
                    (e.g. a stale cached total summing to far less than the
 real, current known_agents count). '…' instead of a
                    number that might be wrong. */}
                {CATEGORY_GROUPS.map((g) => (
                  <button key={g.id} onClick={() => setActiveGroup(g.id)} title={g.categories.join(', ')} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                    activeGroup === g.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-surface dark:text-gray-300 dark:border-gray-700'
                  }`}>{g.label} ({confirmedFresh ? (groupCounts[g.id] || 0) : '…'})</button>
                ))}
                <button onClick={() => setActiveGroup('Unclassified')} title="Agents whose description didn't clearly match a known category" className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                  activeGroup === 'Unclassified' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-surface dark:text-gray-300 dark:border-gray-700'
                }`}>Unclassified ({confirmedFresh ? (groupCounts.Unclassified || 0) : '…'})</button>
              </div>
              </div>

              {categoryView !== 'defi' && activeGroupCategories.length > 0 && (
                <div className="mb-8 flex flex-wrap gap-2 pl-2 border-l-2 border-line">
                  {activeGroupCategories.map((cat) => (
                    <button key={cat} onClick={() => setActiveCategory(cat)} title={CATEGORY_HINTS[cat]} className={`px-3 py-1.5 rounded-full text-[11px] font-medium transition-all ${
                      activeCategory === cat ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300 dark:bg-surface dark:text-gray-400 dark:border-gray-700'
                    }`}>{cat}</button>
                  ))}
                </div>
              )}
              {categoryView !== 'defi' && activeGroupCategories.length === 0 && <div className="mb-8" />}

              {!loading && !error && filteredTotal > 0 && (
                <div className="mb-4 text-xs text-gray-400">
                  Showing {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString()}&ndash;{Math.min(currentPage * PAGE_SIZE, filteredTotal).toLocaleString()} of {filteredTotal.toLocaleString()} agents
                </div>
              )}

 {/* Real, live search fallback (2026-08-29), see
                  UniversalSearchFallback.jsx and docs/universal-search.md.
                  Only ever renders when the local name search came up
 empty AND there's search text to check, never
                  replaces the plain "nothing matched" case below for an
                  ordinary mistyped name. */}
              {/* Filters alone can empty the list -- category, group, "responding
                  only" and "verified only" all narrow it, and "verified only"
                  matches a small fraction of agents, so an empty result is easy
                  to reach without typing anything. Previously the only empty
                  state was gated on searchQuery, so those cases rendered a blank
                  area that read as a loading failure. */}
              {!loading && !error && filteredTotal === 0 && !searchQuery && (
                <div className="text-center py-16 px-6">
                  <p className="font-semibold mb-1">No agents match these filters</p>
                  <p className="text-sm text-muted mb-4">
                    Try widening them, "Only marked delivered" in particular matches only a small share of agents.
                  </p>
                  <button
                    onClick={() => { setActiveGroup('All'); setActiveCategory('All'); setOnlyResponding(false); setOnlyVerified(false); }}
                    className="text-sm font-semibold px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
                  >
                    Clear all filters
                  </button>
                </div>
              )}

              {!loading && !error && filteredTotal === 0 && searchQuery && (
                <div className="mb-6">
                  <UniversalSearchFallback
                    query={searchQuery}
                    agentsWithPerf={agentsWithPerf}
                    onOpenAgent={(agent) => openAgentDetail(agent, agentPath(agent))}
                    accent={accent}
                    mutedBorder="border-line"
                    darkMode={darkMode}
 // Real, plain fallback for anything that doesn't look
                    // like an id/address at all (an ordinary mistyped
                    // name), the component itself renders nothing for
                    // that case, so without this the empty grid used to
                    // just show nothing, no message at all.
                    plainEmptyMessage={`Nothing matches "${searchInput.trim()}" by name. If you're looking for a specific agent, try its exact id instead of its name, or paste a wallet or contract address.`}
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
                <div className="bg-surface rounded-md border border-line overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50/50 dark:bg-gray-800/30 border-b border-line">
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider" title="Which blockchain network this agent runs on">Network</th>
                        <th className="p-4"><SortHeader label="Score" hint="How trustworthy this agent looks, based on past feedback: higher is better" sortKey="totalScore" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4"><SortHeader label="Stars" hint="How many people rated this agent, like a star rating on a store" sortKey="starCount" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4"><SortHeader label="Online?" hint="Whether we could reach this agent just now" sortKey="serviceRank" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4">
                          <button
                            onClick={() => handleSortSelect('hireCount')}
                            title="ERC-8183 hire history for this agent, click to rank by most hired"
                            className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold transition-colors ${PERFORMANCE_SORT_KEYS.has(sortState.key) ? 'text-fg' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
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
                          <tr onClick={() => openAgentDetail(agent, agentPath(agent))} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors group cursor-pointer">
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
                          <td className="p-4 text-sm font-semibold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : 'n/a'}</td>
                          <td className="p-4 text-sm text-muted">{agent.starCount ?? 'n/a'}</td>
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
                          <td className="p-4 text-sm text-gray-500">{agent.totalFeedbacks ?? 'n/a'}</td>
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
                    <div className="bg-surface rounded-md border border-line hover:shadow-md transition-shadow flex flex-col overflow-hidden">
                      <div className="p-6 flex-1 cursor-pointer" onClick={() => openAgentDetail(agent, agentPath(agent))}>
                        <div className="flex justify-between items-start mb-5">
                          <div className="flex items-center gap-3">
                            <AgentAvatar agent={agent} size={40} />
                            <div>
                              <span title={CATEGORY_HINTS[agent.category]} className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-1 block">{agent.category}</span>
                              <h3 className="text-lg font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={16} className="text-indigo-500" title="Registered on-chain, not a quality rating" />}</h3>
                            </div>
                          </div>
                          <ChainCardBadge chainId={agent.chainId} chainName={CHAIN_LABELS[agent.chainId] || agent.network} />
                        </div>

                        <div className="mb-3 flex flex-wrap items-center gap-1.5">
                          {agent.serviceStatus && agent.serviceStatus !== 'unknown' && (
                            <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} />
                          )}
                          <VerificationBadge agent={agent} />
                        </div>


                        <div className="grid grid-cols-3 gap-2 p-3 mb-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-line/50">
                          <div className="text-center" title="How trustworthy this agent looks, based on past feedback"><span className="block text-[10px] text-gray-500 uppercase mb-1">Score</span><span className="font-bold text-sm text-fg">{agent.totalScore != null ? agent.totalScore.toFixed(1) : 'n/a'}</span></div>
                          <div className="text-center border-l border-line" title="How many people rated this agent"><span className="block text-[10px] text-gray-500 uppercase mb-1">Stars</span><span className="font-bold text-sm text-fg">{agent.starCount ?? 'n/a'}</span></div>
                          <div className="text-center border-l border-line" title="Total money this agent currently manages for people"><span className="block text-[10px] text-gray-500 uppercase mb-1">Funds</span><span className="font-bold text-sm text-fg">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : <span className="text-gray-400 font-normal">-</span>}</span></div>
                        </div>

 {/* on-chain hire track record, same data the
                            "Most hired"/"Highest success rate" sort ranks
                            by, shown plainly here so it's visible
                            regardless of which sort is active. */}
                        <div className="mb-4 text-[11px] text-muted" title={perfIndexComplete ? "ERC-8183 job history for this agent: the complete on-chain history, not a recent-only window" : "ERC-8183 job history for this agent: a one-time backfill of the complete history is still catching up"}>
                          {agentHasRealHistory(agent, 'hireCount')
                            ? <>{agent.hireCount} {agent.hireCount === 1 ? 'hire' : 'hires'}{agent.winRate != null ? ` · ${Math.round(agent.winRate * 100)}% success` : ''}</>
                            : <span className="text-gray-400 dark:text-gray-500">No hires yet</span>}
                        </div>

                        <p className="text-sm text-muted leading-relaxed line-clamp-3">{agent.strategy}</p>
                        {/* How someone actually uses this agent, from the
                            same component the chain views use so the sentence
                            cannot differ between them. */}
                        <InteractionLine interaction={agent.interaction} showDetail={false} className="mt-3"
                          deliveredCount={(agent.jobsCompleted ?? 0) + (agent.jobsSubmitted ?? 0)} />
                        {/* Funded versus delivered. Only renders for a
                            provider that has actually been paid before. */}
                        <DeliveryRecord agent={agent} compact className="mt-2" />
                        <BudgetRecord agent={agent} compact className="mt-1" />
                      </div>
                      
                      <div className="p-5 bg-gray-50 dark:bg-gray-800/30 border-t border-line">
                        {agent.session ? (
                          <div>
                            <div className="flex justify-between items-center mb-3 text-xs">
                              <span className="font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400"><ShieldAlert size={14} /> You've given this agent access</span>
                            </div>
                            {/* This was a "Money spent so far" meter reading
                                `session.spendUtilized / session.spendCap`.
                                `spendUtilized` is assigned nowhere in this
                                repo, so it rendered "$undefined / $50000"
                                over a bar of width NaN%. It could not be
                                fixed by finding the field, because there is
                                no such quantity to find: this is the
                                ERC-8183 path, where the whole amount sits in
                                escrow until delivery and nothing is drawn
                                down. A utilisation bar describes a budget,
                                not a job. What is known is the amount on
                                hold and the state, so that is what it says. */}
                            <div className="mb-4 flex justify-between text-[11px] text-muted">
                              <span>On hold until this agent delivers</span>
                              <span className="font-medium tabular-nums">${agent.session.spendCap}</span>
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
            </ChainViewTabs>
          )}

          {/* Hiring Flow Overlay (Styled as a clean modal card) */}
          {hiring && selectedAgent && (
            <div className="max-w-2xl mx-auto mt-10">
              <button onClick={() => setHiring(false)} disabled={hireStep && hireStep !== 'done' && !hireError} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors disabled:opacity-40">
                <ChevronRight size={16} className="rotate-180" /> Back to Explore
              </button>

              {/* Funding model. Escrow is the default and stays selected
                  unless a buyer deliberately picks otherwise -- it is the
                  safer model and the working path. Budget mode is opt-in
                  and renders its own self-contained panel; the ERC-8183
                  markup below is unchanged, only hidden while budget mode
                  is active, so selecting escrow runs exactly the code that
                  ran before budget mode existed. */}
              <div className="bg-surface rounded-md p-6 md:p-8 border border-line shadow-xl mb-6">
                <div className="flex items-center gap-4 mb-6">
                  <AgentAvatar agent={selectedAgent} size={56} />
                  <div>
                    <h2 className="text-h1 font-bold">Hire {selectedAgent.name}</h2>
                    <p className="text-muted text-sm mt-1">Approve each step yourself, in your wallet.</p>
                  </div>
                </div>
                <HireModePicker
                  value={hireMode}
                  onChange={setHireMode}
    budgetAvailable={budgetMode.available}
                  budgetDeclared={budgetMode.declared}
                  disabledReason={budgetMode.reason}
                />
                {hireMode === HIRE_MODE.BUDGET && <BudgetHirePanel agent={selectedAgent} />}
              </div>

              <div className={hireMode === HIRE_MODE.BUDGET ? 'hidden' : ''}>
              <div className="bg-surface rounded-md p-8 md:p-10 border border-line shadow-xl mb-6">
                <div className="flex items-center gap-4 mb-8">
                  <AgentAvatar agent={selectedAgent} size={56} />
                  <div>
                    <h2 className="text-h1 font-bold">Hire {selectedAgent.name}</h2>
                    <p className="text-muted text-sm mt-1">Approve each step yourself, in your wallet.</p>
                  </div>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 mb-8 text-sm text-amber-800 dark:text-amber-300">
 This puts money on hold for this agent to do the work. You're not just browsing anymore. You approve each step yourself, in your wallet, every time.
                </div>

 {/* Real, last-chance gate, see EscrowCompatibilityWarning.jsx.
                    Only renders (and only blocks the fund button below) when
 this specific agent was flagged by a real, live protocol
                    probe against its own registered endpoint. */}
                {hireEscrowGate.node}

                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck size={16} className="text-indigo-500" />
                  <span className="text-xs font-bold uppercase tracking-wide opacity-70">Always Ask</span>
                </div>

                {/* Unified "how much and how long" step (2026-09-09), the
 amount and the deadline are both terms of the
                    same hire, so they live in one bordered section with
                    consistent visual treatment, not two disconnected
                    floating inputs. */}
                <div className="mb-6 p-5 rounded-2xl border border-line bg-gray-50/50 dark:bg-white/[0.02] space-y-6">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold mb-3"><Sliders size={16} className="text-gray-400" /> How much are you funding this job for? <span className="font-normal text-gray-400" title="$U is a type of digital dollar, 1 $U is worth about $1. It's what you pay agents with here.">($U, worth about $1 each)</span></label>

 {/* Live price discovery (useAgentQuote), gap fixed
                        2026-08-22: users had no way to know what an agent
 needed before hiring. Where a price is
                        knowable, say so and pre-fill it; where it isn't, say
                        that plainly too, rather than leave a silent guess. */}
                    {agentQuote.status === 'loading' && (
                      <div className="mb-2 flex items-center gap-1.5 text-xs text-gray-400">
                        <Loader2 size={12} className="animate-spin" /> Checking what this agent charges…
                      </div>
                    )}
                    {agentQuote.status === 'available' && (
                      <div className="mb-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-xs text-emerald-800 dark:text-emerald-300">
                        <strong>This agent charges {agentQuote.priceUnits} $U.</strong> We got this straight from the agent itself, filled in below, no need to guess.
                        {spendCapTouched && Number(spendCap) < agentQuote.priceUnits && (
                          <span className="block mt-1 text-amber-700 dark:text-amber-400">You've entered less than that, we'll automatically pay at least {agentQuote.priceUnits} $U, since the agent won't accept less.</span>
                        )}
                      </div>
                    )}
                    {agentQuote.status === 'unavailable' && (
                      <div className="mb-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
                        This agent hasn't told us what it charges, so you're picking the amount yourself. Heads up: if you enter too little, the agent may not accept the job.
                      </div>
                    )}

                    <input type="number" value={spendCap} onChange={(e) => { setSpendCap(e.target.value); setSpendCapTouched(true); }} disabled={hireStep && !hireError} className="w-full p-4 rounded-xl border border-line bg-inset text-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50" />
                    <div className="mt-1.5"><GetULink /></div>
                  </div>

 {/* Real, user-facing job deadline (2026-09-09), previously
                      hardcoded to 65 minutes with no control in this modal at
                      all (confirmed by reading useHireAgent.js's own hire()
                      signature before building this). Scoped to third-party
                      hiring only: Native Agents and Skills are atomic,
                      single-transaction actions with no delivery period, so
                      no deadline concept applies there, see hireDeadline.js. */}
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold mb-3"><Clock size={16} className="text-gray-400" /> How long does the agent have to deliver?</label>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {DEADLINE_PRESETS.map((p) => (
                        <button
                          key={p.minutes}
                          type="button"
                          onClick={() => setDeadlineMinutes(p.minutes)}
                          disabled={hireStep && !hireError}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${Number(deadlineMinutes) === p.minutes ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' : 'border-line text-muted hover:border-indigo-300'}`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number" value={deadlineMinutes} disabled={hireStep && !hireError}
                      onChange={(e) => setDeadlineMinutes(e.target.value)}
                      className="w-full p-4 rounded-xl border border-line bg-inset text-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50"
                    />
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      {deadlineError
                        ? <span className="text-red-500">{deadlineError}</span>
                        : <>Minutes ({formatDeadline(deadlineMinutes)}). If the agent hasn't delivered by then, you can reclaim your funds. Minimum {DEADLINE_MIN_MINUTES} min, maximum {formatDeadline(DEADLINE_MAX_MINUTES)}.</>}
                    </p>
                  </div>
                </div>

                {/* Advanced: override the on-chain job description. Off by
                    default, only needed when the seller requires a specific
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
                        className="w-full p-3 rounded-xl border border-line bg-inset text-xs font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Only for advanced users. This replaces the automatic description above with your own text, permanently recorded. Leave it blank unless you have a specific reason to use this.</p>
                    </div>
                  )}
                </div>

 {/* Real "sign once" toggle (2026-08-27), only ever shown
 once canBatchHire has genuinely confirmed batch
                    support for the connected wallet (never while still
                    checking, never as a broken option for a wallet that
                    doesn't support it). Disabled once a hire is actively
                    running, same as every other pre-hire control. */}
                {!hireStep && canBatchHire === CAN_BATCH_HIRE_STATUS.supported && (
                  <div className="mb-4 flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-inset">
                    <div>
                      <div className="text-xs font-semibold">{signOnceForAllSteps ? 'Sign once for all steps' : 'Sign each step individually'}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {signOnceForAllSteps
                          ? 'Your wallet supports this, one signature covers the on-chain steps after the job is created.'
                          : "You'll approve each on-chain step one at a time. This is the default if you'd rather see each one."}
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
 {/* Real, fallback message, only once the wallet's
 capability check has completed and
 genuinely doesn't support batching (not while still
                    unknown, and never a broken half-batched attempt). */}
                {!hireStep && canBatchHire === CAN_BATCH_HIRE_STATUS.unsupported && (
                  <p className="mb-4 text-[11px] text-gray-400">
                    "Sign once for all steps" isn't available for your connected wallet, signing each step individually below.
                  </p>
                )}

 {/* step checklist, every row's state comes straight from
                    useHireAgent's own tracked state (step/completedSteps/
                    skippedSteps/stepHashes/error), see buildHireStepList /
                    buildBatchHireStepList in useHireAgent.js. Only shown once
                    the flow has started; the batched builder is used only for
 a run that started in batched mode. */}
                {hireStep && (
                  <div className="mb-6 p-5 rounded-xl border border-line bg-inset">
                    <StepChecklist steps={(activeHireMode === 'batched' ? buildBatchHireStepList : buildHireStepList)({
                      step: hireStep, completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps,
                      stepHashes: hireStepHashes, error: hireError, budgetUnits: spendCap,
                      notifySkipReason: hireNotifySkipReason,
                    })} />
                    {hireStep === 'done' && (
                      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 mt-4 pt-4 border-t border-line">
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
            </div>
          )}

          {/* My Agents Tab, every ERC-8183 job where the connected
              wallet is the client, so a completed hire has somewhere to be
              found afterward. See MyJobsPanel.jsx for the backing. */}
          {nav === 'my-agents' && (
            <div className="w-full">
              <h1 className="text-h1 font-bold mb-2">My Agents</h1>
              <p className="text-muted mb-8">Every agent you've hired through here, and where things stand right now.</p>
              <MyJobsPanel accent={accent} mutedBorder="border-line" />
            </div>
          )}

        </div>

        {/* The site footer: the secondary pages (Explore agents, My agents,
            Docs, Status, Data sources, Privacy), where the figures come from,
            and the social marks. Shared with the mobile sheet. */}
        <SiteLinks
          onNavigate={(to) => { dismissAgentDetail(); onNavigate?.(to); }}
          activePath={path}
          className="mt-12"
        />
      </main>
    </div>
  );
}