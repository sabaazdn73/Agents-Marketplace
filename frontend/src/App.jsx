import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import AgentMarketplaceApp from './AgentMarketplaceApp.web.jsx';
import AgentMarketplaceMobileApp from './AgentMarketplaceApp.mobile.jsx';
import StatusPage from './StatusPage.jsx';
import LandingPage from './LandingPage.jsx';
import DataSourcesPage from './DataSourcesPage.jsx';
import PrivacyPage from './PrivacyPage.jsx';
import HackathonPartnersPage from './HackathonPartnersPage.jsx';
import DocsPage from './DocsPage.jsx';
import CanaryTestingPanel from './CanaryTestingPanel.jsx';
import { EcosystemBoundary, EcosystemFallback, hasWebGL } from './shell/EcosystemFallback.jsx';
import { useSignIn } from './wallet/SignInProvider';
import { MAIN_TAB_PATHS, NAV_TO_PATH } from './routePaths.js';
import { updatePageMeta } from './seoMeta.js';

// Real, page-specific title/description per route, used by the
// per-route <title>/meta-description/canonical fix (seoMeta.js). Kept
// here rather than inside each page component since App.jsx already
// owns every route's pathname. Docs pages set their own per-doc
// title from inside DocsPage.jsx instead, since only that component
// knows which doc is open.
const PAGE_META = {
  // Must say the same thing as index.html's static og:/twitter: tags.
  // Social scrapers read the raw HTML and never run this; search crawlers
  // run it and see this instead. If the two disagree, a shared link and a
  // search result describe the site differently.
  '/': {
    // Both must match index.html's static tags exactly. Social scrapers read
    // the static tags, search crawlers run this and overwrite them; if the
    // two differ, a shared link and a search result disagree.
    docTitle: 'Tnega: Explore AI Agents and Bots, Hire On-Chain',
    ogTitle: 'Tnega: Explore AI Agents and Bots',
    description: "Tnega measures whether an on-chain agent works before anyone pays. Browse and verify ERC-8004 agents and bots on BNB Chain, Ethereum, Arbitrum, Robinhood Chain and Monad, and hire them on-chain.",
  },
  // Ethereum belongs in this list: AgentBudgetEscrow went live there on
  // 2026-09-11, so it is a hire chain like the other three.
  // Renamed 2026-09-17: the tab is Explore. The path stays
  // /market, because every shared link, the sitemap and the Chrome Web Store
  // listing point at it, and a rename that changes a URL breaks all of them.
  '/wallet': { title: 'Your wallet', description: 'What a wallet holds, and what its trading habits on Hyperliquid have cost it: fees as maker and taker, funding, post-only refusals. Measured from public records, each figure with its window.' },
  '/market': { title: 'Explore', description: 'Browse and hire verified AI agents and bots across BNB Chain, Ethereum, Arbitrum and Robinhood Chain, with payment held on-chain until the work is delivered.' },
  // Added 2026-09-17, following /skills and /native-agents: an entry here, a
  // path in routePaths.js, a nav item in both apps, a line in
  // public/sitemap.xml and in backend/scripts/build_sitemap.py.
  '/how-it-works': { title: 'How It Works', description: 'What Tnega measures and why, then four ways to use it: this site, the Chrome extension, the MCP server for your own assistant, and the Telegram bot. Each with the steps to follow.' },
  // The old path, kept because it is in shared links and in the Chrome Web
  // Store listing. Same page, same words, so a search result for either URL
  // describes what the reader lands on.
  '/connect': { title: 'How It Works', description: 'What Tnega measures and why, then four ways to use it: this site, the Chrome extension, the MCP server for your own assistant, and the Telegram bot. Each with the steps to follow.' },
  '/skills': { title: 'Skills', description: 'Pre-built, audited on-chain actions, Venus lending, PancakeSwap trading, and more, you run yourself through your own wallet.' },
  '/native-agents': { title: 'Native Agents', description: "Tnega's own autonomous, multi-factor agents that compare protocols and show their reasoning before you act." },
  '/my-agents': { title: 'My Agents', description: 'Track every agent job you\'ve hired through Tnega and its live, on-chain status.' },
  '/report': { title: 'Advantage Report', description: 'A same-task comparison of hiring an AI agent against doing the work by hand.' },
  '/learn': { title: 'Learn', description: 'A plain-language guide to ERC-8004 agent identity, ERC-8183 job escrow, and how hiring an agent on Tnega works.' },
  '/build': { title: 'Build Your Agent', description: 'Scaffold and deploy your own ERC-8004/ERC-8183 agent on BNB Chain, no coding required.' },
  '/sell': { title: 'Sell Your Agent', description: 'List an agent you own for sale as a one-time license or subscription, on-chain, non-custodially.' },
  '/status': { title: 'Status', description: 'Live pass/fail checks against every external service Tnega depends on.' },
  '/data-sources': { title: 'Data Sources', description: 'Every external data provider Tnega uses, and what each one is used for.' },
  '/partners': { title: 'Hackathon Partners', description: 'The tracks and partners this project was built for, and how each integration works.' },
  '/ecosystem': { title: 'Ecosystem', description: 'A visual map of every agent category on Tnega, sized by its live agent count.' },
  // The Chrome extension's hosted privacy policy. The Web Store listing links
  // straight here, so it needs its own title and canonical rather than the
  // homepage's.
  '/privacy': { title: 'Privacy', description: 'What the Tnega for Hyperliquid Chrome extension reads, what it sends, and what it stores, which is nothing.' },
  // The Hyperliquid tab's own address, linked from the extension's panel.
  // ChainViewTabs.jsx reads the path and opens that tab; this route otherwise
  // resolves to the marketplace like any path it does not recognise.
  '/chain/hyperliquid': { title: 'Hyperliquid', description: 'Post-only rejection measured across the tracked Hyperliquid makers, and the coverage behind each number.' },
};

// Lazy-loaded: pulls in three.js/@react-three/fiber/drei (~800KB) only for
// visitors who open /ecosystem, zero cost added to the
// Marketplace's own default load. See EcosystemGlobePage.jsx for why.
const EcosystemGlobePage = lazy(() => import('./EcosystemGlobePage.jsx'));

/** No router library added for one standalone route, a plain
 * window.location.pathname check, matching this project's existing
 * preference for small hand-rolled solutions over new dependencies for a
 * single case. distinct URL either way: /ecosystem is reachable
 * directly, bookmarkable, and not mixed into any tab's state. */
function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (to, { replace = false } = {}) => {
    if (replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    setPath(to);
  };
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

// wagmi's own reconnectOnMount restores a previously connected wallet after a
// reload; nothing here needs to re-run it. See main.jsx.

export default function App() {
  const isMobile = useIsMobile();
  const [path, navigate] = useRoute();
  const { status: signInStatus } = useSignIn();

  // A SIGNED-IN VISITOR ARRIVING AT "/" GOES TO /wallet. A redirect, not only
  // a prominent link, because the owner's decision is that the page a
  // signed-in visitor lands on is their own wallet. It is a replace, so Back
  // does not bounce between the two.
  //
  // Only the bare "/" redirects. Choosing Home from the navigation goes to
  // /home, which always shows the home page, so a signed-in visitor can still
  // read it. The sign-in check runs in the browser in a few milliseconds
  // after the wallet reconnects, so the home page can show for a moment first.
  useEffect(() => {
    if (path === '/' && signInStatus === 'signed') navigate('/wallet', { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, signInStatus]);

  // "/" IS HOME, FOR EVERYONE, changed 2026-09-19.
  //
  // It used to show Home only on a genuine first visit, decided by a backend
  // call, and open the agent grid every time after that. That made the page
  // that explains the project unreachable in practice: anyone who had been
  // here before, which includes everyone the link is shared with twice, went
  // straight to a grid of agents with no statement of what any of it is for.
  //
  // The first-visit check is gone rather than inverted. It existed to decide
  // between two landings and there is only one now, so keeping it would be a
  // network round trip on every cold load that changes nothing.

 // per-route title/description/canonical (seoMeta.js). Docs pages
  // are deliberately excluded here, DocsPage.jsx sets its own,
 // per-document title once it knows which doc is open.
  useEffect(() => {
    if (path.startsWith('/docs')) return;
    const known = Object.prototype.hasOwnProperty.call(PAGE_META, path);
    const meta = known ? PAGE_META[path] : PAGE_META['/'];
    // Spread rather than naming each field. Listing them one by one silently
    // drops anything added to PAGE_META later: ogTitle was added and went
    // missing here, so the homepage kept publishing a bare "Tnega" headline
    // while index.html's static tag said otherwise.
    //
    // The canonical is the page's OWN path, even when the route is not in
    // PAGE_META. It used to fall back to "/" along with the copy, which meant
    // every one of ~14,900 agent pages published
    // <link rel="canonical" href="https://www.tnega.app/">: each one telling
    // Google it was a duplicate of the homepage and should not be indexed in
    // its own right. That is the entire long tail of this site -- the pages
    // that would rank for an agent's name or a specific capability --
    // volunteering to be dropped.
    //
    // The agent views overwrite title and description with the real agent
    // once it has loaded; this is the floor, not the final answer.
    updatePageMeta({ ...meta, path });
  }, [path]);

  // Home renders OUTSIDE the app shell: no sidebar, no partner footer,
  // just the hero, edge to edge. It is the one route that escapes; every
  // other path still goes through the shell exactly as before.
  //
  // The nav entry stays, so choosing "Home" navigates to /home and lands
  // here. That also means the sidebar is gone while it shows, so the exits
 // below are the only way out and both are links rather than
  // JS-only handlers.
  if (path === '/home' || path === '/') {
    return <LandingPage onEnterMarketplace={() => navigate('/market')} onOpenWallet={() => navigate('/wallet')} />;
  }

  // WHERE "BACK TO EXPLORE" GOES, IN ONE PLACE.
  //
  // Every footer page's Back button used to be navigate('/'), which was
  // correct while "/" rendered the marketplace. It stopped being correct the
  // moment "/" started rendering Home, above: seven Back buttons quietly
  // became Home buttons, and the button still said Explore. Named here so the
  // next change to what "/" renders cannot do that again.
  const backToExplore = () => navigate('/market');

  if (path === '/status') {
    return <StatusPage onBack={backToExplore} />;
  }

  if (path === '/data-sources') {
    return <DataSourcesPage onBack={backToExplore} />;
  }

  if (path === '/privacy') {
    return <PrivacyPage onBack={backToExplore} />;
  }

  if (path === '/partners') {
    return <HackathonPartnersPage onBack={backToExplore} />;
  }

  if (path === '/docs' || path.startsWith('/docs/') || path.startsWith('/docs#')) {
    return <DocsPage path={path} navigate={navigate} onBack={backToExplore} isMobile={isMobile} />;
  }

  if (path === '/canary') {
    return <CanaryTestingPanel onBack={backToExplore} />;
  }

  if (path === '/ecosystem') {
    // No WebGL, no globe: say so instead of loading 900KB that will throw.
    // The boundary catches whatever the check does not predict. See
    // shell/EcosystemFallback.jsx.
    if (!hasWebGL()) return <EcosystemFallback onBack={backToExplore} />;
    return (
      <EcosystemBoundary onBack={backToExplore}>
      <Suspense fallback={
        <div className="min-h-screen bg-page flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-accent" />
        </div>
      }>
        <EcosystemGlobePage onBack={backToExplore} />
      </Suspense>
      </EcosystemBoundary>
    );
  }

 // tab -> URL sync: an unrecognized path (including plain "/") falls
  // back to the market tab, same permissive default this app already had
  // before any tab had its own URL, never a 404, so an old bookmark or a
  // ?agent= deep link on "/" keeps working exactly as it did.
 // /agent/<id> is a real, addressable route for one agent's detail view.
  // It resolves to the marketplace tab; the app's own deep-link effect
  // reads the id out of the path and opens that agent once agents load.
  // Without this a refresh on a detail page fell through to 'market' and
  // lost the agent.
  const resolvedNav = path.startsWith('/agent/') ? 'market' : (MAIN_TAB_PATHS[path] || 'market');
  // firstVisitNav is always null now that "/" renders Home directly, so this
  // is just resolvedNav. Kept as one expression rather than threaded through,
  // because the nav resolution is read in several places below.
  const initialNav = resolvedNav;
  const onNavChange = (id) => navigate(NAV_TO_PATH[id] || '/market');

 // Genuinely different components, not one component with responsive
  // CSS, per the earlier design requirement (mobile is its own
  // information architecture, not a shrunk desktop grid).
  return isMobile
    ? <AgentMarketplaceMobileApp onOpenEcosystem={() => navigate('/ecosystem')} onOpenDataSources={() => navigate('/data-sources')} onOpenPartners={() => navigate('/partners')} onOpenDocs={() => navigate('/docs')} initialNav={initialNav} onNavChange={onNavChange} />
    : <AgentMarketplaceApp onOpenEcosystem={() => navigate('/ecosystem')} onOpenDataSources={() => navigate('/data-sources')} onOpenPartners={() => navigate('/partners')} onOpenDocs={() => navigate('/docs')} initialNav={initialNav} onNavChange={onNavChange} />;
}

