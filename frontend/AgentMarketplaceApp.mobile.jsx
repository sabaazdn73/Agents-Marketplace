import React, { useState } from 'react';
import {
  Sun, Moon, ShieldAlert, ChevronLeft, ScanFace,
  CheckCircle2, Loader2, X, TrendingUp, TrendingDown,
  Sliders, FileBarChart, LayoutGrid
} from 'lucide-react';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring'];

const AGENTS = [
  {
    id: 'RB-01', name: 'RangeKeeper', category: 'Rebalancing', status: 'active',
    winRate: '91.4%', drawdown: '-2.1%', tvl: '$2.8M',
    strategy: 'Resets PancakeSwap V3 LP ranges when price exits the band.',
    pancakeswapBenefit: 'Keeps LP capital in-range on PancakeSwap V3, improving pool depth.',
    session: { key: '0x8f3c...4a21', spendUtilized: 14500, spendCap: 50000, expiry: '14h 22m' },
  },
  {
    id: 'GT-02', name: 'TrustCycle-Grid-V3', category: 'Grid Trading', status: 'idle',
    winRate: '88.7%', drawdown: '-4.5%', tvl: '$1.1M',
    strategy: 'High-frequency localized arbitrage on fragmented PancakeSwap pairs.',
    pancakeswapBenefit: 'Narrows spread on thin PancakeSwap pairs via continuous grid orders.',
    session: null,
  },
  {
    id: 'YR-03', name: 'DIVG-Yield-Router', category: 'Yield Optimisation', status: 'active',
    winRate: '94.2%', drawdown: '-1.2%', tvl: '$4.2M',
    strategy: 'Routes idle capital to the highest verified APR across venues.',
    pancakeswapBenefit: 'Routes capital into PancakeSwap pools when their real APR leads.',
    session: { key: '0x1a9b...7f88', spendUtilized: 0, spendCap: 100000, expiry: '48h 00m' },
  },
  {
    id: 'HF-04', name: 'HCS-Health-Monitor', category: 'Health Factor Monitoring', status: 'active',
    winRate: '99.9%', drawdown: '0.0%', tvl: '$12.4M',
    strategy: 'Pre-emptive collateral swapping and liquidation defense.',
    pancakeswapBenefit: 'Executes defensive swaps through PancakeSwap on best-priced routes.',
    session: { key: '0x2c7e...9d10', spendUtilized: 3200, spendCap: 100000, expiry: '48h 00m' },
  },
];

const ADVANTAGE_REPORT = [
  { task: 'Rebalance $50k LP after a 6% move', category: 'Trading', with: { time: '38s', cost: '$0.41' }, without: { time: '22 min', cost: 'missed fees' } },
  { task: 'Close under-collateralized position', category: 'Security', with: { time: '4s', cost: '$0.18' }, without: { time: 'n/a', cost: '5% penalty' } },
  { task: 'Route idle USDC to best APR', category: 'Yield', with: { time: '11s', cost: '$0.09' }, without: { time: '15 min', cost: 'stale data' } },
];

// Mobile is deliberately a different pattern from the desktop grid: a
// dense, scannable ticker list (closer to a trading app's watchlist) with
// swipe-to-reveal actions and a full-screen detail sheet on tap, rather
// than a card grid shrunk to one column.
function TickerRow({ agent, darkMode, onOpen }) {
  const isUp = !agent.drawdown.startsWith('-') || agent.drawdown === '0.0%';
  return (
    <button
      onClick={() => onOpen(agent)}
      className={`w-full flex items-center gap-3 p-3 border-b active:bg-black/5 ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${agent.status === 'active' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
      <div className="flex-1 text-left min-w-0">
        <div className="font-mono text-sm font-bold truncate">{agent.name}</div>
        <div className="font-mono text-[10px] opacity-50 truncate">{agent.category}</div>
      </div>
      <div className="text-right shrink-0">
        <div className={`font-mono text-sm font-bold flex items-center gap-1 justify-end ${isUp ? 'text-green-500' : 'text-red-500'}`}>
          {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {agent.winRate}
        </div>
        <div className="font-mono text-[10px] opacity-50">{agent.tvl}</div>
      </div>
    </button>
  );
}

export default function AgentMarketplaceMobileApp() {
  const [darkMode, setDarkMode] = useState(false);
  const [tab, setTab] = useState('market'); // market | report
  const [activeCategory, setActiveCategory] = useState('All');
  const [openAgent, setOpenAgent] = useState(null); // full-screen detail sheet
  const [hireStep, setHireStep] = useState(null); // null | 'configure' | 'auth' | 'done'
  const [spendCap, setSpendCap] = useState(50000);
  const [stopLoss, setStopLoss] = useState(5000);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [agents, setAgents] = useState(AGENTS);

  const chrome = darkMode ? 'bg-[#0F172A] text-[#F9FAFB]' : 'bg-white text-[#111827]';
  const border = darkMode ? 'border-gray-800' : 'border-gray-200';

  const handleRevoke = (agentId) => {
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, status: 'idle', session: null } : a)));
    setOpenAgent((prev) => (prev ? { ...prev, status: 'idle', session: null } : prev));
  };

  const startHire = () => {
    setHireStep('configure');
  };

  const runFaceId = () => {
    setHireStep('auth');
    setIsAuthenticating(true);
    setTimeout(() => {
      setIsAuthenticating(false);
      setHireStep('done');
      setTimeout(() => {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === openAgent.id
              ? { ...a, status: 'active', session: { key: '0x' + Math.random().toString(16).slice(2, 10) + '...4a', spendUtilized: 0, spendCap: Number(spendCap), expiry: '24h 00m' } }
              : a
          )
        );
        setHireStep(null);
        setOpenAgent(null);
      }, 1200);
    }, 1800);
  };

  const filtered = agents.filter((a) => activeCategory === 'All' || a.category === activeCategory);

  return (
    <div className={`min-h-screen font-sans pb-16 ${chrome}`}>
      {/* Compact top bar — status strip, not a full header */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${border}`}>
        <div className="flex items-center gap-2">
          <div className="bg-[#22C55E] text-black font-mono font-bold px-1.5 py-0.5 text-[10px] border border-black">BSC</div>
          <span className="font-serif font-bold text-lg">A2A</span>
        </div>
        <button onClick={() => setDarkMode(!darkMode)}>
          {darkMode ? <Sun size={18} className="text-yellow-400" /> : <Moon size={18} />}
        </button>
      </div>

      {tab === 'market' && !openAgent && (
        <>
          {/* Horizontal-scroll category chips, thumb-reachable */}
          <div className="overflow-x-auto px-4 py-3 flex gap-2" style={{ scrollbarWidth: 'none' }}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 px-3 py-1.5 rounded-full font-mono text-[11px] border ${
                  activeCategory === cat ? 'bg-black text-white border-black' : `${border} opacity-70`
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Dense ticker list, not cards */}
          <div>
            {filtered.map((agent) => (
              <TickerRow key={agent.id} agent={agent} darkMode={darkMode} onOpen={setOpenAgent} />
            ))}
          </div>
        </>
      )}

      {tab === 'report' && (
        <div className="p-4">
          <h2 className="text-xl font-serif font-bold mb-1">Advantage Report</h2>
          <p className="font-mono text-xs opacity-60 mb-4">3 real tasks, run both ways.</p>
          <div className="space-y-3">
            {ADVANTAGE_REPORT.map((row, i) => (
              <div key={i} className={`border p-3 ${border}`}>
                <div className="font-mono text-[10px] uppercase opacity-50 mb-1">{row.category}</div>
                <div className="font-bold text-sm mb-2">{row.task}</div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className={`p-2 ${darkMode ? 'bg-green-900/20' : 'bg-green-50'}`}>
                    <div className="font-bold text-green-600 mb-0.5">WITH</div>
                    <div>{row.with.time} · {row.with.cost}</div>
                  </div>
                  <div className={`p-2 ${darkMode ? 'bg-gray-900/40' : 'bg-gray-100'}`}>
                    <div className="font-bold opacity-60 mb-0.5">WITHOUT</div>
                    <div>{row.without.time} · {row.without.cost}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full-screen agent detail sheet — replaces the screen, not a modal card */}
      {openAgent && (
        <div className={`fixed inset-0 z-40 ${chrome} overflow-y-auto`}>
          <div className={`flex items-center gap-3 px-4 py-3 border-b ${border} sticky top-0 ${chrome}`}>
            <button onClick={() => { setOpenAgent(null); setHireStep(null); }}>
              <ChevronLeft size={22} />
            </button>
            <span className="font-mono text-[10px] uppercase opacity-50">{openAgent.category}</span>
          </div>

          <div className="p-4">
            <h2 className="text-2xl font-serif font-bold mb-3">{openAgent.name}</h2>
            <div className={`grid grid-cols-3 gap-2 p-3 mb-4 font-mono text-xs border ${border}`}>
              <div><span className="block opacity-50 text-[10px]">WIN RATE</span><span className="text-green-500 font-bold">{openAgent.winRate}</span></div>
              <div><span className="block opacity-50 text-[10px]">DRAWDOWN</span><span className="text-red-500 font-bold">{openAgent.drawdown}</span></div>
              <div><span className="block opacity-50 text-[10px]">TVL</span><span className="font-bold">{openAgent.tvl}</span></div>
            </div>
            <p className="text-sm opacity-90 mb-3">{openAgent.strategy}</p>
            <div className={`text-xs font-mono p-3 border-l-4 border-[#22C55E] mb-4 ${darkMode ? 'bg-gray-900/40' : 'bg-[#F4F3EE]'}`}>
              <span className="font-bold">PancakeSwap:</span> {openAgent.pancakeswapBenefit}
            </div>

            {openAgent.session ? (
              <div className={`p-4 border ${border}`}>
                <div className="flex items-center gap-1 font-mono text-xs font-bold mb-2">
                  <ShieldAlert size={14} className="text-blue-500" /> AUTHORITY LEDGER
                </div>
                <div className="font-mono text-xs mb-3">
                  ${openAgent.session.spendUtilized.toLocaleString()} / ${openAgent.session.spendCap.toLocaleString()} used · expires {openAgent.session.expiry}
                </div>
                <button
                  onClick={() => handleRevoke(openAgent.id)}
                  className="w-full py-3 bg-red-600 text-white font-mono text-xs font-bold border-2 border-black"
                >
                  REVOKE ACCESS
                </button>
              </div>
            ) : !hireStep ? (
              <button onClick={startHire} className="w-full py-4 bg-black text-white font-mono text-sm font-bold border-2 border-black">
                HIRE AGENT →
              </button>
            ) : null}
          </div>

          {/* Hire flow — bottom sheet, thumb zone */}
          {hireStep && (
            <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm">
              <div className={`w-full border-t-2 p-6 rounded-t-[2rem] ${border} ${chrome}`}>
                {hireStep === 'configure' && (
                  <>
                    <div className="flex justify-between items-center mb-5">
                      <h3 className="text-lg font-serif font-bold">Configure Risk</h3>
                      <button onClick={() => setHireStep(null)}><X size={20} /></button>
                    </div>
                    <div className="space-y-5 font-mono text-sm mb-6">
                      <div>
                        <label className="flex items-center gap-1 text-xs uppercase mb-2 font-bold"><Sliders size={12} /> Max Spend Cap (USDC)</label>
                        <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} className={`w-full p-3 border ${border} outline-none ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`} />
                      </div>
                      <div>
                        <label className="block text-xs uppercase mb-2 font-bold text-red-500">Stop-Loss: ${Number(stopLoss).toLocaleString()}</label>
                        <input type="range" min="500" max="20000" step="500" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="w-full accent-red-600" />
                      </div>
                    </div>
                    <button onClick={runFaceId} className="w-full py-4 bg-black text-white font-mono text-sm font-bold flex items-center justify-center gap-2">
                      <ScanFace size={18} /> SIGN WITH FACE ID
                    </button>
                  </>
                )}
                {hireStep === 'auth' && (
                  <div className="py-8 flex flex-col items-center gap-3">
                    <Loader2 size={32} className="animate-spin text-blue-500" />
                    <span className="font-mono text-sm">Scanning Face ID...</span>
                  </div>
                )}
                {hireStep === 'done' && (
                  <div className="py-8 flex flex-col items-center gap-3">
                    <CheckCircle2 size={32} className="text-green-500" />
                    <span className="font-mono text-sm font-bold">Signature verified</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom tab bar — the mobile-native navigation the desktop doesn't have */}
      <nav className={`fixed bottom-0 w-full border-t flex justify-around py-2 ${border} ${chrome}`}>
        <button onClick={() => setTab('market')} className={`flex flex-col items-center gap-0.5 px-6 py-1 ${tab === 'market' ? '' : 'opacity-40'}`}>
          <LayoutGrid size={20} />
          <span className="text-[10px] font-mono">Market</span>
        </button>
        <button onClick={() => setTab('report')} className={`flex flex-col items-center gap-0.5 px-6 py-1 ${tab === 'report' ? '' : 'opacity-40'}`}>
          <FileBarChart size={20} />
          <span className="text-[10px] font-mono">Report</span>
        </button>
      </nav>
    </div>
  );
}
