import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ShieldAlert, ShieldCheck, FileBarChart, CheckCircle2, XCircle,
  GraduationCap, Store, ChevronRight, Loader2, AlertTriangle,
  Wallet, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, Menu,
  ExternalLink, Zap, Coins, Search, Briefcase, Globe, HelpCircle, Bot, Clock, CreditCard, Plug, Compass,
} from 'lucide-react';

import { useNavSync, useOverlayHistory } from './useViewHistory';
import { useHireAgent, buildHireStepList, buildBatchHireStepList, useAgentQuote, useBatchHireCapability, CAN_BATCH_HIRE_STATUS } from './useHireAgent';
import { DEADLINE_MIN_MINUTES, DEADLINE_MAX_MINUTES, DEADLINE_DEFAULT_MINUTES, DEADLINE_PRESETS, formatDeadline, validateDeadlineMinutes } from './hireDeadline';
import StepChecklist from './StepChecklist';
import GetULink from './GetULink';
import MyJobsPanel from './MyJobsPanel';
// The How It Works page's whole body, shared verbatim with
// AgentMarketplaceApp.web.jsx; `variant` changes type sizes only.
import NotificationBell from './NotificationBell';
import { addNotification, trackJob, getActiveWallet } from './notifications';
import { recordFunded } from './jobTiming';
import BuyAccessPanel from './BuyAccessPanel';
import PasskeyBadge from './PasskeyBadge';
import ServiceHealthBadge, { serviceRank } from './ServiceHealthBadge';
import { CATEGORY_HINTS } from './categoryHints';
import { agentShareUrl, copyShareLink, readDeepLinkAgentId, matchesDeepLink, agentPath } from './shareLink';
import {
  useMarketplaceInfinite, useMarketplaceFacets, fetchAgentById, useLatch,
  groupCountsFromFacets, hackathonCountsFromFacets, SERVE_READ_CAP,
} from './marketplaceQuery';
import ChainViewTabs from './chainViews/ChainViewTabs';
import HireModePicker, { HIRE_MODE } from './HireModePicker';
import BudgetHirePanel from './BudgetHirePanel';
import { useBudgetModeStatus } from './budgetEscrow';
import { useAgentPerformanceBulk } from './useAgentPerformanceBulk';
import { useCanaryStatus } from './useCanaryStatus';
import { withPerformance, withCanaryStatus, performanceComparator, agentHasRealHistory } from './agentRanking';
import { getVerificationTier, VERIFICATION_TIER, VERIFICATION_LABEL_SHORT, VERIFIED_MEANING, withVerificationTierFirst } from './agentVerification';
import VerificationBadge, { VerificationTierDivider } from './VerificationBadge';
import VerificationExplainerSection from './VerificationExplainerSection';
import DeliveryProvenance from './DeliveryProvenance';
import InfoTooltip from './InfoTooltip';
import { CATEGORY_GROUPS, groupForCategory } from './categoryGroups';
import { HACKATHON_CATEGORIES, hackathonForCategory } from './hackathonCategories';
import { useHireFlowEscrowGate, useEscrowCompatibility } from './EscrowCompatibilityWarning';
import UniversalSearchFallback from './UniversalSearchFallback';
import AgentMetrics from './AgentMetrics';
import QualityCenterPanel from './QualityCenterPanel';
import ContractVerificationBadge from './ContractVerificationBadge';
import AgentAvatar from './AgentAvatar';
import InteractionLine from './InteractionLine';
import DeliveryRecord from './DeliveryRecord';
import BudgetRecord from './BudgetRecord';
import SiteLinks from './SiteLinks';
import { BnbPriceSource } from './shell/DataAttribution';
import WalletIdentity from './wallet/WalletIdentity';
import { useConnectedWallet } from './wallet/useConnectedWallet';
import { useSignIn } from './wallet/SignInProvider';
import ThemeToggle from './theme/ThemeToggle';
import Wordmark from './shell/Wordmark';
import TopSearch from './shell/TopSearch';
import { PRODUCT_NAV, PRODUCT_PAGE_IDS } from './shell/productNav';
import Dashboard from './pages/Dashboard';
import Stocks from './pages/Stocks';
import Vaults from './pages/Vaults';
import MyEtfs from './pages/MyEtfs';
import UseWithAi from './pages/UseWithAi';
import { useTheme } from './theme/ThemeProvider';
import { ChainCardBadge } from './chainViews/chainMarks';
import { resetChainChoice } from './chainViews/ChainViewTabs';
import { useBnbQuote, labelledBnbUsd, formatBnbWithUsd } from './useBnbPrice';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain' }; // mainnet-only

// Bumped to v2 alongside the web app, see AgentMarketplaceApp.web.jsx's
// CACHE_KEY comment for the reason (a stale-client-cache theory from
// investigating a reported web-only missing-button bug that a real
// headless render proved isn't a code-level divergence).
// Renamed to 'tnega-cache-v1' alongside web + EcosystemGlobePage for the
// Tnega rebrand, see AgentMarketplaceApp.web.jsx's CACHE_KEY comment.
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
    // Carried through as-is. This mapper renames the API's snake_case into
    // the shape the app uses, and anything it does not name is dropped: that
    // is why the interaction sentence rendered on the chain views and nowhere
    // on BNB Chain until this line existed.
    interaction: a.interaction,
    financialDataAvailable: a.financial_data_available, tvlUsd: a.tvl_usd,
 // Real, added 2026-08-29, same DefiLlama match as tvlUsd, zero extra
 // API calls, see the matching web.jsx comment for the full real
    // reasoning behind each field.
    tvlChange7dPct: a.tvl_change_7d_pct, auditCount: a.audit_count,
    tvlDataFlagged: a.tvl_data_flagged, mcapUsd: a.mcap_usd,
    ownerBnbBalance: a.owner_bnb_balance, possiblyDelisted: a.possibly_delisted, session: null,
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

// (see useMarketplaceInfinite's confirmedFresh in marketplaceQuery.js), a
// pulsing bar, never a
// number that might be wrong. Parity with web's StatSkeleton.
function StatSkeleton() {
  return <div className="h-5 w-10 mx-auto rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />;
}

// The main navigation, shared with the web header through shell/productNav.js
// so the two cannot drift. All five product pages fit in the bottom bar, each
// with its short `barLabel`; Explore agents and My agents are reached from the
// footer links, in the menu sheet and at the foot of each page.
const NAV_ITEMS = PRODUCT_NAV;
const PRIMARY_NAV_IDS = ['dashboard', 'stocks', 'vaults', 'my-etfs', 'ai'];
const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((i) => PRIMARY_NAV_IDS.includes(i.id));

// The menu sheet: the wallet, the theme, and the footer links. Every product
// page is in the bottom bar, so the sheet holds no navigation of its own.
function MobileWalletSheet({ onClose, onNavigate, path }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-h-[90dvh] overflow-y-auto bg-surface text-fg border-t border-line rounded-t-xl p-5 pb-10" onClick={e => e.stopPropagation()}>
        <div className="w-10 h-1 bg-line-strong rounded-full mx-auto mb-5" />
        {/* The wallet first: signing in is the one thing in this sheet a
            visitor may have come here to do. Same control as the web
            header (wallet/WalletIdentity.jsx), laid out for the width. The
            sheet closes before the sign-in page or modal opens. */}
        <div className="mb-5">
          <h3 className="text-micro font-semibold uppercase tracking-wider text-muted mb-2 px-1">Wallet</h3>
          <WalletIdentity
            layout="sheet"
            onBeforeOpen={onClose}
            onOpenSignInPage={onNavigate ? () => onNavigate('/signin') : undefined}
          />
        </div>
        {/* Three positions, system by default, reachable without a wallet. */}
        <div className="mb-4">
          <h3 className="text-micro font-semibold uppercase tracking-wider text-muted mb-2 px-1">Theme</h3>
          <ThemeToggle labels />
        </div>
        <SiteLinks
          onNavigate={onNavigate ? (to) => { onClose(); onNavigate(to); } : undefined}
          activePath={path}
          className="mt-6"
        />
      </div>
    </div>
  );
}

const BSCSCAN = 'https://bscscan.com';

// Full agent detail, a full-screen push (matching the hire flow), showing
// everything the aggregated data holds for one agent.
function AgentDetailMobile({ agent, onBack, onHire, onTrySkill }) {
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
    <div className="p-5">
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 font-medium">
          <ChevronRight size={18} className="rotate-180" /> Back
        </button>
        {/* Shareable per-agent link */}
        <button onClick={onShare} className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
          <Link2 size={14} /> {copied ? 'Copied!' : 'Share'}
        </button>
      </div>
      <div className="bg-surface rounded-md p-6 border border-line">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <AgentAvatar agent={agent} size={44} />
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span title={CATEGORY_HINTS[agent.category]} className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">{agent.category}</span>
                {agent.possiblyDelisted && <span title="Not seen active in over a week" className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">may no longer be active</span>}
              </div>
              <h2 className="text-h1 font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={18} className="text-indigo-500" title="Registered on-chain, not a quality rating" />}</h2>
            </div>
          </div>
          <span className="text-[10px] px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 font-medium shrink-0">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3 text-center">
 {[['Score', agent.totalScore != null ? agent.totalScore.toFixed(1) : 'n/a', 'How trustworthy this agent looks, based on past feedback'],
            ['Stars', agent.starCount ?? 'n/a', 'How many people rated this agent'],
            ['On-chain Feedback', agent.totalFeedbacks ?? 'n/a', 'On-chain ERC-8004 feedback entries for this agent, a count only, with no written text or rating behind it'],
            ['Funds', agent.financialDataAvailable && agent.tvlUsd != null ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : 'n/a', 'Total money this agent currently manages for people']].map(([l, v, hint]) => (
            <div key={l} title={hint} className="p-2 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <span className="block text-[9px] text-gray-500 uppercase">{l}</span>
              <span className="font-bold text-sm">{v}</span>
            </div>
          ))}
        </div>
        {agent.financialDataAvailable && agent.defillamaUrl && (
          <div className="mb-4">
            <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-500 inline-flex items-center gap-1">Where this money number comes from: DefiLlama <ExternalLink size={11} /></a>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-muted">
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
                <span>DefiLlama flags this protocol's reported funds as possibly unrepresentative of its value.</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 my-4">
          {agent.isVerified && <span title="Registered on-chain, not a quality rating" className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><BadgeCheck size={12} />Verified</span>}
          {agent.x402Supported && <span title="Can pay other agents automatically for tools or data it needs, without a person approving each payment" className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><Zap size={12} />Pays other agents automatically</span>}
          {(agent.supportedProtocols || []).map((p) => <span key={p} title={`Works with ${p}, an app it can act on for you`} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"><Coins size={12} />{p}</span>)}
          <ServiceHealthBadge status={agent.serviceStatus} checkedAt={agent.serviceCheckedAt} size="md" />
          {(!agent.serviceStatus || agent.serviceStatus === 'unknown') && (
            <span className="text-[11px] text-gray-400">Not confirmed online yet</span>
          )}
        </div>
        {agent.serviceEndpoint && (
          <p className="text-[11px] text-gray-400 mb-3 -mt-2 break-all" title="The web address we contact to check whether this agent is turned on">Where we check on it: <span className="font-mono">{agent.serviceEndpoint}</span></p>
        )}

        <h3 className="text-sm font-bold mb-1">About</h3>
        <p className="text-sm text-muted leading-relaxed mb-4">{agent.strategy}</p>
        <InteractionLine interaction={agent.interaction} className="mb-4"
          deliveredCount={(agent.jobsCompleted ?? 0) + (agent.jobsSubmitted ?? 0)} />

        {/* Who paid for the deliveries behind the tier. */}
        <DeliveryProvenance agent={agent} className="mb-4" />
        <DeliveryRecord agent={agent} className="mb-4" />
        {/* BNB Chain has both hire paths, so it gets both records. The
            ERC-8183 one above covers escrow jobs; this covers drawable
            budgets, which the job index cannot see at all. */}
        <BudgetRecord agent={agent} className="mb-4" />

        <h3 className="text-sm font-bold mb-1 flex items-center gap-2">Who owns this agent <PasskeyBadge ownerAddress={agent.ownerAddress} /> {agent.id && <ContractVerificationBadge agentId={agent.id} />}</h3>
        {agent.ownerAddress ? (
          <>
            <a href={`${BSCSCAN}/address/${agent.ownerAddress}`} target="_blank" rel="noreferrer" className="font-mono text-xs text-indigo-500 inline-flex items-center gap-1 break-all">{agent.ownerAddress} <ExternalLink size={11} className="shrink-0" /></a>
            <p className="text-[11px] text-gray-400 mt-1">This is the agent creator's wallet ID. A public account number anyone can look up, like a bank account number that's safe to share.</p>
          </>
        ) : <p className="text-xs text-gray-400">We don't have an owner ID on record for this agent.</p>}

 {/* live BNB balance of the owner wallet, a different metric from
            "Funds", labeled and placed separately so the two are never
            confused with one another. */}
        <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-100 dark:border-indigo-500/20">
          <span title="BNB is this network's own currency, used to pay small network fees. This is how much the owner's wallet holds right now." className="text-xs text-muted flex items-center gap-1.5"><Wallet size={13} /> Owner's wallet balance <span className="text-[10px] text-gray-400">(in BNB)</span></span>
          <span className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-sm font-semibold">{agent.ownerBnbBalance != null ? formatBnbWithUsd(agent.ownerBnbBalance, bnbUsdPrice) : <span className="text-muted font-normal">n/a</span>}</span>
            {/* What the dollar figure is: the on-chain BNB/USD average, its
                label, window and block. Shown only when a dollar value is. */}
            {agent.ownerBnbBalance != null && bnbUsdPrice != null && <BnbPriceSource quote={bnbQuote} className="text-right" />}
          </span>
        </div>
 {/* Real, final, unified "Metrics" presentation, see the matching
            comment on AgentDetail (web) / AgentMetrics.jsx's own header
            for the full consolidation rationale (same file web
 uses). The harder, last-chance gate still lives in the actual
            funding modal below. */}
        <AgentMetrics agent={agent} onHire={onHire} onTrySkill={onTrySkill} />

        {agent.id && <QualityCenterPanel agentId={agent.id} />}

        {agent.tokenId != null && <BuyAccessPanel agentId={String(agent.tokenId)} />}
      </div>
    </div>
  );
}

// The mobile shell. The tap-to-continue splash that used to gate it (the
// agents artwork) was removed on 2026-09-25: it stood between every phone
// visitor and the Dashboard, and its picture belonged to the agents product.
export default function AgentMarketplaceMobileRoot(props = {}) {
  return <AgentMarketplaceMobile {...props} />;
}

function AgentMarketplaceMobile({ onOpenEcosystem, onOpenDataSources, onOpenPartners, onOpenDocs, onNavigate, path = '/', query = '', initialNav, onNavChange } = {}) {
 // bug found and fixed (2026-08-27, full mobile/web parity audit):
  // this file referenced an undefined `REPORT_ACCENT` (never defined or
  // imported anywhere in the codebase) on AltanaSkillsPanel, a guaranteed
  // ReferenceError crash the moment a user opened that tab. (At the time,
  // AltanaSkillsPanel lived on the Build tab; it moved to its own Skills
  // tab 2026-08-29, see NAV_ITEMS' own comment above.) Same accent
  // value web uses (AgentMarketplaceApp.web.jsx).
  const accent = '#6366F1';
  // The theme is the site's, not this component's: see theme/ThemeProvider.jsx.
  // `darkMode` is still handed to the few panels that take it as a prop.
  const { dark: darkMode } = useTheme();
  // The first-visit tour is no longer opened here; see the matching note in
  // AgentMarketplaceApp.web.jsx.
 // per-tab URL routing, see the matching comment in
  // AgentMarketplaceApp.web.jsx; identical mechanism here.
  const [nav, setNav] = useState(initialNav || 'dashboard');
  useEffect(() => {
    if (initialNav && initialNav !== nav) setNav(initialNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNav]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyResponding, setOnlyResponding] = useState(false);
 // Real, opt-in filter (see agentVerification.js), off by default.
  const [onlyVerified, setOnlyVerified] = useState(false);
  // Two-tier category filter (categoryGroups.js), matches web.
  const [activeGroup, setActiveGroup] = useState('All');
  // Same two lenses as web, kept here rather than shared because the chip
  // markup differs. The mapping itself is shared (hackathonCategories.js),
  // so the two apps can never disagree about what is under a label.
  const [categoryView, setCategoryView] = useState('categories');
  const [activeHackathon, setActiveHackathon] = useState('All');
 // sort, mobile had no sort control at all before this (the list
  // just showed the backend's own default, score-sorted order). 'default'
  // keeps that; 'hireCount'/'winRate' switch to the tiered comparator
  // (agentRanking.js, same logic web uses, see its own comment for why
 // history sorts first and no-history agents are listed after,
  // never mixed in).
  const [sortKey, setSortKey] = useState('default');
  // Explore's data is requested only once Explore has been shown, as on web:
  // the Dashboard on "/" has no use for it.
  const exploreShown = useLatch(nav === 'market');
  const { byOwner: perfByOwner, indexComplete: perfIndexComplete, storeWideTotals: perfStoreWide, status: perfStatus, retry: retryPerf } = useAgentPerformanceBulk({ enabled: exploreShown });
  const { byOwner: canaryByOwner } = useCanaryStatus({ enabled: exploreShown });
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [detailAgent, setDetailAgent] = useState(null); // full-screen agent detail push
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
  const [hiring, setHiring] = useState(false);
  // Escrow by default, always -- budget mode is opt-in because it is a
 // reduction in buyer protection.
  const [hireMode, setHireMode] = useState(HIRE_MODE.ESCROW);
  // Asked per agent, not per contract: the escrow being deployed does not
  // mean THIS agent can draw from it. Defaults to unavailable while it
  // loads, so a possible dead end is never offered before it is ruled out.
  const budgetMode = useBudgetModeStatus(selectedAgent?.ownerAddress || selectedAgent?.owner_address);
  const [spendCap, setSpendCap] = useState(50000);
  const [spendCapTouched, setSpendCapTouched] = useState(false);
 // Real, user-facing job deadline, see the matching comment in
  // AgentMarketplaceApp.web.jsx (kept in sync) and hireDeadline.js.
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEADLINE_DEFAULT_MINUTES);
  const deadlineError = validateDeadlineMinutes(deadlineMinutes);
  // Advanced override for the on-chain job description, see the matching
  // comment in AgentMarketplaceApp.web.jsx (kept in sync with web).
  const [customDescription, setCustomDescription] = useState('');
  const [showCustomDescription, setShowCustomDescription] = useState(false);
 // Real, live price discovery, see useAgentQuote in useHireAgent.js /
  // the matching comment in AgentMarketplaceApp.web.jsx (kept in sync).
  const agentQuote = useAgentQuote(hiring ? selectedAgent : null);
  useEffect(() => {
    if (agentQuote.status === 'available' && !spendCapTouched) {
      setSpendCap(agentQuote.priceUnits);
    }
  }, [agentQuote.status, agentQuote.priceUnits, spendCapTouched]);
  // Hire-by-address escape hatch, see the matching comment in
  // AgentMarketplaceApp.web.jsx (kept in sync with web).
  const [showManualHire, setShowManualHire] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Tab changes from the header, the bottom bar and the sheet go through one
  // function, as on web, so they cannot drift in what they reset.
  const goTo = (id) => {
    dismissAgentDetail();
    // Explore opens on its chain list, as on web.
    if (id === 'market') resetChainChoice();
    setNav(id); setHiring(false); onNavChange?.(id);
  };
  const facets = useMarketplaceFacets({ enabled: exploreShown });
  // One page at a time, appended by "Load more". Every filter is part of the
  // request, so changing one asks the server for a new selection rather than
  // re-filtering rows already downloaded.
  const {
    agents, setAgents, total: filteredTotal, tiers: filteredTiers,
    loading, error, confirmedFresh, loadMore, hasMore,
  } = useMarketplaceInfinite({
    categoryView, activeGroup, activeCategory, activeHackathon,
    searchQuery, showUnclassified: true, onlyResponding, onlyVerified,
    sortKey: sortKey === 'default' ? null : sortKey, sortDir: 'desc',
  }, mapAgent, 12, { enabled: exploreShown });
 // bug fix, 2026-08-26: this used to sit up near `sortKey` (right
  // after the state declarations, before `agents` itself existed yet),
  // `agents` is a `const` from useMarketplaceAgents() below, and JS's
  // temporal dead zone means referencing a `const` before its own
  // declaration line throws ReferenceError, on every single render. That
  // crashed the ENTIRE mobile app (web was fine, there, `agents` happens
  // to be destructured near the top, before its own agentsWithPerf line,
 // so the same code never hit this). fix: declare it here, right
 // after `agents` itself, matching web's ordering.
  const agentsWithPerf = useMemo(
    () => withCanaryStatus(withPerformance(agents, perfByOwner), canaryByOwner),
    [agents, perfByOwner, canaryByOwner]
  );

  // Deep link: ?agent=<tokenId|id> opens that agent once agents load.
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
  }, [agents]);

  // Hiring needs a connected wallet, not a signed-in one: the wallet signs
  // each hire transaction itself. Same gate as web: open the sign-in modal
  // on its connect step.
  const { isConnected: walletConnected } = useConnectedWallet();
  const { openSignIn } = useSignIn();

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

 // Real, last-chance escrow-compatibility gate, parity with web, see
  // EscrowCompatibilityWarning.jsx.
  const hireEscrowGate = useHireFlowEscrowGate(selectedAgent?.ownerAddress, selectedAgent?.id);

  const {
    hire, hireBatched, step: hireStep, error: hireError,
    completedSteps: hireCompletedSteps, skippedSteps: hireSkippedSteps, stepHashes: hireStepHashes,
    notifySkipReason: hireNotifySkipReason,
  } = useHireAgent();
 // Real "sign once" batched alternative (2026-08-27), parity with web,
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
 if (deadlineError) return; // bounds, the button itself is also disabled on this, see below
    // The hire awaits several confirmations; file its notifications under the
    // wallet that started it, not whichever is connected when it ends.
    const owner = getActiveWallet();
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
      // hireError from the hook is surfaced in the modal, no silent failure
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Filtering, sorting and the tier-first ordering moved to the server
  // (core/agents_index.py). A page cannot be cut correctly until the filters
  // have been applied, so filtering a page the client already holds would give
  // the wrong page rather than a slower one.
  //
  // "Load more" still appends, it just appends the next offset from the server
  // instead of the next slice of a fully-downloaded array. 12 per page,
  // smaller than web's 24 since these cards are full-width and taller.
  const MOBILE_PAGE_SIZE = 12;
  const visible = agentsWithPerf;

 // per-group counts (categoryGroups.js), matches web.
  const groupCounts = useMemo(
    () => groupCountsFromFacets(facets.categories), [facets.categories]);

  // Fine-grained category chips scoped to the active group, matches web.
  const hackathonCounts = useMemo(
    () => hackathonCountsFromFacets(facets.categories), [facets.categories]);

  const activeGroupCategories = useMemo(() => {
    if (activeGroup === 'All' || activeGroup === 'Unclassified') return [];
    const groupCats = CATEGORY_GROUPS.find((g) => g.id === activeGroup)?.categories || [];
    // From the facet counts, not the loaded rows: reading it off what is on
    // screen would hide a category's chip until its agents were loaded.
    const present = new Set((facets.categories || []).map((c) => c.category));
    return ['All', ...groupCats.filter((c) => present.has(c))];
  }, [facets.categories, activeGroup]);
  useEffect(() => { setActiveCategory('All'); }, [activeGroup]);

 // Real, marketplace-wide tier counts + per-card tier-break markers, see
  // the matching comment in AgentMarketplaceApp.web.jsx (kept in sync).
  // Over the whole filtered selection, returned with the page. Counting the
  // loaded rows instead would report the tally of what has been scrolled to.
  const tierCounts = useMemo(() => ({
    [VERIFICATION_TIER.VERIFIED]: filteredTiers?.verified ?? 0,
    [VERIFICATION_TIER.CANARY_VERIFIED]: filteredTiers?.canary_verified ?? 0,
    [VERIFICATION_TIER.RESPONDING]: filteredTiers?.responding ?? 0,
    [VERIFICATION_TIER.UNPROVEN]: filteredTiers?.unproven ?? 0,
    [VERIFICATION_TIER.UNCHECKED]: filteredTiers?.unchecked ?? 0,
  }), [filteredTiers]);
  const visibleTierBreaks = useMemo(() => {
    let lastTier = null;
    return visible.map((agent) => {
      const tier = getVerificationTier(agent);
      const isNewTier = tier !== lastTier;
      lastTier = tier;
      return isNewTier ? tier : null;
    });
  }, [visible]);

  // Same stat cards as web (Listed / Feedback / Verified), from the same
  // source: /api/agents/facets, which counts the whole chain catalogue on the
  // server. These were reduced over agentsWithPerf, which holds only the pages
  // loaded so far, so "Listed" read 12 (one page) instead of the chain total,
  // and Feedback and Verified were page counts too. The verification tier is
  // still agentVerification.js's definition, applied server-side.
  const stats = useMemo(() => ({
    total: facets.total,
    verified: facets.tiers?.verified ?? 0,
    totalFeedbacks: facets.totalFeedbacks,
  }), [facets]);

  return (
    <div className="relative flex flex-col h-[100dvh] font-sans bg-page text-fg">

      {/* The header, following the reference's phone layout: the wordmark
          on the left; search, the bell and the menu on the right, each a 44px
          target. Search opens a row under the header with the same field as
          the web header (shell/TopSearch.jsx). */}
      <header className="shrink-0 bg-surface border-b border-line z-20 pt-safe">
        <div className="h-14 flex items-center justify-between gap-2 pl-4 pr-2">
          <a
            href="/"
            onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); goTo('dashboard'); }}
            className="min-w-0 text-fg"
          >
            <Wordmark className="text-[24px]" />
          </a>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search stocks, ETFs or vaults"
              aria-expanded={searchOpen}
              className={`w-11 h-11 flex items-center justify-center rounded ${searchOpen ? 'text-fg bg-inset' : 'text-fg hover:bg-inset'}`}
            >
              <Search size={20} />
            </button>
            <NotificationBell />
            <button onClick={() => setWalletSheetOpen(true)} aria-label="Menu and wallet" className="w-11 h-11 flex items-center justify-center rounded text-fg hover:bg-inset">
              <Menu size={20} />
            </button>
          </div>
        </div>
        {searchOpen && (
          <div className="px-4 pb-3">
            <TopSearch
              key={query}
              initial={query}
              autoFocus
              onSearch={(to) => { setSearchOpen(false); dismissAgentDetail(); setHiring(false); onNavigate?.(to); }}
            />
          </div>
        )}
      </header>

      {/* Main Scrollable Content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-32">
        
        {hiring && selectedAgent ? (
          <div className="p-5">
            <button onClick={() => setHiring(false)} disabled={hireStep && hireStep !== 'done' && !hireError} className="flex items-center gap-1 text-sm text-gray-500 font-medium mb-6 disabled:opacity-40">
              <ChevronRight size={18} className="rotate-180" /> Back
            </button>
            {/* Funding model, parity with web. Escrow is the default and
                the ERC-8183 markup below is unchanged -- only hidden while
                budget mode is active. */}
            <div className="bg-surface rounded-md p-5 border border-line mb-4">
              <div className="flex items-center gap-3 mb-4">
                <AgentAvatar agent={selectedAgent} size={44} />
                <h2 className="text-xl font-bold">{selectedAgent.name}</h2>
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
            <div className="bg-surface rounded-md p-6 border border-line">
              <div className="mb-4">
                <AgentAvatar agent={selectedAgent} size={64} />
              </div>
              <h2 className="text-h1 font-bold mb-1">{selectedAgent.name}</h2>
              <p className="text-muted text-sm mb-4">You'll approve a few quick steps in your wallet, tracked below as they happen.</p>

 {/* Real, last-chance gate, parity with web, see
                  EscrowCompatibilityWarning.jsx. */}
              {hireEscrowGate.node}

              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={16} className="text-indigo-500" />
                <span className="text-xs font-bold uppercase tracking-wide opacity-70">Always Ask</span>
              </div>

              <div className="space-y-6">
                {/* Unified "how much and how long" step (2026-09-09), see
                    the matching comment in AgentMarketplaceApp.web.jsx
                    (kept in sync). */}
                <div className="p-4 rounded-2xl border border-line bg-gray-50/50 dark:bg-white/[0.02] space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">How much are you funding this job for? <span className="font-normal text-gray-400" title="$U is a type of digital dollar, 1 $U is worth about $1.">($U, worth about $1 each)</span></label>

                  {/* Live price discovery, see the matching comment
                      in AgentMarketplaceApp.web.jsx (kept in sync). */}
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

                  <input type="number" value={spendCap} onChange={(e) => { setSpendCap(e.target.value); setSpendCapTouched(true); }} disabled={hireStep && !hireError} className="w-full p-4 rounded-xl border border-line bg-inset text-lg font-mono outline-none disabled:opacity-50" />
                  <div className="mt-1.5"><GetULink /></div>
                </div>

 {/* Real, user-facing job deadline (2026-09-09), see the
                    matching comment in AgentMarketplaceApp.web.jsx (kept in
                    sync) and hireDeadline.js. Scoped to third-party hiring
                    only, Native Agents and Skills are atomic,
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${Number(deadlineMinutes) === p.minutes ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400' : 'border-line text-muted'}`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <input
                    type="number" value={deadlineMinutes} disabled={hireStep && !hireError}
                    onChange={(e) => setDeadlineMinutes(e.target.value)}
                    className="w-full p-4 rounded-xl border border-line bg-inset text-lg font-mono outline-none disabled:opacity-50"
                  />
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    {deadlineError
                      ? <span className="text-red-500">{deadlineError}</span>
 : <>Minutes ({formatDeadline(deadlineMinutes)}). If the agent hasn't delivered by then, you can reclaim your funds, minimum {DEADLINE_MIN_MINUTES} min, maximum {formatDeadline(DEADLINE_MAX_MINUTES)}.</>}
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
                        className="w-full p-3 rounded-xl border border-line bg-inset text-xs font-mono outline-none disabled:opacity-50"
                      />
                      <p className="text-[11px] text-gray-400 mt-1">Only for advanced users. This replaces the automatic description above with your own text, permanently recorded. Leave it blank unless you have a specific reason to use this.</p>
                    </div>
                  )}
                </div>

 {/* Real "sign once" toggle (2026-08-27), parity with web,
 only ever shown once canBatchHire genuinely confirms
 batch support for the connected wallet. */}
                {!hireStep && canBatchHire === CAN_BATCH_HIRE_STATUS.supported && (
                  <div className="mb-3 flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-inset">
                    <div>
                      <div className="text-xs font-semibold">{signOnceForAllSteps ? 'Sign once for all steps' : 'Sign each step individually'}</div>
                      <div className="text-[11px] text-gray-400 mt-0.5">
                        {signOnceForAllSteps
                          ? 'Your wallet supports this, one signature covers the on-chain steps after the job is created.'
 : "You'll approve each on-chain step one at a time, the default."}
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
                    "Sign once for all steps" isn't available for your connected wallet, signing each step individually below.
                  </p>
                )}

 {/* step checklist, identical logic to web, via the
                    same shared buildHireStepList/buildBatchHireStepList
                    helpers (useHireAgent.js), so the two can't drift on
 what each step means. */}
                {hireStep && (
                  <div className="p-4 rounded-xl border border-line bg-inset">
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

                <button onClick={handleActivateSession} disabled={(hireStep && hireStep !== 'done' && !hireError) || hireEscrowGate.blocked || !!deadlineError} className="w-full py-4 rounded-xl font-bold text-white bg-indigo-600 active:scale-[0.98] transition-transform disabled:opacity-50">
                  {hireStep === 'done' ? 'HIRED ✓' : hireError ? 'TRY AGAIN' : hireEscrowGate.blocked ? 'CHECK THE BOX ABOVE' : deadlineError ? 'FIX THE DEADLINE ABOVE' : 'HIRE'}
                </button>
              </div>
            </div>
            </div>
          </div>
        ) : detailAgent ? (
          <AgentDetailMobile
            agent={detailAgent}
            onBack={closeAgentDetail}
            onHire={(a) => { setDetailAgent(null); handleHireClick(a); }}
          />
        ) : PRODUCT_PAGE_IDS.includes(nav) ? (
          // The product pages, the same components web renders; `layout`
          // changes spacing only.
          <>
            {nav === 'dashboard' && <Dashboard layout="mobile" />}
            {nav === 'stocks' && <Stocks layout="mobile" query={query} />}
            {nav === 'vaults' && <Vaults layout="mobile" />}
            {nav === 'my-etfs' && <MyEtfs layout="mobile" />}
            {nav === 'ai' && <UseWithAi layout="mobile" />}
          </>
        ) : (
          <div className="p-5">
            {/* The page's one h1, as on web: the visible headings below
                belong to whichever chain view is open. */}
            {nav === 'market' && <h1 className="sr-only">Explore agents</h1>}
            {nav === 'market' && (
              <ChainViewTabs mutedBorder="border-line">
                {/* BNB Chain view below is the original mobile marketplace,
                    unchanged; ChainViewTabs renders it as-is on the BNB tab. */}
                <>
                <div className="mb-4">
                  <h2 className="text-h1 font-bold mb-1">Explore</h2>
                  <p className="text-sm text-muted">Browse AI agents and hire one with a spending limit you control.</p>
                </div>

 {/* stat cards (parity with web). The diversity-limit note and
                    badge legend used to each be a permanent paragraph stacked below
 here, now behind small on-demand (i) icons instead, same real
                    meaning, no permanent space. */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {[
                    { label: 'Listed', value: stats.total, icon: Activity, color: '#2563EB', info: (
                      <>This is a varied mix, not every agent that exists. Most agents here were created in a few
                      big signup batches and look nearly identical, so we limit how many near-duplicates show up,
                      there are more agents out there, we're just not cluttering your view with lookalikes. The count
                      is also bounded by our read cap: we serve at most {SERVE_READ_CAP.toLocaleString()} agents, so this is the size
                      of what we serve, not of the registry.</>
                    ), caption: `served, read capped at ${SERVE_READ_CAP.toLocaleString()}` },
                    { label: 'On-chain Feedback', value: stats.totalFeedbacks, icon: MessageSquare, color: '#059669', hint: 'On-chain ERC-8004 feedback entries recorded against these agents. Counts only, no written text and no star rating, so there is nothing to read behind the number. Most of it comes from one automated cluster rather than many independent buyers.' },
                    { label: VERIFICATION_LABEL_SHORT[VERIFICATION_TIER.VERIFIED], value: stats.verified, icon: Users, color: '#7C3AED', hint: `${VERIFIED_MEANING} (see 'How we verify agents' below)` },
                  ].map((c) => {
                    const Icon = c.icon;
                    return (
                      <div key={c.label} title={c.hint} className="bg-surface p-3 rounded-md border border-line text-center">
                        <Icon size={16} className="mx-auto mb-1" style={{ color: c.color }} />
 {/* fix (2026-08-27): only render the real,
                            confirmed-fresh count, a skeleton until then,
                            never a stale cached number that later jumps. */}
                        {confirmedFresh && facets.loaded ? <div className="text-lg font-bold">{c.value.toLocaleString()}</div> : <StatSkeleton />}
                        <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5">
                          {c.label}
                          {c.info && <InfoTooltip label="" size={11} align="right">{c.info}</InfoTooltip>}
                        </div>
                        {/* Beside the number, as on web: the served set stops
                            at the backend read cap. */}
                        {c.caption && <div className="text-[10px] text-muted leading-tight mt-0.5">{c.caption}</div>}
                      </div>
                    );
                  })}
                </div>

 {/* Real, permanently-accessible explainer (2026-08-27),
                    parity with web. See VerificationExplainerSection.jsx. */}
                <VerificationExplainerSection className="mb-4" storeWideTotals={perfStoreWide} livenessCoverage={facets.livenessCoverage} />

                <div className="mb-4">
                  <InfoTooltip label="What does the live 'Online now' badge mean?" size={12}>
                    <div className="space-y-2">
                      <p><strong>Online now</strong> means we reached this agent's endpoint just now and it answered. No checkmark only means we haven't confirmed recently, not that anything is broken. Either way it isn't a quality signal on its own. See "How we verify agents" above for what counts as proof.</p>
                    </div>
                  </InfoTooltip>
                </div>

                <div className="mb-3 relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Search by name, id, or address…" className="w-full pl-10 pr-4 py-3 rounded-md border border-line bg-surface text-sm outline-none" />
                </div>

                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  title="Ranks agents with a hire history first; those without are listed after, kept separate"
                  className="mb-3 w-full px-4 py-3 rounded-md border border-line bg-surface text-sm outline-none"
                >
                  <option value="default">Sort: Top score</option>
                  <option value="hireCount">Sort: Most hired</option>
                  <option value="winRate">Sort: Highest success rate</option>
                </select>

                {(sortKey === 'hireCount' || sortKey === 'winRate') && (
                  <div className="mb-4 flex items-start gap-2 text-[11px] text-muted p-3 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-line">
                    <Activity size={13} className="shrink-0 mt-0.5 text-indigo-500" />
                    <span>
                      Ranked by on-chain hire history{sortKey === 'hireCount' ? ', most jobs first' : ', highest success rate first'}.
                      Agents with no hires yet are listed after those with one, not mixed in.
                    </span>
                  </div>
                )}

                <div className="mb-4 flex items-center gap-2 flex-wrap pt-3 border-t border-line">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-1 shrink-0 w-full">Filters</span>
                  <button
                    onClick={() => setOnlyVerified((v) => !v)}
                    className={`px-3.5 py-2 rounded-xl text-[11px] font-medium border transition-colors ${
                      onlyVerified
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-400'
                        : 'border-line bg-surface text-muted'
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
                        : 'border-line bg-surface text-muted'
                    }`}
                  >
                    {onlyResponding ? '✓ ' : ''}Only show online agents
                  </button>
                </div>

 {/* Real, failure state (2026-08-27), see the
                    matching comment on AgentMarketplaceApp.web.jsx. */}
                {perfStatus === 'error' && (
                  <div className="mb-3 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
                    <AlertTriangle size={12} className="shrink-0" />
                    Couldn't load hire-history data, so filters and sorts using it may be inaccurate.
                    <button onClick={retryPerf} className="underline font-medium">Try again</button>
                  </div>
                )}

                {/* Hire-by-address escape hatch, see the matching block in
                    AgentMarketplaceApp.web.jsx. */}
                <div className="mb-4">
                  <button type="button" onClick={() => setShowManualHire((v) => !v)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold border border-line bg-surface text-muted">
                    <Search size={12} />{showManualHire ? 'Hide this' : "Know an agent's ID? Hire it directly"}
                  </button>
                  {showManualHire && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="text"
                        value={manualAddress}
                        onChange={(e) => setManualAddress(e.target.value.trim())}
                        placeholder="0x… the agent owner's wallet ID"
                        className="flex-1 px-4 py-2.5 rounded-xl border border-line bg-surface text-sm font-mono outline-none"
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

                {/* Two-tier category filter (categoryGroups.js), group
 first, fine-grained categories only shown once a
                    group is picked. Matches web. */}
                <div className="flex items-center gap-1 text-[11px] pb-2">
                  <span className="opacity-40 mr-1">Browse by</span>
                  {[['categories', 'Categories'], ['defi', 'DeFi categories']].map(([id, label]) => (
                    <button key={id} onClick={() => setCategoryView(id)} className={`px-3 py-1 rounded-full font-semibold transition-colors ${
                      categoryView === id ? 'bg-indigo-600 text-white' : 'text-muted'
                    }`}>{label}</button>
                  ))}
                </div>

                {categoryView === 'defi' && (
                  <div className="flex overflow-x-auto pb-4 -mx-5 px-5 gap-2 snap-x hide-scrollbar">
                    <button onClick={() => setActiveHackathon('All')} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                      activeHackathon === 'All' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-surface border border-line text-muted'
                    }`}>All four</button>
                    {HACKATHON_CATEGORIES.map((h) => (
                      <button key={h.id} onClick={() => setActiveHackathon(h.id)} title={`Includes: ${h.categories.join(', ')}`} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                        activeHackathon === h.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-surface border border-line text-muted'
                      }`}>{h.label} ({confirmedFresh ? (hackathonCounts[h.id] || 0) : '…'})</button>
                    ))}
                  </div>
                )}

                <div className={`flex overflow-x-auto pb-3 -mx-5 px-5 gap-2 snap-x hide-scrollbar ${categoryView === 'defi' ? 'hidden' : ''}`}>
                  <button onClick={() => setActiveGroup('All')} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                    activeGroup === 'All' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-surface border border-line text-muted'
                  }`}>All</button>
 {/* fix (2026-08-27), matches web: same
                      confirmedFresh gate as the header stats, '…' instead
                      of a count that might be a stale, pre-fetch number. */}
                  {CATEGORY_GROUPS.map((g) => (
                    <button key={g.id} onClick={() => setActiveGroup(g.id)} title={g.categories.join(', ')} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                      activeGroup === g.id ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-surface border border-line text-muted'
                    }`}>
                      {g.label} ({confirmedFresh ? (groupCounts[g.id] || 0) : '…'})
                    </button>
                  ))}
                  <button onClick={() => setActiveGroup('Unclassified')} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                    activeGroup === 'Unclassified' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-surface border border-line text-muted'
                  }`}>
                    Unclassified ({confirmedFresh ? (groupCounts.Unclassified || 0) : '…'})
                  </button>
                </div>

                {categoryView !== 'defi' && activeGroupCategories.length > 0 && (
                  <div className="flex overflow-x-auto pb-4 -mx-5 px-5 gap-2 snap-x hide-scrollbar">
                    {activeGroupCategories.map((cat) => (
                      <button key={cat} onClick={() => setActiveCategory(cat)} title={CATEGORY_HINTS[cat]} className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-medium snap-start transition-colors ${
                        activeCategory === cat ? 'bg-indigo-600 text-white' : 'bg-surface border border-line text-muted'
                      }`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                )}

                {!loading && filteredTotal > 0 && (
                  <div className="text-xs text-gray-400 mb-3">
                    Showing {visible.length} of {filteredTotal.toLocaleString()} agents
                  </div>
                )}

 {/* Real, live search fallback (2026-08-29), mirrors web
                    exactly, see UniversalSearchFallback.jsx and
                    docs/universal-search.md. */}
                {/* Filters alone can empty the list (see the web app's matching
                    comment) -- previously only a search query produced an empty
                    state, so filtering to nothing rendered a blank area. */}
                {!loading && filteredTotal === 0 && !searchQuery && (
                  <div className="text-center py-14 px-5">
                    <p className="font-semibold mb-1">No agents match these filters</p>
                    <p className="text-sm text-muted mb-4">
                      Try widening them, "Only marked delivered" in particular matches only a small share of agents.
                    </p>
                    <button
                      onClick={() => { setActiveGroup('All'); setActiveCategory('All'); setOnlyResponding(false); setOnlyVerified(false); }}
                      className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-indigo-600 text-white"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}

                {!loading && filteredTotal === 0 && searchQuery && (
                  <div className="mb-5">
                    <UniversalSearchFallback
                      query={searchQuery}
                      agentsWithPerf={agentsWithPerf}
                      onOpenAgent={(agent) => openAgentDetail(agent, agentPath(agent))}
                      accent={accent}
                      mutedBorder="border-line"
                      darkMode={darkMode}
                      plainEmptyMessage={`Nothing matches "${searchInput.trim()}" by name. If you're looking for a specific agent, try its exact id instead of its name, or paste a wallet or contract address.`}
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
                      <div onClick={() => openAgentDetail(agent, agentPath(agent))} className="bg-surface rounded-md p-5 border border-line flex flex-col cursor-pointer">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center gap-3">
                            <AgentAvatar agent={agent} size={36} rounded="rounded-xl" />
                            <div>
                              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">{agent.category}</span>
                              <h3 className="text-lg font-bold flex items-center gap-1">{agent.name}{agent.isVerified && <BadgeCheck size={14} className="text-indigo-500" />}</h3>
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


                        <div className="flex gap-4 mb-2">
                          <div title="How trustworthy this agent looks, based on past feedback"><span className="text-[10px] text-gray-500 uppercase block">Score</span><span className="font-bold text-sm">{agent.totalScore?.toFixed(1) || 'n/a'}</span></div>
                          <div title="Total money this agent currently manages for people"><span className="text-[10px] text-gray-500 uppercase block">Funds</span><span className="font-bold text-sm">{agent.tvlUsd ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '-'}</span></div>
                        </div>

 {/* on-chain hire track record, same data the
                            sort dropdown ranks by, shown here regardless of
                            which sort is active. */}
                        <div className="mb-4 text-[11px] text-muted" title={perfIndexComplete ? "ERC-8183 job history for this agent: the complete on-chain history, not a recent-only window" : "ERC-8183 job history for this agent: a one-time backfill of the complete history is still catching up"}>
                          {agentHasRealHistory(agent, 'hireCount')
                            ? <>{agent.hireCount} {agent.hireCount === 1 ? 'hire' : 'hires'}{agent.winRate != null ? ` · ${Math.round(agent.winRate * 100)}% success` : ''}</>
                            : <span className="text-gray-400 dark:text-gray-500">No hires yet</span>}
                        </div>

                        {agent.session ? (
                          <div className="mt-auto pt-4 border-t border-line">
                            {/* Parity with web. "Spent: $undefined" is what
                                this rendered: `session.spendUtilized` is
                                assigned nowhere, and on the ERC-8183 path
                                there is no drawn-down amount to assign,
                                since the whole sum is held until delivery. */}
                            <div className="flex justify-between text-xs mb-2 text-muted">
                              <span>On hold until it delivers</span>
                              <span className="font-medium tabular-nums">${agent.session.spendCap}</span>
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

                {!loading && hasMore && (
                  <button
                    onClick={loadMore}
                    className="w-full mt-5 py-3.5 rounded-2xl text-sm font-semibold text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 active:scale-[0.98] transition-transform"
                  >
                    Load more agents
                  </button>
                )}
                </>
              </ChainViewTabs>
            )}

            {nav === 'my-agents' && (
              <div className="space-y-5">
                <div>
                  <h1 className="text-h1 font-bold mb-1">My Agents</h1>
                  <p className="text-sm text-muted">Every agent you've hired through here, and where things stand right now.</p>
                </div>
                <MyJobsPanel accent="#4F46E5" mutedBorder="border-line" />
              </div>
            )}

          </div>
        )}


        {/* The footer links, the same component the web shell and the menu
            sheet use. */}
        <div className="px-4 pb-6">
          <SiteLinks onNavigate={(to) => { dismissAgentDetail(); onNavigate?.(to); }} activePath={path} className="mt-4" />
        </div>
      </main>

      {/* App-like Bottom Navigation */}
      {/* Frosted-glass bottom bar (2026-09-04). Matches the header's existing
          translucent + backdrop-blur treatment rather than inventing a new
          material, so the two edges of the app read as the same surface.
          Explicit light AND dark values (not a single translucent white)
          because a blur over a dark page needs its own tint to stay legible. */}
      {/* Frosted-glass bottom bar.
          Fixed 2026-09-04: the blur was previously invisible for a layout
          reason, not a CSS one. The bar was a flex SIBLING sitting below
          <main> in a `flex flex-col h-[100dvh]` column, so page content
          scrolled inside main's own box and was clipped at main's bottom
          edge -- nothing was ever painted behind the bar, and
          backdrop-filter had nothing to sample. It rendered as a flat
          translucent panel over the page background, which is exactly what
          "not glassy" looks like.
          It now overlays the scroll area (absolute, with `relative` added
          to the root), and <main> carries pb-32 so the last row still
          clears it. backdrop-saturate is deliberate alongside the blur:
          blur alone reads as grey haze, and it's the saturation boost that
          makes a material look like glass rather than frosted
          plastic. Light and dark carry their own tint and highlight -- a
          blur over a dark page needs a much dimmer top highlight or it
          reads as a bright seam. */}
      <nav className="absolute bottom-0 inset-x-0 z-30 pb-safe
        bg-surface/90 supports-[backdrop-filter]:bg-surface/75
        backdrop-blur-xl backdrop-saturate-150
        border-t border-line" aria-label="Main">
        <div className="flex justify-around items-center px-2 pt-2 pb-1">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => goTo(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center flex-1 max-w-[88px] h-14 rounded-md transition-colors ${active ? 'text-accent' : 'text-muted hover:text-fg'}`}
              >
                <Icon size={20} className={`mb-1 transition-transform ${active ? 'scale-110' : ''}`} />
                <span className={`text-micro tracking-wide text-center ${active ? 'font-semibold' : 'font-medium'}`}>{item.barLabel || item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      {walletSheetOpen && (
        <MobileWalletSheet
          onClose={() => setWalletSheetOpen(false)}
          onNavigate={(to) => { dismissAgentDetail(); setHiring(false); onNavigate?.(to); }}
          path={path}
        />
      )}
      
      {/* Hide Scrollbar style for horizontal list */}
      {/* The bottom bar needs a floor under it even on a phone with no
          safe-area inset, so pb-safe here keeps a 20px fallback. The other
          utilities this block used to define are in index.css. */}
      <style dangerouslySetInnerHTML={{__html: `
        .pb-safe { padding-bottom: env(safe-area-inset-bottom, 20px); }
      `}} />
    </div>
  );
}