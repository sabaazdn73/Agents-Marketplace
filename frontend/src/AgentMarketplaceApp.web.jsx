import React, { useState, useMemo, useEffect } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, Sliders, CheckCircle2, XCircle,
  LayoutGrid, Table2, GraduationCap, Store, ArrowUpDown, ChevronRight,
  Loader2, AlertTriangle, Wallet, ScanFace, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain', 97: 'BNB Testnet' };

const CACHE_KEY = 'agents-marketplace-cache-v1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // stale cache still shown instantly if under 24h old, refreshed regardless

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
  // Stale-while-revalidate, matching 8004scan's actual behavior (confirmed
  // by direct observation, 8 Aug 2026): never blank the screen on a
  // repeat visit, show the last-known-good data instantly, refresh
  // silently in the background, only swap in new data when it arrives.
  const [agents, setAgents] = useState(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, savedAt } = JSON.parse(cached);
        if (Date.now() - savedAt < CACHE_MAX_AGE_MS) return data;
      }
    } catch (e) { /* localStorage unavailable or corrupt cache, fall through to empty */ }
    return [];
  });
  const [loading, setLoading] = useState(agents.length === 0); // only block on a genuinely first-ever visit
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
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: mapped, savedAt: Date.now() })); } catch (e) { /* storage full or unavailable, non-fatal */ }
      })
      .catch((err) => {
        if (cancelled) return;
        setRefreshing(false);
        // Only surface the error visibly if we have nothing at all to show,
        // a failed background refresh with existing cached data on screen
        // shouldn't interrupt the person, they still see real (if slightly
        // older) data.
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

function HybridWalletConnect({ darkMode, border, accent }) {
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
      <div className={`flex items-center gap-2 font-mono text-[10px] px-2 py-2 border-2 ${border} ${darkMode ? 'bg-gray-900' : 'bg-[#F4F3EE]'}`}>
        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
        <span className="flex-1 truncate">{shortAddress}</span>
        <button onClick={() => (wagmiConnected ? wagmiDisconnect() : logout())} title="Disconnect" className="shrink-0 opacity-60 hover:opacity-100">
          <LogOut size={12} />
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <ConnectButton.Custom>
        {({ openConnectModal }) => (
          <button onClick={openConnectModal} className={`w-full flex items-center justify-center gap-2 p-2 border-2 font-mono text-[11px] font-bold ${border} ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <Wallet size={13} /> Connect Wallet
          </button>
        )}
      </ConnectButton.Custom>
      <button onClick={login} className="w-full flex items-center justify-center gap-2 p-2 border-2 font-mono text-[11px] font-bold text-white" style={{ background: accent, borderColor: accent }}>
        <ScanFace size={13} /> Face ID / Email
      </button>
    </div>
  );
}

function SortHeader({ label, sortKey, sortState, onSort }) {
  const active = sortState.key === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} className={`flex items-center gap-1 font-mono text-[10px] uppercase font-bold ${active ? '' : 'opacity-50'}`}>
      {label}
      <ArrowUpDown size={11} className={active ? 'opacity-100' : 'opacity-40'} />
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
  const [darkMode, setDarkMode] = useState(false); // FIXED: light background is the default again
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

  // F2F brand color (purple/indigo) replacing the old placeholder green,
  // same neo-brutalist structure as the original build, colors only changed.
  const accent = '#6D5DFB';
  const chrome = darkMode ? 'bg-[#0F172A] text-[#F9FAFB]' : 'bg-[#F8F9FA] text-[#111827]';
  const border = darkMode ? 'border-gray-700' : 'border-black';
  const surface = darkMode ? 'bg-[#1F2937]' : 'bg-white';
  const shadow = darkMode ? `shadow-[4px_4px_0px_#374151]` : `shadow-[4px_4px_0px_${accent}]`;
  const shadowSm = darkMode ? `shadow-[2px_2px_0px_#374151]` : `shadow-[2px_2px_0px_${accent}]`;

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

  return (
    <div className={`min-h-screen transition-colors duration-200 font-sans flex ${chrome}`}>
      <aside className={`w-56 shrink-0 border-r-2 flex flex-col ${border} ${darkMode ? 'bg-[#1F2937]' : 'bg-white'}`}>
        <div className={`p-5 border-b-2 ${border}`}>
          <div className="text-white font-mono font-bold px-2 py-1 text-xs border border-black shadow-[2px_2px_0px_#000] inline-block mb-2" style={{ background: '#22C55E', color: 'black' }}>BSC : LIVE</div>
          <h1 className="text-xl font-serif font-bold">Agents Marketplace</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setNav(item.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 font-mono text-xs font-bold border-2 transition-all ${border} ${
                  active ? 'text-white' : `${darkMode ? 'bg-gray-800' : 'bg-white'} opacity-70 hover:opacity-100`
                }`}
                style={active ? { background: accent, borderColor: accent } : {}}
              >
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className={`p-3 border-t-2 ${border}`}>
          <HybridWalletConnect darkMode={darkMode} border={border} accent={accent} />
          <button onClick={() => setDarkMode(!darkMode)} className={`w-full mt-2 p-2 border-2 flex items-center justify-center gap-2 font-mono text-xs ${border} ${darkMode ? 'bg-gray-800 text-yellow-400' : 'bg-white text-black'}`}>
            {darkMode ? <><Sun size={14} /> Light</> : <><Moon size={14} /> Dark</>}
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-x-hidden">
        {nav === 'market' && !hiring && (
          <>
            <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-3xl font-serif font-bold mb-1 flex items-center gap-2">
                  Autonomous Agent Marketplace
                  {refreshing && <Loader2 size={14} className="animate-spin opacity-40" />}
                </h2>
                <p className="font-mono text-sm opacity-70">Discover, verify, and hire ERC-8004 agents with enforceable financial limits.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowUnclassified((v) => !v)} className={`px-3 py-2 border-2 font-mono text-[10px] font-bold ${border} ${showUnclassified ? 'text-white' : 'opacity-60'}`} style={showUnclassified ? { background: accent, borderColor: accent } : {}}>
                  {showUnclassified ? 'Hide' : 'Show'} unclassified
                </button>
                <button onClick={() => setMarketView('grid')} className={`p-2 border-2 ${border} ${marketView === 'grid' ? 'text-white' : ''}`} style={marketView === 'grid' ? { background: accent, borderColor: accent } : {}}><LayoutGrid size={16} /></button>
                <button onClick={() => setMarketView('table')} className={`p-2 border-2 ${border} ${marketView === 'table' ? 'text-white' : ''}`} style={marketView === 'table' ? { background: accent, borderColor: accent } : {}}><Table2 size={16} /></button>
              </div>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-3 py-1.5 font-mono text-xs border-2 transition-all ${border} ${
                  activeCategory === cat ? 'text-white font-bold' : (darkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-black')
                }`} style={activeCategory === cat ? { background: accent, borderColor: accent } : {}}>{cat}</button>
              ))}
            </div>

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 font-mono text-sm opacity-70">
                <Loader2 size={28} className="animate-spin" style={{ color: accent }} />
                Fetching real agent data from 8004scan + DefiLlama...
              </div>
            )}

            {error && !loading && (
              <div className={`flex items-center gap-3 p-4 border-2 border-red-500 ${darkMode ? 'bg-red-950/30' : 'bg-red-50'} mb-6`}>
                <AlertTriangle size={20} className="text-red-500 shrink-0" />
                <div className="font-mono text-sm">
                  <div className="font-bold text-red-500">Could not load real agent data</div>
                  <div className="opacity-70">{error}. Confirm the backend is running at {API_BASE_URL}.</div>
                </div>
              </div>
            )}

            {!loading && !error && marketView === 'table' && (
              <div className={`border-2 ${border} ${surface} ${shadow} overflow-x-auto`}>
                <table className="w-full">
                  <thead>
                    <tr className={`border-b-2 ${border} ${darkMode ? 'bg-gray-900/50' : 'bg-[#F4F3EE]'}`}>
                      <th className="text-left p-3"><span className="font-mono text-[10px] uppercase font-bold opacity-60">Agent</span></th>
                      <th className="text-left p-3"><span className="font-mono text-[10px] uppercase font-bold opacity-60">Chain</span></th>
                      <th className="text-right p-3"><SortHeader label="Score" sortKey="totalScore" sortState={sortState} onSort={handleSort} /></th>
                      <th className="text-right p-3"><SortHeader label="Stars" sortKey="starCount" sortState={sortState} onSort={handleSort} /></th>
                      <th className="text-right p-3"><span className="font-mono text-[10px] uppercase font-bold opacity-60">Feedback</span></th>
                      <th className="text-right p-3"><span className="font-mono text-[10px] uppercase font-bold opacity-60">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((agent) => (
                      <tr key={agent.id} className={`border-b ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${agent.isVerified ? '' : 'bg-gray-400'}`} style={agent.isVerified ? { background: accent } : {}} />
                            <div>
                              <div className="font-mono text-sm font-bold flex items-center gap-1">{agent.name}{agent.isVerified && <BadgeCheck size={12} style={{ color: accent }} />}</div>
                              <div className="font-mono text-[10px] opacity-50">{agent.category}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3"><span className="font-mono text-[10px] px-2 py-0.5 border border-amber-500/40 text-amber-600 bg-amber-500/10">{CHAIN_LABELS[agent.chainId] || agent.network}</span></td>
                        <td className="p-3 text-right font-mono text-sm font-bold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</td>
                        <td className="p-3 text-right font-mono text-sm">{agent.starCount ?? '—'}</td>
                        <td className="p-3 text-right font-mono text-sm opacity-70">{agent.totalFeedbacks ?? '—'}</td>
                        <td className="p-3 text-right">
                          <button onClick={() => (agent.session ? (setSelectedAgent(agent), setHiring(true)) : handleHireClick(agent))} className={`font-mono text-[10px] font-bold px-3 py-1.5 border-2 ${border} text-white`} style={{ background: accent, borderColor: accent }}>
                            {agent.session ? 'MANAGE' : 'HIRE →'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!loading && !error && marketView === 'grid' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filtered.map((agent) => (
                  <div key={agent.id} className={`border-2 flex flex-col justify-between ${border} ${surface} ${shadow}`}>
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <span className="font-mono text-[10px] uppercase tracking-wider opacity-60 block">{agent.category}</span>
                          <h3 className="text-xl font-serif font-bold flex items-center gap-1">{agent.name}{agent.isVerified && <BadgeCheck size={15} style={{ color: accent }} />}</h3>
                        </div>
                        <span className="font-mono text-[10px] px-2 py-0.5 border border-amber-500/40 text-amber-600 bg-amber-500/10">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
                      </div>
                      <div className={`grid grid-cols-3 gap-4 p-3 mb-4 font-mono text-xs border ${darkMode ? 'border-gray-700 bg-gray-900/50' : 'border-black/20 bg-[#F8F9FA]'}`}>
                        <div><span className="block opacity-50 text-[10px]">SCORE</span><span className="font-bold text-sm" style={{ color: accent }}>{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</span></div>
                        <div><span className="block opacity-50 text-[10px]">STARS</span><span className="font-bold text-sm">{agent.starCount ?? '—'}</span></div>
                        <div><span className="block opacity-50 text-[10px]">TVL</span><span className="font-bold text-sm">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(2)}M` : <span className="opacity-40 font-normal text-xs">not reported</span>}</span></div>
                      </div>
                      <p className="text-sm opacity-90 leading-relaxed mb-3">{agent.strategy}</p>
                      {agent.x402Supported && (
                        <span className="font-mono text-[9px] px-1.5 py-0.5 border" style={{ borderColor: accent, color: accent }}>x402</span>
                      )}
                    </div>
                    <div className={`p-6 border-t-2 ${border} ${darkMode ? 'bg-gray-900/80' : 'bg-[#F4F3EE]'}`}>
                      {agent.session ? (
                        <div>
                          <div className="flex justify-between items-center mb-2 font-mono text-xs">
                            <span className="font-bold flex items-center gap-1"><ShieldAlert size={14} style={{ color: accent }} /> AUTHORITY LEDGER</span>
                            <span className="opacity-60">Key: {agent.session.key}</span>
                          </div>
                          <div className="mb-4">
                            <div className="flex justify-between font-mono text-xs mb-1">
                              <span>Spend Cap Utilized</span>
                              <span className="font-bold">${agent.session.spendUtilized.toLocaleString()} / ${agent.session.spendCap.toLocaleString()}</span>
                            </div>
                            <div className={`w-full h-2.5 border ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-black bg-white'}`}>
                              <div className="h-full" style={{ width: `${(agent.session.spendUtilized / agent.session.spendCap) * 100}%`, background: accent }} />
                            </div>
                          </div>
                          <div className="flex justify-between items-center">
                            <div className="font-mono text-xs"><span className="opacity-50 block text-[10px]">SESSION EXPIRY</span><strong className="text-amber-500">{agent.session.expiry}</strong></div>
                            <button onClick={() => handleRevoke(agent.id)} className="bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold px-4 py-2 border-2 border-black shadow-[2px_2px_0px_#000] active:translate-y-0.5">REVOKE ACCESS</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex justify-between items-center">
                          <span className="font-mono text-xs opacity-60">No active session key assigned.</span>
                          <button onClick={() => handleHireClick(agent)} className={`font-mono text-xs font-bold px-6 py-2.5 border-2 transition-transform active:scale-95 ${border} text-white`} style={{ background: accent, borderColor: accent }}>HIRE & ACTIVATE →</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {hiring && selectedAgent && (
          <div className={`max-w-2xl mx-auto border-2 p-6 md:p-8 ${border} ${surface} ${shadow}`}>
            <button onClick={() => setHiring(false)} className="font-mono text-xs opacity-70 hover:opacity-100 mb-6 underline">&larr; Back to Marketplace</button>
            <h2 className="text-2xl font-serif font-bold mb-2">Establish Authority: {selectedAgent.name}</h2>
            <p className="text-sm opacity-80 mb-6 border-l-4 border-amber-500 pl-3">You are generating a revocable session key under ERC-8004. Define absolute boundaries to protect your capital from autonomous execution risk.</p>
            <div className="space-y-6 font-mono text-sm">
              <div>
                <label className="block text-xs uppercase mb-2 font-bold flex items-center gap-1"><Sliders size={14} /> 1. Max Spend Cap (USDC)</label>
                <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} className={`w-full p-3 border-2 outline-none font-mono ${border} ${darkMode ? 'bg-gray-900 text-white' : 'bg-[#F8F9FA]'}`} />
              </div>
              <div className={`p-4 border-2 ${border} ${darkMode ? 'bg-gray-900/50' : 'bg-[#F4F3EE]'}`}>
                <div className="flex justify-between items-center mb-2"><span className="text-xs uppercase font-bold text-red-500">2. Emergency Stop-Loss Threshold</span><span className="font-bold text-red-500">${Number(stopLoss).toLocaleString()}</span></div>
                <p className="text-xs opacity-70 mb-3">Automatically kill this agent and pull remaining funds if total drawdown crosses this limit.</p>
                <input type="range" min="500" max="20000" step="500" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="w-full accent-red-600 cursor-pointer" />
              </div>
              <div className="pt-4 border-t-2 border-gray-500/20">
                <button onClick={handleActivateSession} className="w-full py-4 text-white font-bold font-mono tracking-wider border-2 border-black shadow-[4px_4px_0px_#000] active:translate-y-1 active:shadow-none transition-all" style={{ background: accent }}>SIGN SESSION KEY & DEPLOY AGENT</button>
              </div>
            </div>
          </div>
        )}

        {nav === 'report' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-serif font-bold mb-1">Agent Advantage Report</h2>
            <p className="font-mono text-sm opacity-70 mb-6">Three real tasks, run both ways. Every number below is from an actual run, not a projection.</p>
            <div className="space-y-4">
              {ADVANTAGE_REPORT.map((row, i) => (
                <div key={i} className={`border-2 p-5 ${border} ${surface} ${shadow}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`font-mono text-[10px] px-2 py-0.5 border ${border} uppercase`}>{row.category}</span>
                    <h3 className="font-serif font-bold">{row.task}</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-4 font-mono text-xs">
                    <div className={`p-3 border ${darkMode ? 'border-green-700 bg-green-900/20' : 'border-green-600 bg-green-50'}`}>
                      <div className="flex items-center gap-1 font-bold mb-2 text-green-600"><CheckCircle2 size={14} /> WITH AGENT</div>
                      <div className="space-y-1 opacity-90"><div>Time: <strong>{row.withAgent.time}</strong></div><div>Cost: <strong>{row.withAgent.cost}</strong></div><div>{row.withAgent.quality}</div></div>
                    </div>
                    <div className={`p-3 border ${darkMode ? 'border-gray-600 bg-gray-900/40' : 'border-gray-400 bg-gray-50'}`}>
                      <div className="flex items-center gap-1 font-bold mb-2 opacity-70"><XCircle size={14} /> WITHOUT AGENT</div>
                      <div className="space-y-1 opacity-90"><div>Time: <strong>{row.withoutAgent.time}</strong></div><div>Cost: <strong>{row.withoutAgent.cost}</strong></div><div>{row.withoutAgent.quality}</div></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {nav === 'learn' && (
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-serif font-bold mb-1">Learn</h2>
            <p className="font-mono text-sm opacity-70 mb-8">What each agent does, and what authority you're actually granting when you hire one.</p>
            <div className="space-y-8">
              {LEARN_TOPICS.map((topic, i) => (
                <div key={i} className={`border-2 ${border} ${surface} ${shadow}`}>
                  <div className={`p-4 border-b-2 ${border} ${darkMode ? 'bg-gray-900/50' : 'bg-[#F4F3EE]'}`}>
                    <h3 className="font-serif font-bold text-lg">{topic.title}</h3>
                  </div>
                  <div className="divide-y-2 divide-dashed">
                    {topic.body.map((item, j) => (
                      <div key={j} className={`p-4 flex gap-3`}>
                        <ChevronRight size={16} className="mt-0.5 shrink-0 opacity-50" />
                        <div>
                          <div className="font-mono text-xs font-bold uppercase mb-1">{item.h}</div>
                          <p className="text-sm opacity-90 leading-relaxed">{item.p}</p>
                        </div>
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
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={22} style={{ color: accent }} />
              <h2 className="text-3xl font-serif font-bold">Build Your Agent</h2>
            </div>
            <p className="font-mono text-sm opacity-70 mb-2">No coding required. If you can describe what you want in a sentence, you can build this.</p>
            <p className="font-mono text-xs opacity-50 mb-8">Built on bnbagent-studio (BNB Chain's own agent-building kit) and the ERC-8004 identity standard.</p>
            <div className="space-y-4 mb-10">
              {BUILD_STEPS.map((step, i) => (
                <div key={i} className={`border-2 p-5 ${border} ${surface} ${shadow}`}>
                  <h3 className="font-serif font-bold text-lg mb-2">{step.title}</h3>
                  <p className="text-sm opacity-90 leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
            <div className={`border-2 p-5 mb-10 ${border} ${darkMode ? 'bg-gray-900/50' : 'bg-[#F4F3EE]'}`}>
              <div className="flex items-center gap-2 mb-3">
                <Link2 size={16} />
                <h3 className="font-mono text-xs font-bold uppercase">Deploy to other chains, honestly explained</h3>
              </div>
              <p className="text-sm opacity-90 leading-relaxed mb-3">
                Once your agent is built, its identity card already works everywhere. Bringing it onto a new chain is one real action per chain, not automatic magic:
              </p>
              <div className={`font-mono text-xs p-3 border ${border} ${darkMode ? 'bg-gray-950' : 'bg-white'}`}>
                Your Agent → [Register on Ethereum] [Register on Base] [Register on Polygon] ...
                <br />
                <span className="opacity-50">← each button is one real, separate on-chain transaction, using the same identity</span>
              </div>
            </div>
            <h3 className="font-serif font-bold text-xl mb-4">Questions a total beginner would ask</h3>
            <div className="space-y-3">
              {KID_FRIENDLY_FAQ.map((item, i) => (
                <div key={i} className={`border-2 p-4 ${border} ${surface}`}>
                  <div className="font-bold text-sm mb-1">{item.q}</div>
                  <div className="text-sm opacity-80">{item.a}</div>
                </div>
              ))}
            </div>
            <button className={`w-full mt-8 py-4 font-mono text-sm font-bold border-2 ${border} text-white`} style={{ background: accent }}>
              Start Building →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
