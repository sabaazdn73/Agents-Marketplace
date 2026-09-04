import React, { useState, useEffect, Suspense, lazy } from 'react';
import { useReconnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';
import AgentMarketplaceApp from './AgentMarketplaceApp.web.jsx';
import AgentMarketplaceMobileApp from './AgentMarketplaceApp.mobile.jsx';
import StatusPage from './StatusPage.jsx';
import DataSourcesPage from './DataSourcesPage.jsx';
import HackathonPartnersPage from './HackathonPartnersPage.jsx';
import DocsPage from './DocsPage.jsx';
import CanaryTestingPanel from './CanaryTestingPanel.jsx';
import { MAIN_TAB_PATHS, NAV_TO_PATH } from './routePaths.js';
import { updatePageMeta } from './seoMeta.js';

// Real, page-specific title/description per route, used by the
// per-route <title>/meta-description/canonical fix (seoMeta.js). Kept
// here rather than inside each page component since App.jsx already
// owns every route's real pathname. Docs pages set their own per-doc
// title from inside DocsPage.jsx instead, since only that component
// knows which doc is open.
const PAGE_META = {
  '/': { description: "Tnega — an agent marketplace for BNB Agent Studio: discover, verify, and hire ERC-8004/ERC-8183 agents on BNB Smart Chain." },
  '/market': { title: 'Marketplace', description: 'Browse and hire verified AI agents on BNB Smart Chain, with on-chain escrow protecting every payment.' },
  '/skills': { title: 'Skills', description: 'Pre-built, audited on-chain actions — Venus lending, PancakeSwap trading, and more — you run yourself through your own wallet.' },
  '/native-agents': { title: 'Native Agents', description: "Tnega's own autonomous, multi-factor agents that compare real protocols and show their reasoning before you act." },
  '/my-agents': { title: 'My Agents', description: 'Track every agent job you\'ve hired through Tnega and its live, on-chain status.' },
  '/report': { title: 'Advantage Report', description: 'A real, same-task comparison of hiring an AI agent versus doing the same work by hand.' },
  '/learn': { title: 'Learn', description: 'A plain-language guide to ERC-8004 agent identity, ERC-8183 job escrow, and how hiring an agent on Tnega actually works.' },
  '/build': { title: 'Build Your Agent', description: 'Scaffold and deploy your own ERC-8004/ERC-8183 agent on BNB Chain, no coding required.' },
  '/sell': { title: 'Sell Your Agent', description: 'List an agent you own for sale as a one-time license or subscription, on-chain, non-custodially.' },
  '/status': { title: 'Status', description: 'Live pass/fail checks against every external service Tnega depends on.' },
  '/data-sources': { title: 'Data Sources', description: 'Every external data provider Tnega uses, and what each one is used for.' },
  '/partners': { title: 'Hackathon Partners', description: 'The tracks and partners this project was built for, and how each integration actually works.' },
  '/ecosystem': { title: 'Ecosystem', description: 'A visual map of every agent category on Tnega, sized by its real, live agent count.' },
};

// Lazy-loaded: pulls in three.js/@react-three/fiber/drei (~800KB) only for
// visitors who actually open /ecosystem — zero cost added to the
// Marketplace's own default load. See EcosystemGlobePage.jsx for why.
const EcosystemGlobePage = lazy(() => import('./EcosystemGlobePage.jsx'));

/** No router library added for one real standalone route — a plain
 * window.location.pathname check, matching this project's existing
 * preference for small hand-rolled solutions over new dependencies for a
 * single case. Real distinct URL either way: /ecosystem is reachable
 * directly, bookmarkable, and not mixed into any tab's state. */
function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (to) => { window.history.pushState({}, '', to); setPath(to); };
  return [path, navigate];
}

const MOBILE_BREAKPOINT = 768; // matches Tailwind's `md` breakpoint

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}

// Real fix, 2026-08-18: WagmiProvider's reconnectOnMount is set to false
// (main.jsx) specifically to stop wagmi from touching window.ethereum at
// the same React-mount tick Privy's own SDK independently probes it — that
// simultaneous double-touch was the real cause of the double MetaMask
// prompt on connect (see main.jsx's comment for the full trace). But
// reconnectOnMount is ALSO the only thing that restores a previously-
// connected wagmi wallet after a page refresh, so turning it off entirely
// silently broke that persistence as a side effect — not a separate bug,
// the documented behavior of that flag.
//
// Real fix: don't leave it off. Trigger the same reconnect manually, once,
// but sequenced to run only after Privy's own `ready` has settled instead
// of at the same mount tick RainbowKit fires it automatically — same end
// result (the wallet comes back after a refresh), the two systems just
// never touch window.ethereum in the same instant. wagmi's reconnect()
// uses eth_accounts for an injected connector (a silent, non-prompting
// read of already-authorized accounts, not eth_requestAccounts), so
// staggering it doesn't introduce a prompt of its own to worry about.
function useStaggeredWalletReconnect() {
  const { ready } = usePrivy();
  const { reconnect } = useReconnect();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready || done) return;
    setDone(true);
    reconnect();
  }, [ready, done, reconnect]);
}

export default function App() {
  const isMobile = useIsMobile();
  const [path, navigate] = useRoute();
  useStaggeredWalletReconnect();

  // Real per-route title/description/canonical (seoMeta.js). Docs pages
  // are deliberately excluded here — DocsPage.jsx sets its own,
  // per-document title once it knows which doc is actually open.
  useEffect(() => {
    if (path.startsWith('/docs')) return;
    const known = Object.prototype.hasOwnProperty.call(PAGE_META, path);
    const meta = known ? PAGE_META[path] : PAGE_META['/'];
    updatePageMeta({ title: meta.title, description: meta.description, path: known ? path : '/' });
  }, [path]);

  if (path === '/status') {
    return <StatusPage onBack={() => navigate('/')} />;
  }

  if (path === '/data-sources') {
    return <DataSourcesPage onBack={() => navigate('/')} />;
  }

  if (path === '/partners') {
    return <HackathonPartnersPage onBack={() => navigate('/')} />;
  }

  if (path === '/docs' || path.startsWith('/docs/') || path.startsWith('/docs#')) {
    return <DocsPage path={path} navigate={navigate} onBack={() => navigate('/')} isMobile={isMobile} />;
  }

  if (path === '/canary') {
    return <CanaryTestingPanel onBack={() => navigate('/')} />;
  }

  if (path === '/ecosystem') {
    return (
      <Suspense fallback={
        <div className="min-h-screen bg-[#0B1120] flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-indigo-400" />
        </div>
      }>
        <EcosystemGlobePage onBack={() => navigate('/')} />
      </Suspense>
    );
  }

  // Real tab -> URL sync: an unrecognized path (including plain "/") falls
  // back to the market tab, same permissive default this app already had
  // before any tab had its own URL — never a 404, so an old bookmark or a
  // ?agent= deep link on "/" keeps working exactly as it did.
  // /agent/<id> is a real, addressable route for one agent's detail view.
  // It resolves to the marketplace tab; the app's own deep-link effect
  // reads the id out of the path and opens that agent once agents load.
  // Without this a refresh on a detail page fell through to 'market' and
  // lost the agent.
  const initialNav = path.startsWith('/agent/') ? 'market' : (MAIN_TAB_PATHS[path] || 'market');
  const onNavChange = (id) => navigate(NAV_TO_PATH[id] || '/market');

  // Genuinely different components, not one component with responsive
  // CSS, per the earlier design requirement (mobile is its own
  // information architecture, not a shrunk desktop grid).
  return isMobile
    ? <AgentMarketplaceMobileApp onOpenEcosystem={() => navigate('/ecosystem')} onOpenDataSources={() => navigate('/data-sources')} onOpenPartners={() => navigate('/partners')} onOpenDocs={() => navigate('/docs')} initialNav={initialNav} onNavChange={onNavChange} />
    : <AgentMarketplaceApp onOpenEcosystem={() => navigate('/ecosystem')} onOpenDataSources={() => navigate('/data-sources')} onOpenPartners={() => navigate('/partners')} onOpenDocs={() => navigate('/docs')} initialNav={initialNav} onNavChange={onNavChange} />;
}

