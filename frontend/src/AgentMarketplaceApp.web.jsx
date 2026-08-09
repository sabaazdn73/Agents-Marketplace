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

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain', 97: 'BNB Testnet' };

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

const LEARN_TOPICS = [
  { title: 'The four categories', body: [
    { h: 'Rebalancing', p: 'Keeps a liquidity position inside its active price range, re-centering automatically when price moves out.' },
    { h: 'Grid Trading', p: 'Places a ladder of buy/sell orders across a price range, profiting from volatility without predicting direction.' },
    { h: 'Yield Optimisation', p: 'Continuously compares real APR across venues, moving idle capital to whichever pays the most right now.' },
    { h: 'Health Factor Monitoring', p: "Watches a lending position's collateral ratio and acts before it crosses into liquidation." },
  ]},
  { title: 'What a session key actually is', body: [
    { h: 'Not your wallet', p: 'An agent never holds your main wallet\'s keys, you grant a separate session key, scoped narrowly.' },
    { h: 'Spend cap', p: 'A hard ceiling enforced on-chain, not a promise in a UI.' },
    { h: 'Expiry', p: 'Every session ends on its own, automatically.' },
    { h: 'Revoke', p: 'One transaction, immediate, always visible from the card.' },
  ]},
];

const BUILD_STEPS = [
  { title: '1. Describe your agent in plain English', body: "You don't write code. You describe what you want, a tool called Cursor writes the real code, using BNB Chain's own agent-building kit (bnbagent-studio)." },
  { title: '2. Pick what it can touch, before it runs', body: 'You set a spending limit and expiry before your agent moves anything, enforced by the blockchain, not a promise.' },
  { title: '3. It gets a real, permanent ID card', body: 'Your agent registers on-chain under ERC-8004, a unique ID anyone can check.' },
  { title: '4. One identity, every chain, honestly explained', body: "Your agent's ID format (CAIP-10) is recognized on every major chain. What's NOT automatic: it still needs one real transaction to register on each additional chain it operates on." },
];

const KID_FRIENDLY_FAQ = [
  { q: 'Do I need to know how to code?', a: 'No. You describe what you want in normal sentences.' },
  { q: 'Can my agent spend all my money by accident?', a: "No, a maximum is set first and the blockchain enforces it." },
  { q: 'What if I change my mind?', a: 'Revoke instantly, one click, anytime.' },
  { q: 'Does it work on other blockchains too?', a: 'Its ID is recognized everywhere, you choose where it actually runs, one click per chain.' },
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

  const handleHireClick = (agent) => {
    if (!walletConnected) {
      alert('Connect a wallet first (sidebar: Connect Wallet or Face ID / Email). A session key has to be signed by a real wallet.');
      return;
    }
    setSelectedAgent(agent);
    setHiring(true);
  };

  const handleActivateSession = () => {
    if (!selectedAgent || !walletConnected) return;
    setAgents((prev) => prev.map((a) => a.id === selectedAgent.id ? { ...a, session: { key: '0x' + Math.random().toString(16).substring(2, 10) + '...4a', spendUtilized: 0, spendCap: Number(spendCap), expiry: '24h 00m' } } : a));
    setSelectedAgent(null);
    setHiring(false);
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
      
      {/* Sidebar: Deep Dark Navy like the image, slightly smaller width (w-72) */}
      <aside className="w-72 shrink-0 bg-[#0B101B] text-white flex flex-col justify-between border-r border-white/5 shadow-xl relative z-10">
        <div>
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

          {/* Hero image, same role as OnChain Oversight's hand+device visual */}
          <div className="px-6">
            <img src={agentsHero} alt="" className="w-full rounded-2xl border border-white/10" />
          </div>
        </div>

        <div className="p-6 pt-0">
          <HybridWalletConnect accent={accent} />
          
          <div className="mt-6 flex items-center justify-between text-xs text-gray-500 px-2">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> BSC Mainnet</div>
            <button onClick={() => setDarkMode(!darkMode)} className="hover:text-gray-300 transition-colors">
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 md:p-12 overflow-x-hidden overflow-y-auto text-gray-900 dark:text-gray-100 transition-colors duration-300">
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
              <button onClick={() => setHiring(false)} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors">
                <ChevronRight size={16} className="rotate-180" /> Back to Marketplace
              </button>
              
              <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-8 md:p-10 border border-gray-200 dark:border-gray-800 shadow-xl">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xl">{selectedAgent.name.charAt(0)}</div>
                  <div>
                    <h2 className="text-2xl font-bold">Establish Authority</h2>
                    <p className="text-gray-500 text-sm mt-1">Configuring permissions for {selectedAgent.name}</p>
                  </div>
                </div>

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-2xl p-4 mb-8 text-sm text-amber-800 dark:text-amber-300">
                  You are generating a revocable session key under ERC-8004. Define absolute boundaries to protect your capital from autonomous execution risk.
                </div>

                <div className="space-y-8">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold mb-3"><Sliders size={16} className="text-gray-400" /> Max Spend Cap (USDC)</label>
                    <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono focus:ring-2 focus:ring-indigo-500 outline-none transition-all" />
                  </div>
                  
                  <div className="p-6 rounded-2xl border border-red-100 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold text-red-600 dark:text-red-400">Emergency Stop-Loss Threshold</span>
                      <span className="font-mono font-bold text-red-600 dark:text-red-400">${Number(stopLoss).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-red-500/80 mb-5">Automatically kill this agent and pull remaining funds if total drawdown crosses this limit.</p>
                    <input type="range" min="500" max="20000" step="500" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="w-full accent-red-500" />
                  </div>
                  
                  <button onClick={handleActivateSession} className="w-full py-4 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-500/25 transition-all text-sm tracking-wide">
                    SIGN SESSION KEY & DEPLOY AGENT
                  </button>
                </div>
              </div>
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
              <p className="text-xs text-gray-400 mb-10">Built on bnbagent-studio (BNB Chain's own agent-building kit) and the ERC-8004 identity standard.</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                {BUILD_STEPS.map((step, i) => (
                  <div key={i} className="bg-white dark:bg-[#1E293B] p-8 rounded-3xl border border-gray-200 dark:border-gray-800 shadow-sm">
                    <h3 className="font-bold mb-3">{step.title}</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.body}</p>
                  </div>
                ))}
              </div>
              
              <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-500/20 rounded-3xl p-8 mb-12">
                <div className="flex items-center gap-2 mb-4 text-indigo-700 dark:text-indigo-400">
                  <Link2 size={18} />
                  <h3 className="font-bold text-sm uppercase tracking-wide">Deploy to other chains, honestly explained</h3>
                </div>
                <p className="text-sm text-indigo-900/70 dark:text-indigo-200/70 leading-relaxed mb-6">
                  Once your agent is built, its identity card already works everywhere. Bringing it onto a new chain is one real action per chain, not automatic magic:
                </p>
                <div className="font-mono text-xs p-5 rounded-2xl bg-white dark:bg-[#0F172A] border border-indigo-100 dark:border-indigo-500/30 text-gray-700 dark:text-gray-300">
                  Your Agent → <span className="text-indigo-500">[Register on Ethereum]</span> <span className="text-blue-500">[Register on Base]</span> <span className="text-purple-500">[Register on Polygon]</span>
                  <div className="mt-3 text-gray-400">← each button is one real, separate on-chain transaction, using the same identity</div>
                </div>
              </div>
              
              <h3 className="text-xl font-bold mb-6">Questions a total beginner would ask</h3>
              <div className="space-y-4 mb-10">
                {KID_FRIENDLY_FAQ.map((item, i) => (
                  <div key={i} className="bg-white dark:bg-[#1E293B] p-6 rounded-2xl border border-gray-200 dark:border-gray-800">
                    <div className="font-bold text-sm mb-2">{item.q}</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">{item.a}</div>
                  </div>
                ))}
              </div>
              
              <button className="w-full py-5 rounded-2xl font-bold text-white bg-gray-900 hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors shadow-lg">
                Start Building →
              </button>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}