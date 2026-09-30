// WalletHome.jsx
//
// The connected wallet's Dashboard ("/"; /wallet redirects there). One
// component for both apps; `layout` changes the arrangement, never the
// content. Laid out like getquin's dashboard (owner's reference,
// 05-dashboard-getquin-style), with the cards in dashboard/cards.jsx:
//
// Web
//   left   Portfolio (the valued total), Positions
//   right  Allocation (the donut, one colour per asset class), Dividends and
//          Performance (not measured yet)
//   then   one card per asset class: Stocks, ETFs, Vaults, Tokens
//   then   Hyperliquid: account value, holdings, what its habits cost
// Mobile, one column in the same order, Allocation straight after Portfolio.
//
// THE THREE STATES OF THE VISITOR
//   disconnected  a short prompt and a way to connect
//   connected     the figures, labelled "this address"
//   signed        the same figures, labelled "your wallet"
// Signing changes the words and nothing else; the reads are the same public
// reads either way, and a connected but unsigned wallet triggers them too.
//
// WHAT IS READ, AND WHERE THE ADDRESS GOES
// Two requests to our server, each with the address in the POST body, never
// the URL: /api/wallet/holdings (stocks, ETFs and tokens on six chains, read
// on chain by the server) and /api/wallet/habits (the Hyperliquid record).
// The vault list (GET /api/vaults) carries no address. Nothing else is read
// with the address from this page: the agent hires panel is not on the
// Dashboard ("/" carries nothing about agents, owner 2026-09-26), and the
// browser no longer reads token balances itself (the server's holdings read
// covers the same tokens on all six chains). Each read is shown on its own:
// a failed or busy one never hides the others.

import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useSignIn } from './SignInProvider';
import { useHabits } from './useHabits';
import { useEquityHoldings } from './useEquityHoldings';
import HabitCosts from './HabitCosts';
import { HyperliquidPositions, HyperliquidValue } from './HyperliquidHoldings';
import { fmtAge, fmtUtc, reasonText, sectionName } from './format';
import { derive } from '../dashboard/portfolio';
import {
  AllocationCard, ClassCard, DividendsCard, PerformanceCard, PortfolioCard, PositionsCard, Tip, VaultsCard,
} from '../dashboard/cards';

// With no wallet connected. On the Dashboard (`embedded`) the page title is
// already the h1, so this card's heading is an h2.
function Intro({ onSignIn, embedded = false }) {
  const Heading = embedded ? 'h2' : 'h1';
  return (
    <section className="card p-4 md:p-6 max-w-3xl" aria-labelledby="wallet-intro-title">
      <Heading id="wallet-intro-title" className={`${embedded ? 'text-title' : 'text-h1'} font-bold text-fg`}>Your wallet</Heading>
      <p className="text-body text-muted mt-1">Connect one to see its stocks, ETFs and tokens, read on chain.</p>
      <button type="button" onClick={onSignIn} className="mt-4 h-10 px-4 rounded-md bg-accent text-accent-fg text-body font-semibold hover:opacity-90 inline-flex items-center gap-2">
        <Wallet size={16} aria-hidden="true" /> Connect a wallet
      </button>
    </section>
  );
}

function useCountdown(until) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

function ServerState({ habits }) {
  const left = useCountdown(habits.status === 'busy' ? habits.retryAt : null);
  if (habits.status === 'loading') {
    return (
      <section className="card p-4 flex items-center gap-2 text-body text-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        Reading Hyperliquid…
      </section>
    );
  }
  if (habits.status === 'busy') {
    return (
      <section className="card p-4 border-warn/40" role="status">
        <h2 className="text-title font-bold">The server is busy</h2>
        <p className="text-body text-fg mt-1">{habits.detail}</p>
        <p className="text-body text-muted mt-1">
          {left > 0 ? `Try again in ${left} seconds.` : 'You can try again now.'}
        </p>
        <button
          type="button"
          onClick={habits.refresh}
          disabled={left > 0}
          className="mt-3 h-9 px-3 rounded-md bg-accent text-accent-fg text-label font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={13} aria-hidden="true" /> {left > 0 ? `Try again in ${left}s` : 'Try again'}
        </button>
      </section>
    );
  }
  if (habits.status === 'error') {
    return (
      <section className="card p-4" role="status">
        <h2 className="text-title font-bold">Hyperliquid figures not available</h2>
        <p className="text-body text-muted mt-1">{habits.detail}</p>
        <button type="button" onClick={habits.refresh} className="mt-3 h-9 px-3 rounded-md border border-line-strong text-label font-semibold text-fg hover:bg-inset inline-flex items-center gap-1.5">
          <RefreshCw size={13} aria-hidden="true" /> Try again
        </button>
      </section>
    );
  }
  return null;
}

function PartialNote({ data }) {
  if (!data?.partial || !(data.missing || []).length) return null;
  const reasons = data.reasons || {};
  return (
    <section className="card p-4 border-warn/40 bg-warn/5" aria-label="Limits of this read">
      <h2 className="text-title font-bold">Partial read</h2>
      <p className="text-label text-muted mt-0.5 mb-2">{data.missing_note}</p>
      <ul className="space-y-2">
        {data.missing.map((m, i) => (
          <li key={`${m.section}-${i}`} className="text-body">
            <span className="font-semibold text-fg">{sectionName(m.section)}.</span>{' '}
            <span className="text-muted">{reasonText(reasons, m.withheld_reason)}</span>
            {m.detail && <span className="text-muted"> {m.detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function shortAddr(a) {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function Header({ status, address, openSignIn, embedded }) {
  const signed = status === 'signed';
  const Heading = embedded ? 'h2' : 'h1';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4 md:mb-5">
      <div className="min-w-0 flex items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-inset text-[12px] font-semibold text-fg">
          {signed ? <ShieldCheck size={13} className="text-pos" aria-hidden="true" /> : <Wallet size={13} aria-hidden="true" />}
          {signed ? 'Your wallet' : 'This address'}
        </span>
        <Heading className="figure text-[15px] font-semibold text-fg" title={address}>{shortAddr(address)}</Heading>
        <Tip label="About this address" align="left">
          <span className="block break-all">{address}</span>
          <span className="block">Its public balances and Hyperliquid record, read without signing anything. Signing in changes only what the page calls it.</span>
        </Tip>
      </div>
      {!signed && (
        <button type="button" onClick={openSignIn} className="text-[13px] font-semibold text-fg hover:underline">Sign in</button>
      )}
    </div>
  );
}

function HyperliquidHead({ habits }) {
  const d = habits.status === 'ok' ? habits.data : null;
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-[17px] font-semibold text-fg flex items-center gap-2">
        Hyperliquid
        {d && (
          <Tip label="About the Hyperliquid read" align="left">
            <span className="block">Read from the venue&apos;s public record {fmtUtc(d.as_of)}{d.served_from_cache ? `, from the server's cache (${fmtAge(d.cache_age_seconds)} old)` : ''}.</span>
            {d.read && <span className="block">{d.read.venue_calls} calls to the venue{d.served_from_cache ? ' when first read' : ''}.</span>}
          </Tip>
        )}
      </h2>
      {habits.status === 'ok' && (
        <button type="button" onClick={habits.refresh} aria-label="Read Hyperliquid again" title="Read again"
          className="w-8 h-8 rounded-lg border border-line inline-flex items-center justify-center text-muted hover:text-fg hover:bg-inset">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

const HIDE_KEY = 'tnega_dashboard_hide_amounts';

/** The eye on the Portfolio card: amounts shown or dotted out, remembered in
 *  this browser only. */
function useHideAmounts() {
  const [hidden, setHidden] = useState(() => {
    try { return window.localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
  });
  const toggle = () => setHidden((h) => {
    const next = !h;
    try { window.localStorage.setItem(HIDE_KEY, next ? '1' : '0'); } catch { /* storage off: this visit only */ }
    return next;
  });
  return [hidden, toggle];
}

// `embedded` is set when the Dashboard shows this under its own page title,
// so the address is a second-level heading there rather than a second h1.
// `onConnect`, when given, is what the connect button does with no wallet
// connected (the Dashboard opens /signin); without it, the sign-in modal.
export default function WalletHome({ layout = 'web', embedded = false, onConnect = null }) {
  const { status, address, openSignIn } = useSignIn();
  const habits = useHabits(status === 'disconnected' ? null : address);
  const equities = useEquityHoldings(status === 'disconnected' ? null : address);
  const [hidden, toggleHidden] = useHideAmounts();
  const holdings = equities.status === 'ok' ? equities.data : null;
  const d = useMemo(() => derive(holdings), [holdings]);

  if (status === 'disconnected') return <Intro embedded={embedded} onSignIn={onConnect || (() => openSignIn())} />;

  const who = status === 'signed' ? 'your wallet' : 'this address';
  const data = habits.status === 'ok' ? habits.data : null;
  const server = <ServerState habits={habits} />;
  const mobile = layout === 'mobile';
  const common = { d, data: holdings, read: equities, hidden };
  const classes = (
    <section aria-label="By asset class" className={`grid grid-cols-1 sm:grid-cols-2 ${mobile ? '' : 'xl:grid-cols-4'} gap-4 items-start`}>
      <ClassCard k="stocks" {...common} />
      <ClassCard k="etfs" {...common} />
      <VaultsCard />
      <ClassCard k="tokens" {...common} />
      {d && d.rows.untyped.length > 0 && <ClassCard k="untyped" {...common} />}
    </section>
  );
  const hyperliquid = (
    <section aria-label="Hyperliquid">
      <HyperliquidHead habits={habits} />
      <div className={mobile ? 'space-y-3' : 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-start'}>
        <div className={mobile ? 'space-y-3' : 'lg:col-span-8 space-y-4 min-w-0'}>
          {server}
          {data && <PartialNote data={data} />}
          {/* The eye hides every amount on the page, these included: with
              amounts hidden the Hyperliquid figures are not rendered at all. */}
          {data && hidden && <p className="card p-4 text-body text-muted">Amounts hidden.</p>}
          {data && !hidden && <HyperliquidValue data={data} compact={mobile} />}
          {data && !hidden && <HyperliquidPositions data={data} layout={layout} />}
        </div>
        <div className={mobile ? '' : 'lg:col-span-4 min-w-0'}>
          {data && !hidden && <HabitCosts data={data} who={who} />}
        </div>
      </div>
    </section>
  );

  if (mobile) {
    return (
      <div>
        <Header status={status} address={address} openSignIn={() => openSignIn()} embedded={embedded} />
        <div className="space-y-3">
          <PortfolioCard {...common} onToggleHidden={toggleHidden} />
          <AllocationCard {...common} />
          {classes}
          <PositionsCard {...common} compact />
          <DividendsCard />
          <PerformanceCard />
          <div className="pt-3">{hyperliquid}</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header status={status} address={address} openSignIn={() => openSignIn()} embedded={embedded} />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 space-y-4 min-w-0">
          <PortfolioCard {...common} onToggleHidden={toggleHidden} />
          <PositionsCard {...common} />
        </div>
        <div className="lg:col-span-4 space-y-4 min-w-0">
          <AllocationCard {...common} />
          <DividendsCard />
          <PerformanceCard />
        </div>
      </div>
      <div className="mt-6">{classes}</div>
      <div className="mt-8">{hyperliquid}</div>
    </div>
  );
}
