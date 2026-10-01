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
import { NAV_TO_PATH, resolvePath, tabForPath, isExplorePath, isSignPath } from './routePaths.js';
import { updatePageMeta } from './seoMeta.js';
import { SITE_COPY } from './siteCopy.js';
import MobileWelcome, { shouldWelcome } from './shell/MobileWelcome.jsx';

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
  // The one copy of the site's title and description, which also goes into
  // index.html and the manifest at build time (siteCopy.js).
  '/': { ...SITE_COPY },
  '/stocks': { title: 'Stocks & ETFs', description: 'Tokenized stocks and ETFs from every issuer we read, on every chain, and every version of each.' },
  '/vaults': { title: 'Vaults', description: 'Real-asset vaults, read-only: who manages each, its audits and controls, and what it holds, read on chain.' },
  '/my-etfs': { title: 'My ETFs', description: 'Baskets of up to five tokenized stocks and ETFs, with the all-in cost and the largest size their thinnest leg allows.' },
  '/dashboard': { title: 'Dashboard', description: "Your wallet's tokenized equities, their value, cost and allocation, read from the chain." },
  '/issuer-controls': { title: 'Issuer controls', description: 'Who can pause, freeze, burn or seize, and upgrade each tokenized stock and ETF we list, read on chain with the evidence for each, and who may hold it in the issuer\'s own words.' },
  '/guide': { title: 'Read before you start', description: 'What each part of Tnega means: the stock lists and pages, how costs are measured, what is checked before a trade, issuer controls, vaults, My ETFs, the dashboard and signing.' },
  '/ai': { title: 'Use with AI', description: "Point your own assistant at Tnega's MCP server: the endpoint, the one-line install, and the tools it serves today: measurements to read, and orders it prepares for you to sign in your own wallet." },
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
  '/privacy': { title: 'Privacy', description: 'What the Tnega website and the Tnega Chrome extension read, what they send, and what they store.' },
  // The Hyperliquid tab's own address, linked from the extension's panel.
  // ChainViewTabs.jsx reads the path and opens that tab; routePaths.js names
  // /chain/<view> as one of Explore's own addresses.
  '/chain/hyperliquid': { title: 'Hyperliquid', description: 'Post-only rejection measured across the tracked Hyperliquid makers, and the coverage behind each number.' },
  // Every /sign/<id> takes this entry, with /sign as its canonical: the id
  // is one order for one wallet, so it is never published as the page's
  // address. The page also sets noindex, and vercel.json sends
  // X-Robots-Tag: noindex for these paths; none is in the sitemap.
  '/sign': { title: 'Sign an order', description: 'An order prepared through Tnega, shown in full and signed in your own wallet.' },
};

// Lazy-loaded: pulls in three.js/@react-three/fiber/drei (~800KB) only for
// visitors who open /ecosystem, zero cost added to the
// Marketplace's own default load. See EcosystemGlobePage.jsx for why.
const EcosystemGlobePage = lazy(() => import('./EcosystemGlobePage.jsx'));
// Lazy too: the signing page brings its own wallet config for the buy
// chains (sign/signWagmi.js), which must not be created for any other page.
const SignOrderPage = lazy(() => import('./sign/SignOrderPage.jsx'));

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

// THE PHONE WELCOME (shell/MobileWelcome.jsx) sits over whatever page the
// address opens, once per session, on phones only. Decided once, when the
// app mounts: a desktop window narrowed later does not get it.
// `tree` is which providers the page load mounted (main.jsx): 'site', the
// site's; 'sign', a signing link's own (sign/SignRoot.jsx); 'site-fallback',
// the site's after the signing providers failed to load.
export default function App({ tree = 'site' }) {
  // Not over a signing link: someone arriving to sign one order, with ten
  // minutes on the clock, is not shown the welcome first.
  const [welcome, setWelcome] = useState(() => shouldWelcome(typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
    && !(typeof window !== 'undefined' && isSignPath(window.location.pathname.replace(/\/+$/, ''))));
  return (
    <>
      <AppRoutes tree={tree} />
      {welcome && <MobileWelcome onEnter={() => setWelcome(false)} />}
    </>
  );
}

function AppRoutes({ tree }) {
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
    const bare = path.split('#')[0];
    if (isSignPath(bare)) { updatePageMeta({ ...PAGE_META['/sign'], path: '/sign' }); return; }
    const known = Object.prototype.hasOwnProperty.call(PAGE_META, bare);
    const detailParent = bare.startsWith('/stocks/') ? '/stocks' : bare.startsWith('/vaults/') ? '/vaults' : bare.startsWith('/my-etfs/') ? '/my-etfs' : null;
    const meta = known ? PAGE_META[bare] : PAGE_META[detailParent || (isExplorePath(bare) ? '/market' : '/')];
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
    updatePageMeta({ ...meta, path: bare });
  }, [path]);

  // ONE PROVIDER TREE PER PAGE LOAD. The site's pages need the site's wallet
  // providers (SignInProvider above all), and a signing link needs its own
  // (sign/SignRoot.jsx). When the address moves from one to the other inside
  // a page load (Back, Forward, a pushed address), the page is loaded again
  // for the new address rather than drawn under the wrong providers.
  const signHere = isSignPath(path.split('#')[0]);
  const wrongTree = (tree === 'sign' && !signHere) || (tree === 'site' && signHere);
  useEffect(() => {
    if (wrongTree) window.location.reload();
  }, [wrongTree, path]);
  if (wrongTree) return null;

  // Sign-in renders outside the app shell: a split screen of its own, one
  // component for every width (pages/SignInPage.jsx).
  if (path === '/signin') {
    return <SignInPage navigate={navigate} />;
  }

  // A signing link (sign/SignOrderPage.jsx): one component for every width,
  // with its own wallet providers, so it works while the site's Buy switch
  // is off.
  if (signHere && tree === 'site-fallback') {
    return (
      <div className="min-h-screen bg-page text-fg flex items-center justify-center p-6">
        <div className="max-w-[480px] text-[14px]">
          <h1 className="text-[20px] font-semibold">This page did not load fully</h1>
          <p className="mt-2 text-muted">The part of the page that talks to your wallet did not load, so nothing is offered for signing. The link itself may be fine: reload the page.</p>
          <button type="button" className="mt-4 h-10 px-4 rounded border border-line-strong text-[13px] font-semibold" onClick={() => window.location.reload()}>Reload the page</button>
        </div>
      </div>
    );
  }
  if (signHere) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-page flex items-center justify-center"><Loader2 size={28} className="animate-spin text-accent" /></div>}>
        <SignOrderPage id={path.split('#')[0].slice('/sign/'.length)} />
      </Suspense>
    );
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

  // The footer links to /privacy#website; the hash travels on `path`.
  if (path === '/privacy' || path.startsWith('/privacy#')) {
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
  // The hash is not part of the path that names a tab: /guide#costs opens
  // the guide.
  const initialNav = tabForPath(path.split('#')[0], search);
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

