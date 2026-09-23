// LandingStory.jsx
//
// Everything below the hero. The landing page was one screen: a video, a
// headline, a button, and a skip link. A visitor who did not already know what
// this project is had nowhere to find out, because the only route onward was
// into the agent grid, which answers "what is listed" and not "why should I
// believe any of it".
//
// The order is argued rather than decorative. The problem first, because the
// claim only means something once you accept that registration proves nothing.
// Then the scale, so the problem is not hypothetical. Then what is actually
// measured, then what is deliberately NOT measured, which is the part that
// separates this from a directory. Where it runs comes last, before the exit.
//
// Every number here is measured and is sourced in the line under it. Nothing
// on this page is a projection, a target, or a figure from a deck.

import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ShieldQuestion, Radio, Coins, Ban, Building2, Wallet } from 'lucide-react';
import { ChainMark } from './chainViews/chainMarks';

/** Reveal on scroll, once, and never at the cost of the content.
 *
 *  If IntersectionObserver is missing or prefers-reduced-motion is set, the
 *  section is simply visible from the start. A reveal that can fail closed
 *  hides the page from whoever it fails for. */
function Reveal({ children, className = '' }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (!('IntersectionObserver' in window)) return true;
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (shown || !ref.current) return undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); io.disconnect(); }
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);

  return (
    <div ref={ref} className={`tn-reveal ${shown ? 'is-in' : ''} ${className}`}>
      {children}
    </div>
  );
}

// THESE READ THEMSELVES NOW, and the reason is what they used to be.
//
// They were stamped by hand, "Measured 2026-09-19", under a comment saying a
// number on a landing page with no provenance is the thing this project exists
// to argue against. The provenance was there and the number moved: four days
// later this said 12.0M orders observed against 53,106,754 live, understated by
// a factor of 4.4. The other three had drifted under 1.5% and were fine, which
// is the point: the figure that moves fastest is the one a hand-written stamp
// cannot keep, and re-stamping it would only set the same trap again.
//
// The values below are the fallback, not the source. They render on the first
// frame and are replaced when /api/landing-stats answers, because a headline
// that blanks while a request is in flight is worse than one that is a day old.
// That is the same rule the How It Works opening paragraph already follows.
// What is different here is that the page says which of the two it is showing,
// so a stale fallback cannot pass itself off as a reading.
const STAT_FALLBACK = [
  { key: 'agents_indexed', value: '199,217', label: 'agents indexed',
    note: 'ERC-8004 registries, six chains' },
  // Six, not the seven chain views. The seventh is Hyperliquid, which is a
  // venue with no ERC-8004 registry to read, so counting it here would put a
  // venue in a registry figure.
  { key: 'registry_chains', value: '6', label: 'chains read',
    note: 'three of them hireable today' },
  { key: 'orders_observed', value: '53.1M', label: 'orders observed',
    note: 'post-only orders on Hyperliquid' },
  { key: 'addresses_cached', value: '46,882', label: 'addresses cached',
    note: "the venue's own leaderboard, daily" },
];

/** A count as this page writes counts: millions short, everything else grouped. */
function statValue(key, n) {
  if (!Number.isFinite(n)) return null;
  if (key === 'orders_observed') {
    return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString('en-US');
  }
  return n.toLocaleString('en-US');
}

const STEPS = [
  {
    icon: Radio,
    title: 'Call the endpoint',
    body: 'An agent publishes a service URL when it registers. We call it and record '
      + 'what came back, and when. Answering is not the same as being good, but not '
      + 'answering is disqualifying and nothing else on chain tells you.',
  },
  {
    icon: Coins,
    title: 'Follow the money',
    body: 'ERC-8183 jobs name a provider address. We count who actually paid for a '
      + 'delivery, and separate the clients who are somebody else from the ones who '
      + 'are the agent’s own owner paying itself.',
  },
  {
    icon: ShieldQuestion,
    title: 'Measure the behaviour',
    body: 'On Hyperliquid we poll order outcomes and count how often a post-only '
      + 'order was refused before it rested. A refused order never reaches the book, '
      + 'so it leaves no trace in fills or volume. That gap is the measurement.',
  },
  {
    icon: Ban,
    title: 'Say what cannot be said',
    body: 'Where the observations are too few, the data is stale, or the address is '
      + 'outside what we poll, the number is withheld and the reason is shown in its '
      + 'place. A blank is a finding. A zero would be a lie.',
  },
];

// The chains, in the order the tab row uses, so the landing page and the app
// name them the same way round. Marks come from chainMarks, which is the same
// component the tabs use: two lists of chain logos that can disagree is how one
// of them goes stale.
const CHAINS = [
  { id: 'hyperliquid', name: 'Hyperliquid', note: 'Order-book measurements' },
  { id: 'bnb', name: 'BNB Chain', note: '154,602 agents · hireable' },
  { id: 'ethereum', name: 'Ethereum', note: '30,894 agents' },
  { id: 'solana', name: 'Solana', note: '1,490 agents' },
  { id: 'arbitrum', name: 'Arbitrum', note: '1,424 agents · hireable' },
  { id: 'robinhood', name: 'Robinhood Chain', note: '221 agents · hireable' },
  { id: 'monad', name: 'Monad', note: '10,170 agents' },
];

const AUDIENCES = [
  {
    icon: Wallet,
    who: 'Someone about to pay an agent',
    body: 'You have found an agent that claims to do the thing you need. Before '
      + 'funding a job you want to know whether its endpoint answers, and whether '
      + 'anyone other than its own deployer has ever paid it for work.',
  },
  {
    icon: Building2,
    who: 'A protocol routing other people’s orders',
    body: 'You send user orders to a venue and need to know whether they rest. A '
      + 'refused post-only order is not a maker’s strategy choice to you, it is a '
      + 'user whose order neither rested nor filled.',
  },
];

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

/** How long ago the figures were read, in the page's own register. */
function statAge(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'just now';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'seconds ago';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 172800) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default function LandingStory({ onEnter }) {
  // Never blocks the page. The fallback renders on the first frame and this
  // swaps in when it lands; a failure leaves the fallback with the line below
  // saying so, rather than a blank or a silent stale figure.
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/landing-stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) setStats(d); })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="tn-story">
      <div className="tn-shell">
        {/* STICKY INTRO, the layout this page was missing.
            It carries the name, the one-line claim and the exits, and stays put
            while the argument scrolls past it. Without it the reader loses what
            the page is about by the third section, and the only way back to a
            CTA is the bottom of the page. On a phone it is not sticky: a fixed
            block would eat a third of a small screen. */}
        <aside className="tn-aside">
          <div className="tn-aside-in">
            <p className="tn-eyebrow">Tnega</p>
            <h2 className="tn-aside-h">
              Agents are easy to register. Tnega measures whether they work.
            </h2>
            <p className="tn-aside-p">
              {/* The same figure as the first tile, from the same read. It was a
                  second hardcoded copy of it, which is how one stale number
                  becomes two: the tile was corrected once and this was not. */}
              {(stats && Number.isFinite(stats.agents_indexed)
                ? stats.agents_indexed.toLocaleString('en-US')
                : '199,217')} agents across six chains, and the readings behind each of
              them, including the ones we will not state.
            </p>
            <div className="tn-cta tn-cta--aside">
              <button type="button" className="tn-btn" onClick={onEnter}>
                Explore the agents <ArrowRight size={16} aria-hidden="true" />
              </button>
              <a className="tn-btn tn-btn--ghost" href="/how-it-works">
                How it is measured
              </a>
            </div>
          </div>
        </aside>

        <div className="tn-main">
      {/* ─── The problem, stated before any claim rests on it ─── */}
      <section className="tn-sec tn-sec--lead" aria-labelledby="tn-why">
        <Reveal>
          <p className="tn-eyebrow">Why this exists</p>
          <h2 id="tn-why">Registering an agent is a transaction. It proves nothing.</h2>
          <p className="tn-lead">
            It costs a few cents and writes a name to a registry. It does not say whether
            the agent answers when called, whether it has ever delivered work, or whether
            anyone other than the person who deployed it has ever paid it.
          </p>
          <p className="tn-lead">
            Every directory in this space lists the transaction. Tnega measures what
            happens afterwards, and says plainly where it cannot.
          </p>
        </Reveal>
      </section>

      {/* ─── Scale, so the problem is not hypothetical ─── */}
      <section className="tn-sec tn-sec--stats" aria-label="What has been measured">
        <Reveal>
          <div className="tn-stats">
            {STAT_FALLBACK.map((s) => {
              const live = stats ? statValue(s.key, stats[s.key]) : null;
              return (
                <div key={s.label} className="tn-stat">
                  <div className="tn-stat-v">{live || s.value}</div>
                  <div className="tn-stat-l">{s.label}</div>
                  <div className="tn-stat-n">{s.note}</div>
                </div>
              );
            })}
          </div>
          {/* Which of the two is on screen. Without this the fallback is
              indistinguishable from a reading, which is the defect that put a
              four-day-old figure here under a provenance stamp. */}
          <p className="tn-stat-asof">
            {stats
              ? `Read from the store ${statAge(stats.as_of)}.`
              : 'Last measured 23 September 2026. Live figures have not loaded.'}
          </p>
        </Reveal>
      </section>

      {/* ─── What it actually does ─── */}
      <section className="tn-sec" aria-labelledby="tn-how">
        <Reveal>
          <p className="tn-eyebrow">What it measures</p>
          <h2 id="tn-how">Four readings, and one refusal</h2>
        </Reveal>
        <div className="tn-steps">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.title}>
                <div className="tn-step">
                  <div className="tn-step-n">{String(i + 1).padStart(2, '0')}</div>
                  <Icon size={18} className="tn-step-i" aria-hidden="true" />
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ─── The differentiator, given its own section ─── */}
      <section className="tn-sec tn-sec--quiet" aria-labelledby="tn-honest">
        <Reveal>
          <p className="tn-eyebrow">The part most sites leave out</p>
          <h2 id="tn-honest">What it refuses to tell you</h2>
          <ul className="tn-refuse">
            <li>
              <b>No score.</b> There is no single number ranking one agent above another.
              The readings are shown separately because they measure different things and
              averaging them would hide which one is weak.
            </li>
            <li>
              <b>No prediction.</b> Nothing here forecasts whether an agent will deliver
              next time. It records what happened, with the count of observations behind it.
            </li>
            <li>
              <b>No inferred identity.</b> Where the public data cannot tell one trader from
              a platform holding many customers, the panel says so rather than guessing.
            </li>
            <li>
              <b>No borrowed credit.</b> Where a figure is the venue’s rather than ours, it
              is labelled as the venue’s, on the page and in the payload.
            </li>
          </ul>
        </Reveal>
      </section>

      {/* ─── Who feels this, named rather than implied ─── */}
      <section className="tn-sec" aria-labelledby="tn-who">
        <Reveal>
          <p className="tn-eyebrow">Who this is for</p>
          <h2 id="tn-who">Two people who need the same answer</h2>
        </Reveal>
        <div className="tn-who">
          {AUDIENCES.map((a) => {
            const Icon = a.icon;
            return (
              <Reveal key={a.who}>
                <div className="tn-who-card">
                  <Icon size={20} aria-hidden="true" />
                  <h3>{a.who}</h3>
                  <p>{a.body}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ─── The chains, with the same marks the tab row uses ─── */}
      <section className="tn-sec tn-sec--quiet" aria-labelledby="tn-chains">
        <Reveal>
          <p className="tn-eyebrow">Coverage</p>
          <h2 id="tn-chains">Seven chains, three you can hire on</h2>
          <p className="tn-lead">
            Counts are read from the registries, not estimated. Where a chain has no
            hiring path the page says so rather than implying one.
          </p>
        </Reveal>
        <Reveal>
          <div className="tn-chains">
            {CHAINS.map((c) => (
              <div key={c.id} className="tn-chain">
                <ChainMark viewId={c.id} size={18} />
                <div>
                  <div className="tn-chain-n">{c.name}</div>
                  <div className="tn-chain-s">{c.note}</div>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ─── Where it runs, then the exit ─── */}
      <section className="tn-sec" aria-labelledby="tn-where">
        <Reveal>
          <p className="tn-eyebrow">Where it runs</p>
          <h2 id="tn-where">On the site, and on the page you were already reading</h2>
          <p className="tn-lead">
            Hyperliquid, BNB Chain, Ethereum, Solana, Arbitrum, Robinhood Chain and Monad.
            {/* This said hiring runs through ERC-8183 escrow on all three
                chains. Wrong twice: ERC-8183 is deployed on BNB Chain only,
                and the other two hire through AgentBudgetEscrow, which is a
                spending mechanism rather than an escrow. So the landing page
                was telling a prospective funder that two of the three paths
                carried delivery protection they do not have. */}
            {' '}BNB Chain has two ways to hire: ERC-8183 escrow, where payment is held until
            the agent delivers, and a spending budget the agent draws from as it works. On
            Arbitrum and Robinhood Chain the budget is the only way. A budget is not an
            escrow and carries no delivery protection.
            {' '}A Chrome extension puts the same readings on the block explorer page you are
            already looking at, without you coming here first.
          </p>
          <div className="tn-cta">
            <button type="button" className="tn-btn" onClick={onEnter}>
              Explore the agents <ArrowRight size={16} aria-hidden="true" />
            </button>
            <a className="tn-btn tn-btn--ghost" href="/how-it-works">
              How it is measured
            </a>
          </div>
        </Reveal>
      </section>
        </div>
      </div>
    </div>
  );
}
