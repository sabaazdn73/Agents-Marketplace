import React, { useState, useMemo, useEffect } from 'react';
import {
  Sun, Moon, ShieldAlert, FileBarChart, CheckCircle2, XCircle,
  GraduationCap, Store, ChevronRight, Loader2, AlertTriangle,
  Wallet, LogOut, Hammer, Sparkles, Link2, BadgeCheck,
  Activity, Users, MessageSquare, Menu
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import iconLogo from './assets/icon_v2.svg';
import { useHireAgent } from './useHireAgent';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain', 97: 'BNB Testnet' };

// Source: docs.bnbchain.org/developer-kit — matches web's Learn content.
const LEARN_TOPICS = [
  { h: 'ERC-8004 — Identity', p: 'Every agent gets an on-chain identity token (ERC-721), a discoverable profile, and metadata. Gas-free registration via MegaFuel paymaster.' },
  { h: 'ERC-8183 — Commerce', p: 'A trustless job protocol: client + provider transact through AgenticCommerce (escrow), EvaluatorRouter (routing), OptimisticPolicy (silence = approve).' },
  { h: 'Hiring = a real job, not a subscription', p: 'createJob → registerJob → setBudget → fund. Your wallet signs each step. The budget sits in escrow, it\'s not a standing permission.' },
  { h: 'Job lifecycle', p: 'OPEN → FUNDED → SUBMITTED → COMPLETED (settled) / REJECTED (disputed) / EXPIRED (never settled).' },
  { h: 'The real safety net', p: 'claimRefund() after expiry with no settlement, non-pausable, non-hookable, always available.' },
  { h: 'Dispute window', p: 'If a submitted result looks wrong, dispute() during the review window, whitelisted voters decide.' },
];

// Real bag CLI workflow. v0.0.1 is seller-only, currently BSC only.
const BUILD_STEPS = [
  { h: '1. Describe it in plain English', p: 'Tell Claude Code or Cursor what you want, e.g. "a BNB agent that sells weather forecasts." BNB Agent Studio scaffolds the real project.' },
  { h: '2. Two layers, automatically', p: 'Layer A (the Agent) holds the wallet + LLM, the only signer. Layer B (public, keyless) just relays requests.' },
  { h: '3. You edit one function', p: 'Everything else is already wired. You customize handle_fulfill: what your agent actually does.' },
  { h: '4. Test before spending anything', p: 'bag dev runs both layers locally, hit the real /negotiate endpoint before deploying.' },
  { h: '5. Register, then deploy', p: 'bag erc8004 register makes it discoverable. Deploy sends Layer A to AgentCore and Layer B to EC2.' },
];
const CACHE_KEY = 'agents-marketplace-cache-v1';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function mapAgent(a) {
  return {
    id: a.id, name: a.name || 'Unnamed', category: a.category || 'Unclassified',
    network: a.network, chainId: a.chain_id, totalScore: a.total_score,
    starCount: a.star_count, totalFeedbacks: a.total_feedbacks, isVerified: a.is_verified,
    strategy: a.description || 'No description provided.',
    financialDataAvailable: a.financial_data_available, tvlUsd: a.tvl_usd,
    session: null,
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

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const mapped = (data.agents || []).map(mapAgent);
        setAgents(mapped);
        setLoading(false);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: mapped, savedAt: Date.now() })); } catch (e) {}
      })
      .catch((err) => {
        if (cancelled) return;
        if (agents.length === 0) setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { agents, setAgents, loading, error };
}

const NAV_ITEMS = [
  { id: 'market', label: 'Market', icon: Store },
  { id: 'report', label: 'Report', icon: FileBarChart },
  { id: 'learn', label: 'Learn', icon: GraduationCap },
  { id: 'build', label: 'Build', icon: Hammer },
];

// Mobile-optimized Wallet Modal / Sheet
function MobileWalletSheet({ onClose }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { ready, authenticated, user, login, logout } = usePrivy();
  const privyConnected = ready && authenticated;
  const activeAddress = wagmiConnected ? wagmiAddress : user?.wallet?.address;
  const isConnected = wagmiConnected || privyConnected;
  const shortAddress = activeAddress ? `${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full bg-white dark:bg-[#0F172A] rounded-t-3xl p-6 pb-10" onClick={e => e.stopPropagation()}>
        <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-700 rounded-full mx-auto mb-6" />
        <h3 className="text-lg font-bold mb-6 text-gray-900 dark:text-white text-center">Web3 Connection</h3>
        
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
            <button onClick={() => { login(); onClose(); }} className="w-full flex justify-between items-center bg-gray-100 dark:bg-[#1E293B] text-gray-900 dark:text-white text-base font-semibold py-4 px-5 rounded-2xl">
              <span>Face ID / Email</span>
              <ChevronRight size={20} className="text-gray-400" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentMarketplaceMobile() {
  const [darkMode, setDarkMode] = useState(false);
  const [nav, setNav] = useState('market');
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
  const [walletSheetOpen, setWalletSheetOpen] = useState(false);
  const { agents, setAgents, loading, error } = useMarketplaceAgents();

  const { isConnected: wagmiConnected } = useAccount();
  const { ready, authenticated } = usePrivy();
  const walletConnected = wagmiConnected || (ready && authenticated);

  const handleHireClick = (agent) => {
    if (!walletConnected) { setWalletSheetOpen(true); return; }
    setSelectedAgent(agent);
    setHiring(true);
  };

  const { hire, step: hireStep, error: hireError } = useHireAgent();

  const handleActivateSession = async () => {
    if (!selectedAgent || !walletConnected) return;
    if (!selectedAgent.ownerAddress) {
      alert("This agent has no on-chain owner address on record, can't create a real job.");
      return;
    }
    try {
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
      // hireError from the hook is surfaced in the modal, no silent failure
    }
  };

  const filtered = useMemo(() => {
    let list = agents.filter(a => a.name && a.name.trim().length > 2);
    return list.filter((a) => activeCategory === 'All' || a.category === activeCategory);
  }, [agents, activeCategory]);

  return (
    <div className={`flex flex-col h-[100dvh] font-sans ${darkMode ? 'dark bg-[#0B101B] text-white' : 'bg-[#F4F5F8] text-gray-900'}`}>
      
      {/* App Header (Sticky) */}
      <header className="shrink-0 flex items-center justify-between px-5 py-4 bg-white/80 dark:bg-[#0F172A]/80 backdrop-blur-md border-b border-gray-200/50 dark:border-white/5 z-20 pt-safe">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg overflow-hidden">
            <img src={iconLogo} alt="Agents Marketplace" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">Agents Marketplace</h1>
        </div>
        <div className="flex items-center gap-3">
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
            <button onClick={() => setHiring(false)} className="flex items-center gap-1 text-sm text-gray-500 font-medium mb-6">
              <ChevronRight size={18} className="rotate-180" /> Back
            </button>
            <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-6 shadow-sm border border-gray-100 dark:border-gray-800">
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-2xl mb-4">
                {selectedAgent.name.charAt(0)}
              </div>
              <h2 className="text-2xl font-bold mb-1">{selectedAgent.name}</h2>
              <p className="text-gray-500 text-sm mb-6">Establish on-chain authority.</p>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2">Max Spend Cap (USDC)</label>
                  <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} className="w-full p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0F172A] text-lg font-mono outline-none" />
                </div>
                <button onClick={handleActivateSession} className="w-full py-4 rounded-xl font-bold text-white bg-indigo-600 active:scale-[0.98] transition-transform">
                  SIGN & DEPLOY
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5">
            {nav === 'market' && (
              <>
                <div className="mb-6">
                  <h2 className="text-2xl font-bold mb-1">Marketplace</h2>
                  <p className="text-sm text-gray-500">Discover and hire AI agents.</p>
                </div>

                {/* Horizontal Scroll Categories */}
                <div className="flex overflow-x-auto pb-4 -mx-5 px-5 gap-2 snap-x hide-scrollbar">
                  {CATEGORIES.map((cat) => (
                    <button key={cat} onClick={() => setActiveCategory(cat)} className={`shrink-0 px-5 py-2.5 rounded-full text-sm font-medium snap-start transition-colors ${
                      activeCategory === cat ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-white dark:bg-[#1E293B] border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300'
                    }`}>
                      {cat}
                    </button>
                  ))}
                </div>

                {loading ? (
                  <div className="flex flex-col items-center justify-center py-20"><Loader2 size={24} className="animate-spin text-indigo-500" /></div>
                ) : (
                  <div className="space-y-4">
                    {filtered.map((agent) => (
                      <div key={agent.id} className="bg-white dark:bg-[#1E293B] rounded-3xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm flex flex-col">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1">{agent.category}</span>
                            <h3 className="text-lg font-bold flex items-center gap-1">{agent.name}{agent.isVerified && <BadgeCheck size={14} className="text-indigo-500" />}</h3>
                          </div>
                          <span className="text-[10px] px-2 py-1 rounded-md bg-gray-50 dark:bg-gray-800 font-medium">{CHAIN_LABELS[agent.chainId] || agent.network}</span>
                        </div>
                        
                        <div className="flex gap-4 mb-4">
                          <div><span className="text-[10px] text-gray-500 uppercase block">Score</span><span className="font-bold text-sm">{agent.totalScore?.toFixed(1) || '—'}</span></div>
                          <div><span className="text-[10px] text-gray-500 uppercase block">TVL</span><span className="font-bold text-sm">{agent.tvlUsd ? `$${(agent.tvlUsd / 1e6).toFixed(1)}M` : '-'}</span></div>
                        </div>

                        {agent.session ? (
                          <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-800">
                            <div className="flex justify-between text-xs mb-2 text-gray-600 dark:text-gray-400">
                              <span>Spend: ${agent.session.spendUtilized}</span>
                              <span>Cap: ${agent.session.spendCap}</span>
                            </div>
                            <button onClick={() => setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, session: null } : a))} className="w-full py-3 rounded-xl text-sm font-bold text-red-600 bg-red-50 dark:bg-red-500/10">
                              Revoke Access
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => handleHireClick(agent)} className="w-full mt-auto py-3 rounded-xl text-sm font-bold bg-gray-900 text-white dark:bg-white dark:text-gray-900 active:scale-[0.98] transition-transform">
                            Hire Agent
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {nav === 'report' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold">Advantage Report</h2>
                <div className="bg-white dark:bg-[#1E293B] rounded-3xl p-5 border border-gray-100 dark:border-gray-800 shadow-sm">
                  <h3 className="font-bold mb-4 text-base">Rebalance WBNB/USDC</h3>
                  <div className="space-y-3">
                    <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-900/30">
                      <div className="font-bold text-emerald-700 dark:text-emerald-400 text-xs mb-2 flex items-center gap-1"><CheckCircle2 size={14}/> WITH AGENT</div>
                      <div className="text-sm">Time: 38s • Cost: $0.41</div>
                    </div>
                    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-gray-800/50">
                      <div className="font-bold text-gray-500 text-xs mb-2 flex items-center gap-1"><XCircle size={14}/> MANUAL</div>
                      <div className="text-sm">Time: 22 min • Cost: $0.41 + missed fees</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {nav === 'learn' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-bold mb-1">Learn</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">What each agent does, and what you're actually granting.</p>
                </div>
                <div className="space-y-3">
                  {LEARN_TOPICS.map((item, i) => (
                    <div key={i} className="bg-white dark:bg-[#1E293B] rounded-2xl p-4 border border-gray-100 dark:border-gray-800 shadow-sm">
                      <div className="font-bold text-sm mb-1">{item.h}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{item.p}</div>
                    </div>
                  ))}
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
                      <div className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.p}</div>
                    </div>
                  ))}
                </div>
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 border border-gray-100 dark:border-gray-800">
                  <div className="flex items-center gap-2 mb-2"><Link2 size={13} /><span className="text-xs font-bold uppercase text-gray-500">Scope, stated honestly</span></div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">v0.0.1 is seller-only: builds agents that earn by fulfilling jobs. Currently BSC only (testnet + mainnet).</p>
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
                    Build it for real (48h trial)
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
                            queued: 'Queued...', scaffolding: 'Scaffolding (bag init)...', creating_wallet: 'Creating testnet wallet...',
                            writing_logic: 'Writing agent instructions...', activating_llm: 'Activating LLM...',
                            deploying: 'Deploying (48h trial)...', done: 'Deployed, live for 48h.', error: 'Build failed',
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
      </main>

      {/* App-like Bottom Navigation */}
      <nav className="shrink-0 bg-white dark:bg-[#0B101B] border-t border-gray-200 dark:border-gray-800 pb-safe z-20">
        <div className="flex justify-around items-center px-2 pt-2 pb-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = nav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setNav(item.id); setHiring(false); }}
                className={`flex flex-col items-center justify-center w-16 h-14 rounded-xl transition-colors ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/5'}`}
              >
                <Icon size={20} className={`mb-1 transition-transform ${active ? 'scale-110' : ''}`} />
                <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals */}
      {walletSheetOpen && <MobileWalletSheet onClose={() => setWalletSheetOpen(false)} />}
      
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