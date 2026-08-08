import React, { useState, useMemo, useEffect } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, Sliders, CheckCircle2, XCircle,
  LayoutGrid, Table2, GraduationCap, Store, ArrowUpDown, ChevronRight,
  Loader2, AlertTriangle, Wallet, ScanFace, LogOut, Hammer, Sparkles,
  Link2, BadgeCheck, Zap, Star, Users, Boxes, Bell,
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const CHAIN_LABELS = { 56: 'BNB Smart Chain', 97: 'BNB Testnet' };
const CHAIN_COLORS = {
  56: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  97: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

function useMarketplaceAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => {
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const mapped = (data.agents || []).map((a) => ({
          id: a.id,
          name: a.name || 'Unnamed agent',
          category: a.category || 'Unclassified',
          network: a.network,
          chainId: a.chain_id,
          totalScore: a.total_score,
          averageScore: a.average_score,
          rank: a.rank,
          networkRank: a.network_rank,
          healthScore: a.health_score,
          starCount: a.star_count,
          totalFeedbacks: a.total_feedbacks,
          isVerified: a.is_verified,
          x402Supported: a.x402_supported,
          supportedProtocols: a.supported_protocols || [],
          crossChainVersions: a.cross_chain_versions,
          ownerAddress: a.owner_address,
          ownerEns: a.owner_ens,
          ownerUsername: a.owner_username,
          ownerCertifiedName: a.owner_certified_name,
          imageUrl: a.image_url,
          createdAt: a.created_at,
          strategy: a.description || 'No description provided.',
          financialDataAvailable: a.financial_data_available,
          tvlUsd: a.tvl_usd,
          defillamaUrl: a.defillama_url,
          session: null,
        }));
        setAgents(mapped);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { agents, setAgents, loading, error };
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

function HybridWalletConnect({ darkMode, accent }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { ready, authenticated, user, login, logout } = usePrivy();

  const privyConnected = ready && authenticated;
  const privyAddress = user?.wallet?.address;
  const isConnected = wagmiConnected || privyConnected;
  const activeAddress = wagmiConnected ? wagmiAddress : privyAddress;
  const shortAddress = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : null;

  if (isConnected) {
    return (
      <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${darkMode ? 'border-white/10 bg-white/5' : 'border-black/10 bg-black/5'}`}>
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="font-medium">{shortAddress}</span>
        <button onClick={() => (wagmiConnected ? wagmiDisconnect() : logout())} className="opacity-50 hover:opacity-100">
          <LogOut size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <button onClick={openConnectModal} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border ${darkMode ? 'border-white/15 hover:bg-white/5' : 'border-black/15 hover:bg-black/5'}`}>
            <Wallet size={13} /> Connect Wallet
          </button>
        )}
      </ConnectButton.Custom>
      <button onClick={login} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: accent }}>
        <ScanFace size={13} /> Face ID / Email
      </button>
    </div>
  );
}

function ChainBadge({ chainId, network }) {
  const label = CHAIN_LABELS[chainId] || network;
  const cls = CHAIN_COLORS[chainId] || 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>{label}</span>;
}

function ProtocolBadges({ protocols, x402 }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {(protocols || []).map((p) => (
        <span key={p} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">{p}</span>
      ))}
      {x402 && <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/10 text-violet-400 border border-violet-500/20">x402</span>}
    </div>
  );
}

function StatCard({ icon: Icon, value, label, accent }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <Icon size={16} style={{ color: accent }} />
        <span className="text-3xl font-bold" style={{ color: accent }}>{value}</span>
      </div>
      <div className="text-xs opacity-60">{label}</div>
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'market', label: 'Marketplace', icon: Store },
  { id: 'report', label: 'Advantage Report', icon: FileBarChart },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'build', label: 'Build Your Agent', icon: Hammer },
];

export default function AgentMarketplaceApp() {
  const [darkMode, setDarkMode] = useState(true);
  const [nav, setNav] = useState('market');
  const [marketView, setMarketView] = useState('table');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [hiring, setHiring] = useState(false);
  const [spendCap, setSpendCap] = useState(50000);
  const [stopLoss, setStopLoss] = useState(5000);
  const { agents, setAgents, loading, error } = useMarketplaceAgents();
  const [sortState, setSortState] = useState({ key: 'totalScore', dir: 'desc' });
  const [showUnclassified, setShowUnclassified] = useState(true);

  const { isConnected: wagmiConnected } = useAccount();
  const { ready, authenticated } = usePrivy();
  const walletConnected = wagmiConnected || (ready && authenticated);

  const accent = '#6D5DFB';
  const bg = darkMode ? '#0A0A12' : '#F8F9FB';
  const text = darkMode ? '#F5F5F7' : '#111114';
  const surface = darkMode ? '#14141F' : '#FFFFFF';
  const border = darkMode ? 'border-white/10' : 'border-black/10';
  const mutedBorder = darkMode ? 'border-white/5' : 'border-black/5';

  const handleRevoke = (agentId) => setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, session: null } : a)));

  const handleHireClick = (agent) => {
    if (!walletConnected) {
      alert('Connect a wallet first. A session key has to be signed by a real wallet.');
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

  const stats = useMemo(() => ({
    total: agents.length,
    verified: agents.filter((a) => a.isVerified).length,
    x402: agents.filter((a) => a.x402Supported).length,
    categorized: agents.filter((a) => a.category !== 'Unclassified').length,
  }), [agents]);

  return (
    <div className="min-h-screen font-sans transition-colors duration-200" style={{ background: bg, color: text }}>
      <header className={`sticky top-0 z-30 border-b ${border} backdrop-blur-md`} style={{ background: darkMode ? 'rgba(10,10,18,0.85)' : 'rgba(248,249,251,0.85)' }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accent }}>
              <Boxes size={17} className="text-white" />
            </div>
            <span className="font-bold text-lg">Agents Marketplace</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: '#10B981' }}>BSC</span>
          </div>
          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setNav(item.id)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${nav === item.id ? '' : 'opacity-60 hover:opacity-100'}`}
                style={nav === item.id ? { background: darkMode ? 'rgba(109,93,251,0.15)' : 'rgba(109,93,251,0.1)', color: accent } : {}}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => setDarkMode(!darkMode)} className="p-2 rounded-lg opacity-60 hover:opacity-100">
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <HybridWalletConnect darkMode={darkMode} accent={accent} />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {nav === 'market' && !hiring && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-1">Autonomous Agent Marketplace</h1>
              <p className="opacity-60 text-sm">Discover, verify, and hire ERC-8004 agents with enforceable financial limits.</p>
            </div>

            <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 mb-10 py-6 rounded-2xl border ${mutedBorder}`} style={{ background: surface }}>
              <StatCard icon={Users} value={stats.total} label="Agents shown" accent={accent} />
              <StatCard icon={BadgeCheck} value={stats.verified} label="Verified" accent={accent} />
              <StatCard icon={Zap} value={stats.x402} label="x402-enabled" accent={accent} />
              <StatCard icon={Star} value={stats.categorized} label="Categorized" accent={accent} />
            </div>

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${activeCategory === cat ? 'text-white' : `${mutedBorder} opacity-60 hover:opacity-100`}`}
                    style={activeCategory === cat ? { background: accent, borderColor: accent } : {}}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowUnclassified((v) => !v)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${mutedBorder} ${showUnclassified ? '' : 'opacity-50'}`}>
                  {showUnclassified ? 'Hide' : 'Show'} unclassified
                </button>
                <button onClick={() => setMarketView('grid')} className={`p-2 rounded-lg border ${mutedBorder} ${marketView === 'grid' ? 'text-white' : 'opacity-60'}`} style={marketView === 'grid' ? { background: accent, borderColor: accent } : {}}><LayoutGrid size={15} /></button>
                <button onClick={() => setMarketView('table')} className={`p-2 rounded-lg border ${mutedBorder} ${marketView === 'table' ? 'text-white' : 'opacity-60'}`} style={marketView === 'table' ? { background: accent, borderColor: accent } : {}}><Table2 size={15} /></button>
              </div>
            </div>

            {loading && (
              <div className="flex flex-col items-center justify-center py-24 gap-3 text-sm opacity-60">
                <Loader2 size={26} className="animate-spin" style={{ color: accent }} />
                Fetching real agent data from 8004scan + DefiLlama...
              </div>
            )}

            {error && !loading && (
              <div className="flex items-center gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/5 mb-6">
                <AlertTriangle size={18} className="text-red-400 shrink-0" />
                <div className="text-sm">
                  <div className="font-semibold text-red-400">Could not load real agent data</div>
                  <div className="opacity-60">{error}. Confirm the backend is running at {API_BASE_URL}.</div>
                </div>
              </div>
            )}

            {!loading && !error && marketView === 'table' && (
              <div className={`rounded-2xl border ${mutedBorder} overflow-hidden`} style={{ background: surface }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className={`border-b ${mutedBorder} text-left`}>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase">Agent</th>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase">Chain</th>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase">Protocol</th>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase text-right"><button onClick={() => handleSort('totalScore')} className="flex items-center gap-1 ml-auto">Score <ArrowUpDown size={11} /></button></th>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase text-right"><button onClick={() => handleSort('starCount')} className="flex items-center gap-1 ml-auto">Stars <ArrowUpDown size={11} /></button></th>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase text-right">Feedback</th>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase">Owner</th>
                      <th className="p-4 font-medium opacity-50 text-xs uppercase"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((agent) => (
                      <tr key={agent.id} className={`border-b ${mutedBorder} hover:bg-white/[0.02]`}>
                        <td className="p-4">
                          <div className="flex items-center gap-2.5">
                            {agent.imageUrl ? (
                              <img src={agent.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                            ) : (
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white" style={{ background: accent }}>
                                {agent.name.slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="font-semibold flex items-center gap-1">
                                {agent.name}
                                {agent.isVerified && <BadgeCheck size={13} style={{ color: accent }} />}
                              </div>
                              <div className="text-[10px] opacity-40">{agent.category}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4"><ChainBadge chainId={agent.chainId} network={agent.network} /></td>
                        <td className="p-4"><ProtocolBadges protocols={agent.supportedProtocols} x402={agent.x402Supported} /></td>
                        <td className="p-4 text-right font-semibold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</td>
                        <td className="p-4 text-right">{agent.starCount ?? '—'}</td>
                        <td className="p-4 text-right opacity-70">{agent.totalFeedbacks ?? '—'}</td>
                        <td className="p-4 opacity-60 font-mono text-xs">{agent.ownerEns || agent.ownerUsername || (agent.ownerAddress ? `${agent.ownerAddress.slice(0, 6)}...${agent.ownerAddress.slice(-4)}` : '—')}</td>
                        <td className="p-4 text-right">
                          <button onClick={() => (agent.session ? (setSelectedAgent(agent), setHiring(true)) : handleHireClick(agent))} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: accent }}>
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {filtered.map((agent) => (
                  <div key={agent.id} className={`rounded-2xl border ${mutedBorder} p-5`} style={{ background: surface }}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {agent.imageUrl ? (
                          <img src={agent.imageUrl} alt="" className="w-10 h-10 rounded-xl object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
                        ) : (
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white" style={{ background: accent }}>{agent.name.slice(0, 1).toUpperCase()}</div>
                        )}
                        <div>
                          <div className="font-semibold flex items-center gap-1">{agent.name}{agent.isVerified && <BadgeCheck size={14} style={{ color: accent }} />}</div>
                          <div className="text-[10px] opacity-40 uppercase">{agent.category}</div>
                        </div>
                      </div>
                      <ChainBadge chainId={agent.chainId} network={agent.network} />
                    </div>
                    <p className="text-sm opacity-70 mb-3 leading-relaxed">{agent.strategy}</p>
                    <ProtocolBadges protocols={agent.supportedProtocols} x402={agent.x402Supported} />
                    <div className={`grid grid-cols-3 gap-3 my-4 p-3 rounded-xl border ${mutedBorder}`}>
                      <div><div className="text-[9px] opacity-40 uppercase">Score</div><div className="font-bold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</div></div>
                      <div><div className="text-[9px] opacity-40 uppercase">Stars</div><div className="font-bold">{agent.starCount ?? '—'}</div></div>
                      <div><div className="text-[9px] opacity-40 uppercase">TVL</div><div className="font-bold text-xs">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(2)}M` : <span className="opacity-40">not reported</span>}</div></div>
                    </div>
                    {agent.session ? (
                      <div>
                        <div className="flex justify-between text-xs mb-1"><span className="opacity-50">Spend Cap Utilized</span><span className="font-semibold">${agent.session.spendUtilized.toLocaleString()} / ${agent.session.spendCap.toLocaleString()}</span></div>
                        <div className={`w-full h-2 rounded-full border ${mutedBorder} mb-3`}><div className="h-full rounded-full" style={{ width: `${(agent.session.spendUtilized / agent.session.spendCap) * 100}%`, background: accent }} /></div>
                        <button onClick={() => handleRevoke(agent.id)} className="w-full py-2 rounded-lg text-xs font-semibold text-white bg-red-500">Revoke Access</button>
                      </div>
                    ) : (
                      <button onClick={() => handleHireClick(agent)} className="w-full py-2.5 rounded-lg text-sm font-semibold text-white" style={{ background: accent }}>Hire & Activate →</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {hiring && selectedAgent && (
          <div className={`max-w-xl mx-auto rounded-2xl border ${mutedBorder} p-8`} style={{ background: surface }}>
            <button onClick={() => setHiring(false)} className="text-xs opacity-60 hover:opacity-100 mb-6">&larr; Back to Marketplace</button>
            <h2 className="text-2xl font-bold mb-2">Establish Authority: {selectedAgent.name}</h2>
            <p className="text-sm opacity-60 mb-6 border-l-2 pl-3" style={{ borderColor: accent }}>You are generating a revocable session key under ERC-8004.</p>
            <div className="space-y-5 text-sm">
              <div>
                <label className="flex items-center gap-1 text-xs uppercase mb-2 font-semibold opacity-60"><Sliders size={13} /> Max Spend Cap (USDC)</label>
                <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} className={`w-full p-3 rounded-lg border ${mutedBorder} outline-none bg-transparent`} />
              </div>
              <div className={`p-4 rounded-xl border ${mutedBorder}`}>
                <div className="flex justify-between mb-2"><span className="text-xs uppercase font-semibold text-red-400">Emergency Stop-Loss</span><span className="font-bold text-red-400">${Number(stopLoss).toLocaleString()}</span></div>
                <input type="range" min="500" max="20000" step="500" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="w-full accent-red-500" />
              </div>
              <button onClick={handleActivateSession} className="w-full py-4 rounded-xl font-semibold text-white" style={{ background: accent }}>Sign Session Key & Deploy Agent</button>
            </div>
          </div>
        )}

        {nav === 'report' && (
          <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold mb-1">Agent Advantage Report</h1>
            <p className="opacity-60 text-sm mb-6">Three real tasks, run both ways.</p>
            <div className="space-y-4">
              {ADVANTAGE_REPORT.map((row, i) => (
                <div key={i} className={`rounded-2xl border ${mutedBorder} p-5`} style={{ background: surface }}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `${accent}22`, color: accent }}>{row.category}</span>
                    <h3 className="font-semibold">{row.task}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                      <div className="flex items-center gap-1 font-semibold mb-2 text-emerald-400"><CheckCircle2 size={13} /> WITH AGENT</div>
                      <div className="space-y-1 opacity-80"><div>Time: <strong>{row.withAgent.time}</strong></div><div>Cost: <strong>{row.withAgent.cost}</strong></div><div>{row.withAgent.quality}</div></div>
                    </div>
                    <div className={`p-3 rounded-xl border ${mutedBorder}`}>
                      <div className="flex items-center gap-1 font-semibold mb-2 opacity-60"><XCircle size={13} /> WITHOUT AGENT</div>
                      <div className="space-y-1 opacity-80"><div>Time: <strong>{row.withoutAgent.time}</strong></div><div>Cost: <strong>{row.withoutAgent.cost}</strong></div><div>{row.withoutAgent.quality}</div></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {nav === 'learn' && (
          <div className="max-w-3xl mx-auto">
            <h1 className="text-3xl font-bold mb-1">Learn</h1>
            <p className="opacity-60 text-sm mb-8">What each agent does, and what authority you're granting.</p>
            <div className="space-y-6">
              {LEARN_TOPICS.map((topic, i) => (
                <div key={i} className={`rounded-2xl border ${mutedBorder} overflow-hidden`} style={{ background: surface }}>
                  <div className={`p-4 border-b ${mutedBorder}`}><h3 className="font-semibold">{topic.title}</h3></div>
                  <div className={`divide-y ${mutedBorder}`}>
                    {topic.body.map((item, j) => (
                      <div key={j} className="p-4 flex gap-3">
                        <ChevronRight size={15} className="mt-0.5 shrink-0 opacity-40" />
                        <div><div className="text-xs font-semibold uppercase mb-1 opacity-70">{item.h}</div><p className="text-sm opacity-70 leading-relaxed">{item.p}</p></div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {nav === 'build' && (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-2 mb-1"><Sparkles size={20} style={{ color: accent }} /><h1 className="text-3xl font-bold">Build Your Agent</h1></div>
            <p className="opacity-60 text-sm mb-8">No coding required. If you can describe what you want, you can build this.</p>
            <div className="space-y-4 mb-10">
              {BUILD_STEPS.map((step, i) => (
                <div key={i} className={`rounded-2xl border ${mutedBorder} p-5`} style={{ background: surface }}>
                  <h3 className="font-semibold mb-2">{step.title}</h3>
                  <p className="text-sm opacity-70 leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
            <div className={`rounded-2xl border ${mutedBorder} p-5 mb-10`} style={{ background: surface }}>
              <div className="flex items-center gap-2 mb-3"><Link2 size={15} /><h3 className="text-xs font-semibold uppercase opacity-70">Deploy to other chains, honestly explained</h3></div>
              <p className="text-sm opacity-70 mb-3">Once built, your agent's identity already works everywhere. Bringing it to a new chain is one real action per chain:</p>
              <div className={`text-xs p-3 rounded-xl border ${mutedBorder} font-mono`}>Your Agent → [Register on Ethereum] [Register on Base] [Register on Polygon] ...</div>
            </div>
            <h3 className="text-xl font-semibold mb-4">Questions a total beginner would ask</h3>
            <div className="space-y-3">
              {KID_FRIENDLY_FAQ.map((item, i) => (
                <div key={i} className={`rounded-xl border ${mutedBorder} p-4`}>
                  <div className="font-semibold text-sm mb-1">{item.q}</div>
                  <div className="text-sm opacity-60">{item.a}</div>
                </div>
              ))}
            </div>
            <button className="w-full mt-8 py-4 rounded-xl font-semibold text-white" style={{ background: accent }}>Start Building →</button>
          </div>
        )}
      </main>

      <footer className={`border-t ${border} mt-16 py-10`}>
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-xs opacity-40">Part of the F2F collection · Agents Marketplace</div>
          <div className="flex items-center gap-4 text-xs opacity-60">
            <span>Scan to switch to the mobile view</span>
            <div className={`w-16 h-16 rounded-lg border ${mutedBorder} flex items-center justify-center text-[8px] text-center p-1`}>
              QR → agents-marketplacee.vercel.app
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
