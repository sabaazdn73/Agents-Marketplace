// EquityHoldings.jsx
//
// The Dashboard's three sections for the connected wallet: Stocks, ETFs and
// Vaults, each on its own card.
//
// STOCKS AND ETFs come from one read, POST /api/wallet/holdings
// (useEquityHoldings.js): every listed tokenized version on Ethereum, Base,
// Arbitrum, BNB Chain, Robinhood Chain and HyperEVM, read on chain by our
// server. Stock or ETF is the universe file's type, the one the Stocks & ETFs
// lists use; a version whose underlying has no recorded type is shown on its
// own card rather than guessed into either. A dollar value is shown only when
// the answer carries one (a pool price Tnega measured, with its time);
// otherwise the balance alone, and the route's reason on hover and under the
// list. An empty card says what was read: "none held on the six chains read"
// only when all six answered, and names any chain that could not be read.
//
// VAULTS. Every vault Tnega lists today is on Solana (Kamino, Voltr, GLAM),
// and holding one takes a Solana address. The dashboard connects an EVM
// wallet, so the card says those were not checked, using the vault list's
// own platform counts (GET /api/vaults), and never shows an empty list as if
// it had been.

import React, { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Card, CardTitle, SymbolTile } from '../ui/primitives';
import { useTe, VAULT_LIST_HEADERS_MS } from '../te/api';
import { readErrorText } from '../te/ReadError';
import { fmtAge, fmtCount, fmtUsd, fmtUtc } from './format';

function listWords(xs) {
  if (!xs.length) return '';
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0];
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

/** A balance as the chain gave it (an exact decimal string), grouped, never
 *  rounded to zero. */
function fmtBalance(s) {
  if (typeof s !== 'string' || !/^\d+(\.\d+)?$/.test(s)) return s ?? null;
  const [i, f] = s.split('.');
  const grouped = Number(i).toLocaleString('en-US');
  return f ? `${grouped}.${f}` : grouped;
}

function ReadAgain({ onClick, disabled = false, children = 'Read again' }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="h-8 px-2.5 rounded border border-line-strong text-[12px] font-semibold text-fg hover:bg-inset disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0">
      <RefreshCw size={13} aria-hidden="true" /> {children}
    </button>
  );
}

/** Loading, busy and error, the same on both cards (one read feeds both). */
function ReadState({ read, what }) {
  const left = useCountdown(read.status === 'busy' ? read.retryAt : null);
  if (read.status === 'loading' || read.status === 'idle') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
        <Loader2 size={15} className="animate-spin shrink-0" aria-hidden="true" />
        Reading this address&apos;s {what} on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM.
      </p>
    );
  }
  if (read.status === 'busy') {
    return (
      <div role="status" className="space-y-2">
        <p className="text-[13px] text-fg">{read.detail}</p>
        <p className="text-[12px] text-muted">{left > 0 ? `Try again in ${left} seconds.` : 'You can try again now.'} Nothing is retried automatically.</p>
        <ReadAgain onClick={read.refresh} disabled={left > 0}>{left > 0 ? `Try again in ${left}s` : 'Try again'}</ReadAgain>
      </div>
    );
  }
  if (read.status === 'error') {
    return (
      <div role="alert" className="space-y-2">
        <p className="text-[13px] text-fg">{what.charAt(0).toUpperCase() + what.slice(1)} could not be read. {read.detail}</p>
        <ReadAgain onClick={read.refresh}>Try again</ReadAgain>
      </div>
    );
  }
  return null;
}

function Row({ r, reasons }) {
  const value = fmtUsd(r.value_usd);
  const why = r.value_reason ? (reasons?.[r.value_reason] || r.value_reason) : null;
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <a href={`/stocks/${encodeURIComponent(r.ticker || '')}?v=${encodeURIComponent(r.key)}`} className="flex items-center gap-3 min-w-0 group">
        <SymbolTile symbol={r.symbol} underlying={r.ticker} issuer={r.issuer} />
        <span className="min-w-0">
          <span className="block text-[14px] font-semibold text-fg truncate group-hover:underline">{r.name || r.ticker}</span>
          <span className="block text-[12px] text-muted truncate">
            {r.ticker}{r.symbol && r.symbol !== r.ticker ? ` · ${r.symbol}` : ''}
          </span>
          <span className="block text-[12px] text-muted truncate">{r.issuer} · {r.chain}</span>
        </span>
      </a>
      <span className="text-right shrink-0 max-w-[48%]">
        <span className="block figure text-[14px] text-fg tabular-nums break-all">{fmtBalance(r.balance)} <span className="text-muted text-[12px]">{r.symbol}</span></span>
        {value
          ? <span className="block figure text-[12px] text-muted tabular-nums" title={r.price ? `Pool price $${r.price.price_usd}, measured ${fmtUtc(r.price.computed_at)} at block ${fmtCount(r.price.block)}` : undefined}>≈ {value}</span>
          : <span className="block text-[12px] text-muted" title={why || undefined}>no value</span>}
      </span>
    </li>
  );
}

/** What was read, under a list or in place of one. */
function Coverage({ data, rows, noun }) {
  const chains = data.chains || [];
  const read = chains.filter((c) => c.status === 'read');
  const failed = chains.filter((c) => c.status !== 'read');
  const readNames = read.map((c) => c.chain);
  let empty = null;
  if (!rows.length) {
    if (!read.length) empty = `No chain could be read just now, so nothing is known about this address's ${noun}.`;
    else if (!failed.length) empty = `None held on the ${read.length === 6 ? 'six' : fmtCount(read.length)} chains read (${listWords(readNames)}).`;
    else empty = `None held on the ${fmtCount(read.length)} chains read (${listWords(readNames)}).`;
  }
  const used = [...new Set(rows.map((r) => r.value_reason).filter(Boolean))];
  return (
    <div className="space-y-1.5">
      {empty && <p className="text-[13px] text-fg">{empty}</p>}
      {failed.map((c) => (
        <p key={c.chain_id} className="text-[12px] text-warn">
          {c.chain} could not be read ({c.reason || 'no reason given'}), so {noun} there are not shown. That is about the call, not the address.
        </p>
      ))}
      {used.map((code) => (
        <p key={code} className="text-[12px] text-muted">{data.reasons?.[code] || code}</p>
      ))}
      {rows.some((r) => r.value_usd != null) && (
        <p className="text-[12px] text-muted">Values: {data.price_basis}</p>
      )}
      {read.length > 0 && (
        <p className="text-[12px] text-muted">
          Read on chain {fmtUtc(data.as_of)}
          {data.cached_seconds ? `, from the server's cache (${fmtAge(data.cached_seconds)} old)` : ''}:{' '}
          {read.map((c) => `${c.chain} block ${fmtCount(c.block)}`).join(', ')}.
          {' '}Only versions Tnega lists are read; Solana versions and other tokens are not.
        </p>
      )}
    </div>
  );
}

function HoldingCard({ title, rows, total, read, noun }) {
  const data = read.status === 'ok' ? read.data : null;
  const right = data
    ? (
      <span className="flex items-center gap-2">
        {total?.value_usd != null && (
          <span className="figure text-[14px] text-fg tabular-nums" title={`${total.rows_priced} of ${total.rows} priced; ${data.totals?.basis || ''}`}>
            ≈ {fmtUsd(total.value_usd)}
          </span>
        )}
        <ReadAgain onClick={read.refresh} />
      </span>
    )
    : null;
  return (
    <Card aria-label={title}>
      <CardTitle right={right}>{title}</CardTitle>
      {!data && <ReadState read={read} what={noun} />}
      {data && (
        <>
          {rows.length > 0 && (
            <ul className="divide-y divide-line -mt-2 mb-2">
              {rows.map((r) => <Row key={r.key} r={r} reasons={data.reasons} />)}
            </ul>
          )}
          <Coverage data={data} rows={rows} noun={noun} />
        </>
      )}
    </Card>
  );
}

function VaultsCard() {
  const v = useTe('/api/vaults?limit=1', { headersTimeoutMs: VAULT_LIST_HEADERS_MS });
  const plats = v.data?.platforms || [];
  const listed = plats.filter((p) => p.status === 'listed' && p.listed > 0);
  const none = plats.filter((p) => p.status !== 'listed' || !p.listed);
  const solana = listed.filter((p) => p.group === 'nonevm');
  const evm = listed.filter((p) => p.group === 'evm');
  const solanaCount = solana.reduce((n, p) => n + p.listed, 0);
  return (
    <Card aria-label="Vaults">
      <CardTitle right={<a href="/vaults" className="text-[12px] font-semibold text-fg hover:underline">All vaults</a>}>Vaults</CardTitle>
      {v.loading && !v.data && (
        <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
          <Loader2 size={15} className="animate-spin shrink-0" aria-hidden="true" /> Reading the vaults Tnega lists.
        </p>
      )}
      {v.error && <p className="text-[13px] text-fg" role="alert">{readErrorText(v.error, 'the vault list', v.errorBody)}</p>}
      {v.data && (
        <div className="space-y-2">
          {solana.length > 0 && (
            <p className="text-[13px] text-fg">
              Not checked for this address. The {fmtCount(solanaCount)} vault{solanaCount === 1 ? '' : 's'} Tnega lists on Solana
              {' '}({listWords(solana.map((p) => `${p.platform} ${fmtCount(p.listed)}`))}) are held through a Solana address,
              and this dashboard is connected to an EVM address, so it cannot tell whether you hold any of them.
            </p>
          )}
          {evm.length > 0 && (
            <p className="text-[13px] text-fg">
              Not read yet: the vaults Tnega lists on {listWords(evm.map((p) => `${p.chain} (${p.platform})`))} are not read for this address on this page.
            </p>
          )}
          {!listed.length && <p className="text-[13px] text-fg">Tnega lists no vault right now, so there is nothing to check.</p>}
          {none.length > 0 && (
            <p className="text-[12px] text-muted">
              {listWords(none.map((p) => p.platform))}: no vault there qualifies for Tnega&apos;s list, so nothing there was checked either. The reasons are on the Vaults page.
            </p>
          )}
          {v.data.as_of && <p className="text-[12px] text-muted">Vault list as read {v.data.as_of}.</p>}
        </div>
      )}
    </Card>
  );
}

export default function EquityHoldings({ read, layout = 'web' }) {
  const data = read.status === 'ok' ? read.data : null;
  const stocks = data?.stocks || [];
  const etfs = data?.etfs || [];
  const untyped = data?.untyped || [];
  return (
    <div className={layout === 'mobile' ? 'space-y-3' : 'space-y-6'}>
      <HoldingCard title="Stocks" rows={stocks} total={data?.totals?.stocks} read={read} noun="tokenized stocks" />
      <HoldingCard title="ETFs" rows={etfs} total={data?.totals?.etfs} read={read} noun="tokenized ETFs" />
      {untyped.length > 0 && (
        <HoldingCard title="Other listed tokens" rows={untyped} total={null} read={read} noun="listed tokens with no stock or ETF type recorded" />
      )}
      <VaultsCard />
    </div>
  );
}
