// trade/TradePanel.jsx
//
// Buy one tokenized stock version with a connected EVM wallet (SPEC C.1).
// One component for both apps; `compact` tightens it for a phone.
//
// THE ORDER A BUY GOES IN, each step on the visitor's own click:
//   1. pick what to pay with, among the stablecoins this wallet holds on the
//      stock's chain (and Arbitrum USDC for Robinhood Chain, the one
//      cross-chain route measured); the balances are read from the chains'
//      public endpoints;
//   2. "Get a LI.FI quote": one request from this browser to li.quest,
//      never on load, never to our API. The answer is refused if it does not
//      match the request, if any step names Jupiter, or if our own value
//      check fails;
//   3. everything the wallet will be asked to do is shown: tokens and the
//      minimum, LI.FI's fee, gas, LI.FI's estimated time, when it was
//      quoted, the tools, the approval address, and the issuer's words on
//      who may hold it with an unticked box to confirm;
//   4. "Approve", only when the allowance is short: its own wallet prompt,
//      for exactly the amount;
//   5. "Sign the swap": LI.FI's transaction as it was quoted;
//   6. the hash, an explorer link, and LI.FI's status every 5 s until DONE
//      or FAILED.
// A quote older than 60 s is not signed; the visitor asks for a new one.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useConnectedWallet, shortAddress } from '../wallet/useConnectedWallet';
import { Eligibility } from '../home/cards';
import { fmtUsd, fmtUsd0 } from '../ui/primitives';
import { timeText, blockText, tokensText } from '../te/costText';
import { BUY_CHAINS, payOptions, txUrl, addressUrl, parseKey } from './chains';
import {
  fetchQuote, fetchStatus, jupiterIn, quoteMismatch, quoteFacts, referencePrice, valueCheck,
  quotaState, recordBuy, readBuys, QUOTE_MAX_AGE_MS, units, QUOTA_LIMIT, SLIPPAGE, MIN_GAP, MAX_GAIN,
} from './lifi';
import { readBalance, readAllowance, approveExact, sendSwap, walletErrorText } from './evmExecute';

const tok = (v, d = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : null);
const pct = (x) => `${(x * 100).toFixed(2)}%`;

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,40%)_1fr] gap-x-3 py-1.5 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-fg min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Ext({ href, children }) {
  if (!href) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-fg break-all">{children}<ExternalLink size={11} aria-hidden="true" className="inline ml-1 align-baseline" /></a>;
}

const btn = 'h-10 px-4 rounded bg-accent text-accent-fg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';
const btn2 = 'h-10 px-4 rounded border border-line-strong text-fg text-[13px] font-semibold hover:bg-inset disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';

// `onSent(hash)` tells a caller (the basket buy, trade/BasketBuy.jsx) that
// the swap was handed to the wallet and came back with a hash. `title`
// replaces the heading.
export default function TradePanel({ v, size, compact = false, onSent = null, title = null }) {
  const { address } = useConnectedWallet();
  const { openConnectModal } = useConnectModal();
  const target = parseKey(v.key);
  const toChain = target?.chainId;
  const options = useMemo(() => (toChain ? payOptions(toChain) : []), [toChain]);
  const ref = referencePrice(v);
  const issuer = v.issuer_name || v.issuer;

  // Balances of each pay-with token, read once per wallet.
  const [bal, setBal] = useState({});
  const [balTick, setBalTick] = useState(0);
  useEffect(() => {
    setBal({});
    if (!address) return undefined;
    let live = true;
    for (const o of options) {
      readBalance({ chainId: o.chainId, token: o.address, owner: address })
        .then((raw) => { if (live) setBal((b) => ({ ...b, [o.id]: { raw } })); })
        .catch((e) => { if (live) setBal((b) => ({ ...b, [o.id]: { error: e?.shortMessage || e?.message || 'read failed' } })); });
    }
    return () => { live = false; };
  }, [address, options, balTick]);

  const need = (o) => BigInt(Math.round(size)) * 10n ** BigInt(o.decimals);
  const enough = (o) => bal[o.id]?.raw != null && bal[o.id].raw >= need(o);
  const held = options.filter((o) => bal[o.id]?.raw > 0n);
  const [payId, setPayId] = useState(null);
  const pay = options.find((o) => o.id === payId) || options.find(enough) || held[0] || null;

  // The quote and everything after it. Any change of size, version, token
  // or wallet drops it: a quote answers one question only.
  const [q, setQ] = useState({ status: 'idle' });
  const [agree, setAgree] = useState(false);
  const [allowance, setAllowance] = useState(null);
  const [wallet, setWallet] = useState({ status: 'idle' });
  const [tx, setTx] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [, setBuysTick] = useState(0);
  // Every in-flight answer (a quote, a status) carries the generation it
  // was asked in; a reset, a new quote or unmounting moves the generation
  // on, so a late answer is dropped and the status timer stops.
  const gen = useRef(0);
  const pollRef = useRef(null);
  const stopAll = () => { gen.current += 1; clearTimeout(pollRef.current); pollRef.current = null; };
  useEffect(() => {
    stopAll();
    setQ({ status: 'idle' }); setAgree(false); setAllowance(null); setWallet({ status: 'idle' }); setTx(null);
  }, [v.key, size, pay?.id, address]);
  useEffect(() => {
    if (q.status !== 'ready') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [q.status]);
  useEffect(() => () => stopAll(), []);

  if (!target || !BUY_CHAINS[toChain]) return null;

  const params = pay && address ? {
    fromChain: pay.chainId, toChain, fromToken: pay.address, toToken: target.address,
    fromAmount: need(pay).toString(), fromAddress: address,
  } : null;

  const getQuote = async () => {
    if (!params) return;
    stopAll();
    const g = gen.current;
    setQ({ status: 'quoting' }); setAgree(false); setAllowance(null); setWallet({ status: 'idle' }); setTx(null);
    const r = await fetchQuote(params);
    if (g !== gen.current) return;
    if (r.error) { setQ({ status: 'error', error: r.error, kind: r.kind }); return; }
    const quote = r.quote;
    const facts = quoteFacts(quote);
    const mismatch = quoteMismatch(quote, params);
    if (mismatch.length) { setQ({ status: 'refused', quote, facts, quotedAt: r.quotedAt, why: `LI.FI's answer does not match the request (${mismatch.join(', ')}), so it is not used.` }); return; }
    const jup = jupiterIn(quote);
    if (jup.length) { setQ({ status: 'refused', quote, facts, quotedAt: r.quotedAt, why: `This route goes through Jupiter (${jup.join(', ')}). Tnega does not use Jupiter, so the route is refused.` }); return; }
    const check = valueCheck({ tokens: facts.toAmount, minTokens: facts.toAmountMin, sizeUsd: size, ref });
    if (!check) { setQ({ status: 'refused', quote, facts, quotedAt: r.quotedAt, why: 'The quote could not be checked against our measured price, so it is not offered.' }); return; }
    if (!check.ok) {
      const lines = [];
      if (check.why.includes('min')) lines.push(`LI.FI's route guarantees at least ${tok(check.minTokens)} ${facts.toSymbol}, ${pct(1 - check.minRatio)} below its estimate of ${tok(check.tokens)}; more than the ${pct(SLIPPAGE)} slippage asked for plus ${pct(MIN_GAP - SLIPPAGE)}.`);
      if (check.why.includes('loss')) lines.push(`At least ${tok(check.minTokens)} ${facts.toSymbol} is worth ${fmtUsd(check.valueOut)} at our measured price, for ${fmtUsd0(size)}: a ${pct(check.loss)} loss, over this check's ${pct(check.limit)} limit.`);
      if (check.why.includes('gain')) lines.push(`At least ${tok(check.minTokens)} ${facts.toSymbol} is worth ${fmtUsd(check.valueOut)} at our measured price, ${pct(-check.loss)} more than the ${fmtUsd0(size)} paid. More than ${pct(MAX_GAIN)} above points to a wrong token, decimals or price, not a bargain.`);
      setQ({ status: 'refused', quote, facts, check, quotedAt: r.quotedAt, why: `Refused. ${lines.join(' ')}` });
      return;
    }
    setQ({ status: 'ready', quote, facts, check, quotedAt: r.quotedAt, at: Date.now() });
    setNow(Date.now());
    if (facts.approvalAddress) {
      readAllowance({ chainId: pay.chainId, token: pay.address, owner: address, spender: facts.approvalAddress })
        .then((a) => setAllowance({ raw: a }))
        .catch((e) => setAllowance({ error: e?.shortMessage || e?.message || 'read failed' }));
    } else setAllowance({ raw: null, none: true });
  };

  const amount = pay ? need(pay) : 0n;
  const needsApproval = q.status === 'ready' && !!q.facts.approvalAddress && allowance?.raw != null && allowance.raw < amount;
  const allowanceOk = q.status === 'ready' && (allowance?.none || (allowance?.raw != null && allowance.raw >= amount));
  const age = q.status === 'ready' ? now - q.at : 0;
  const stale = age > QUOTE_MAX_AGE_MS;

  // The age is checked again at the click, not only by the 1 s timer.
  const tooOld = () => {
    if (Date.now() - q.at <= QUOTE_MAX_AGE_MS) return false;
    // Moving the clock on turns the quote stale, which shows its one message.
    setNow(Date.now());
    return true;
  };

  const approve = async () => {
    if (tooOld()) return;
    setWallet({ status: 'approving' });
    try {
      const hash = await approveExact({ chainId: pay.chainId, token: pay.address, spender: q.facts.approvalAddress, amount });
      const a = await readAllowance({ chainId: pay.chainId, token: pay.address, owner: address, spender: q.facts.approvalAddress });
      setAllowance({ raw: a });
      setWallet({ status: 'approved', hash });
    } catch (e) {
      setWallet({ status: 'error', error: walletErrorText(e) });
    }
  };

  // LI.FI's status every 5 s until DONE or FAILED. NOT_FOUND (LI.FI has not
  // seen the transaction yet) or a failed read counts toward a limit: after
  // 120 of them, or 10 minutes, or an hour in any state, the page stops
  // asking and says the status is unknown.
  const POLL_MS = 5000;
  const poll = (hash, fromChain, g, started, misses) => {
    fetchStatus({ txHash: hash, fromChain, toChain }).then((st) => {
      if (g !== gen.current) return;
      const miss = !!st.error || st.status === 'NOT_FOUND';
      const n = miss ? misses + 1 : misses;
      const elapsed = Date.now() - started;
      const done = st.status === 'DONE' || st.status === 'FAILED';
      const giveUp = !done && ((miss && (n >= 120 || elapsed > 10 * 60e3)) || elapsed > 60 * 60e3);
      setTx((t) => (t && t.hash === hash ? { ...t, lifi: st, unknown: giveUp ? (miss ? 'unseen' : 'pending') : false } : t));
      if (done || giveUp) return;
      pollRef.current = setTimeout(() => poll(hash, fromChain, g, started, n), POLL_MS);
    });
  };

  const sign = async () => {
    if (tooOld()) return;
    setWallet({ status: 'signing' });
    try {
      const hash = await sendSwap({ chainId: pay.chainId, transactionRequest: q.quote.transactionRequest });
      setWallet({ status: 'sent' });
      setTx({ hash, fromChain: pay.chainId, lifi: null });
      recordBuy({ hash, fromChain: pay.chainId, toChain, key: v.key, symbol: v.symbol });
      onSent?.(hash);
      setBuysTick((t) => t + 1);
      const g = gen.current;
      const from = pay.chainId;
      pollRef.current = setTimeout(() => poll(hash, from, g, Date.now(), 0), POLL_MS);
    } catch (e) {
      setWallet({ status: 'error', error: walletErrorText(e) });
    }
  };

  const quota = quotaState();
  // Kept in this browser (tnega_buys_v1), so a sent buy's link survives a
  // new quote, a new size or a reload. The one on screen above is not repeated.
  const recent = readBuys(v.key).filter((b) => b.hash !== tx?.hash);
  const f = q.facts;

  return (
    <section aria-label={`Buy ${v.symbol}`} className="rounded border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-fg">{title || `Buy ${v.symbol} on ${v.chain}`}</h3>
        <span className="text-[12px] text-muted">Routed by LI.FI in your browser. Your wallet signs; Tnega never holds funds.</span>
      </div>

      {!ref ? (
        <p className="mt-3 text-[13px] text-muted">
          No Buy here: there is no measured price for {v.symbol} to check a quote against
          {v.reason ? ` (${v.reason})` : ''}.
        </p>
      ) : !address ? (
        <div className="mt-3">
          <p className="text-[13px] text-muted mb-2">Connect a wallet to see what it holds and ask LI.FI for a route. Connecting signs nothing.</p>
          <button type="button" className={btn} onClick={() => openConnectModal?.()}>Connect a wallet</button>
        </div>
      ) : (
        <>
          <fieldset className="mt-3">
            <legend className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-2">Pay with, from {shortAddress(address)}</legend>
            <ul className="space-y-1.5">
              {options.map((o) => {
                const b = bal[o.id];
                const amountText = b?.raw != null ? `${tok(units(b.raw, o.decimals), 2)} ${o.symbol}` : b?.error ? `balance not read: ${b.error}` : 'reading balance';
                const short = b?.raw != null && !enough(o);
                return (
                  <li key={o.id}>
                    <label className={`flex items-center gap-3 rounded border px-3 py-2 text-[13px] ${pay?.id === o.id ? 'border-fg' : 'border-line'} ${b?.raw === 0n ? 'opacity-60' : ''}`}>
                      <input type="radio" name={`pay-${v.key}`} checked={pay?.id === o.id} onChange={() => setPayId(o.id)} disabled={!(b?.raw > 0n)} />
                      <span className="text-fg font-semibold">{o.symbol}</span>
                      <span className="text-muted">on {o.chainName}{o.chainId !== toChain ? ', then across to ' + v.chain : ''}</span>
                      <span className="ml-auto text-right tabular-nums text-muted">
                        {amountText}
                        {short && <span className="block text-[11px] text-warn">less than {fmtUsd0(size)}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {Object.values(bal).some((b) => b.error) && (
              <button type="button" className="mt-2 text-[12px] text-accent hover:underline" onClick={() => setBalTick((t) => t + 1)}>Read the balances again</button>
            )}
            {options.length > 0 && options.every((o) => bal[o.id]?.raw === 0n) && (
              <p className="mt-2 text-[13px] text-muted">This wallet holds none of these on {[...new Set(options.map((o) => o.chainName))].join(' or ')}.</p>
            )}
          </fieldset>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={btn} onClick={getQuote} disabled={!pay || !enough(pay) || q.status === 'quoting' || wallet.status === 'approving' || wallet.status === 'signing'}>
              {q.status === 'quoting' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {q.status === 'idle' ? `Get a LI.FI quote for ${fmtUsd0(size)}` : 'Get a new quote'}
            </button>
            <span className="text-[11px] text-muted">One request to li.quest from this browser, only when you press it. This browser has used {quota.used} of LI.FI&apos;s {QUOTA_LIMIT} per 2 hours.</span>
          </div>

          {q.status === 'error' && <p role="alert" className="mt-3 text-[13px] text-neg">{q.error}</p>}
          {q.status === 'refused' && (
            <div role="alert" className="mt-3 rounded border border-neg/50 p-3 text-[13px]">
              <p className="text-neg font-semibold">{q.why}</p>
              {q.check && <p className="mt-1 text-muted">Checked against {q.check.basis}: {fmtUsd(q.check.price)} per token.</p>}
              {f?.tools?.length > 0 && <p className="mt-1 text-muted">Route: {f.tools.join(', ')}. Quoted {timeText(q.quotedAt)}.</p>}
            </div>
          )}

          {q.status === 'ready' && (
            <div className="mt-4">
              <dl className="divide-y divide-line border-y border-line">
                <Row label="You receive (LI.FI's quote)">{tok(f.toAmount)} {f.toSymbol}</Row>
                <Row label="At least, after 0.5% slippage">{tok(f.toAmountMin)} {f.toSymbol}</Row>
                <Row label="You pay">{fmtUsd0(size)} in {pay.symbol} on {pay.chainName}</Row>
                {f.fees.map((x) => (
                  <Row key={x.name} label={x.name}>
                    {Number.isFinite(x.pct) && x.pct < 1 ? `${(x.pct * 100).toFixed(2)}%` : ''}{Number.isFinite(x.usd) ? ` (${fmtUsd(x.usd)}, LI.FI's dollar figure)` : ''}{x.included ? ', taken out of the amount paid' : ''}
                  </Row>
                ))}
                {f.gas.map((g, i) => (
                  <Row key={`gas-${i}`} label="Network fee (LI.FI's estimate)">{tok(g.amount, 6)} {g.symbol}{Number.isFinite(g.usd) ? ` (${fmtUsd(g.usd)})` : ''}</Row>
                ))}
                <Row label="LI.FI's estimated time">{f.seconds == null ? 'not given' : f.seconds === 0 && pay.chainId === toChain ? "under a minute, LI.FI's estimate" : `${f.seconds} s, LI.FI's estimate`}</Row>
                <Row label="Route">{f.tools.join(', ') || 'not named'}{f.steps ? `, ${f.steps} step${f.steps === 1 ? '' : 's'}` : ''}</Row>
                <Row label="Quoted at">{timeText(q.quotedAt)}{stale ? ', over 60 s ago' : `, ${Math.round(age / 1000)} s ago`}</Row>
                <Row label="Approval address">
                  {f.approvalAddress ? <Ext href={addressUrl(pay.chainId, f.approvalAddress)}>{f.approvalAddress}</Ext> : 'none needed'}
                  {needsApproval && <span className="block text-[12px] text-muted">Allowance {tok(units(allowance.raw, pay.decimals), 2)} {pay.symbol}; an approval for exactly {tok(units(amount, pay.decimals), 2)} {pay.symbol} comes first, as its own wallet prompt.</span>}
                  {allowanceOk && f.approvalAddress && <span className="block text-[12px] text-muted">The allowance already covers {fmtUsd0(size)}; no approval needed.</span>}
                  {allowance?.error && <span className="block text-[12px] text-warn">Allowance not read: {allowance.error}</span>}
                </Row>
                <Row label="Measured on pools (ours)">
                  {tokensText(v.tokens_per_1000) || 'no measured fill for this version'}{v.state === 'filled' && blockText(v.block) ? `, ${blockText(v.block)}` : ''}
                  <span className="block text-[12px] text-muted">Our simulation of the best single pool, not LI.FI&apos;s quote.</span>
                </Row>
                <Row label="Value check (ours)">
                  At least {tok(q.check.minTokens)} {f.toSymbol} x {fmtUsd(q.check.price)} = {fmtUsd(q.check.valueOut)} against {fmtUsd0(size)} paid: {q.check.loss >= 0 ? `${pct(q.check.loss)} less, within the ${pct(q.check.limit)} limit` : `${pct(-q.check.loss)} more, within ${pct(MAX_GAIN)}`}.
                  <span className="block text-[12px] text-muted">Checked on the minimum the route guarantees, not the estimate. Priced at {q.check.basis}. The stablecoin is taken at $1.</span>
                </Row>
              </dl>

              <div className="mt-4 rounded bg-inset p-3 text-[13px]">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">Who may hold {v.symbol}, in {issuer}&apos;s words</div>
                <Eligibility e={v.eligibility} />
                <label className="mt-3 flex items-start gap-2 text-fg">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
                  <span>I am not a restricted person under {issuer}&apos;s terms</span>
                </label>
              </div>

              {stale && !tx && <p role="alert" className="mt-3 text-[13px] text-warn">This quote is over 60 s old. Get a new quote before signing.</p>}

              <div className={`mt-4 flex ${compact ? 'flex-col' : 'flex-wrap'} gap-2`}>
                {needsApproval && (
                  <button type="button" className={btn2} onClick={approve} disabled={!agree || stale || wallet.status === 'approving' || wallet.status === 'signing'}>
                    {wallet.status === 'approving' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                    Approve exactly {tok(units(amount, pay.decimals), 2)} {pay.symbol}
                  </button>
                )}
                <button type="button" className={btn} onClick={sign} disabled={!agree || stale || !allowanceOk || wallet.status === 'approving' || wallet.status === 'signing' || !!tx}>
                  {wallet.status === 'signing' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  Sign the swap
                </button>
              </div>
              {wallet.status === 'approving' && <p className="mt-2 text-[12px] text-muted">Confirm the approval in your wallet, then wait for one confirmation.</p>}
              {wallet.status === 'approved' && <p className="mt-2 text-[12px] text-muted">Approved: <Ext href={txUrl(pay.chainId, wallet.hash)}>{shortAddress(wallet.hash)}</Ext>. Now sign the swap.</p>}
              {wallet.status === 'signing' && <p className="mt-2 text-[12px] text-muted">Confirm the swap in your wallet.</p>}
              {wallet.status === 'error' && <p role="alert" className="mt-2 text-[13px] text-neg">{wallet.error}</p>}
            </div>
          )}

          {tx && (
            <div className="mt-4 rounded border border-line p-3 text-[13px]" aria-live="polite">
              <div>Sent: <Ext href={txUrl(tx.fromChain, tx.hash)}>{tx.hash}</Ext></div>
              <div className="mt-1 text-muted">
                {tx.unknown === 'pending'
                  ? 'LI.FI still reports it as pending after an hour; check the explorer.'
                  : tx.unknown
                  ? 'Status unknown: LI.FI has not reported it. Check the explorer.'
                  : <>LI.FI status: {tx.lifi?.status ? `${tx.lifi.status}${tx.lifi.substatus ? ` (${tx.lifi.substatus})` : ''}${tx.lifi.message ? `: ${tx.lifi.message}` : ''}` : tx.lifi?.error ? `not read yet: ${tx.lifi.error}` : 'checking every 5 s'}</>}
              </div>
              {tx.lifi?.receiving && tx.lifi.receiving !== tx.hash && <div className="mt-1">Received on {v.chain}: <Ext href={txUrl(toChain, tx.lifi.receiving)}>{tx.lifi.receiving}</Ext></div>}
            </div>
          )}
        </>
      )}
      {/* Per browser, not per wallet: shown with or without one connected. */}
      {recent.length > 0 && (
        <div className="mt-4 text-[12px] text-muted">
          Your recent buys of {v.symbol} from this browser:{' '}
          {recent.map((b, i) => (
            <span key={b.hash}>{i ? ', ' : ''}<Ext href={txUrl(b.fromChain, b.hash)}>{shortAddress(b.hash)}</Ext> ({timeText(b.at)})</span>
          ))}
        </div>
      )}
    </section>
  );
}
