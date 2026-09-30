// dashboard/cards.jsx
//
// The Dashboard's cards, laid out like getquin's dashboard (owner's
// reference, 05-dashboard-getquin-style and getquin/dashboard-01 to 03):
// Portfolio and Positions on the left, Allocation, Dividends and Performance
// on the right, then one card per asset class (Stocks, ETFs, Vaults, Tokens).
// Short on the face: a title, the figure, at most one muted line. Sources,
// times, method and every "why not" sit behind the (i) beside a title and in
// each figure's hover text.
//
// All figures come from one read, POST /api/wallet/holdings
// (wallet/useEquityHoldings.js), summarised by dashboard/portfolio.js. Each
// asset class has one colour (tailwind cls-*, src/index.css), the same in its
// card and its allocation slice. What Tnega does not measure (a value
// history, buy-in and P/L, dividends, performance) is said in one line and the
// card stays in the layout.

import React, { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Info, Loader2, RefreshCw, Layers, LineChart as LineIcon, Coins, Landmark, CandlestickChart, Boxes } from 'lucide-react';
import { SymbolTile, fmtUsd } from '../ui/primitives';
import { useTe, VAULT_LIST_HEADERS_MS } from '../te/api';
import { readErrorText } from '../te/ReadError';
import { fmtAge, fmtCount, fmtUtc } from '../wallet/format';
import { CLASSES, listWords } from './portfolio';

const HIDDEN = '••••';

// ── small pieces ───────────────────────────────────────────────────────────

/** An (i) that opens on hover, focus or tap, and closes on Escape or a tap
 *  elsewhere. Everything a card explains lives in one of these. */
export function Tip({ label = 'Details', children, align = 'right', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('touchstart', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('touchstart', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <span ref={ref} className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-expanded={open} aria-label={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="w-5 h-5 rounded-full inline-flex items-center justify-center text-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-cls-stocks">
        <Info size={14} aria-hidden="true" />
      </button>
      {open && (
        <span role="tooltip"
          className={`absolute z-30 top-full mt-1.5 w-72 max-w-[calc(100vw-40px)] p-3 rounded-lg border border-line bg-surface shadow-xl text-[12px] leading-relaxed text-muted font-normal normal-case tracking-normal text-left space-y-1.5 ${align === 'left' ? 'left-0' : 'right-0'}`}>
          {children}
        </span>
      )}
    </span>
  );
}

function Title({ children, tip, right = null, icon: Icon = null, cls = null }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="min-w-0 flex items-center gap-2 text-[15px] font-semibold text-fg">
        {Icon && (
          <span className={`w-7 h-7 rounded-lg inline-flex items-center justify-center shrink-0 ${cls ? `${cls.fill} ${cls.ink}` : 'bg-inset text-fg'}`}>
            <Icon size={15} aria-hidden="true" />
          </span>
        )}
        <span className="truncate">{children}</span>
        {tip}
      </h3>
      {right}
    </div>
  );
}

/** A card; `cls` gives it its asset class's soft gradient and border. */
function Panel({ cls = null, className = '', children, ...rest }) {
  const tone = cls ? `bg-gradient-to-br ${cls.tint} to-transparent ${cls.ring}` : 'border-line';
  return (
    <section className={`relative bg-surface border rounded-xl p-4 md:p-5 ${tone} ${className}`} {...rest}>
      {children}
    </section>
  );
}

/** The brand's gradient, as a thin band at the top of a card. */
function BrandBand() {
  return (
    <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 rounded-t-xl"
      style={{ background: 'linear-gradient(90deg, rgb(var(--cls-vaults)), rgb(var(--cls-other)), rgb(var(--cls-tokens)), rgb(var(--cls-etfs)), rgb(var(--cls-stocks)))' }} />
  );
}

/** A dollar figure, large and bold with small cents; hidden shows dots. */
function Money({ value, hidden, className = 'text-[36px]' }) {
  if (hidden) return <span className={`font-semibold tabular-nums leading-none ${className}`}>{HIDDEN}</span>;
  if (value == null || !Number.isFinite(value)) return null;
  // Rounded to the cent first, as fmtUsd does: $1.999 is $2.00.
  const inCents = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(inCents / 100);
  const cents = inCents % 100;
  return (
    <span className={`font-semibold tabular-nums leading-none tracking-[-0.02em] ${className}`}>
      ${whole.toLocaleString('en-US')}<span className="text-[0.5em] font-medium text-muted">.{String(cents).padStart(2, '0')}</span>
    </span>
  );
}

const usd = (v, hidden) => (hidden ? HIDDEN : fmtUsd(v));

/** A balance from the chain (an exact decimal string), shortened for the
 *  face to six significant digits; the exact figure is in the hover. */
export function shortBalance(s) {
  if (typeof s !== 'string' || !/^\d+(\.\d+)?$/.test(s)) return s ?? '';
  const n = Number(s);
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toLocaleString('en-US', { maximumSignificantDigits: 4 });
}

/** Where a row's value comes from, in one line for its hover. */
export function valueSource(r) {
  const p = r.price;
  if (!p) return null;
  if (p.source === 'tnega_cost_engine') {
    return `Pool mid $${p.price_usd} measured by Tnega's cost engine ${fmtUtc(p.computed_at)} at block ${fmtCount(p.block)}.`;
  }
  if (p.source === 'stablecoin_at_one_dollar') return 'Counted at $1: an assumption that the stablecoin holds its peg.';
  if (p.source === 'onchain_twap') {
    const pool = String(p.pool_label || '').replace(/\s*\([^()]*\.py\)/g, '');
    return `${r.symbol} at $${Number(p.price_usd).toFixed(2)}, a 30-minute on-chain average from ${pool}, block ${fmtCount(p.block)}, read ${fmtUtc(p.read_at)}.`;
  }
  return null;
}

function readLine(data) {
  if (!data) return null;
  return `Read on chain ${fmtUtc(data.as_of)}${data.cached_seconds ? ` (server cache, ${fmtAge(data.cached_seconds)} old)` : ''}.`;
}

function IconButton({ onClick, label, disabled = false, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="w-8 h-8 rounded-lg border border-line inline-flex items-center justify-center text-muted hover:text-fg hover:bg-inset disabled:opacity-40">
      {children}
    </button>
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

/** One short line for a read that is not answered yet or could not be. */
export function ReadLine({ read }) {
  const left = useCountdown(read.status === 'busy' ? read.retryAt : null);
  if (read.status === 'loading' || read.status === 'idle') {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted" role="status">
        <Loader2 size={14} className="animate-spin shrink-0" aria-hidden="true" /> Reading six chains…
      </p>
    );
  }
  if (read.status === 'busy' || read.status === 'error') {
    return (
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-fg" role={read.status === 'error' ? 'alert' : 'status'}>
        {read.status === 'busy' ? 'Server busy' : 'Not read'}
        <Tip label="Why">{read.detail}</Tip>
        <button type="button" onClick={read.refresh} disabled={left > 0}
          className="text-[12px] font-semibold text-cls-stocks hover:underline disabled:opacity-50 disabled:no-underline">
          {left > 0 ? `Retry in ${left}s` : 'Retry'}
        </button>
      </p>
    );
  }
  return null;
}

/** The chains not (fully) read, and why, for an (i). */
function GapTip({ d }) {
  return (
    <Tip label="Which chains">
      {d.gaps.failed.map((c) => <span key={c.chain_id} className="block">{c.chain}: {c.reason || 'no reason given'}. Nothing there is shown.</span>)}
      {d.gaps.unanswered.map((c) => <span key={c.chain_id} className="block">{c.chain}: {c.note}</span>)}
      <span className="block">About this call, not the address. Totals leave out what was not read.</span>
    </Tip>
  );
}

/** No chain answered: nothing is known about the address. */
function NotReadLine({ d, onRetry, children = 'Not read' }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-warn" role="status">
      {children} <GapTip d={d} />
      {onRetry && <button type="button" onClick={onRetry} className="font-semibold text-cls-stocks hover:underline">Retry</button>}
    </p>
  );
}

/** The word in place of a total when there is none. Never "nothing held"
 *  unless every chain answered. */
function emptyWord(d, rows) {
  if (d.unavailable) return 'Not read';
  if (rows) return 'Not valued';
  return d.partial ? 'None found on the chains read' : 'Nothing held';
}

/** "Base not read · Retry", when any chain was not (fully) read. */
export function GapLine({ d, onRetry }) {
  if (!d?.partial) return null;
  const failed = d.gaps.failed.map((c) => c.chain);
  const partly = d.gaps.unanswered.map((c) => c.chain);
  const words = [failed.length ? `${listWords(failed)} not read` : null, partly.length ? `${listWords(partly)} partly read` : null]
    .filter(Boolean).join(' · ');
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-warn" role="status">
      {words || 'Partly read'}
      <GapTip d={d} />
      {onRetry && <button type="button" onClick={onRetry} className="font-semibold text-cls-stocks hover:underline">Retry</button>}
    </p>
  );
}

// ── Portfolio ──────────────────────────────────────────────────────────────

export function PortfolioCard({ d, data, read, hidden, onToggleHidden }) {
  const all = d?.overall;
  const bar = d?.slices || [];
  const sum = bar.reduce((a, s) => a + s.usd, 0);
  return (
    <Panel className="overflow-hidden pt-5">
      <BrandBand />
      <Title
        tip={(
          <Tip label="About this total">
            <span className="block">The sum of the positions below that carry a value. Each value&apos;s source and time is on its hover.</span>
            {data && <span className="block">Rows without a value are not in it. {readLine(data)}</span>}
            <span className="block">Vaults are not checked for an EVM address and are not counted.</span>
          </Tip>
        )}
        right={(
          <span className="flex items-center gap-2">
            <IconButton onClick={onToggleHidden} label={hidden ? 'Show amounts' : 'Hide amounts'}>
              {hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            </IconButton>
            {read.status === 'ok' && (
              <IconButton onClick={read.refresh} label="Read again"><RefreshCw size={14} aria-hidden="true" /></IconButton>
            )}
          </span>
        )}
      >
        Portfolio
      </Title>
      {!data && <ReadLine read={read} />}
      {data && (
        <>
          <div title={all.usd != null && !hidden ? `Sum of ${all.priced} valued position${all.priced === 1 ? '' : 's'}. ${readLine(data)}` : undefined}>
            {all.usd != null
              ? <Money value={all.usd} hidden={hidden} className="text-[40px] md:text-[48px] text-fg" />
              : <span className="text-[20px] font-semibold text-fg">{emptyWord(d, all.rows)}</span>}
          </div>
          {d.unavailable
            ? <div className="mt-2"><NotReadLine d={d} onRetry={read.refresh}>No chain answered</NotReadLine></div>
            : (
              <p className="mt-2 text-[13px] text-muted">
                {all.rows === 0
                  ? (d.partial ? 'Some chains not read' : 'No listed stock, ETF or named token')
                  : all.priced === all.rows
                    ? `${all.rows} position${all.rows === 1 ? '' : 's'}, all valued`
                    : `${all.priced} of ${all.rows} positions valued`}
              </p>
            )}
          {sum > 0 && (
            <>
              <div className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-inset" aria-hidden="true">
                {bar.map((s) => (
                  <span key={s.id} className={`${CLASSES[s.id].fill} h-full`} style={{ width: `${(s.usd / sum) * 100}%` }} />
                ))}
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
                {bar.map((s) => (
                  <li key={s.id} className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${CLASSES[s.id].fill}`} aria-hidden="true" />
                    <span className="text-muted">{s.label}</span>
                    <span className="font-semibold tabular-nums text-fg">{usd(s.usd, hidden)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
              <LineIcon size={14} aria-hidden="true" /> History not measured yet
              <Tip label="Why no chart" align="left">
                Tnega keeps no stored price history for these positions, so there is no chart and no change over a day, week or year.
              </Tip>
            </span>
            {!d.unavailable && <GapLine d={d} onRetry={read.refresh} />}
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Allocation ─────────────────────────────────────────────────────────────

function Ring({ slices, size = 188, children }) {
  const total = slices.reduce((a, s) => a + s.usd, 0);
  const r = 40, C = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 1.6 : 0;
  let acc = 0;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="14" className="stroke-inset" />
        {total > 0 && slices.map((s) => {
          const frac = s.usd / total;
          const seg = Math.max(0.5, frac * C - gap);
          const el = (
            <circle key={s.id} cx="50" cy="50" r={r} fill="none" strokeWidth="14" stroke="currentColor"
              className={CLASSES[s.id].text} strokeDasharray={`${seg} ${C - seg}`} strokeDashoffset={-acc * C} />
          );
          acc += frac;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">{children}</div>
    </div>
  );
}

export function AllocationCard({ d, data, read, hidden }) {
  const slices = d?.slices || [];
  const sum = slices.reduce((a, s) => a + s.usd, 0);
  const legend = ['stocks', 'etfs', 'vaults', 'tokens', ...(d?.rows.untyped.length ? ['untyped'] : [])];
  const status = (k) => {
    if (k === 'vaults') return 'not checked';
    if (d.unavailable) return 'not read';
    const t = d.totals[k];
    if (!t.rows) return d.partial ? 'none on chains read' : 'none';
    if (!t.priced) return 'not valued';
    const pct = `${d.shares[k] ?? 0}%`;
    return t.priced < t.rows ? `${pct} · ${t.priced} of ${t.rows}` : pct;
  };
  return (
    <Panel>
      <Title tip={(
        <Tip label="About the allocation">
          <span className="block">Each class&apos;s share of the valued total. Only positions with a value count.</span>
          <span className="block">Vaults: the vaults Tnega lists are on Solana; an EVM address is not checked for them, so they are not counted.</span>
          <span className="block">Tokens: each chain&apos;s own coin at an on-chain 30-minute average, and stablecoins counted at $1 (an assumption about the peg).</span>
        </Tip>
      )}>Allocation</Title>
      {!data && <ReadLine read={read} />}
      {data && (
        <>
          <Ring slices={slices}>
            <span className="text-[11px] uppercase tracking-wider text-muted">Total</span>
            {sum > 0
              ? <Money value={sum} hidden={hidden} className="text-[24px] text-fg mt-1" />
              : <span className="text-[13px] text-muted mt-1">{d.unavailable ? 'Not read' : 'Nothing valued'}</span>}
          </Ring>
          {d.unavailable && <div className="mt-3 flex justify-center"><NotReadLine d={d} onRetry={read.refresh}>No chain answered</NotReadLine></div>}
          <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
            {legend.map((k) => (
              <li key={k} className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${CLASSES[k].fill}`} aria-hidden="true" />
                <span className="text-fg truncate">{CLASSES[k].label}</span>
                <span className="ml-auto text-muted tabular-nums whitespace-nowrap">{status(k)}</span>
              </li>
            ))}
          </ul>
          {d.overall.priced < d.overall.rows && (
            <p className="mt-3 text-[12px] text-muted">{d.overall.priced} of {d.overall.rows} positions valued</p>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Positions ──────────────────────────────────────────────────────────────

function rowLink(r) {
  return r.type === 'token' ? null : `/stocks/${encodeURIComponent(r.ticker || '')}?v=${encodeURIComponent(r.key)}`;
}

function NoValue({ r, reasons }) {
  const why = r.value_reason ? (reasons?.[r.value_reason] || r.value_reason) : null;
  return <span className="text-[12px] text-muted" title={why || undefined}>no value</span>;
}

export function PositionsCard({ d, data, read, hidden, compact = false }) {
  const rows = d?.positions || [];
  const buyIn = 'Buy-in not read yet: Tnega does not read this wallet\'s purchase transactions, so there is no buy-in or P/L.';
  return (
    <Panel className="px-0 md:px-0 pb-2">
      <div className="px-4 md:px-5">
        <Title tip={(
          <Tip label="About positions">
            <span className="block">Every listed stock and ETF version, each chain&apos;s own coin and the named stablecoins, read on Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM. Other tokens and Solana are not read.</span>
            <span className="block">{buyIn}</span>
            {data && <span className="block">{readLine(data)}</span>}
          </Tip>
        )}>Positions</Title>
      </div>
      {!data && <div className="px-4 md:px-5 pb-3"><ReadLine read={read} /></div>}
      {data && rows.length === 0 && (
        <div className="px-4 md:px-5 pb-3 text-[13px] text-muted">
          {d.unavailable ? <NotReadLine d={d} onRetry={read.refresh} /> : d.partial
            ? <span className="inline-flex items-center gap-1.5">None found on the chains read <GapTip d={d} /></span>
            : 'No positions yet'}
        </div>
      )}
      {data && rows.length > 0 && (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-muted text-left text-[11px] uppercase tracking-wider">
              <th className="font-medium pl-4 md:pl-5 pb-2">Title</th>
              {!compact && <th className="font-medium pb-2 pl-4 text-right whitespace-nowrap" title={buyIn}>Buy-in</th>}
              <th className="font-medium pb-2 pl-6 pr-4 md:pr-0 text-right whitespace-nowrap">Position</th>
              {!compact && <th className="font-medium pl-6 pr-4 md:pr-5 pb-2 text-right whitespace-nowrap" title={buyIn}>P/L</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cls = CLASSES[r.type === 'token' ? 'tokens' : r.type === 'etf' ? 'etfs' : r.type === 'stock' ? 'stocks' : 'untyped'];
              const href = rowLink(r);
              const Name = href ? 'a' : 'span';
              return (
                <tr key={r.key} className="border-t border-line">
                  <td className="pl-4 md:pl-5 py-3 max-w-0 w-full">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="relative shrink-0">
                        <SymbolTile symbol={r.symbol} underlying={r.ticker} issuer={r.issuer} />
                        <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface ${cls.fill}`} title={cls.label} aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <Name {...(href ? { href } : {})} className={`block font-semibold text-fg truncate ${href ? 'hover:underline' : ''}`}>
                          {r.type === 'token' ? r.symbol : (r.name || r.ticker)}
                        </Name>
                        <span className="block text-[12px] text-muted truncate">
                          {r.type === 'token' ? (r.kind === 'native' ? 'Gas coin' : r.name || 'Stablecoin') : r.symbol}
                          {' · '}{r.type === 'token' ? r.chain : `${r.issuer} · ${r.chain}`}
                        </span>
                      </span>
                    </div>
                  </td>
                  {!compact && <td className="py-3 pl-4 text-right text-muted whitespace-nowrap" title={buyIn}>—</td>}
                  <td className="py-3 pl-6 pr-4 md:pr-0 text-right whitespace-nowrap">
                    {Number.isFinite(r.value_usd)
                      ? <span className="block font-semibold tabular-nums text-fg" title={hidden ? undefined : valueSource(r) || undefined}>{usd(r.value_usd, hidden)}</span>
                      : <NoValue r={r} reasons={data.reasons} />}
                    <span className="block text-[12px] text-muted tabular-nums" title={hidden ? undefined : `${r.balance} ${r.symbol}, ${r.chain} block ${fmtCount(r.block)}`}>
                      {hidden ? HIDDEN : shortBalance(r.balance)} {r.symbol}
                    </span>
                  </td>
                  {!compact && <td className="pl-6 pr-4 md:pr-5 py-3 text-right text-muted" title={buyIn}>—</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

// ── Not measured yet ──────────────────────────────────────────────────────

function NotMeasured({ title, icon, children }) {
  return (
    <Panel>
      <Title icon={icon} tip={<Tip label={`About ${title.toLowerCase()}`}>{children}</Tip>}>{title}</Title>
      <p className="text-[13px] text-muted">Not measured yet</p>
    </Panel>
  );
}

export function DividendsCard() {
  return (
    <NotMeasured title="Dividends" icon={Coins}>
      Tokenized stocks pass on dividends as a change in each token&apos;s multiplier or as extra tokens. Tnega does not read those changes for a wallet yet, so nothing received is shown.
    </NotMeasured>
  );
}

export function PerformanceCard() {
  return (
    <NotMeasured title="Performance" icon={LineIcon}>
      Returns by year, price gain and costs need this wallet&apos;s purchases and a price history. Tnega reads neither yet, so no return is shown.
    </NotMeasured>
  );
}

// ── the asset-class sections ───────────────────────────────────────────────

const CLASS_ICON = { stocks: CandlestickChart, etfs: Layers, vaults: Landmark, tokens: Coins, untyped: Boxes };

function ClassHead({ k, value, tip, sub }) {
  const cls = CLASSES[k];
  return (
    <>
      <Title icon={CLASS_ICON[k]} cls={cls} tip={tip}>{cls.label}</Title>
      <div className="flex items-baseline justify-between gap-3">
        {value}
        {sub}
      </div>
    </>
  );
}

/** Stocks, ETFs, Tokens or Other listed: the section total, "k of n
 *  valued" when not all are, and up to five rows. */
export function ClassCard({ k, d, data, read, hidden }) {
  const cls = CLASSES[k];
  const rows = d?.rows[k] || [];
  const t = d?.totals[k];
  const allRead = data && !d.partial;
  let empty = null;
  if (data && !rows.length) {
    if (data.status === 'unavailable') empty = 'Not read';
    else empty = allRead ? cls.empty : 'None found on the chains read';
  }
  const tip = (
    <Tip label={`About ${cls.label}`}>
      {k === 'tokens'
        ? <span className="block">Each chain&apos;s own coin, the stablecoins an order can be paid with (USDC; USDT and USDC on BNB Chain; USDG on Robinhood Chain), and USD1, U, USD₮0 and USDe. Other tokens are not read.</span>
        : <span className="block">The tokenized {k === 'etfs' ? 'ETFs' : k === 'stocks' ? 'stocks' : 'versions with no stock or ETF type recorded'} Tnega lists, read on six chains. Stock or ETF is the type in Tnega&apos;s universe file.</span>}
      {k === 'tokens'
        ? <span className="block">Values: stablecoins you pay with at $1 (an assumption about the peg); each chain&apos;s coin at a 30-minute on-chain average; USD1, U, USD₮0 and USDe are not valued.</span>
        : data?.price_basis && <span className="block">Values: {data.price_basis}</span>}
      {data && t && t.priced < t.rows && <span className="block">{t.priced} of {t.rows} valued; the total leaves out the rest.</span>}
      {data && <span className="block">{readLine(data)}</span>}
    </Tip>
  );
  const value = !data ? null : t.usd != null
    ? <span title={`Sum of ${t.priced} valued row${t.priced === 1 ? '' : 's'}`}><Money value={t.usd} hidden={hidden} className="text-[28px] text-fg" /></span>
    : <span className="text-[15px] font-semibold text-fg">{empty || 'Not valued'}</span>;
  const sub = data && t.rows > 0
    ? <span className="text-[12px] text-muted whitespace-nowrap">{t.priced < t.rows ? `${t.priced} of ${t.rows} valued` : `${t.rows} held`}</span>
    : null;
  return (
    <Panel cls={cls} aria-label={cls.label}>
      <ClassHead k={k} tip={tip} value={value} sub={sub} />
      {!data && <div className="mt-1"><ReadLine read={read} /></div>}
      {data && rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.slice(0, 5).map((r) => {
            const href = rowLink(r);
            const Tag = href ? 'a' : 'div';
            return (
              <li key={r.key}>
                <Tag {...(href ? { href } : {})} className="flex items-center gap-3 rounded-lg bg-surface/70 border border-line px-3 py-2 hover:bg-inset min-w-0">
                  <SymbolTile symbol={r.symbol} underlying={r.ticker} issuer={r.issuer} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-fg truncate">{r.type === 'token' ? r.symbol : r.name || r.ticker}</span>
                    <span className="block text-[11px] text-muted truncate">{r.type === 'token' ? r.chain : `${r.symbol} · ${r.issuer} · ${r.chain}`}</span>
                  </span>
                  <span className="text-right shrink-0">
                    {Number.isFinite(r.value_usd)
                      ? <span className="block text-[13px] font-semibold tabular-nums text-fg" title={hidden ? undefined : valueSource(r) || undefined}>{usd(r.value_usd, hidden)}</span>
                      : <NoValue r={r} reasons={data.reasons} />}
                    <span className="block text-[11px] text-muted tabular-nums" title={hidden ? undefined : `${r.balance} ${r.symbol}, block ${fmtCount(r.block)}`}>{hidden ? HIDDEN : shortBalance(r.balance)}</span>
                  </span>
                </Tag>
              </li>
            );
          })}
          {rows.length > 5 && <li className="text-[12px] text-muted px-1">+{rows.length - 5} more in Positions</li>}
        </ul>
      )}
      {data && d.partial && !d.unavailable && (
        <div className="mt-3"><GapLine d={d} /></div>
      )}
    </Panel>
  );
}

/** Vaults: not checked for an EVM address, and never counted; the vault
 *  list's own platform counts (GET /api/vaults) are in the (i). */
export function VaultsCard() {
  const v = useTe('/api/vaults?limit=1', { headersTimeoutMs: VAULT_LIST_HEADERS_MS });
  const plats = v.data?.platforms || [];
  const listed = plats.filter((p) => p.status === 'listed' && p.listed > 0);
  const solana = listed.filter((p) => p.group === 'nonevm');
  const evm = listed.filter((p) => p.group === 'evm');
  const count = solana.reduce((n, p) => n + p.listed, 0);
  const tip = (
    <Tip label="About vaults">
      {v.error && <span className="block">{readErrorText(v.error, 'the vault list', v.errorBody)}</span>}
      {solana.length > 0 && (
        <span className="block">The vaults Tnega lists on Solana ({listWords(solana.map((p) => `${p.platform} ${fmtCount(p.listed)}`))}) are held through a Solana address. This dashboard is connected to an EVM address, so it cannot tell whether you hold any.</span>
      )}
      {evm.length > 0 && <span className="block">Vaults listed on {listWords(evm.map((p) => `${p.chain} (${p.platform})`))} are not read for this address yet.</span>}
      {v.data && !listed.length && <span className="block">Tnega lists no vault right now.</span>}
      <span className="block">Not counted in the total or the allocation.</span>
      {v.data?.as_of && <span className="block">Vault list as read {v.data.as_of}.</span>}
    </Tip>
  );
  return (
    <Panel cls={CLASSES.vaults} aria-label="Vaults">
      <ClassHead k="vaults" tip={tip}
        value={<span className="text-[15px] font-semibold text-fg">Not checked</span>}
        sub={<a href="/vaults" className="text-[12px] font-semibold text-fg hover:underline whitespace-nowrap">Browse vaults</a>} />
      <p className="mt-2 text-[12px] text-muted">
        {v.loading && !v.data ? 'Reading the vault list…' : v.data && count ? `${fmtCount(count)} listed on Solana · needs a Solana address` : 'Needs a Solana address'}
      </p>
    </Panel>
  );
}
