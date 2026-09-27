// home/cards.jsx
//
// The real UI cards: the home page's feature sections show them, and the
// product pages reuse them. Each takes the parsed answer of one endpoint
// (te/api.js documents the shapes) and returns null when the field it needs
// is missing, so no card ever draws an empty frame or a zero it did not
// measure. Both apps render these; `compact` tightens them for a phone.

import React, { useMemo, useState } from 'react';
import { Check, Copy, Pause, Snowflake, Flame, ArrowUpCircle, Globe, Crown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Card, CardTitle, DevTag, GroupChip, SymbolTile, Sparkline, Pills,
  fmtUsd, fmtUsd0, fmtBps, fmtPct, BigMoney,
} from '../ui/primitives';
import { hasRows } from '../te/api';
import ReadError from '../te/ReadError';
import { capText } from '../etfs/BasketBreakdown';
import {
  headline, tokensText, bpsText, shareRatioText, depthText, blockText, refGap,
  stateText, measuredLine, sentence, tiedWithBest, tieLine, priceText4,
} from '../te/costText';

/* 02 · One stock, many tokens. GET /api/te/underlying/{T}?size=1000
 *
 * Every version renders, in the engine's order (filled first, then by all-in
 * price per share). A filled version shows its all-in price per share as the
 * headline, tokens per $1,000 and cost_bps (labelled) under it, then its
 * share ratio, the pool's depth and the block. The best (data.best) wears a
 * crown; a filled version whose share ratio is not read is shown at its
 * price per token, "not ranked", with the reason. Every other state is named
 * apart (te/costText.js stateText) with the engine's reason: a partial fill,
 * a failed quote, a pool too thin, not a venue, not searched, no pool, held.
 * pricedCount() is how many versions have a cost at this size, which is
 * what a headline may count ("k different bills"). */
export function versionRows(data) {
  if (!data || !hasRows(data.versions)) return [];
  return data.versions;
}

export const pricedCount = (data) => versionRows(data).filter((v) => v.state === 'filled').length;

function VersionFigures({ v, best, tied }) {
  const h = headline(v);
  return (
    <div className="shrink-0 text-right">
      <div className="flex items-center justify-end gap-1 text-[15px] font-semibold tabular-nums text-fg">
        {best && <Crown size={13} className="text-pos" aria-hidden="true" />}
        {tied ? priceText4(v.allin_per_share) : h?.value}
      </div>
      <div className="text-[11px] text-muted">{h?.unit}</div>
      {best && <div className="text-[11px] text-pos">lowest per share{tied ? ', tied to the cent' : ''}</div>}
    </div>
  );
}

function VersionDetail({ v, size, best }) {
  if (v.state !== 'filled') {
    // The state is named on the row; the engine's reason, which can run to
    // a paragraph, opens under it.
    const st = stateText(v, size);
    return (
      <div className="mt-1 text-[12px] leading-snug">
        {st.reason ? (
          <details>
            <summary className="cursor-pointer font-semibold text-fg">{st.label}</summary>
            <p className="mt-1 text-muted break-words">{sentence(st.reason)}</p>
          </details>
        ) : <span className="font-semibold text-fg">{st.label}</span>}
      </div>
    );
  }
  const gap = refGap(v);
  const parts = [tokensText(v.tokens_per_1000), bpsText(v.cost_bps), shareRatioText(v), depthText(v.pool_usd), blockText(v.block)].filter(Boolean);
  return (
    <div className="mt-1 text-[12px] leading-snug text-muted">
      <span>{parts.join(' · ')}</span>
      {!v.comparable && <span className="block text-fg">Not ranked: {v.share_ratio_basis || 'share ratio not read'}, so its price per token is not set against other issuers.</span>}
      {best && <span className="sr-only"> Best at this size.</span>}
      {gap && <span className="block text-warn">{gap.text}{gap.basis ? ` (${gap.basis})` : ''}.</span>}
    </div>
  );
}

export function VersionsCard({ data, compact = false }) {
  const rows = versionRows(data);
  if (!rows.length) return null;
  const size = fmtUsd0(data.size);
  const bestKey = data.best?.key;
  const tiedList = tiedWithBest(rows, bestKey);
  const tied = new Set(tiedList.map((x) => x.key));
  const measured = measuredLine(data.computed_at, rows.map((v) => v.us_market_open));
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>{data.name || data.ticker}: what {size} buys</CardTitle>
      {tieLine(tiedList, data.size) && <p className="mb-2 text-[12px] text-fg">{tieLine(tiedList, data.size)}</p>}
      <ul className="divide-y divide-line">
        {rows.map((v) => (
          <li key={v.key} className="py-2.5">
            <div className="flex items-start gap-3">
              <SymbolTile symbol={v.symbol} underlying={data.ticker} issuer={v.issuer} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-fg truncate">{v.symbol}</span>
                  {!compact && <GroupChip group={v.group} />}
                </div>
                <div className="text-[12px] text-muted truncate">{v.issuer} · {v.chain}</div>
              </div>
              {v.state === 'filled' && <VersionFigures v={v} best={v.key === bestKey} tied={tied.has(v.key)} />}
            </div>
            <div className="pl-12"><VersionDetail v={v} size={data.size} best={v.key === bestKey} /></div>
          </li>
        ))}
      </ul>
      <p className="mt-3 pt-3 border-t border-line text-[11px] leading-snug text-muted">
        The crown marks the lowest all-in price per share among versions that fill {size} and whose share ratio is read.
        Cost in bps is fees and price impact against the pool&apos;s own price, so it does not rank versions.
        {data.lifi_fee_included ? ' Includes LI.FI’s 0.25% fee.' : ''}
        {measured ? ` ${measured}` : ''}
      </p>
    </Card>
  );
}

/* 03 · Every chain, grouped. GET /api/te/summary (chain_list) */
export function ChainsCard({ data }) {
  if (!data || !hasRows(data.chain_list)) return null;
  const groups = [['evm', 'EVM'], ['nonevm', 'Non-EVM']].map(([g, label]) => [label, data.chain_list.filter((c) => c.group === g)]).filter(([, cs]) => cs.length);
  if (!groups.length) return null;
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Chains we read</CardTitle>
      <div className="space-y-4">
        {groups.map(([label, cs]) => (
          <div key={label}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">{label}</div>
            <ul className="grid grid-cols-2 gap-2">
              {cs.map((c) => (
                <li key={c.name} className="flex items-center justify-between rounded bg-inset px-3 h-9 text-[13px]">
                  <span className="text-fg">{c.name}</span>
                  {Number.isFinite(c.tokens) && <span className="text-muted tabular-nums">{c.tokens} tokens</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* 04 · The cost at your size. GET /api/te/curve/{T}
 *
 * Per chain, the best ranked version at each stop (the engine's rule) and
 * its cost_bps, labelled as that. A chain with no figure at a stop says why,
 * in the engine's words (null_reason: a partial fill, a failed quote, or
 * filled only by versions whose share ratio is not read). Chains where no
 * version has a quote at all are listed under the bars, each state named
 * apart, with the reasons behind a disclosure. */
const CHAIN_STATE = {
  no_pool: 'no pool found', not_searched: 'not searched', too_thin: 'pool too thin',
  not_a_venue: 'not a venue', held: 'held back', failed: 'quote failed', mixed: 'no quotable pool',
};

// `size` and `onSize` make the slider follow a size chosen elsewhere on the
// page (the instrument page's size selector); without them it keeps its own.
export function CostCurveCard({ data, size: sizeProp = null, onSize = null }) {
  const stops = data?.stops;
  const [own, setOwn] = useState(() => (Array.isArray(stops) ? Math.max(0, stops.indexOf(10000)) : 0));
  if (!data || !hasRows(stops) || !(hasRows(data.chains) || hasRows(data.chains_without_pool))) return null;
  const held = sizeProp != null ? stops.indexOf(sizeProp) : -1;
  const i = held >= 0 ? held : own;
  const setI = (n) => { if (held >= 0 && onSize) onSize(stops[n]); else setOwn(n); };
  const at = Math.min(i, stops.length - 1);
  const size = stops[at];
  const rows = (data.chains || [])
    .map((c) => ({ ...c, v: c.bps?.[at], why: c.null_reason?.[at], depth: c.pool_usd?.[at], who: c.symbols?.[at] || c.symbol }))
    .sort((a, b) => (a.v == null) - (b.v == null) || (a.v ?? 0) - (b.v ?? 0));
  const max = Math.max(...rows.map((r) => r.v || 0), 1);
  const without = data.chains_without_pool || [];
  const measured = measuredLine(data.computed_at);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Order size</div>
          <div className="mt-1"><BigMoney value={size} className="text-[36px]" /></div>
        </div>
        <DevTag data={data} />
      </div>
      <input
        type="range" min={0} max={stops.length - 1} step={1} value={at}
        onChange={(e) => setI(Number(e.target.value))}
        aria-label="Order size" aria-valuetext={fmtUsd0(size)}
        className="w-full mt-4 accent-[rgb(var(--fg))]"
      />
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <li key={`${r.chain}-${r.chain_id}`} className="grid grid-cols-[110px_1fr_78px] items-center gap-x-3 text-[13px]">
            <span className="text-fg truncate">{r.chain}</span>
            {r.v == null
              ? <span className="text-muted text-[12px] col-span-2">{sentence(r.why) || 'No figure at this size'}</span>
              : (
                <>
                  <span className="h-2 rounded-full bg-inset overflow-hidden">
                    <span className="block h-full rounded-full bg-chart" style={{ width: `${(r.v / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-fg">{fmtBps(r.v)}</span>
                  <span className="col-start-2 col-span-2 text-[11px] text-muted truncate">{[r.who, depthText(r.depth)].filter(Boolean).join(' · ')}</span>
                </>
              )}
          </li>
        ))}
      </ul>
      {without.length > 0 && (
        <details className="mt-3 pt-3 border-t border-line text-[12px]">
          <summary className="cursor-pointer text-muted hover:text-fg">
            {without.map((c) => `${c.chain}: ${CHAIN_STATE[c.state] || c.state}`).join(' · ')}
          </summary>
          <ul className="mt-2 space-y-2 text-muted">
            {without.map((c) => (
              <li key={c.chain_id}>
                <span className="text-fg">{c.chain}</span> ({(c.symbols || []).join(', ')}): {(c.reasons || []).map(sentence).join('; ')}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-3 text-[11px] leading-snug text-muted">
        {data.ticker}: per chain, the best ranked version at this size, and its cost in bps (fees and price impact against the pool&apos;s own price). Simulated on the pools, not quoted.
        {data.lifi_fee_included ? ' Includes LI.FI’s 0.25% fee.' : ''}
        {measured ? ` ${measured}` : ''}
      </p>
    </Card>
  );
}

/* 06 · How a buy goes. No figures: the steps only. */
export function BuyStepsCard() {
  const steps = [
    ['Pick the version', 'Every token of the stock, with what each costs at your size.'],
    ['See the route', 'LI.FI finds the route in your browser; its fee is shown before you sign.'],
    ['Approve, then sign', 'An approval for the exact amount, then one signature for the swap. The tokens go straight to your wallet.'],
  ];
  return (
    <Card>
      <ol className="space-y-4">
        {steps.map(([h, p], n) => (
          <li key={h} className="flex gap-3">
            <span className="w-7 h-7 shrink-0 rounded-full border border-line-strong text-[12px] font-semibold flex items-center justify-center">{n + 1}</span>
            <div>
              <div className="text-[14px] font-semibold text-fg">{h}</div>
              <div className="text-[13px] text-muted">{p}</div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* 07 · A basket. GET /api/baskets/curated (one basket). The cost at the
 * list's size or the served reason there is none; the wallet prompts, with
 * approvals as "up to"; the cap as capText words it ("at least" and every
 * tied leg). */
export function BasketCard({ basket, source, onOpen }) {
  if (!basket || !hasRows(basket.legs)) return null;
  const COLORS = ['bg-chart', 'bg-chart-3', 'bg-chart-4', 'bg-chart-2', 'bg-chart-5'];
  return (
    <Card>
      <CardTitle right={<DevTag data={source} />}>{basket.name}</CardTitle>
      <div className="flex h-2 rounded-full overflow-hidden bg-inset mb-3" aria-hidden="true">
        {basket.legs.map((l, i) => <span key={l.ticker || l.symbol} className={COLORS[i % COLORS.length]} style={{ width: `${l.weight_bps / 100}%` }} />)}
      </div>
      <ul className="space-y-1.5 text-[13px]">
        {basket.legs.map((l, i) => (
          <li key={l.ticker || l.symbol} className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-sm ${COLORS[i % COLORS.length]}`} aria-hidden="true" />
            <SymbolTile size="sm" underlying={l.ticker} symbol={l.symbol} issuer={l.issuer} />
            <span className="text-fg flex-1">{l.ticker || l.symbol}{l.ticker && l.symbol && l.symbol !== l.ticker ? <span className="text-muted"> · {l.symbol}</span> : null}</span>
            <span className="tabular-nums text-muted">{(l.weight_bps / 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
      <dl className="mt-3 pt-3 border-t border-line grid grid-cols-2 gap-y-1 text-[12px]">
        {(() => {
          const size = source?.size || 1000;
          const bps = Number.isFinite(basket.cost_bps) ? basket.cost_bps : basket.cost_bps_1k;
          return Number.isFinite(bps)
            ? <><dt className="text-muted">Cost to buy {fmtUsd0(size)}</dt><dd className="text-right tabular-nums text-fg">{fmtBps(bps)}</dd></>
            : basket.cost_reason ? <><dt className="text-muted">Cost to buy {fmtUsd0(size)}</dt><dd className="text-right text-fg">{sentence(basket.cost_reason)}</dd></> : null;
        })()}
        {basket.prompts && Number.isFinite(basket.prompts.swaps) && (<><dt className="text-muted">Signatures</dt><dd className="text-right tabular-nums text-fg">{basket.prompts.swaps} swaps{basket.prompts.approvals_up_to ? `, up to ${basket.prompts.approvals_up_to} approvals` : ''}{Number.isFinite(basket.prompts.chain_switches) ? `; ${basket.prompts.chain_switches} chain switch${basket.prompts.chain_switches === 1 ? '' : 'es'}` : ''}</dd></>)}
        {capText(basket) && (<><dt className="text-muted">Largest size under 1% cost</dt><dd className="text-right tabular-nums text-fg">{capText(basket)}</dd></>)}
      </dl>
      <p className="mt-3 text-[11px] text-muted">{source?.note || 'A fixed example basket; not a recommendation.'}</p>
      {onOpen && (
        <button type="button" onClick={onOpen} className="mt-2 text-[12px] font-semibold text-accent hover:underline">Open this basket</button>
      )}
    </Card>
  );
}

/* 08 · Vault due diligence. GET /api/vaults?limit=4
 * The five checks are the fields every vault page carries, named as fields:
 * a tick would claim a vault passed them. The chips name the platforms and
 * assets read, once each. */
const CHECKS = ['Stablecoin deposit, and what it is lent against', 'Audits and auditors, linked', 'Upgrade authority, read on chain', 'Timelock on admin changes', 'What the manager can move'];
export function VaultChecksCard({ data }) {
  if (!data || !hasRows(data.vaults)) return null;
  const chips = [...new Set(data.vaults.map((v) => `${v.platform} · ${v.token_symbol || v.tvl_symbol || ''}`))].slice(0, 6);
  // The backend's own list of checks when it serves one (T6 `checks`).
  const checks = Array.isArray(data.checks) && data.checks.length ? data.checks : CHECKS;
  return (
    <Card>
      <CardTitle right={<DevTag data={data} />}>Every vault page shows</CardTitle>
      <ul className="divide-y divide-line text-[13px]">
        {checks.map((c) => (
          <li key={c} className="py-2 text-fg">{c}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span key={c} className="h-7 px-2.5 rounded border border-line-strong text-[12px] text-fg inline-flex items-center">{c}</span>
        ))}
      </div>
      {(data.deposits_note || data.notice) && <p className="mt-3 text-[11px] text-muted">{data.deposits_note || data.notice}</p>}
    </Card>
  );
}

/** The issuer's own words on who may hold a token, always with the link to
 *  where they are written and the date they were read. Without both, the
 *  words are not shown. */
export function Eligibility({ e }) {
  if (!e || !e.text || !e.url || !e.read_on) return <span className="text-muted">not read</span>;
  return (
    <span>
      {e.text}{' '}
      <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-muted hover:text-fg">issuer&apos;s terms</a>
      <span className="block text-[11px] text-muted">read on {e.read_on}</span>
    </span>
  );
}

/* 09 · Issuer controls. GET /api/te/controls?by=issuer */
export function ControlsCard({ data, compact = false }) {
  if (!data || !hasRows(data.rows)) return null;
  const COLS = [['pause', 'Pause', Pause], ['freeze', 'Freeze', Snowflake], ['burn', 'Burn or seize', Flame], ['upgrade', 'Upgrade', ArrowUpCircle]];
  const rows = compact ? data.rows.slice(0, 3) : data.rows;
  return (
    <Card className="overflow-x-auto">
      <CardTitle right={<DevTag data={data} />}>Who holds each power</CardTitle>
      <table className="w-full text-[12px] min-w-[520px]">
        <thead>
          <tr className="text-muted text-left">
            <th className="font-medium pb-2 pr-3">Issuer</th>
            {COLS.map(([k, label, Icon]) => (
              <th key={k} className="font-medium pb-2 pr-3"><span className="inline-flex items-center gap-1"><Icon size={12} aria-hidden="true" />{label}</span></th>
            ))}
            <th className="font-medium pb-2"><span className="inline-flex items-center gap-1"><Globe size={12} aria-hidden="true" />Who may hold</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.programme}>
              <td className="py-2 pr-3 text-fg font-semibold">{r.issuer}<div className="font-normal text-muted">{(r.chains || []).join(', ')}</div></td>
              {COLS.map(([k]) => <td key={k} className="py-2 pr-3 text-fg">{r[k]?.text || <span className="text-muted">not established</span>}</td>)}
              <td className="py-2 text-fg"><Eligibility e={r.who_may_hold} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* 13 · Use with AI. The MCP endpoint and the install, which are real today. */
const MCP_URL = 'https://agents-marketplace-q3k4.onrender.com/mcp';
export function AiCard() {
  const [copied, setCopied] = useState(false);
  const cmd = 'npx tnega-mcp';
  const copy = async () => {
    try { await navigator.clipboard.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* not fatal */ }
  };
  return (
    <Card>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">MCP server</div>
      <div className="mt-1 font-mono text-[13px] text-fg break-all">{MCP_URL}</div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">One command</div>
      <div className="mt-1 flex items-center justify-between gap-2 rounded bg-inset px-3 h-10">
        <code className="font-mono text-[13px] text-fg">{cmd}</code>
        <button type="button" onClick={copy} aria-label="Copy the command" className="text-muted hover:text-fg">
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <p className="mt-3 text-[12px] text-muted">No key, no account. It reads; it never signs.</p>
    </Card>
  );
}

/* Live lists · GET /api/te/list. One table for stocks and for ETFs.
 *
 * Takes the whole read state from useTe ({ data, error, loading, stale }):
 *   loading, nothing yet    renders nothing (no frame flashes in);
 *   the first read failed   renders nothing;
 *   a later read failed     the card, titled, with "Couldn't read the list";
 *   the answer has no rows  the card and its filter stay, with the engine's
 *                           group note (or "No EVM version listed"), so
 *                           the visitor can switch back;
 *   a filter changed        the previous rows stay, dimmed and labelled
 *                           "Updating", until the new answer replaces them.
 *
 * Each row is the underlying's best version at the list's size: its all-in
 * price per share as the headline, tokens per $1,000 under it, then the
 * cost to buy the size in dollars and in bps (labelled). A price the engine
 * flags as far from the underlying's reference says so on the row.
 * Paging follows rows_total and next_offset: `onOffset` draws Previous and
 * Next (the Stocks page); without it the count reads "6 of 69" beside
 * See all (the home). The footer carries the order and why (sort_reason),
 * the underlyings not ranked and why, those with no version that fills,
 * the 7-day column's absence and why (spark_reason), and when it was
 * measured. */
function emptyLine(data, group) {
  if (data?.group_note) return `${sentence(data.group_note)}.`;
  if (group === 'nonevm') return 'No non-EVM version listed.';
  if (group === 'evm') return 'No EVM version listed.';
  return 'Nothing listed.';
}

const NOUN = { stock: ['stock', 'stocks'], etf: ['ETF', 'ETFs'] };

/* WHAT THE COUNTS COUNT, beside the list (backend core/te/cost_views.py
 * list_view). The list document holds one row per underlying with at
 * least one EVM version the cost engine reads, with a pool or without one
 * (its no_pool and not_searched versions have documents too, so "at least
 * one EVM pool" would overstate it); for the list's type and
 * group each falls in exactly one of three served counts, each counted per
 * group: rows_total (a version in the group fills the size and is ranked),
 * rows_not_ranked (one fills, but none has a read share ratio, so none is
 * ranked) and rows_without_filled_version (none fills). None of them is
 * the universe: that is summary.underlyings, every stock and ETF listed
 * across all chains. The remainder to it is worked out here from those
 * served numbers, and labelled as worked out. */
function CountsLine({ data, group, universe }) {
  const size = fmtUsd0(data.size || 1000);
  const [one, many] = NOUN[data.type] || ['underlying', 'underlyings'];
  const other = data.type === 'etf' ? 'stocks' : data.type === 'stock' ? 'ETFs' : null;
  const n = (k) => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`;
  const nr = data.rows_not_ranked;
  // Both are counted per group. Under non-EVM nothing is measured, so every
  // underlying would count as "no version fills", which tells a reader
  // nothing; the group note says why instead, and these are left out there.
  const notRanked = nr && nr.count > 0 && group !== 'nonevm' ? nr : null;
  const unfilled = Number.isFinite(data.rows_without_filled_version) && group !== 'nonevm' ? data.rows_without_filled_version : null;
  if (!Number.isFinite(data.rows_total)) return null;
  const measured = data.rows_total + (notRanked?.count || 0) + (unfilled || 0);
  const rest = Number.isFinite(universe) && group !== 'nonevm' ? universe - measured : null;
  return (
    <div className="px-4 pt-1 text-[12px] leading-snug text-muted space-y-0.5">
      <p>
        <span className="text-fg">{n(data.rows_total)} fill {size} and are ranked.</span>
        {notRanked && <> {notRanked.count} more {notRanked.count === 1 ? 'fills' : 'fill'} but {notRanked.count === 1 ? "isn't" : "aren't"} ranked: {notRanked.count === 1 ? 'its' : 'their'} share ratio isn&apos;t read ({notRanked.underlyings.join(', ')}{notRanked.count > notRanked.underlyings.length ? ` and ${notRanked.count - notRanked.underlyings.length} more` : ''}).</>}
        {unfilled ? <> {unfilled.toLocaleString('en-US')} more have no version that fills {size}.</> : null}
      </p>
      <p>
        These counts cover only the {many} with at least one EVM version our cost engine reads, with or without a pool
        {rest != null && rest >= 0
          ? <>: {measured.toLocaleString('en-US')} of the {universe.toLocaleString('en-US')} stocks and ETFs Tnega lists across all chains. The other {rest.toLocaleString('en-US')} ({universe.toLocaleString('en-US')} minus {measured.toLocaleString('en-US')}, worked out on this page from the served counts) are {other ? `${other}, or ` : ''}{many} with no EVM version the engine reads.</>
          : '.'}
      </p>
    </div>
  );
}

function ListFooter({ data, group }) {
  const size = fmtUsd0(data.size || 1000);
  const noSpark = data.rows?.length && data.rows.every((r) => !hasRows(r.spark)) ? data.rows.find((r) => r.spark_reason)?.spark_reason : null;
  const measured = measuredLine(data.computed_at, (data.rows || []).map((r) => r.best?.us_market_open));
  const lines = [
    data.sort_reason ? `Order: ${data.sort_reason}.` : data.sort === 'cost1k' ? `Ordered by cost to buy ${size}.` : null,
    `Each row is the version with the lowest all-in price per share that fills ${size}. Cost in bps is fees and price impact against the pool's own price.${data.lifi_fee_included ? ' Includes LI.FI’s 0.25% fee.' : ''}`,
    noSpark ? `7-day prices: ${noSpark}.` : null,
    measured,
  ].filter(Boolean);
  return (
    <div className="px-4 py-3 border-t border-line space-y-1 text-[11px] leading-snug text-muted">
      {lines.map((l) => <p key={l}>{l}</p>)}
    </div>
  );
}

function Pager({ data, onOffset }) {
  const total = data.rows_total;
  if (!Number.isFinite(total) || !data.rows?.length) return null;
  const from = (data.offset || 0) + 1;
  const to = (data.offset || 0) + data.rows.length;
  // The total is rows_total: underlyings with a version that fills the
  // list's size and is ranked (CountsLine below the heading says the rest).
  const fillsAt = fmtUsd0(data.size || 1000);
  const label = `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ranked at ${fillsAt}`;
  if (!onOffset) {
    return (
      <span className="text-[12px] text-muted tabular-nums text-right">
        {data.rows.length} of {total.toLocaleString('en-US')} ranked at {fillsAt}
      </span>
    );
  }
  if (!data.offset && data.next_offset == null) return <span className="text-[12px] text-muted tabular-nums">{total.toLocaleString('en-US')} ranked at {fillsAt}</span>;
  const prev = data.offset > 0 ? Math.max(0, data.offset - (data.limit || data.rows.length)) : null;
  const btn = 'h-8 w-8 inline-flex items-center justify-center rounded border border-line-strong text-fg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-inset';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-muted tabular-nums">{label}</span>
      <button type="button" className={btn} disabled={prev == null} onClick={() => onOffset(prev)} aria-label="Previous page"><ChevronLeft size={15} aria-hidden="true" /></button>
      <button type="button" className={btn} disabled={data.next_offset == null} onClick={() => onOffset(data.next_offset)} aria-label="Next page"><ChevronRight size={15} aria-hidden="true" /></button>
    </div>
  );
}

function RowPrice({ b }) {
  const h = headline(b || {});
  const gap = refGap(b || {});
  return (
    <>
      <div className="text-fg">{h?.value}</div>
      <div className="text-[11px] text-muted whitespace-nowrap">{tokensText(b?.tokens_per_1000)}</div>
      {gap && <div className="text-[11px] text-warn" title={gap.basis || undefined}>{gap.text}</div>}
    </>
  );
}

export function InstrumentList({ title, state, group, onGroup, onOpen, onSeeAll, onOffset, compact = false, universe = null }) {
  const { data, error, errorBody, stale } = state || {};
  // A read that failed says so, first read or not (te/ReadError.jsx).
  if (!data && !error) return null;
  const head = (
    <div className="px-4 pt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        <DevTag data={data} />
        {stale && <span className="text-[11px] text-muted">Updating</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onGroup && !error && <Pills label="Chain group" value={group} onChange={onGroup} options={[{ id: 'all', label: 'All' }, { id: 'evm', label: 'EVM' }, { id: 'nonevm', label: 'Non-EVM' }]} />}
        {data && !onOffset && <Pager data={data} />}
        {onSeeAll && <button type="button" onClick={onSeeAll} className="text-[12px] font-semibold text-accent hover:underline">See all</button>}
      </div>
    </div>
  );
  if (!data) {
    return <Card pad={false}>{head}<div className="px-4 py-5"><ReadError bare error={error} body={errorBody} what={`the list of ${title.replace(/^Tokenized /, 'tokenized ')}`} /></div></Card>;
  }
  if (!hasRows(data.rows)) {
    return <Card pad={false}>{head}<CountsLine data={data} group={group} universe={universe} /><p className="px-4 py-5 text-[13px] text-muted">{emptyLine(data, group)}</p><ListFooter data={data} group={group} /></Card>;
  }
  const size = fmtUsd0(data.size || 1000);
  const spark = data.rows.some((r) => hasRows(r.spark));
  return (
    <Card pad={false} className={stale ? 'opacity-60 transition-opacity' : ''}>
      {head}
      <CountsLine data={data} group={group} universe={universe} />
      <table className={`w-full mt-2 text-[13px] ${compact ? 'table-fixed' : ''}`}>
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium px-4 py-2">Instrument</th>
            {!compact && <th className="font-medium py-2">Chain</th>}
            <th className={`font-medium py-2 text-right ${compact ? 'pr-4 w-[156px]' : ''}`}>Per share, all-in</th>
            {!compact && <th className="font-medium py-2 pl-4 text-right whitespace-nowrap">Cost to buy {size}</th>}
            {!compact && <th className={`font-medium py-2 text-right ${spark ? '' : 'pr-4'}`}>Versions</th>}
            {!compact && spark && <th className="font-medium px-4 py-2 text-right">7 days</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.rows.map((r) => (
            <tr key={r.best?.key || r.underlying} className={onOpen ? 'cursor-pointer hover:bg-inset/60' : ''} onClick={onOpen ? () => onOpen(r) : undefined}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-3">
                  <SymbolTile underlying={r.underlying} />
                  <div className="min-w-0">
                    <div className="text-fg font-semibold truncate">{r.name}</div>
                    <div className="text-[12px] text-muted truncate">
                      <span className="inline-flex items-center h-4 px-1 mr-1 rounded bg-inset text-fg text-[11px]">{r.best?.symbol}</span>
                      {r.best?.issuer}{compact && r.best?.chain ? ` · ${r.best.chain}` : ''}
                    </div>
                  </div>
                </div>
              </td>
              {!compact && <td className="py-2.5"><div className="flex items-center gap-2 text-fg">{r.best?.chain}<GroupChip group={r.best?.group} /></div></td>}
              <td className={`py-2.5 text-right tabular-nums align-top pt-3 ${compact ? 'pr-4' : ''}`}>
                <RowPrice b={r.best} />
                {compact && <div className="text-[11px] text-muted">{bpsText(r.best?.cost_bps)}</div>}
              </td>
              {!compact && (
                <td className="py-2.5 pl-4 text-right tabular-nums align-top pt-3">
                  <div className="text-fg">{fmtUsd(r.best?.cost_usd)}</div>
                  <div className="text-[11px] text-muted">{bpsText(r.best?.cost_bps)}</div>
                </td>
              )}
              {!compact && <td className={`py-2.5 text-right text-muted tabular-nums ${spark ? '' : 'pr-4'}`}>{r.versions}</td>}
              {!compact && spark && <td className="px-4 py-2.5"><div className="flex justify-end"><Sparkline points={r.spark} /></div></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {onOffset && <div className="px-4 py-3 border-t border-line flex justify-end"><Pager data={data} onOffset={onOffset} /></div>}
      <ListFooter data={data} group={group} />
    </Card>
  );
}

/* Live lists · GET /api/vaults. */
export function VaultTable({ state, compact = false, onOpen }) {
  const { data, error, stale, ever } = state || {};
  if (!data && !(error && ever)) return null;
  if (!data || !hasRows(data.vaults)) {
    return (
      <Card>
        <div className="flex items-center justify-between gap-2"><h3 className="text-[15px] font-semibold text-fg">Vaults</h3><span className="text-[12px] text-muted">Deposits happen on each venue; Tnega never holds funds.</span></div>
        <p className="mt-3 text-[13px] text-muted">{data ? 'No qualifying vault found.' : "Couldn't read the vaults. Try again later."}</p>
      </Card>
    );
  }
  return (
    <Card pad={false} className={`overflow-x-auto ${stale ? 'opacity-60' : ''}`}>
      <div className="px-4 pt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-[15px] font-semibold text-fg">Vaults</h3><DevTag data={data} /></div>
        <span className="text-[12px] text-muted">Deposits happen on each venue; Tnega never holds funds.</span>
      </div>
      <table className={`w-full mt-2 text-[13px] ${compact ? '' : 'min-w-[560px]'}`}>
        <thead>
          <tr className="text-muted text-left text-[12px]">
            <th className="font-medium px-4 py-2">Vault</th>
            <th className="font-medium py-2">Admin / manager and audits</th>
            {!compact && <th className="font-medium py-2">Assets and controls</th>}
            <th className="font-medium py-2 text-right">TVL</th>
            {!compact && <th className="font-medium px-4 py-2 text-right">Fees and lockup</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.vaults.map((v) => (
            <tr key={v.key || `${v.platform}-${v.name}`} className={onOpen ? 'cursor-pointer hover:bg-inset/60' : ''} onClick={onOpen ? () => onOpen(v) : undefined}>
              <td className="px-4 py-2.5"><div className="text-fg font-semibold">{v.name}</div><div className="text-[12px] text-muted">{v.platform} · {v.chain}</div></td>
              <td className="py-2.5 text-fg">{v.manager}<div className="text-[12px] text-muted">{v.audits}</div></td>
              {!compact && <td className="py-2.5 text-fg">{v.assets}<div className="text-[12px] text-muted">{v.controls}</div></td>}
              <td className="py-2.5 pr-4 md:pr-0 text-right tabular-nums text-fg" title={v.tvl_basis}>{fmtUsd0(v.tvl_usd)}<div className="text-[11px] text-muted">{v.tvl_source === 'computed_from_chain' ? 'computed from chain' : v.tvl_source === 'vault_recorded' ? `as recorded by the vault${(v.tvl_recorded_at || v.tvl_last_written) ? `, recorded ${String(v.tvl_recorded_at || v.tvl_last_written).slice(0, 10)}` : ''}` : ''}{v.stale ? ', stale' : ''}{v.nested_in ? ', inside another listed vault' : ''}</div><span className="sr-only">{v.tvl_basis}</span></td>
              {!compact && <td className="px-4 py-2.5 text-right text-fg">{v.fees}<div className="text-[12px] text-muted">{v.lockup}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export { fmtPct };
export const useSorted = (rows, key) => useMemo(() => [...(rows || [])].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0)), [rows, key]);
