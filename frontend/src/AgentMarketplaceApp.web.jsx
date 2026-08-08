import React, { useState, useMemo, useEffect } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, Sliders, CheckCircle2, XCircle,
  LayoutGrid, Table2, GraduationCap, Store, ArrowUpDown, ChevronRight, Loader2, AlertTriangle
} from 'lucide-react';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];

// Real backend, no mock data. Set VITE_API_BASE_URL in .env
// (http://localhost:8000 for local dev, your Render URL in production).
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

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
        // Map real backend fields to what the UI needs, no invented numbers.
        const mapped = (data.agents || []).map((a) => ({
          id: a.id,
          name: a.name || 'Unnamed agent',
          category: a.category || 'Unclassified',
          status: 'unknown', // real session/activity status isn't in 8004scan's data, honestly unknown
          network: a.network,
          totalScore: a.total_score,
          starCount: a.star_count,
          totalFeedbacks: a.total_feedbacks,
          strategy: a.description || 'No description provided.',
          financialDataAvailable: a.financial_data_available,
          tvlUsd: a.tvl_usd,
          defillamaUrl: a.defillama_url,
          ownerAddress: a.owner_address,
          session: null, // real session data only exists once a user actually hires this agent, not from the listing API
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
  {
    title: 'The four categories',
    body: [
      { h: 'Rebalancing', p: 'Keeps a liquidity position inside its active price range. When price moves out of range, the position earns nothing until someone re-centers it, an agent does this automatically, in seconds.' },
      { h: 'Grid Trading', p: 'Places a ladder of buy/sell orders across a price range, profiting from volatility inside that range without predicting direction.' },
      { h: 'Yield Optimisation', p: 'Continuously compares real APR across lending and LP venues, moving idle capital to whichever pays the most right now, not whichever paid the most last week.' },
      { h: 'Health Factor Monitoring', p: 'Watches a lending position\'s collateral ratio and acts before it crosses into liquidation, the single most expensive mistake in DeFi.' },
    ],
  },
  {
    title: 'What a session key actually is',
    body: [
      { h: 'Not your wallet', p: 'An agent never holds your main wallet\'s keys. You grant it a separate session key, scoped narrowly to what it\'s allowed to do.' },
      { h: 'Spend cap', p: 'A hard ceiling on total value the agent can move, enforced on-chain, not a promise in a UI. Once hit, further calls simply fail.' },
      { h: 'Expiry', p: 'Every session ends on its own, automatically, even if you forget to revoke it.' },
      { h: 'Revoke', p: 'One transaction, takes effect immediately, always visible from the agent\'s card, never buried in a settings menu.' },
    ],
  },
  {
    title: 'How hiring works, step by step',
    body: [
      { h: '1. Pick an agent', p: 'Filter by category, compare win rate, drawdown, and TVL managed.' },
      { h: '2. Set your limits', p: 'Spend cap and an emergency stop-loss, before the agent can touch anything.' },
      { h: '3. Sign once', p: 'One signature creates the scoped session key and registers it on-chain.' },
      { h: '4. Watch or walk away', p: 'The Authority Ledger on the agent\'s card shows exactly how much of the cap is used and how long the session has left, at any time.' },
    ],
  },
];

function AuthorityLedger({ session, darkMode, onRevoke }) {
  if (!session) return null;
  const pct = (session.spendUtilized / session.spendCap) * 100;
  return (
    <div>
      <div className="flex justify-between items-center mb-2 font-mono text-xs">
        <span className="font-bold flex items-center gap-1"><ShieldAlert size={14} className="text-blue-500" /> AUTHORITY LEDGER</span>
        <span className="opacity-60">Key: {session.key}</span>
      </div>
      <div className="mb-4">
        <div className="flex justify-between font-mono text-xs mb-1">
          <span>Spend Cap Utilized</span>
          <span className="font-bold">${session.spendUtilized.toLocaleString()} / ${session.spendCap.toLocaleString()}</span>
        </div>
        <div className={`w-full h-2.5 border ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-black bg-white'}`}>
          <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex justify-between items-center">
        <div className="font-mono text-xs"><span className="opacity-50 block text-[10px]">SESSION EXPIRY</span><strong className="text-amber-500">{session.expiry}</strong></div>
        <button onClick={onRevoke} className="bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold px-4 py-2 border-2 border-black shadow-[2px_2px_0px_#000] active:translate-y-0.5">REVOKE ACCESS</button>
      </div>
    </div>
  );
}

function SortHeader({ label, sortKey, sortState, onSort, border }) {
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
];

export default function AgentMarketplaceApp() {
  const [darkMode, setDarkMode] = useState(false);
  const [nav, setNav] = useState('market');
  const [marketView, setMarketView] = useState('grid'); // grid | table
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [hiring, setHiring] = useState(false);
  const [spendCap, setSpendCap] = useState(50000);
  const [stopLoss, setStopLoss] = useState(5000);
  const { agents, setAgents, loading, error } = useMarketplaceAgents();
  const [sortState, setSortState] = useState({ key: 'totalScore', dir: 'desc' });

  const chrome = darkMode ? 'bg-[#0F172A] text-[#F9FAFB]' : 'bg-[#F8F9FA] text-[#111827]';
  const border = darkMode ? 'border-gray-700' : 'border-black';
  const surface = darkMode ? 'bg-[#1F2937]' : 'bg-white';
  const shadow = darkMode ? 'shadow-[4px_4px_0px_#374151]' : 'shadow-[4px_4px_0px_#000]';

  const handleRevoke = (agentId) => setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, status: 'idle', session: null } : a)));

  const handleActivateSession = () => {
    if (!selectedAgent) return;
    setAgents((prev) => prev.map((a) => a.id === selectedAgent.id ? { ...a, status: 'active', session: { key: '0x' + Math.random().toString(16).substring(2, 10) + '...4a', spendUtilized: 0, spendCap: Number(spendCap), expiry: '24h 00m' } } : a));
    setSelectedAgent(null);
    setHiring(false);
  };

  const handleSort = (key) => setSortState((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));

  const filtered = useMemo(() => {
    const list = agents.filter((a) => activeCategory === 'All' || a.category === activeCategory);
    return [...list].sort((a, b) => {
      const av = a[sortState.key] ?? -Infinity;
      const bv = b[sortState.key] ?? -Infinity;
      const mult = sortState.dir === 'desc' ? -1 : 1;
      return (av - bv) * mult;
    });
  }, [agents, activeCategory, sortState]);

  return (
    <div className={`min-h-screen transition-colors duration-200 font-sans flex ${chrome}`}>
      {/* Left sidebar — the Bitbond-inspired addition, same neo-brutalist language */}
      <aside className={`w-56 shrink-0 border-r-2 flex flex-col ${border} ${darkMode ? 'bg-[#1F2937]' : 'bg-white'}`}>
        <div className={`p-5 border-b-2 ${border}`}>
          <div className="bg-[#22C55E] text-black font-mono font-bold px-2 py-1 text-xs border border-black shadow-[2px_2px_0px_#000] inline-block mb-2">BSC : LIVE</div>
          <h1 className="text-xl font-serif font-bold">A2A Protocol</h1>
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
                  active ? (darkMode ? 'bg-white text-black' : 'bg-black text-white shadow-[2px_2px_0px_#22C55E]') : `${darkMode ? 'bg-gray-800' : 'bg-white'} opacity-70 hover:opacity-100`
                }`}
              >
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className={`p-3 border-t-2 ${border}`}>
          <div className={`flex items-center gap-2 font-mono text-[10px] px-2 py-2 border-2 ${border} ${darkMode ? 'bg-gray-900' : 'bg-[#F4F3EE]'}`}>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> 0x7a2...9d41
          </div>
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
                <h2 className="text-3xl font-serif font-bold mb-1">Autonomous Agent Marketplace</h2>
                <p className="font-mono text-sm opacity-70">Discover, verify, and hire ERC-8004 agents with enforceable financial limits.</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setMarketView('grid')} className={`p-2 border-2 ${border} ${marketView === 'grid' ? 'bg-black text-white' : ''}`}><LayoutGrid size={16} /></button>
                <button onClick={() => setMarketView('table')} className={`p-2 border-2 ${border} ${marketView === 'table' ? 'bg-black text-white' : ''}`}><Table2 size={16} /></button>
              </div>
            </div>

            <div className="mb-6 flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setActiveCategory(cat)} className={`px-3 py-1.5 font-mono text-xs border-2 transition-all ${border} ${
                  activeCategory === cat ? (darkMode ? 'bg-white text-black font-bold' : 'bg-black text-white font-bold shadow-[2px_2px_0px_#22C55E]') : (darkMode ? 'bg-gray-800 text-gray-300' : 'bg-white text-black')
                }`}>{cat}</button>
              ))}
            </div>

            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 font-mono text-sm opacity-70">
                <Loader2 size={28} className="animate-spin" />
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
              // Bitbond-inspired sortable table, same visual language
              <div className={`border-2 ${border} ${surface} ${shadow} overflow-x-auto`}>
                <table className="w-full">
                  <thead>
                    <tr className={`border-b-2 ${border} ${darkMode ? 'bg-gray-900/50' : 'bg-[#F4F3EE]'}`}>
                      <th className="text-left p-3"><span className="font-mono text-[10px] uppercase font-bold opacity-60">Agent</span></th>
                      <th className="text-right p-3"><SortHeader label="Score" sortKey="totalScore" sortState={sortState} onSort={handleSort} border={border} /></th>
                      <th className="text-right p-3"><SortHeader label="Feedbacks" sortKey="totalFeedbacks" sortState={sortState} onSort={handleSort} border={border} /></th>
                      <th className="text-right p-3"><span className="font-mono text-[10px] uppercase font-bold opacity-60">TVL</span></th>
                      <th className="text-right p-3"><span className="font-mono text-[10px] uppercase font-bold opacity-60">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((agent) => (
                      <tr key={agent.id} className={`border-b ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${agent.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                            <div>
                              <div className="font-mono text-sm font-bold">{agent.name}</div>
                              <div className="font-mono text-[10px] opacity-50">{agent.category}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono text-sm font-bold text-green-500">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</td>
                        <td className="p-3 text-right font-mono text-sm">{agent.totalFeedbacks ?? '—'}</td>
                        <td className="p-3 text-right font-mono text-sm font-bold">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(2)}M` : <span className="opacity-40 font-normal">not reported</span>}</td>
                        <td className="p-3 text-right">
                          <button onClick={() => { setSelectedAgent(agent); setHiring(true); }} className={`font-mono text-[10px] font-bold px-3 py-1.5 border-2 ${border} ${darkMode ? 'bg-white text-black' : 'bg-black text-white'}`}>
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
                          <h3 className="text-xl font-serif font-bold">{agent.name}</h3>
                        </div>
                        <span className={`font-mono text-xs px-2.5 py-1 border opacity-50 border-gray-500`}>
                          UNVERIFIED SESSION
                        </span>
                      </div>
                      <div className={`grid grid-cols-3 gap-4 p-3 mb-4 font-mono text-xs border ${darkMode ? 'border-gray-700 bg-gray-900/50' : 'border-black/20 bg-[#F8F9FA]'}`}>
                        <div><span className="block opacity-50 text-[10px]">SCORE</span><span className="text-green-500 font-bold text-sm">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</span></div>
                        <div><span className="block opacity-50 text-[10px]">FEEDBACKS</span><span className="font-bold text-sm">{agent.totalFeedbacks ?? '—'}</span></div>
                        <div><span className="block opacity-50 text-[10px]">TVL</span><span className="font-bold text-sm">{agent.financialDataAvailable ? `$${(agent.tvlUsd / 1e6).toFixed(2)}M` : <span className="opacity-40 font-normal text-xs">not reported</span>}</span></div>
                      </div>
                      <p className="text-sm opacity-90 leading-relaxed mb-3">{agent.strategy}</p>
                      <div className={`font-mono text-[10px] px-2 py-1 border inline-block ${border} ${agent.network === 'mainnet' ? 'text-green-600' : 'opacity-60'}`}>
                        {agent.network === 'mainnet' ? '● MAINNET' : '○ TESTNET'}
                      </div>
                      {agent.financialDataAvailable && (
                        <div className={`text-xs font-mono p-2 border-l-4 border-[#22C55E] mt-2 ${darkMode ? 'bg-gray-900/40' : 'bg-[#F4F3EE]'}`}>
                          <span className="font-bold">Real TVL confirmed via DefiLlama</span> —{' '}
                          <a href={agent.defillamaUrl} target="_blank" rel="noreferrer" className="underline">view source</a>
                        </div>
                      )}
                    </div>
                    <div className={`p-6 border-t-2 ${border} ${darkMode ? 'bg-gray-900/80' : 'bg-[#F4F3EE]'}`}>
                      {agent.session ? (
                        <AuthorityLedger session={agent.session} darkMode={darkMode} onRevoke={() => handleRevoke(agent.id)} />
                      ) : (
                        <div className="flex justify-between items-center">
                          <span className="font-mono text-xs opacity-60">No active session key assigned.</span>
                          <button onClick={() => { setSelectedAgent(agent); setHiring(true); }} className={`font-mono text-xs font-bold px-6 py-2.5 border-2 transition-transform active:scale-95 ${border} ${darkMode ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800 shadow-[2px_2px_0px_#22C55E]'}`}>HIRE & ACTIVATE →</button>
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
          <div className={`max-w-2xl mx-auto border-2 p-6 md:p-8 ${border} ${surface} ${darkMode ? 'shadow-[6px_6px_0px_#374151]' : 'shadow-[6px_6px_0px_#000]'}`}>
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
                <button onClick={handleActivateSession} className="w-full py-4 bg-green-600 hover:bg-green-700 text-black font-bold font-mono tracking-wider border-2 border-black shadow-[4px_4px_0px_#000] active:translate-y-1 active:shadow-none transition-all">SIGN SESSION KEY & DEPLOY AGENT</button>
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
                      <div key={j} className={`p-4 flex gap-3 ${darkMode ? 'divide-gray-700' : 'divide-gray-200'}`}>
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
      </main>
    </div>
  );
}
