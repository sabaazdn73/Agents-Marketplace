import React, { useState, useEffect, Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import AgentMarketplaceApp from './AgentMarketplaceApp.web.jsx';
import AgentMarketplaceMobileApp from './AgentMarketplaceApp.mobile.jsx';
import StatusPage from './StatusPage.jsx';
import SignInPage from './pages/SignInPage.jsx';
import DataSourcesPage from './DataSourcesPage.jsx';
import PrivacyPage from './PrivacyPage.jsx';
import HackathonPartnersPage from './HackathonPartnersPage.jsx';
import DocsPage from './DocsPage.jsx';
import CanaryTestingPanel from './CanaryTestingPanel.jsx';
import { EcosystemBoundary, EcosystemFallback, hasWebGL } from './shell/EcosystemFallback.jsx';
import { NAV_TO_PATH, resolvePath, tabForPath, isExplorePath } from './routePaths.js';
import { updatePageMeta } from './seoMeta.js';

// Real, page-specific title/description per route, used by the
// per-route <title>/meta-description/canonical fix (seoMeta.js). Kept
// here rather than inside each page component since App.jsx already
// owns every route's pathname. Docs pages set their own per-doc
// title from inside DocsPage.jsx instead, since only that component
// knows which doc is open.
const PAGE_META = {
  // Must say the same thing as index.html's static title, description and
  // og:/twitter: tags. Social scrapers read the raw HTML and never run this;
  // search crawlers run it and see this instead. If the two disagree, a
  // shared link and a search result describe the site differently.
  // Rewritten 2026-09-25 for the tokenized-equities product. "Being built"
  // stays in the description until the pages hold something live.
  '/': {
    docTitle: 'Tnega: Tokenized Stocks, ETFs and Vaults, and What They Cost to Buy',
    ogTitle: 'Tnega: Tokenized Stocks, ETFs and Vaults',
    description: 'Tnega is being built: connect a wallet, pick a tokenized stock, ETF or vault, see what it costs to buy, and sign in your own wallet. EVM chains, Solana and Hyperliquid.',
  },
  '/stocks': { title: 'Stocks & ETFs', description: 'Tokenized stocks and ETFs, with the cost and route of a buy shown before your wallet signs it. Being built: nothing is listed yet.' },
  '/vaults': { title: 'Vaults', description: 'Vaults holding real-world assets on Solana and Hyperliquid, with platform, manager, fees, lockup and audit status. Being built: nothing is listed yet.' },
  '/my-etfs': { title: 'My ETFs', description: 'A basket of up to five tokenized stocks, ETFs or vaults, bought one signature per component and shared as a link. Being built.' },
  '/ai': { title: 'Use with AI', description: "Point your own assistant at Tnega's MCP server: the endpoint, the one-line install, and the read-only tools it serves today." },
  '/signin': { title: 'Sign in', description: 'Connect a wallet and sign one message to show the wallet is yours. No account, no password, no funds moved.' },
  // Explore keeps its path: every shared link, the sitemap and the Chrome
  // Web Store listing point at /market.
  '/market': { title: 'Explore agents', description: 'Browse and hire verified AI agents and bots across BNB Chain, Ethereum, Arbitrum and Robinhood Chain, with payment held on-chain until the work is delivered.' },
  '/my-agents': { title: 'My Agents', description: 'Track every agent job you\'ve hired through Tnega and its live, on-chain status.' },
  '/status': { title: 'Status', description: 'Live pass/fail checks against every external service Tnega depends on.' },
  '/data-sources': { title: 'Data Sources', description: 'Every external data provider Tnega uses, and what each one is used for.' },
  '/partners': { title: 'Hackathon Partners', description: 'The tracks and partners this project was built for, and how each integration works.' },
  '/ecosystem': { title: 'Ecosystem', description: 'A visual map of every agent category on Tnega, sized by its live agent count.' },
  // The Chrome extension's hosted privacy policy. The Web Store listing links
  // straight here, so it needs its own title and canonical rather than the
  // homepage's.
  '/privacy': { title: 'Privacy', description: 'What the Tnega for Hyperliquid Chrome extension reads, what it sends, and what it stores, which is nothing.' },
  // The Hyperliquid tab's own address, linked from the extension's panel.
  // ChainViewTabs.jsx reads the path and opens that tab; routePaths.js names
  // /chain/<view> as one of Explore's own addresses.
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
  // The address is settled before anything renders (routePaths.js,
  // resolvePath): the trailing slash goes, an old path takes its new one, and
  // a path that is none of the site's pages becomes "/". The address bar is
  // replaced, not pushed, so the old page never flashes, Back does not return
  // to a URL that only bounces, and the canonical is never a junk URL. The
  // query and the hash travel with it.
  const settle = () => {
    const { pathname, search, hash } = window.location;
    const { path, changed } = resolvePath(pathname);
    if (changed) {
      try { window.history.replaceState(window.history.state, '', `${path}${search}${hash}`); } catch { /* non-fatal */ }
    }
    return { path, search };
  };
  const [loc, setLoc] = useState(settle);
  useEffect(() => {
    const onPop = () => setLoc(settle());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // `to` may carry a query (/stocks?q=nvda) and a hash (/docs/x#part). The
  // path is resolved on its own; the query is kept separately for the page
  // that reads it, and the hash stays on the routed path, which is where
  // DocsPage.jsx reads it from.
  const navigate = (to, { replace = false } = {}) => {
    const h = to.indexOf('#');
    const hash = h >= 0 ? to.slice(h) : '';
    const beforeHash = h >= 0 ? to.slice(0, h) : to;
    const q = beforeHash.indexOf('?');
    const query = q >= 0 ? beforeHash.slice(q) : '';
    const { path } = resolvePath(q >= 0 ? beforeHash.slice(0, q) : beforeHash);
    const target = `${path}${query}${hash}`;
    if (replace) window.history.replaceState({}, '', target);
    else window.history.pushState({}, '', target);
    setLoc({ path: `${path}${hash}`, search: query });
    window.scrollTo(0, 0);
  };
  return [loc.path, navigate, loc.search];
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
  const [path, navigate, search] = useRoute();

  // "/" is the Dashboard for everyone (2026-09-25). A connected wallet's
  // holdings show at its top, so there is no separate landing for a signed-in
  // visitor any more, and no redirect to one.

 // per-route title/description/canonical (seoMeta.js). Docs pages
  // are deliberately excluded here, DocsPage.jsx sets its own,
 // per-document title once it knows which doc is open.
  useEffect(() => {
    if (path.startsWith('/docs')) return;
    // Every path reaching here is one of the site's pages (useRoute replaced
    // the rest with "/"). The ones without an entry are Explore's agent pages
    // and chain views, which take Explore's copy until the agent loads.
    const known = Object.prototype.hasOwnProperty.call(PAGE_META, path);
    const meta = known ? PAGE_META[path] : PAGE_META[isExplorePath(path) ? '/market' : '/'];
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

  // Sign-in renders outside the app shell: a split screen of its own, one
  // component for every width (pages/SignInPage.jsx).
  if (path === '/signin') {
    return <SignInPage navigate={navigate} />;
  }

  // WHERE "BACK" GOES FROM A STANDALONE PAGE, IN ONE PLACE. The Dashboard,
  // since 2026-09-25; it was Explore while "/" was the agent listing.
  const backHome = () => navigate('/');

  if (path === '/status') {
    return <StatusPage onBack={backHome} />;
  }

  if (path === '/data-sources') {
    return <DataSourcesPage onBack={backHome} />;
  }

  if (path === '/privacy') {
    return <PrivacyPage onBack={backHome} />;
  }

  if (path === '/partners') {
    return <HackathonPartnersPage onBack={backHome} />;
  }

  if (path === '/docs' || path.startsWith('/docs/') || path.startsWith('/docs#')) {
    return <DocsPage path={path} navigate={navigate} onBack={backHome} isMobile={isMobile} />;
  }

  if (path === '/canary') {
    return <CanaryTestingPanel onBack={backHome} />;
  }

  if (path === '/ecosystem') {
    // No WebGL, no globe: say so instead of loading 900KB that will throw.
    // The boundary catches whatever the check does not predict. See
    // shell/EcosystemFallback.jsx.
    if (!hasWebGL()) return <EcosystemFallback onBack={backHome} />;
    return (
      <EcosystemBoundary onBack={backHome}>
      <Suspense fallback={
        <div className="min-h-screen bg-page flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-accent" />
        </div>
      }>
        <EcosystemGlobePage onBack={backHome} />
      </Suspense>
      </EcosystemBoundary>
    );
  }

  // Which tab a path opens: routePaths.js. Explore's agent pages
  // (/agent/<id>, /chain-agent/...) and /chain/<view> open Explore, named
  // explicitly; a path the site does not serve never gets this far, because
  // useRoute has already replaced it with "/".
  const initialNav = tabForPath(path, search);
  const onNavChange = (id) => navigate(NAV_TO_PATH[id] || '/');
  const query = new URLSearchParams(search).get('q') || '';
  const shellProps = {
    onOpenEcosystem: () => navigate('/ecosystem'),
    onOpenDataSources: () => navigate('/data-sources'),
    onOpenPartners: () => navigate('/partners'),
    onOpenDocs: () => navigate('/docs'),
    onNavigate: navigate,
    path,
    query,
    initialNav,
    onNavChange,
  };

 // Genuinely different components, not one component with responsive
  // CSS, per the earlier design requirement (mobile is its own
  // information architecture, not a shrunk desktop grid).
  return isMobile
    ? <AgentMarketplaceMobileApp {...shellProps} />
    : <AgentMarketplaceApp {...shellProps} />;
}

