import React, { useState, useMemo, useEffect } from 'react';
import {
  Menu, X, Globe, Settings, ChevronDown, ChevronRight, Loader2, AlertTriangle,
  Wallet, ScanFace, LogOut, BadgeCheck, Zap, Star, Hammer, FileBarChart,
  GraduationCap, Store, Sliders, CheckCircle2, XCircle, Sparkles, Link2, Boxes,
} from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';

const CATEGORIES = ['All', 'Rebalancing', 'Grid Trading', 'Yield Optimisation', 'Health Factor Monitoring', 'Unclassified'];
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const CHAIN_LABELS = { 56: 'BNB Smart Chain', 97: 'BNB Testnet' };

// Real data hook, identical mapping to the web version, one source of
// truth for both, no separate mock arrays to drift out of sync.
function useMarketplaceAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE_URL}/api/agents`)
      .then((res) => { if (!res.ok) throw new Error(`Backend returned ${res.status}`); return res.json(); })
      .then((data) => {
        if (cancelled) return;
        const mapped = (data.agents || []).map((a) => ({
          id: a.id, name: a.name || 'Unnamed agent', category: a.category || 'Unclassified',
          network: a.network, chainId: a.chain_id, totalScore: a.total_score,
          starCount: a.star_count, totalFeedbacks: a.total_feedbacks, isVerified: a.is_verified,
          x402Supported: a.x402_supported, supportedProtocols: a.supported_protocols || [],
          ownerAddress: a.owner_address, ownerEns: a.owner_ens, ownerUsername: a.owner_username,
          imageUrl: a.image_url, strategy: a.description || 'No description provided.',
          financialDataAvailable: a.financial_data_available, tvlUsd: a.tvl_usd,
          defillamaUrl: a.defillama_url, session: null,
        }));
        setAgents(mapped); setLoading(false);
      })
      .catch((err) => { if (cancelled) return; setError(err.message); setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { agents, setAgents, loading, error };
}

const ADVANTAGE_REPORT = [
  { task: 'Rebalance $50k LP after a 6% move', category: 'Trading', with: { time: '38s', cost: '$0.41' }, without: { time: '22 min', cost: 'missed fees' } },
  { task: 'Close under-collateralized position', category: 'Security', with: { time: '4s', cost: '$0.18' }, without: { time: 'n/a', cost: '5% penalty' } },
  { task: 'Route idle USDC to best APR', category: 'Yield', with: { time: '11s', cost: '$0.09' }, without: { time: '15 min', cost: 'stale data' } },
];

// Source: docs.bnbchain.org/developer-kit — matches web's Learn content, condensed for mobile's flat list.
const LEARN_TOPICS = [
  { h: 'ERC-8004 — Identity', p: 'Every agent gets an on-chain identity token (ERC-721), a discoverable profile, and metadata. Gas-free registration via MegaFuel paymaster.' },
  { h: 'ERC-8183 — Commerce', p: 'A trustless job protocol: client + provider transact through AgenticCommerce (escrow), EvaluatorRouter (routing), OptimisticPolicy (silence = approve).' },
  { h: 'Hiring = a real job, not a subscription', p: 'createJob → registerJob → setBudget → fund. Your wallet signs each step. The budget sits in escrow, it\'s not a standing permission.' },
  { h: 'Job lifecycle', p: 'OPEN → FUNDED → SUBMITTED → COMPLETED (settled) / REJECTED (disputed) / EXPIRED (never settled).' },
  { h: 'The real safety net', p: 'claimRefund() after expiry with no settlement, non-pausable, non-hookable, always available. Not an instant revoke, but a guaranteed exit.' },
  { h: 'Dispute window', p: 'If a submitted result looks wrong, dispute() during the review window, whitelisted voters decide.' },
];

// Real bag CLI workflow. v0.0.1 is seller-only: builds agents that EARN
// by fulfilling jobs, currently scoped to BSC only.
const BUILD_STEPS = [
  { h: '1. Describe it in plain English', p: 'Tell Claude Code or Cursor what you want, e.g. "a BNB agent that sells weather forecasts." BNB Agent Studio scaffolds the real project.' },
  { h: '2. Two layers, automatically', p: 'Layer A (the Agent) holds the wallet + LLM, the only signer. Layer B (public, keyless) just relays requests, never touches a key.' },
  { h: '3. You edit one function', p: 'Everything else (wallet, ERC-8004, ERC-8183 plumbing) is already wired. You customize handle_fulfill: what your agent actually does.' },
  { h: '4. Test before spending anything', p: 'bag dev runs both layers locally, hit the real /negotiate endpoint and get a real signed quote before deploying.' },
  { h: '5. Register, then deploy', p: 'bag erc8004 register makes it discoverable. Deploy sends the Agent to AWS Bedrock AgentCore and the Service to a public EC2 host.' },
];

function HybridWalletConnect({ accent, compact }) {
  const { address: wagmiAddress, isConnected: wagmiConnected } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { ready, authenticated, user, login, logout } = usePrivy();
  const privyConnected = ready && authenticated;
  const activeAddress = wagmiConnected ? wagmiAddress : user?.wallet?.address;
  const isConnected = wagmiConnected || privyConnected;
  const shortAddress = activeAddress ? `${activeAddress.slice(0, 5)}...${activeAddress.slice(-3)}` : null;

  if (isConnected) {
    return (
      <button onClick={() => (wagmiConnected ? wagmiDisconnect() : logout())} className="px-3 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 bg-white/5 border border-white/10">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {shortAddress} <LogOut size={11} className="opacity-50" />
      </button>
    );
  }
  return (
    <ConnectButton.Custom>
      {({ openConnectModal }) => (
        <button onClick={openConnectModal} className="px-4 py-2 rounded-full text-xs font-bold text-white" style={{ background: accent }}>
          Connect
        </button>
      )}
    </ConnectButton.Custom>
  );
}

// Hyperliquid-pattern: dense ticker rows, not cards, for fast scanning
function TickerRow({ agent, accent, onOpen }) {
  return (
    <button onClick={() => onOpen(agent)} className="w-full flex items-center gap-3 px-4 py-3.5 border-b border-white/5 active:bg-white/[0.03]">
      {agent.imageUrl ? (
        <img src={agent.imageUrl} alt="" className="w-9 h-9 rounded-lg object-cover shrink-0" onError={(e) => { e.target.style.display = 'none'; }} />
      ) : (
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold text-white shrink-0" style={{ background: accent }}>
          {agent.name.slice(0, 1).toUpperCase()}
        </div>
      )}
      <div className="flex-1 text-left min-w-0">
        <div className="text-sm font-semibold truncate flex items-center gap-1">
          {agent.name}
          {agent.isVerified && <BadgeCheck size={12} style={{ color: accent }} />}
        </div>
        <div className="text-[10px] opacity-40 truncate">{agent.category}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-bold">{agent.totalScore != null ? agent.totalScore.toFixed(1) : '—'}</div>
        <div className="text-[9px] opacity-40">{agent.starCount ?? 0} ★</div>
      </div>
    </button>
  );
}

const TABS = [
  { id: 'market', label: 'Market', icon: Store },
  { id: 'build', label: 'Build', icon: Hammer },
  { id: 'account', label: 'Account', icon: Wallet },
];

export default function AgentMarketplaceMobileApp() {
  const [tab, setTab] = useState('market');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [showUnclassified, setShowUnclassified] = useState(true);
  const [openAgent, setOpenAgent] = useState(null);
  const [hireStep, setHireStep] = useState(null);
  const [spendCap, setSpendCap] = useState(50000);
  const [stopLoss, setStopLoss] = useState(5000);
  const { agents, setAgents, loading, error } = useMarketplaceAgents();

  const { isConnected: wagmiConnected } = useAccount();
  const { ready, authenticated, user, login } = usePrivy();
  const walletConnected = wagmiConnected || (ready && authenticated);

  // Same tokens as web, kept in sync intentionally.
  const accent = '#6D5DFB';
  const bg = '#0A0A12';
  const surface = '#14141F';
  const border = 'border-white/10';
  const mutedBorder = 'border-white/5';

  const filtered = useMemo(() => {
    let list = agents.filter((a) => a.name && a.name.trim().length > 2);
    if (!showUnclassified) list = list.filter((a) => a.category !== 'Unclassified');
    list = list.filter((a) => activeCategory === 'All' || a.category === activeCategory);
    return [...list].sort((a, b) => (b.totalScore ?? -Infinity) - (a.totalScore ?? -Infinity));
  }, [agents, activeCategory, showUnclassified]);

  const handleRevoke = (id) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, session: null } : a)));
    setOpenAgent((prev) => (prev ? { ...prev, session: null } : prev));
  };

  const startHire = () => {
    if (!walletConnected) { alert('Connect a wallet first. A session key needs a real signature.'); return; }
    setHireStep('configure');
  };

  const confirmHire = () => {
    setAgents((prev) => prev.map((a) => a.id === openAgent.id ? { ...a, session: { key: '0x' + Math.random().toString(16).slice(2, 8) + '...4a', spendUtilized: 0, spendCap: Number(spendCap), expiry: '24h' } } : a));
    setHireStep(null);
    setOpenAgent(null);
  };

  return (
    <div className="min-h-screen font-sans pb-20" style={{ background: bg, color: '#F5F5F7' }}>
      {/* Hyperliquid-pattern top bar: hamburger, logo, Connect CTA, settings */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${border} sticky top-0 z-30 backdrop-blur-md`} style={{ background: 'rgba(10,10,18,0.9)' }}>
        <button onClick={() => setMenuOpen(true)} className="p-1.5"><Menu size={20} /></button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: accent }}><Boxes size={13} className="text-white" /></div>
          <span className="font-bold text-sm">Agents Marketplace</span>
        </div>
        <div className="flex items-center gap-2">
          <HybridWalletConnect accent={accent} />
          <button className="p-1.5 opacity-60"><Settings size={18} /></button>
        </div>
      </div>

      {/* Hyperliquid-pattern side menu for secondary items */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="w-72 h-full p-5 overflow-y-auto" style={{ background: surface }}>
            <div className="flex justify-between items-center mb-8">
              <span className="font-bold">Menu</span>
              <button onClick={() => setMenuOpen(false)}><X size={20} /></button>
            </div>
            <div className="space-y-4">
              {[
                { id: 'report', label: 'Advantage Report', icon: FileBarChart },
                { id: 'learn', label: 'Learn', icon: GraduationCap },
              ].map((item) => (
                <button key={item.id} onClick={() => { setTab(item.id); setMenuOpen(false); }} className="w-full flex items-center gap-3 text-left py-2">
                  <item.icon size={17} className="opacity-60" /> <span className="text-sm font-medium">{item.label}</span>
                </button>
              ))}
              <div className={`border-t ${mutedBorder} my-4`} />
              <div className="text-xs opacity-40 space-y-3">
                <div>Testnet</div>
                <div>Docs</div>
                <div>Support</div>
              </div>
            </div>
          </div>
          <div className="flex-1 bg-black/60" onClick={() => setMenuOpen(false)} />
        </div>
      )}

      {tab === 'market' && !openAgent && (
        <>
          <div className="overflow-x-auto px-4 py-3 flex gap-2" style={{ scrollbarWidth: 'none' }}>
            {CATEGORIES.map((cat) => (
              <button key={cat} onClick={() => setActiveCategory(cat)} className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border"
                style={activeCategory === cat ? { background: accent, borderColor: accent, color: 'white' } : { borderColor: 'rgba(255,255,255,0.08)', opacity: 0.6 }}>
                {cat}
              </button>
            ))}
            <button onClick={() => setShowUnclassified((v) => !v)} className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-medium border ${mutedBorder} ${showUnclassified ? '' : 'opacity-40'}`}>
              {showUnclassified ? 'Hide' : 'Show'} unclassified
            </button>
          </div>

          {loading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-sm opacity-60">
              <Loader2 size={24} className="animate-spin" style={{ color: accent }} /> Loading real agent data...
            </div>
          )}
          {error && !loading && (
            <div className="mx-4 flex items-center gap-2 p-3 rounded-xl border border-red-500/30 bg-red-500/5 text-xs">
              <AlertTriangle size={16} className="text-red-400 shrink-0" /> {error}
            </div>
          )}
          {!loading && !error && filtered.map((agent) => <TickerRow key={agent.id} agent={agent} accent={accent} onOpen={setOpenAgent} />)}
        </>
      )}

      {tab === 'report' && (
        <div className="p-4">
          <h2 className="text-xl font-bold mb-1">Advantage Report</h2>
          <p className="text-xs opacity-50 mb-5">3 real tasks, run both ways.</p>
          <div className="space-y-3">
            {ADVANTAGE_REPORT.map((row, i) => (
              <div key={i} className={`rounded-xl border ${mutedBorder} p-4`} style={{ background: surface }}>
                <div className="text-[10px] uppercase opacity-40 mb-1">{row.category}</div>
                <div className="font-semibold text-sm mb-3">{row.task}</div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20"><div className="font-bold text-emerald-400 mb-0.5">WITH</div>{row.with.time} · {row.with.cost}</div>
                  <div className={`p-2 rounded-lg border ${mutedBorder}`}><div className="font-bold opacity-50 mb-0.5">WITHOUT</div>{row.without.time} · {row.without.cost}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'learn' && (
        <div className="p-4">
          <h2 className="text-xl font-bold mb-1">Learn</h2>
          <p className="text-xs opacity-50 mb-5">What each agent does, and what you're granting.</p>
          <div className="space-y-2">
            {LEARN_TOPICS.map((item, i) => (
              <div key={i} className={`rounded-xl border ${mutedBorder} p-4`} style={{ background: surface }}>
                <div className="text-xs font-semibold mb-1">{item.h}</div>
                <div className="text-xs opacity-60 leading-relaxed">{item.p}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'build' && (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-1"><Sparkles size={17} style={{ color: accent }} /><h2 className="text-xl font-bold">Build Your Agent</h2></div>
          <p className="text-xs opacity-50 mb-1">No coding required.</p>
          <a href="https://docs.bnbchain.org/developer-kit" target="_blank" rel="noreferrer" className="text-[10px] underline opacity-50 mb-5 inline-block">Source: docs.bnbchain.org/developer-kit →</a>
          <div className="space-y-3 mb-6">
            {BUILD_STEPS.map((step, i) => (
              <div key={i} className={`rounded-xl border ${mutedBorder} p-4`} style={{ background: surface }}>
                <div className="text-xs font-semibold mb-1">{step.h}</div>
                <div className="text-xs opacity-60 leading-relaxed">{step.p}</div>
              </div>
            ))}
          </div>
          <div className={`rounded-xl border ${mutedBorder} p-4 mb-6`} style={{ background: surface }}>
            <div className="flex items-center gap-2 mb-2"><Link2 size={13} /><span className="text-[10px] font-semibold uppercase opacity-60">Scope, stated honestly</span></div>
            <p className="text-xs opacity-60">v0.0.1 is seller-only: builds agents that earn by fulfilling jobs. Currently BSC only (testnet + mainnet), where these contracts are actually deployed.</p>
          </div>
          <button className="w-full py-4 rounded-xl font-semibold text-white text-sm" style={{ background: accent }}>Start Building →</button>
        </div>
      )}

      {tab === 'account' && (
        // Hyperliquid-pattern: clean label/value rows, big primary CTA, outlined secondary actions
        <div className="p-4">
          <div className="text-xs uppercase opacity-40 font-semibold mb-3">Your Wallet</div>
          {!walletConnected ? (
            <div className={`rounded-xl border ${mutedBorder} p-6 text-center mb-6`} style={{ background: surface }}>
              <Wallet size={28} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm opacity-60 mb-4">Connect to see your hired agents and sessions.</p>
              <div className="flex flex-col gap-2">
                <HybridWalletConnect accent={accent} />
                <button onClick={login} className="px-4 py-2.5 rounded-full text-xs font-semibold border border-white/15 flex items-center justify-center gap-1.5"><ScanFace size={13} /> Face ID / Email</button>
              </div>
            </div>
          ) : (
            <>
              <div className={`rounded-xl border ${mutedBorder} divide-y ${mutedBorder} mb-6`} style={{ background: surface }}>
                {[
                  ['Active sessions', agents.filter((a) => a.session).length],
                  ['Total spend cap set', `$${agents.filter((a) => a.session).reduce((s, a) => s + (a.session?.spendCap || 0), 0).toLocaleString()}`],
                  ['Wallet path', wagmiConnected ? 'External wallet' : 'Face ID / Email'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center px-4 py-3.5 text-sm">
                    <span className="opacity-50">{label}</span>
                    <span className="font-semibold">{value}</span>
                  </div>
                ))}
              </div>
              <div className="text-xs uppercase opacity-40 font-semibold mb-3">Hired Agents</div>
              {agents.filter((a) => a.session).length === 0 ? (
                <p className="text-xs opacity-40 mb-6">No agents hired yet.</p>
              ) : (
                agents.filter((a) => a.session).map((a) => (
                  <div key={a.id} className={`rounded-xl border ${mutedBorder} p-4 mb-2`} style={{ background: surface }}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-sm">{a.name}</span>
                      <button onClick={() => handleRevoke(a.id)} className="text-[10px] font-bold text-red-400 px-2 py-1 rounded-full border border-red-500/30">REVOKE</button>
                    </div>
                    <div className="text-xs opacity-50">${a.session.spendUtilized} / ${a.session.spendCap.toLocaleString()} used</div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}

      {/* Full-screen agent detail, replaces the screen like Hyperliquid's market drill-down */}
      {openAgent && (
        <div className="fixed inset-0 z-40 overflow-y-auto" style={{ background: bg }}>
          <div className={`flex items-center gap-3 px-4 py-3 border-b ${border} sticky top-0 backdrop-blur-md`} style={{ background: 'rgba(10,10,18,0.9)' }}>
            <button onClick={() => { setOpenAgent(null); setHireStep(null); }}><ChevronRight size={20} className="rotate-180" /></button>
            <span className="text-[10px] uppercase opacity-40">{openAgent.category}</span>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-3 mb-4">
              {openAgent.imageUrl ? (
                <img src={openAgent.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover" onError={(e) => { e.target.style.display = 'none'; }} />
              ) : (
                <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white text-lg" style={{ background: accent }}>{openAgent.name.slice(0, 1).toUpperCase()}</div>
              )}
              <h2 className="text-xl font-bold flex items-center gap-1">{openAgent.name}{openAgent.isVerified && <BadgeCheck size={16} style={{ color: accent }} />}</h2>
            </div>
            <div className={`grid grid-cols-3 gap-2 p-3 mb-4 rounded-xl border ${mutedBorder}`}>
              <div><div className="text-[9px] opacity-40 uppercase">Score</div><div className="font-bold">{openAgent.totalScore != null ? openAgent.totalScore.toFixed(1) : '—'}</div></div>
              <div><div className="text-[9px] opacity-40 uppercase">Stars</div><div className="font-bold">{openAgent.starCount ?? '—'}</div></div>
              <div><div className="text-[9px] opacity-40 uppercase">Chain</div><div className="font-bold text-[10px]">{CHAIN_LABELS[openAgent.chainId] || openAgent.network}</div></div>
            </div>
            <p className="text-sm opacity-70 mb-4 leading-relaxed">{openAgent.strategy}</p>

            {openAgent.session ? (
              <div className={`p-4 rounded-xl border ${mutedBorder}`}>
                <div className="text-xs font-semibold mb-2">Authority Ledger</div>
                <div className="text-xs opacity-60 mb-3">${openAgent.session.spendUtilized} / ${openAgent.session.spendCap.toLocaleString()} used · expires {openAgent.session.expiry}</div>
                <button onClick={() => handleRevoke(openAgent.id)} className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-red-500">Revoke Access</button>
              </div>
            ) : !hireStep ? (
              <button onClick={startHire} className="w-full py-4 rounded-xl text-sm font-semibold text-white" style={{ background: accent }}>Hire Agent →</button>
            ) : null}
          </div>

          {hireStep && (
            <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm">
              <div className="w-full rounded-t-3xl p-6" style={{ background: surface }}>
                <div className="flex justify-between items-center mb-5">
                  <h3 className="font-bold">Configure Risk</h3>
                  <button onClick={() => setHireStep(null)}><X size={20} /></button>
                </div>
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="flex items-center gap-1 text-[10px] uppercase mb-2 font-semibold opacity-50"><Sliders size={11} /> Max Spend Cap (USDC)</label>
                    <input type="number" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} className={`w-full p-3 rounded-lg border ${mutedBorder} outline-none bg-transparent`} />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase mb-2 font-semibold text-red-400">Stop-Loss: ${Number(stopLoss).toLocaleString()}</label>
                    <input type="range" min="500" max="20000" step="500" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="w-full accent-red-500" />
                  </div>
                </div>
                <button onClick={confirmHire} className="w-full py-4 rounded-xl font-semibold text-white text-sm" style={{ background: accent }}>Sign & Deploy</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hyperliquid-pattern bottom nav: exactly 3 items, icon + label */}
      <nav className={`fixed bottom-0 w-full border-t ${border} flex justify-around py-2 backdrop-blur-md z-30`} style={{ background: 'rgba(10,10,18,0.9)' }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => { setTab(t.id); setOpenAgent(null); }} className="flex flex-col items-center gap-1 px-8 py-1" style={{ opacity: tab === t.id ? 1 : 0.4, color: tab === t.id ? accent : undefined }}>
            <t.icon size={20} />
            <span className="text-[10px] font-medium">{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
