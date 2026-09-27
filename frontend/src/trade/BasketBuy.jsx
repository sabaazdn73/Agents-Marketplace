// trade/BasketBuy.jsx
//
// Buy a basket one leg at a time (SPEC C.3), with the stock page's own Buy
// panel (TradePanel.jsx) for each leg: its own LI.FI quote on the
// visitor's click, its own value check against our measured price, its
// own approval prompt where the allowance is short, and one signature for
// its swap. There is no single signature across legs, and none is claimed.
//
// Which legs: those the basket answer says fill at this size, on an EVM
// chain the panel buys on. Each leg's version is read again from
// GET /api/te/underlying/{T}?size={measured_at_usd} before its panel shows,
// and is bought only if that answer still has it filled (a ranked version
// fills; not_ranked and unfilled legs never reach a panel). Every other leg
// is listed with why it is not bought here.
//
// Order: the answer's by_chain order (EVM first, grouped by chain), so the
// wallet switches chain as few times as the basket allows. Progress (which
// legs were sent, with their hashes) is kept in sessionStorage for this
// basket and size, so a reload shows what is done; nothing retries by
// itself.
//
// Shown only while the Buy panel is (trade/buyLive.js).

import React, { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTe } from '../te/api';
import { Card, fmtUsd0 } from '../ui/primitives';
import { sentence } from '../te/costText';
import { isBuyChain, txUrl } from './chains';
import { referencePrice } from './lifi';
import { measuredNote } from '../etfs/BasketBreakdown';
import TradePanel from './TradePanel';

const RUN_KEY = 'tnega_basket_run_v1:';

function readRun(id) {
  try { const v = JSON.parse(window.sessionStorage.getItem(RUN_KEY + id) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function writeRun(id, v) {
  try { window.sessionStorage.setItem(RUN_KEY + id, JSON.stringify(v)); } catch { /* blocked: progress is not kept */ }
}

/** The legs in buying order, each with whether it is bought here and why not. */
export function buyPlan(b) {
  const order = (b.by_chain || []).flatMap((c) => c.legs);
  const rank = (t) => { const i = order.indexOf(t); return i < 0 ? order.length : i; };
  return [...b.legs].sort((x, y) => rank(x.ticker) - rank(y.ticker)).map((l) => {
    let why = null;
    if (l.state !== 'filled') why = l.reason ? sentence(l.reason) : 'does not fill at this size';
    else if (l.group !== 'evm') why = 'not an EVM chain; the Solana buy is not built yet';
    else if (!isBuyChain(l.chain_id)) why = `${l.chain} is not a chain this site buys on`;
    return { ...l, buy: !why, why };
  });
}

function LegPanel({ leg, onSent }) {
  const u = useTe(`/api/te/underlying/${encodeURIComponent(leg.ticker)}?size=${leg.measured_at_usd}`);
  if (u.loading || (!u.data && !u.error)) return <p className="text-[13px] text-muted">Reading {leg.ticker} at {fmtUsd0(leg.measured_at_usd)}.</p>;
  if (!u.data) return <p className="text-[13px] text-warn">Couldn&apos;t read {leg.ticker} at {fmtUsd0(leg.measured_at_usd)} ({u.error}), so this leg is not offered now. Try again, or skip it.</p>;
  const v = (u.data.versions || []).find((x) => x.key === leg.key);
  if (!v || !referencePrice(v)) {
    return <p className="text-[13px] text-warn">{leg.symbol} no longer fills {fmtUsd0(leg.measured_at_usd)} on our latest measurement{v?.reason ? ` (${v.reason})` : ''}, so this leg is not bought. Skip it or reload the basket.</p>;
  }
  return (
    <div>
      {measuredNote(leg) && <p className="mb-2 text-[12px] text-muted">This leg buys {fmtUsd0(leg.leg_usd)}; its value check uses our price measured at {fmtUsd0(leg.measured_at_usd)}, the next measured size up.</p>}
      <TradePanel v={v} size={leg.leg_usd} onSent={onSent} title={`${leg.ticker}: buy ${v.symbol} on ${v.chain}, ${fmtUsd0(leg.leg_usd)}`} />
    </div>
  );
}

const pctText = (x) => `${(x * 100).toFixed(x * 100 % 1 ? 1 : 0)}%`;

/** What a buyer ends up with, said before the first leg, whenever that is
 *  not simply the basket as shown: some legs are not bought here (so the
 *  rest carry larger shares), or the size is above the largest basket
 *  under the threshold. Every figure is served (weight_bps, leg_usd,
 *  leg_cost_bps, cap_usd, threshold_bps); the shares are those weights
 *  over their own sum. */
function Outcome({ b, toBuy }) {
  const all = b.legs.length;
  const partial = toBuy.length < all;
  const above = Number.isFinite(b.cap_usd) && !b.cap_lower_bound && b.size > b.cap_usd;
  if (!partial && !above) return null;
  const sumW = toBuy.reduce((a, l) => a + l.weight_bps, 0);
  const shares = toBuy.map((l) => ({ t: l.ticker, share: l.weight_bps / sumW }));
  const same = shares.every((x) => Math.abs(x.share - shares[0].share) < 1e-9);
  const dollars = toBuy.reduce((a, l) => a + (Number.isFinite(l.leg_usd) ? l.leg_usd : 0), 0);
  const priced = b.legs.filter((l) => l.state === 'filled' && Number.isFinite(l.leg_cost_bps));
  const worst = priced.reduce((w, l) => (!w || l.leg_cost_bps > w.leg_cost_bps ? l : w), null);
  const capLegs = (b.cap_legs || []).join(', ');
  return (
    <div className="mt-3 rounded border border-warn/60 p-3 text-[13px] text-fg space-y-1.5" role="note">
      {partial && toBuy.length > 0 && (
        <p>
          {toBuy.length} of {all} legs can be bought here, so you would end up with {same
            ? `${toBuy.length === 1 ? toBuy[0].ticker : `${toBuy.length} legs`} at ${pctText(shares[0].share)} each`
            : shares.map((x) => `${x.t} ${pctText(x.share)}`).join(', ')}{' '}
          ({fmtUsd0(dollars)} of the {fmtUsd0(b.size)}), not the basket&apos;s weights.
        </p>
      )}
      {above && (
        <p>
          {fmtUsd0(b.size)} is above the largest basket under {b.threshold_bps ?? 100} bps, {fmtUsd0(b.cap_usd)}{capLegs ? `, set by ${capLegs}` : ''}.
          {worst ? ` At this size the costliest leg is ${worst.ticker} at ${worst.leg_cost_bps.toFixed(1)} bps.` : ''}
        </p>
      )}
    </div>
  );
}

export default function BasketBuy({ b, runId }) {
  const plan = useMemo(() => buyPlan(b), [b]);
  const toBuy = plan.filter((l) => l.buy);
  const [run, setRun] = useState(() => readRun(runId));
  const done = run.done || {};
  const skipped = run.skipped || {};
  const next = toBuy.find((l) => !done[l.ticker] && !skipped[l.ticker]);
  const [open, setOpen] = useState(false);
  const save = (v) => { setRun(v); writeRun(runId, v); };
  const sent = (t, hash, chainId) => save({ ...run, done: { ...done, [t]: { hash, chainId } } });
  const skip = (t) => save({ ...run, skipped: { ...skipped, [t]: true } });
  const reset = () => save({});

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-fg">Buy this basket at {fmtUsd0(b.size)}</h3>
        <span className="text-[12px] text-muted">One leg at a time: a quote, an approval where needed, and one signature per leg.</span>
      </div>
      <ol className="mt-3 space-y-1.5 text-[13px]">
        {plan.map((l, i) => {
          const d = done[l.ticker];
          return (
            <li key={l.ticker} className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-5 text-muted tabular-nums">{i + 1}.</span>
              <span className="font-semibold text-fg">{l.ticker}</span>
              <span className="text-muted">{l.buy ? `${l.symbol} on ${l.chain}, ${fmtUsd0(l.leg_usd)}` : fmtUsd0(l.leg_usd)}</span>
              <span className="ml-auto text-right">
                {d ? <a href={txUrl(d.chainId, d.hash)} target="_blank" rel="noopener noreferrer" className="text-pos underline underline-offset-2">sent<ExternalLink size={11} aria-hidden="true" className="inline ml-1" /></a>
                  : skipped[l.ticker] ? <span className="text-muted">skipped</span>
                  : l.buy ? (next?.ticker === l.ticker && open ? <span className="text-fg">now</span> : <span className="text-muted">to do</span>)
                  : <span className="text-muted">not bought here: {l.why}</span>}
              </span>
            </li>
          );
        })}
      </ol>

      <Outcome b={b} toBuy={toBuy} />
      {toBuy.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">No leg of this basket can be bought here at this size.</p>
      ) : !next ? (
        <div className="mt-3 text-[13px] text-fg">
          Every leg bought here was sent or skipped. <button type="button" className="text-accent hover:underline" onClick={reset}>Clear this progress</button>
        </div>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="mt-4 h-10 px-4 rounded bg-accent text-accent-fg text-[13px] font-semibold hover:opacity-90">
          {Object.keys(done).length ? `Continue with ${next.ticker}` : `Start with ${next.ticker}`}
        </button>
      ) : (
        <div className="mt-4 space-y-2">
          <LegPanel key={`${next.ticker}-${b.size}`} leg={next} onSent={(hash) => sent(next.ticker, hash, next.chain_id)} />
          <button type="button" className="text-[12px] text-muted hover:text-fg underline underline-offset-2" onClick={() => skip(next.ticker)}>Skip {next.ticker}</button>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">Each leg is its own purchase at its own price; a leg can fill while another does not. Progress is kept in this tab only.</p>
    </Card>
  );
}
