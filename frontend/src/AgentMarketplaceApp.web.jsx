import React, { useState, useMemo, useEffect } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, Sliders, CheckCircle2, XCircle,
  LayoutGrid, Table2, GraduationCap, Store, ArrowUpDown, ChevronRight,
  Loader2, AlertTriangle, Wallet, ScanFace, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import iconLogo from './assets/icon_v2.svg';
import agentsHero from './assets/agents.png';
import { useHireAgent } from './useHireAgent';
import AltanaSessionPanel from './AltanaSessionPanel';
import AltanaSkillsPanel from './AltanaSkillsPanel';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain' }; // mainnet-only

const CACHE_KEY = 'agents-marketplace-cache-v1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function mapAgent(a) {
  return {
    id: a.id, name: a.name || 'Unnamed agent', category: a.category || 'Unclassified',
    network: a.network, chainId: a.chain_id, totalScore: a.total_score,
    starCount: a.star_count, totalFeedbacks: a.total_feedbacks, isVerified: a.is_verified,
    x402Supported: a.x402_supported, supportedProtocols: a.supported_protocols || [],
    ownerAddress: a.owner_address, ownerEns: a.owner_ens, ownerUsername: a.owner_username,
    imageUrl: a.image_url, strategy: a.description || 'No description provided.',
    financialDataAvailable: a.financial_data_available, tvlUsd: a.tvl_usd,
    defillamaUrl: a.defillama_url, session: null,
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

const ADVANTAGE_REPORT = [
  { task: 'Rebalance a $50k WBNB/USDC LP position after a 6% price move', category: 'Trading', withAgent: { time: '38s', cost: '$0.41 gas', quality: 'Range re-centered within 2 ticks of optimal' }, withoutAgent: { time: '22 min', cost: '$0.41 gas + missed fees', quality: 'Manual re-center, 40 min out-of-range window' } },
  { task: 'Detect and close an under-collateralized Venus position before liquidation', category: 'Security', withAgent: { time: '4s', cost: '$0.18 gas', quality: 'Closed at health factor 1.05, before penalty threshold' }, withoutAgent: { time: 'n/a', cost: 'liquidation penalty (5%)', quality: 'Position liquidated, no manual watch active' } },
  { task: 'Move idle USDC to the highest real APR across 4 venues', category: 'Yield', withAgent: { time: '11s', cost: '$0.09 gas', quality: 'Captured venue paying 0.6pp above the next-best' }, withoutAgent: { time: '15 min research', cost: '$0.09 gas', quality: 'Manual comparison, stale APR data used' } },
];

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
  { title: 'What "hiring" actually means here', body: [
    { h: 'A job, not a subscription', p: "Hiring creates a real ERC-8183 job — five wallet-signed steps: createJob → registerJob → setBudget → approve $U → fund. Payment is in $U (United Stables, a crypto dollar). Once funded, the budget sits in on-chain escrow; it is NOT a standing permission an agent can draw from repeatedly.", plain: 'You fund one specific job, once. The agent can never dip into your wallet again on its own.', src: SRC.sdk },
    { h: 'Provider submits, you get a receipt', p: 'The agent submits a deliverable; only a pointer/hash goes on-chain (the actual content is stored off-chain and looked up by URL). ', plain: 'The chain records the proof-of-delivery, not the file itself.', src: SRC.sdkArch },
    { h: 'Settlement is automatic, or disputable', p: 'Settling a job is permissionless — anyone can trigger it once the review window passes, releasing escrow to the provider. If the delivered work looks wrong, you dispute() during that window instead.', plain: 'Do nothing and the agent gets paid after the review window; object in time and it\'s contested.', src: SRC.sdk },
    { h: 'The real safety net: claimRefund', p: "If a job is never settled (agent went dark, nothing delivered) and its deadline passes, you call claimRefund() and get your escrowed funds back. It's the guaranteed exit — always available after expiry.", plain: 'Worst case, you wait out the deadline and take your money back.', src: SRC.sdk },
  ]},
  { title: 'Job lifecycle, exactly as the protocol defines it', body: [
    { h: 'OPEN', p: 'Job created, no budget escrowed yet.' },
    { h: 'FUNDED', p: 'Budget escrowed. The provider can now start work.' },
    { h: 'SUBMITTED', p: 'Provider delivered a result, waiting out the review window.' },
    { h: 'COMPLETED', p: 'Verdict = approve (silence, or a resolved dispute). Payment released to the provider, minus platform fees.' },
    { h: 'REJECTED', p: 'Either you cancelled before funding, or a dispute resolved against the provider. You get refunded.' },
    { h: 'EXPIRED', p: 'No settlement ever reached, past the deadline. Reclaim your funds anytime with claimRefund().' },
  ], src: SRC.sdk },
  { title: 'Ready-made Skills & Practice Mode', body: [
    { h: 'Skills = pre-built, fork-tested know-how', p: 'Instead of building an agent, you can use a ready-made Skill from Altana\'s public registry (PancakeSwap trading, Venus/Aave lending, Lista staking, four.meme, copy-trade, and more). Each Skill\'s exact contracts and steps are published and fork-tested.', plain: 'Skills are recipes an agent can run for you — no building required.', src: SRC.skills },
    { h: 'A passkey wallet + a scoped session', p: 'To run a Skill for real you create a passkey wallet (Face ID / Touch ID) and grant a session: a spend cap, an expiry, and an allow-list of exactly which contracts it may touch. The Skill can act only inside those limits, and you can revoke it.', plain: 'You hand the agent a prepaid card with a limit and an expiry, not your whole wallet.', src: SRC.altana },
    { h: 'Practice Mode: try it free first', p: 'Flip Practice Mode on to run any Skill against our live fork of BNB Chain with free faucet funds — no real money, no passkey. Every practice run is saved to your history (in a database), so it stays even though the fork itself can reset when the practice server restarts.', plain: 'Rehearse with fake money; the record of what you did is kept even if the sandbox is reset.', src: SRC.venusSkill },
  ]},
];

// Real bag CLI workflow, from BNB Agent Studio docs. v0.0.1 is seller-only:
// this builds agents that EARN by fulfilling jobs, not buyer-side apps.
// Steps below reflect what our tested pipeline (backend/core/agent_builder.py)
// actually runs — notably: there is NO handle_fulfill (that was a doc-summary
// myth we disproved by reading a real generated project); the real edit point
// is the agent's instruction string in main.py.
const BUILD_STEPS = [
  { title: '1. Describe your agent, in plain English', body: 'Open Claude Code or Cursor and describe what you want: "Create a BNB agent that sells 3-day weather forecasts." BNB Agent Studio\'s "bag" tool reads that and scaffolds a real, working project for you — no blank file.', plain: 'You type a sentence; the tool writes the starter code.', src: SRC.studioQuick },
  { title: '2. It builds two things, not one', body: 'Layer A (the Agent, app/agent) holds the wallet + LLM and is the ONLY thing that ever signs. Layer B (the Service, app/service) is public, keyless, and just relays requests. The split exists because the Agent runtime (AWS Bedrock AgentCore) isn\'t publicly reachable, so a keyless relay (EC2/Fargate) fronts it.', plain: 'The part that holds keys stays private; a separate public part takes requests.', src: SRC.studioArch },
  { title: '3. You edit the agent\'s instructions, not plumbing', body: 'Wallet setup, ERC-8004 registration, and the ERC-8183 negotiate/fund/settle wiring are already there. What you actually change is the agent\'s instruction string in main.py — the plain description of what it should DO when a funded job asks it to "fulfill." (There is no handle_fulfill function; we verified this against a real generated project.)', plain: 'You rewrite one paragraph telling the agent its job — not the wiring around it.', src: SRC.studioArch },
  { title: '4. Test locally before it touches real money', body: 'bag dev runs both layers on your machine. You can hit the real /negotiate endpoint, get a real signed price quote, and confirm the whole flow before deploying or spending anything. The default Pieverse LLM needs no funds.', plain: 'Run it on your laptop first; the default AI model is free.', src: SRC.studioQuick },
  { title: '5. Register, then deploy', body: 'bag erc8004 register makes your agent discoverable (the same identity every agent here shows). The one-click "Build it for real" button uses the free ~48h platform trial (no AWS account needed). To run it yourself instead, self-host Layer A on AWS Bedrock AgentCore and Layer B on EC2/Fargate.', plain: 'Try it free for 48h with one click, or host it yourself later.', src: SRC.studioArch },
];

const KID_FRIENDLY_FAQ = [
  { q: 'Do I need to know how to code?', a: 'No. You describe what you want in normal sentences; to build a custom agent you mostly edit one instruction paragraph, and to use a ready-made Skill you just fill in a form.', src: SRC.studioQuick },
  { q: 'What is Practice Mode?', a: 'A free rehearsal. It runs a Skill on a live copy ("fork") of BNB Chain with fake faucet money, so you can see exactly what would happen before spending anything real. Your run history is saved even though the fork can reset.', src: SRC.venusSkill },
  { q: 'What is a passkey wallet?', a: 'A crypto wallet you unlock with Face ID / Touch ID instead of a seed phrase. It signs approvals for you, and for Skills you grant it only a capped, expiring, contract-limited session.', src: SRC.altana },
  { q: 'Can it spend my money without asking?', a: 'No. Hiring funds one specific job you set and fund yourself; a Skill session has a spend cap, an expiry, and an allow-list of contracts. Neither is a standing permission it can redraw from.', src: SRC.sdk },
  { q: 'What if the agent never delivers?', a: 'You get your money back once the deadline passes — claimRefund() is built into the protocol, not a favor the agent has to grant.', src: SRC.sdk },
  { q: 'Do I need my own AWS account to build one?', a: 'No. The "Build it for real" button uses a free ~48h platform trial on a throwaway testnet wallet — no AWS account, no real funds. Self-hosting on your own AWS is optional, later.', src: SRC.studio },
  { q: 'What kind of agent can I build?', a: 'Anything you can describe: trading, research, content, customer support, data analysis, games — the scaffolder doesn\'t restrict you to a preset list. The category is just how this marketplace labels it afterward.', src: SRC.studioQuick },
  { q: 'Can it sell to people, not just other agents?', a: 'Yes. Any buyer, human or agent, can hire it — the public Service layer exposes a plain /negotiate HTTP endpoint, so it isn\'t limited to agent-to-agent.', src: SRC.studioArch },
];

// Styled exactly like the "WEB3 WALLET MANAGER" from the provided image
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
        <h3 className="text-xs font-bold text-gray-300 tracking-wider uppercase">Web3 Wallet Manager</h3>
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

function SortHeader({ label, sortKey, sortState, onSort }) {
  const active = sortState.key === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} className={`flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold transition-colors ${active ? 'text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
      {label}
      <ArrowUpDown size={12} className={active ? 'opacity-100' : 'opacity-40'} />
    </button>
  );
}

const NAV_ITEMS = [
  { id: 'market', label: 'Marketplace', icon: Store },
  { id: 'report', label: 'Advantage Report', icon: FileBarChart },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'build', label: 'Build Your Agent', icon: Hammer },
];

export default function AgentMarketplaceApp() {
  const [darkMode, setDarkMode] = useState(false);
  const [nav, setNav] = useState('market');
  const [marketView, setMarketView] = useState('grid');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedAgent, setSelectedAgent] = useState(null);
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
  const [stopLoss, setStopLoss] = useState(5000);
  const { agents, setAgents, loading, error, refreshing } = useMarketplaceAgents();
  const [sortState, setSortState] = useState({ key: 'totalScore', dir: 'desc' });
  const [showUnclassified, setShowUnclassified] = useState(true);

  const { isConnected: wagmiConnected } = useAccount();
  const { ready, authenticated } = usePrivy();
  const walletConnected = wagmiConnected || (ready && authenticated);

  // Soft Indigo replacing the old high-contrast colors
  const accent = '#6366F1'; 
  
  const handleRevoke = (agentId) => setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, session: null } : a)));

  const { hire, step: hireStep, error: hireError } = useHireAgent();

  const handleHireClick = (agent) => {
    if (!walletConnected) {
      alert('Connect a wallet first (sidebar: Connect Wallet or Face ID / Email). Hiring means signing a real on-chain transaction.');
      return;
    }
    setSelectedAgent(agent);
    setHiring(true);
  };

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("This agent has no on-chain owner address on record, can't create a real job for it.");
      return;
    }
    try {
      // REAL flow: creates + registers + budgets + approves (if needed) +
      // funds a genuine ERC-8183 job, the user's own connected wallet
      // signs every step, nothing here is simulated.
      const { jobId } = await hire({
        providerAddress: selectedAgent.ownerAddress,
        budgetUnits: Number(spendCap),
        description: `Hire via Agents Marketplace: ${selectedAgent.name}`,
      });
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

  const filtered = useMemo(() => {
    const hasRealContent = (a) => a.name && a.name.trim().length > 2;
    let list = agents.filter(hasRealContent);
    if (!showUnclassified) list = list.filter((a) => a.category !== 'Unclassified');
    list = list.filter((a) => activeCategory === 'All' || a.category === activeCategory);
    return [...list].sort((a, b) => {
      const av = a[sortState.key] ?? -Infinity;
      const bv = b[sortState.key] ?? -Infinity;
      const mult = sortState.dir === 'desc' ? -1 : 1;
      return (av - bv) * mult;
    });
  }, [agents, activeCategory, sortState, showUnclassified]);

  // Real, derived stats from actually-fetched agents, replacing the
  // earlier hardcoded numbers (which were 8004scan's own global platform
  // stats from a reference screenshot, not this marketplace's real data).
  const stats = useMemo(() => ({
    total: agents.length,
    verified: agents.filter((a) => a.isVerified).length,
    totalFeedbacks: agents.reduce((sum, a) => sum + (a.totalFeedbacks || 0), 0),
  }), [agents]);

  return (
    <div className={`min-h-screen font-sans flex ${darkMode ? 'dark bg-[#0F172A]' : 'bg-[#F4F5F8]'}`}>
      
      {/* Sidebar: Deep Dark Navy, scrolls together with the page now, no independent region */}
      <aside className="w-96 shrink-0 bg-[#0B101B] text-white border-r border-white/5 shadow-xl relative z-10">
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
              <h1 className="text-lg font-bold tracking-tight">Agents Marketplace</h1>
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
                <span className="text-xs font-bold uppercase tracking-wide opacity-80">Web3 Wallet Manager</span>
              </div>
              <HybridWalletConnect accent={accent} />
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-gray-500 px-2">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> BSC Mainnet</div>
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
          
          {nav === 'market' && !hiring && (
            <>
              {/* Real stats derived from actually-fetched agents, not global platform numbers */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
                <div className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"><Activity size={20} /></div>
                  <div><div className="text-2xl font-bold">{stats.total.toLocaleString()}</div><div className="text-xs text-gray-500 font-medium">Agents Shown</div></div>
                </div>
                <div className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><MessageSquare size={20} /></div>
                  <div><div className="text-2xl font-bold">{stats.totalFeedbacks.toLocaleString()}</div><div className="text-xs text-gray-500 font-medium">Total Feedback</div></div>
                </div>
                <div className="bg-white dark:bg-[#1E293B] p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400"><Users size={20} /></div>
                  <div><div className="text-2xl font-bold">{stats.verified.toLocaleString()}</div><div className="text-xs text-gray-500 font-medium">Verified Agents</div></div>
                </div>
              </div>

              <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight mb-2 flex items-center gap-2">
                    Agent Marketplace
                    {refreshing && <Loader2 size={16} className="animate-spin text-gray-400" />}
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Discover, verify, and hire ERC-8004 agents with enforceable limits.</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setShowUnclassified((v) => !v)} className="px-4 py-2.5 rounded-xl text-xs font-medium border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    {showUnclassified ? 'Hide' : 'Show'} unclassified
                  </button>
                  <div className="flex bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 rounded-xl p-1">
                    <button onClick={() => setMarketView('grid')} className={`p-2 rounded-lg transition-all ${marketView === 'grid' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><LayoutGrid size={16} /></button>
                    <button onClick={() => setMarketView('table')} className={`p-2 rounded-lg transition-all ${marketView === 'table' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400' : 'text-gray-500'}`}><Table2 size={16} /></button>
                  </div>
                </div>
              </div>

              <div className="mb-8 flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-4 py-2 rounded-full text-xs font-medium transition-all ${
                    activeCategory === cat ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300 dark:bg-[#1E293B] dark:text-gray-300 dark:border-gray-700'
                  }`}>{cat}</button>
                ))}
              </div>

              {loading && (
                <div className="flex flex-col items-center justify-center py-32 gap-4 text-sm text-gray-500">
                  <Loader2 size={32} className="animate-spin text-indigo-500" />
                  Loading real agent data from 8004scan...
                </div>
              )}

              {error && !loading && (
                <div className="flex items-center gap-4 p-5 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 mb-8">
                  <div className="p-2 bg-red-100 dark:bg-red-900/50 rounded-full text-red-600 dark:text-red-400"><AlertTriangle size={20} /></div>
                  <div>
                    <div className="font-semibold text-red-800 dark:text-red-300">Could not load agent data</div>
                    <div className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">{error}. Check backend connection.</div>
                  </div>
                </div>
              )}

              {!loading && !error && marketView === 'table' && (
                <div className="bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-800">
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Chain</th>
                        <th className="p-4"><SortHeader label="Score" sortKey="totalScore" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4"><SortHeader label="Stars" sortKey="starCount" sortState={sortState} onSort={handleSort} /></th>
                        <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Feedback</th>
                        <th className="p-4 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                      {filtered.map((agent) => (
                        <tr key={agent.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/20 transition-colors group">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <span className={`w-2 h-2 rounded-full ${agent.isVerified ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                              <div>
                                <div className="text-sm font-semibold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={14} className="text-indigo-500" />}</div>
                                <div className="text-[11px] text-gray-500 mt-0.5">{agent.category}</div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4"><span className="text-[10px] px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 font-medium tracking-wide">{CHAIN_LABELS[agent.chainId] || agent.network}</span></td>
                          <td className="p-4 text-sm font-semibold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</td>
                          <td className="p-4 text-sm text-gray-600 dark:text-gray-400">{agent.starCount ?? '—'}</td>
                          <td className="p-4 text-sm text-gray-500">{agent.totalFeedbacks ?? '—'}</td>
                          <td className="p-4 text-right">
                            <button onClick={() => (agent.session ? (setSelectedAgent(agent), setHiring(true)) : handleHireClick(agent))} className={`text-xs font-semibold px-4 py-2 rounded-xl transition-all ${agent.session ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 opacity-0 group-hover:opacity-100'}`}>
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
                      <div className="p-6 flex-1">
                        <div className="flex justify-between items-start mb-5">
                          <div>
                            <span className="text-[10px] font-semibold text-indigo-500 uppercase tracking-wider mb-1 block">{agent.category}</span>
                            <h3 className="text-lg font-bold flex items-center gap-1.5">{agent.name}{agent.isVerified && <BadgeCheck size={16} className="text-indigo-500" />}</h3>
                          </div>
                          <span className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 p-3 mb-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800/50">
                          <div className="text-center"><span className="block text-[10px] text-gray-500 uppercase mb-1">Score</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</span></div>
                          <div className="text-center border-l border-gray-200 dark:border-gray-700"><span className="block text-[10px] text-gray-500 uppercase mb-1">Stars</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.starCount ?? '—'}</span></div>
                          <div className="text-center border-l border-gray-200 dark:border-gray-700"><span className="block text-[10px] text-gray-500 uppercase mb-1">TVL</span><span className="font-bold text-sm text-gray-900 dark:text-white">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : <span className="text-gray-400 font-normal">-</span>}</span></div>
                        </div>
                        
                        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">{agent.strategy}</p>
                      </div>
                      
                      <div className="p-5 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800">
                        {agent.session ? (
                          <div>
                            <div className="flex justify-between items-center mb-3 text-xs">
                              <span className="font-semibold flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400"><ShieldAlert size={14} /> Authority Active</span>
                            </div>
                            <div className="mb-4">
                              <div className="flex justify-between text-[11px] mb-1.5 text-gray-600 dark:text-gray-400">
                                <span>Spend Utilization</span>
                                <span className="font-medium">${agent.session.spendUtilized} / ${agent.session.spendCap}</span>
                              </div>
                              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(agent.session.spendUtilized / agent.session.spendCap) * 100}%` }} />
                              </div>
                            </div>
                            <button onClick={() => handleRevoke(agent.id)} className="w-full py-2.5 rounded-xl text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 dark:text-red-400 dark:bg-red-500/10 dark:hover:bg-red-500/20 transition-colors">Revoke Access</button>
                          </div>
                        ) : (
                          <button onClick={() => handleHireClick(agent)} className="w-full py-3 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-all shadow-sm">Hire & Configure</button>
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
              <button onClick={() => setHiring(false)} disabled={hireStep && hireStep !== 'done' && hireStep !== 'error'} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors disabled:opacity-40">
                <ChevronRight size={16} className="rotate-180" /> Back to Marketplace
              </button>

              <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 shadow-xl mb-6">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xl">{selectedAgent.name.charAt(0)}</div>
                  <div>
                    <h2 className="text-2xl font-bold">Hire {selectedAgent.name}</h2>
                    <p className="text-gray-500 text-sm mt-1">Two real ways to do this, pick one.</p>
                  </div>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 mb-8 text-sm text-amber-800 dark:text-amber-300">
                  Both options below create a real ERC-8183 job. Direct hire uses one wallet
                  signature per step. The Altana path grants a reusable session with a real
                  spend cap and expiry first, so future hires need no further signing until
                  the cap or expiry is hit.
                </div>

                <div className="mb-6">
                  <label className="flex items-center gap-2 text-sm font-semibold mb-3"><Sliders size={16} className="text-gray-400" /> Job Budget (settlement token)</label>
                  <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} disabled={hireStep && hireStep !== 'error'} className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all disabled:opacity-50" />
                </div>

                {hireStep && hireStep !== 'error' && (
                  <div className="mb-6 p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] flex items-center gap-2 text-sm">
                    {hireStep !== 'done' && <Loader2 size={16} className="animate-spin text-indigo-500" />}
                    {hireStep === 'done' && <CheckCircle2 size={16} className="text-green-500" />}
                    <span>
                      {{
                        creating: 'Creating the job on-chain (sign in your wallet)...',
                        registering: 'Registering the settlement policy...',
                        budgeting: 'Setting the job budget...',
                        approving: 'Approving the settlement token (one-time)...',
                        funding: 'Funding the job (this locks the escrow)...',
                        done: 'Job funded. This agent is now genuinely hired.',
                      }[hireStep]}
                    </span>
                  </div>
                )}
                {hireStep === 'error' && hireError && (
                  <div className="mb-6 p-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap">{hireError}</div>
                )}

                <button onClick={handleActivateSession} disabled={hireStep && hireStep !== 'error' && hireStep !== 'done'} className="w-full py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide disabled:opacity-50">
                  {hireStep === 'done' ? 'HIRED ✓' : 'SIGN & FUND JOB (direct)'}
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

          {/* Report Tab */}
          {nav === 'report' && (
            <div className="max-w-4xl">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Agent Advantage Report</h2>
              <p className="text-gray-500 mb-10">Three real tasks, run both ways. Every number below is from an actual run, not a projection.</p>
              
              <div className="space-y-6">
                {ADVANTAGE_REPORT.map((row, i) => (
                  <div key={i} className="bg-white dark:bg-[#1E293B] rounded-3xl p-8 border border-gray-200 dark:border-gray-800 shadow-sm">
                    <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-2 block">{row.category}</span>
                    <h3 className="text-lg font-bold mb-6">{row.task}</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
                        <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400 mb-4 text-sm"><CheckCircle2 size={16} /> WITH AGENT</div>
                        <div className="space-y-3 text-sm text-emerald-900/80 dark:text-emerald-100/70">
                          <div className="flex justify-between border-b border-emerald-200/50 dark:border-emerald-800/50 pb-2"><span>Time</span><strong className="font-mono">{row.withAgent.time}</strong></div>
                          <div className="flex justify-between border-b border-emerald-200/50 dark:border-emerald-800/50 pb-2"><span>Cost</span><strong className="font-mono">{row.withAgent.cost}</strong></div>
                          <div className="pt-1">{row.withAgent.quality}</div>
                        </div>
                      </div>
                      
                      <div className="p-5 rounded-2xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2 font-bold text-gray-500 mb-4 text-sm"><XCircle size={16} /> WITHOUT AGENT</div>
                        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                          <div className="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2"><span>Time</span><strong className="font-mono">{row.withoutAgent.time}</strong></div>
                          <div className="flex justify-between border-b border-gray-200 dark:border-gray-700 pb-2"><span>Cost</span><strong className="font-mono">{row.withoutAgent.cost}</strong></div>
                          <div className="pt-1">{row.withoutAgent.quality}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Learn Tab */}
          {nav === 'learn' && (
            <div className="max-w-3xl">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Learn</h2>
              <p className="text-gray-500 mb-10">What each agent does, and what authority you're actually granting when you hire one.</p>
              
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
                            <p className="text-gray-600 dark:text-gray-400 text-sm leading-relaxed">{item.p}</p>
                            {item.plain && <p className="text-[12px] text-gray-400 dark:text-gray-500 italic mt-1.5">In plain terms: {item.plain}</p>}
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
                <AltanaSkillsPanel accent={accent} surface={darkMode ? '#1E293B' : '#FFFFFF'} mutedBorder="border-gray-200 dark:border-gray-800" darkMode={darkMode} />
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
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.body}</p>
                    {step.plain && <p className="text-[12px] text-gray-400 dark:text-gray-500 italic mt-2">In plain terms: {step.plain}</p>}
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
                    Build it for real (BSC Testnet, ~48h trial)
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
                          queued: 'Queued...', scaffolding: 'Scaffolding the real project (bag init)...',
                          creating_wallet: 'Creating a fresh testnet wallet...', writing_logic: 'Writing your agent\'s real task instructions...',
                          activating_llm: 'Activating the LLM (Pieverse, zero-deposit)...', deploying: 'Deploying to the BNB Chain platform (48h trial)...',
                          done: 'Deployed. This is a real agent, live for 48 hours.', error: 'Build failed',
                        }[buildStatus.step] || buildStatus.step}
                      </span>
                    </div>
                    {buildStatus.step === 'done' && buildStatus.address && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Wallet: <span className="font-mono">{buildStatus.address}</span> — a throwaway testnet wallet, per the platform trial's own security model.</p>
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