// WalletHome.jsx
//
// /wallet: the connected wallet's own page. Holdings, and what its trading
// habits on Hyperliquid have cost it, measured. One component for both apps;
// `layout` changes the arrangement, never the content.
//
// Web, following the reference dashboard's two stacks:
//   left   Hyperliquid account value, Hyperliquid holdings, other chains
//   right  what the habits cost, then hires and budgets
// Mobile, one column: value, holdings, habit costs, hires.
//
// THE THREE STATES OF THE VISITOR
//   disconnected  what the page shows and reads, and a way to connect
//   connected     the figures, labelled "this address"
//   signed        the same figures, labelled "your wallet"
// Signing changes the words and nothing else; the reads are the same public
// reads either way, and a connected but unsigned wallet triggers them too.
//
// INDEPENDENCE OF THE PARTS
// The Hyperliquid half comes from our server's /api/wallet/habits; the other
// chains and the hires come from chain reads in the browser. A failed or busy
// server read never hides them, and they never wait for it.

import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useSignIn } from './SignInProvider';
import { useHabits } from './useHabits';
import { useEvmHoldings } from './useEvmHoldings';
import HabitCosts from './HabitCosts';
import { HyperliquidPositions, HyperliquidValue } from './HyperliquidHoldings';
import EvmHoldings from './EvmHoldings';
import MyJobsPanel from '../MyJobsPanel';
import { fmtAge, fmtUtc, reasonText, sectionName } from './format';

function Intro({ onSignIn }) {
  return (
    <div className="max-w-2xl">
      <h1 className="text-h1 font-bold">Your wallet</h1>
      <p className="text-body text-muted mt-1">
        Connect a wallet to see what it holds and what its trading habits on Hyperliquid have cost it, measured.
      </p>
      <div className="card p-4 mt-5 space-y-3 text-body text-fg">
        <p><span className="font-semibold">Holdings.</span> Its Hyperliquid perp accounts and positions, its Hyperliquid spot balances, and its native coin and a short named list of stablecoins on BNB Chain, Arbitrum and Robinhood Chain.</p>
        <p><span className="font-semibold">What its habits cost.</span> Fees paid as maker and as taker, the share of volume it took rather than made, funding paid and received, how often its post-only orders were refused, and cancels per fill. Each figure carries the window and the number of records behind it, and where something could not be read the page says why instead of showing a zero. There are no estimates and no what-ifs.</p>
        <p><span className="font-semibold">What is read, and by whom.</span> The address is sent to our server in the body of one request, which reads its public Hyperliquid record and keeps the answer in memory for five minutes; and from your browser to each chain&apos;s public RPC provider to read balances. Nothing is stored, and you do not need to sign anything to see the figures.</p>
        <button type="button" onClick={onSignIn} className="h-10 px-4 rounded-md bg-accent text-accent-fg text-body font-semibold hover:opacity-90 inline-flex items-center gap-2">
          <Wallet size={16} aria-hidden="true" /> Connect a wallet
        </button>
      </div>
    </div>
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
        Reading this address&apos;s public record on Hyperliquid. A first read takes a few seconds.
      </section>
    );
  }
  if (habits.status === 'busy') {
    return (
      <section className="card p-4 border-warn/40" role="status">
        <h2 className="text-title font-bold">The server is busy</h2>
        <p className="text-body text-fg mt-1">{habits.detail}</p>
        <p className="text-body text-muted mt-1">
          {left > 0 ? `Try again in ${left} seconds.` : 'You can try again now.'} It reads one new wallet a minute across everyone, so nothing is retried automatically.
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
        <p className="text-body text-muted mt-1">{habits.detail} The other chains and your hires below are read separately and are not affected.</p>
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

function Header({ status, address, habits, openSignIn }) {
  const signed = status === 'signed';
  const d = habits.status === 'ok' ? habits.data : null;
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-5">
      <div className="min-w-0">
        <p className="text-label font-semibold uppercase tracking-wide text-muted flex items-center gap-1.5">
          {signed && <ShieldCheck size={13} className="text-pos" aria-hidden="true" />}
          {signed ? 'Your wallet' : 'This address'}
        </p>
        <h1 className="figure text-title md:text-h1 font-bold text-fg break-all">{address}</h1>
        {!signed && (
          <p className="text-label text-muted mt-1">
            Not signed in, so the page calls it this address. The figures are the same either way.{' '}
            <button type="button" onClick={openSignIn} className="text-accent font-semibold hover:underline">Sign in</button>
          </p>
        )}
      </div>
      <div className="text-label text-muted md:text-right shrink-0">
        {d && (
          <p>
            Hyperliquid read {fmtUtc(d.as_of)}
            {d.served_from_cache ? `, from the server's cache (${fmtAge(d.cache_age_seconds)} old)` : ''}
          </p>
        )}
        {d && d.read && (
          <p>{d.read.venue_calls} calls to the venue{d.served_from_cache ? ' when first read' : ''}</p>
        )}
        {habits.status === 'ok' && (
          <button type="button" onClick={habits.refresh} className="mt-1 h-8 px-2.5 rounded-md border border-line-strong text-label text-fg hover:bg-inset inline-flex items-center gap-1.5">
            <RefreshCw size={13} aria-hidden="true" /> Read again
          </button>
        )}
      </div>
    </div>
  );
}

function Hires() {
  return (
    <section className="card p-4">
      <h2 className="text-title font-bold mb-3">Hires and budgets</h2>
      {/* The panels build alpha variants by appending hex digits to the accent
          (`${accent}1A`), so it has to stay a hex string here. */}
      <MyJobsPanel accent="#6366F1" mutedBorder="border-line" />
    </section>
  );
}

export default function WalletHome({ layout = 'web' }) {
  const { status, address, openSignIn } = useSignIn();
  const habits = useHabits(status === 'disconnected' ? null : address);
  const evm = useEvmHoldings(status === 'disconnected' ? null : address);

  if (status === 'disconnected') return <Intro onSignIn={() => openSignIn()} />;

  const who = status === 'signed' ? 'your wallet' : 'this address';
  const data = habits.status === 'ok' ? habits.data : null;
  const server = <ServerState habits={habits} />;

  if (layout === 'mobile') {
    return (
      <div>
        <Header status={status} address={address} habits={habits} openSignIn={() => openSignIn()} />
        <div className="space-y-3">
          {server}
          {data && <PartialNote data={data} />}
          {data && <HyperliquidValue data={data} compact />}
          {data && <HyperliquidPositions data={data} layout="mobile" />}
          <EvmHoldings holdings={evm} />
          {data && <HabitCosts data={data} who={who} />}
          <Hires />
        </div>
      </div>
    );
  }

  return (
    <div>
      <Header status={status} address={address} habits={habits} openSignIn={() => openSignIn()} />
      {data && <div className="mb-6"><PartialNote data={data} /></div>}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6 min-w-0">
          {server}
          {data && <HyperliquidValue data={data} />}
          {data && <HyperliquidPositions data={data} layout="web" />}
          <EvmHoldings holdings={evm} />
        </div>
        <div className="lg:col-span-4 space-y-6 min-w-0">
          {data && <HabitCosts data={data} who={who} />}
          <Hires />
        </div>
      </div>
    </div>
  );
}
