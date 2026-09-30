// trade/StockTrade.jsx
//
// The Buy and Sell tabs of one tokenized stock version on its stock page
// (stocks/StockPage.jsx). One component for both apps and both sides:
//   buy   pay the chain's stablecoin (trade/chains.js pay list), receive the
//         stock token;
//   sell  part with the stock token the connected wallet holds, receive the
//         chain's stablecoin. Max fills in the balance read on chain.
// Shown only on a chain switched on in trade/tradeLive.js (Base today);
// elsewhere the tab says so and offers no control.
//
// THE SIGNING PAGE'S PROTECTIONS, the same code wherever it can be shared:
//   - both tokens' decimals read on chain (sign/tokenMeta.js), the
//     stablecoin's held against this site's list and the stock token's read
//     twice, from two endpoints, and held against LI.FI's figure in the
//     quote; the exact amount is worked out from the chain's figures;
//   - every check in trade/quoteCheck.js, shared with sign/SignOrderPage.jsx:
//     the answer matches the request (recipient: the connected wallet, at
//     every step), no Jupiter, LI.FI's contract pinned per chain
//     (trade/lifi.js LIFI_DIAMONDS) as the contract called and the spender,
//     our measured reference under 30 minutes old, LI.FI's own price within
//     5% of ours, and the minimum valued at both prices within
//     min(5%, max(2%, 3 x our measured cost without gas)); the reference and
//     limit come from our stored measurements (trade/measuredRef.js, the
//     server's rule in backend/core/te/prepare.py);
//   - an approval for exactly the amount, never an unlimited one, offered
//     once; the allowance read every 2 s for up to 30 s after it;
//   - the swap signed only while the quote is under 60 s old, and only for
//     the wallet it was quoted for;
//   - the issuer's words on who may hold the token, with a box to tick.
// Every wallet prompt is on the visitor's own click. Tnega never holds funds
// or keys, and nothing here goes to Tnega's API except the read of our own
// measurements.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { parseUnits } from 'viem';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { useConnectedWallet, shortAddress } from '../wallet/useConnectedWallet';
import { Eligibility } from '../home/cards';
import { Card, fmtUsd } from '../ui/primitives';
import { wagmiConfig, secondOpinionClient } from '../wagmiConfig';
import { BUY_CHAINS, addressUrl, txUrl, parseKey } from './chains';
import { fetchQuote, fetchStatus, quoteFacts, quotaState, QUOTE_MAX_AGE_MS, QUOTA_LIMIT, SLIPPAGE } from './lifi';
import { readBalance, readAllowance, approveExact, sendSwap, ensureChain, walletErrorText } from './evmExecute';
import { checkQuote, referenceProblem } from './quoteCheck';
import { buyReference, sellReference } from './measuredRef';
import { rawText, clockText } from './format';
import { tradeOn } from './tradeLive';
import { readDecimals, commitDecimals, forgetDecimals } from '../sign/tokenMeta';
import { REFERENCE_MAX_AGE_MS } from '../sign/order';
import { useAskConnectChain } from '../wallet/connectChain';

const lc = (a) => String(a || '').toLowerCase();
const tok = (v, d = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : null);
const pct = (x, d = 2) => `${(x * 100).toFixed(d)}%`;
// LI.FI's small dollar figures: under a cent reads "< $0.01", not "$0.00".
const usdSmall = (x) => (x > 0 && x < 0.01 ? '< $0.01' : fmtUsd(x));
// The same bounds the MCP server puts on a buy it prepares (sign_link.py).
const USD_MIN = 1;
const USD_MAX = 10000;

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[minmax(0,38%)_1fr] gap-x-3 py-2 text-[13px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-fg min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Ext({ href, children, mono = false }) {
  if (!href) return <span className={mono ? 'font-mono' : ''}>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`underline underline-offset-2 hover:text-fg break-all ${mono ? 'font-mono' : ''}`}>
      {children}<ExternalLink size={11} aria-hidden="true" className="inline ml-1 align-baseline" />
    </a>
  );
}

function Step({ n, done, active, title, children }) {
  return (
    <li className="flex gap-3 py-3">
      <span aria-hidden="true" className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[12px] font-semibold ${done ? 'bg-pos text-page' : active ? 'bg-accent text-accent-fg' : 'border border-line-strong text-muted'}`}>
        {done ? <Check size={13} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[14px] font-semibold ${active || done ? 'text-fg' : 'text-muted'}`}>{title}</div>
        {children && <div className="mt-1 text-[13px] text-muted">{children}</div>}
      </div>
    </li>
  );
}

const btn = 'h-10 px-4 rounded bg-accent text-accent-fg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';
const btn2 = 'h-10 px-4 rounded border border-line-strong text-fg text-[13px] font-semibold hover:bg-inset disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';
const input = 'h-10 w-full rounded border border-line-strong bg-surface px-3 text-[14px] text-fg tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

/** A plain decimal with at most `places` decimals, above zero. */
function parseAmount(text, places) {
  const s = String(text || '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: 'Enter an amount, digits and one point.' };
  const fr = s.split('.')[1] || '';
  if (Number.isInteger(places) && fr.length > places) return { error: `At most ${places} decimal place${places === 1 ? '' : 's'}.` };
  if (!(Number(s) > 0)) return { error: 'Enter an amount above zero.' };
  return { text: s, value: Number(s) };
}

/** "Buying on Ethereum is not switched on yet", with no control. */
export function NotSwitchedOn({ v, side }) {
  return (
    <Card>
      <p className="text-[14px] text-fg">{side === 'sell' ? 'Selling' : 'Buying'} on {v.chain} is not switched on yet.</p>
      <p className="mt-1 text-[12px] text-muted">
        Buy and Sell are switched on one chain at a time, after a real trade has been run there. Today that is Base.
      </p>
    </Card>
  );
}

export default function StockTrade({ v, ticker, side, size }) {
  const target = parseKey(v.key);
  const chainId = target?.chainId;
  if (!target || v.group !== 'evm' || !BUY_CHAINS[chainId] || !tradeOn(chainId)) return <NotSwitchedOn v={v} side={side} />;
  // Remounted per version and side, so nothing carries over between them.
  return <Trade key={`${v.key}:${side}`} v={v} ticker={ticker} side={side} size={size} chainId={chainId} token={target.address} />;
}

function Trade({ v, ticker, side, size, chainId, token }) {
  const buy = side === 'buy';
  const chain = BUY_CHAINS[chainId];
  const { address, chainId: walletChain, status: walletStatus } = useConnectedWallet();
  const { openConnectModal } = useConnectModal();
  const issuer = v.issuer_name || v.issuer;
  const symbol = v.symbol;
  // A wallet connected from this tab connects on this chain, not BNB Chain.
  useAskConnectChain(chainId);

  // What the stablecoin side is: one of the chain's own, from this site's
  // list (trade/chains.js), never a token a quote names.
  const [payAddr, setPayAddr] = useState(chain.pay[0].address);
  const pay = chain.pay.find((p) => p.address === payAddr) || chain.pay[0];

  // Both tokens' decimals, read on chain before anything is quoted. The
  // stablecoin's must equal this site's list; the stock token's is read from
  // two endpoints and kept only when they agree.
  const [dec, setDec] = useState({ token: null, pay: null, error: null, bad: null });
  const [decTick, setDecTick] = useState(0);
  useEffect(() => {
    let live = true;
    setDec({ token: null, pay: null, error: null, bad: null });
    (async () => {
      let p = await readDecimals(wagmiConfig, chainId, pay.address);
      if (p !== pay.decimals) {
        forgetDecimals(chainId, pay.address);
        p = await readDecimals(wagmiConfig, chainId, pay.address, { fresh: true, client: secondOpinionClient(chainId) });
      }
      const t1 = await readDecimals(wagmiConfig, chainId, token);
      const t2 = await readDecimals(wagmiConfig, chainId, token, { fresh: true, client: secondOpinionClient(chainId) });
      const bad = [];
      if (p !== pay.decimals) bad.push(`${pay.symbol} has ${p} decimals on chain, this site's list says ${pay.decimals}`);
      if (t1 !== t2) bad.push(`two endpoints disagree on ${symbol}'s decimals (${t1} and ${t2})`);
      if (!Number.isInteger(t1) || t1 < 0 || t1 > 36) bad.push(`${symbol}'s decimals read as ${t1}`);
      if (bad.length) { forgetDecimals(chainId, token); forgetDecimals(chainId, pay.address); } else { commitDecimals(chainId, token, t1); commitDecimals(chainId, pay.address, p); }
      if (live) setDec({ token: t1, pay: p, error: null, bad: bad.length ? bad : null });
    })().catch((e) => { if (live) setDec({ token: null, pay: null, error: e?.shortMessage || e?.message || 'read failed', bad: null }); });
    return () => { live = false; };
  }, [chainId, token, pay.address, pay.decimals, symbol, decTick]);
  const decOk = dec.token != null && dec.pay != null && !dec.bad;
  const fromToken = buy ? pay.address : token;
  const toToken = buy ? token : pay.address;
  const fromDecimals = decOk ? (buy ? dec.pay : dec.token) : null;
  const toDecimals = decOk ? (buy ? dec.token : dec.pay) : null;
  const fromSymbol = buy ? pay.symbol : symbol;
  const toSymbol = buy ? symbol : pay.symbol;

  // The balance of what is given up, read on the chain for the connected
  // wallet.
  const [bal, setBal] = useState(null);
  const [balTick, setBalTick] = useState(0);
  useEffect(() => {
    let live = true;
    setBal(null);
    if (!address) return undefined;
    readBalance({ chainId, token: fromToken, owner: address })
      .then((r) => { if (live) setBal({ raw: r }); })
      .catch((e) => { if (live) setBal({ error: e?.shortMessage || e?.message || 'read failed' }); });
    return () => { live = false; };
  }, [address, chainId, fromToken, balTick]);

  // The amount: dollars on a buy (the page's size to start with, within the
  // bounds a prepared order has), tokens on a sale.
  const [text, setText] = useState(() => (buy ? String(Math.min(USD_MAX, Math.max(USD_MIN, Math.round(size || 100)))) : ''));
  const parsed = parseAmount(text, buy ? 2 : fromDecimals ?? undefined);
  let amountError = parsed.error || null;
  if (!amountError && buy && (parsed.value < USD_MIN || parsed.value > USD_MAX)) amountError = `A buy here is from $${USD_MIN} to $${USD_MAX.toLocaleString('en-US')}.`;
  let raw = null;
  if (!amountError && fromDecimals != null) {
    try { raw = parseUnits(parsed.text, fromDecimals); } catch { raw = null; }
  }
  const short = bal?.raw != null && raw != null && bal.raw < raw;
  const setMax = () => { if (bal?.raw != null && fromDecimals != null) setText(rawText(bal.raw, fromDecimals).replace(/,/g, '')); };

  // The quote and everything after it.
  const [q, setQ] = useState({ status: 'idle' });
  const [allowance, setAllowance] = useState(null);
  const [wallet, setWallet] = useState({ status: 'idle' });
  const [agree, setAgree] = useState(false);
  const [approved, setApproved] = useState(null);
  const [tx, setTx] = useState(null);
  const [now, setNow] = useState(Date.now());
  const gen = useRef(0);
  const pollRef = useRef(null);
  const stopAll = () => { gen.current += 1; clearTimeout(pollRef.current); pollRef.current = null; };
  useEffect(() => () => stopAll(), []);
  // A quote answers one question: any change of amount, stablecoin or wallet
  // drops it (a sent swap stays on screen).
  useEffect(() => {
    if (tx) return;
    stopAll();
    setQ({ status: 'idle' }); setAllowance(null); setWallet({ status: 'idle' }); setApproved(null); setAgree(false);
  }, [text, pay.address, address]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (q.status !== 'ready') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [q.status]);

  const params = useMemo(() => (address && raw != null ? {
    fromChain: chainId, toChain: chainId, fromToken, toToken,
    fromAmount: raw.toString(), fromAddress: address, slippage: SLIPPAGE,
  } : null), [address, raw, chainId, fromToken, toToken]);

  const readAllowanceNow = useCallback(async (spender, owner) => {
    try {
      const a = await readAllowance({ chainId, token: fromToken, owner, spender });
      setAllowance({ raw: a, spender });
    } catch (e) {
      setAllowance({ error: e?.shortMessage || e?.message || 'read failed', spender });
    }
  }, [chainId, fromToken]);

  const getQuote = async () => {
    if (!params || !decOk || tx) return;
    stopAll();
    const g = gen.current;
    const asked = params;
    setQ({ status: 'quoting' }); setAllowance(null); setApproved(null);
    if (wallet.status === 'error') setWallet({ status: 'idle' });
    // Our reference and limit, read now, so its age is judged at the quote.
    const vc = buy
      ? await buyReference({ ticker, key: v.key, symbol, usd: parsed.value })
      : await sellReference({ ticker, key: v.key, symbol, tokens: parsed.value });
    if (g !== gen.current) return;
    // A reference that cannot pass refuses here, before LI.FI is asked:
    // no quote request, and the wallet address goes nowhere.
    const refProblem = referenceProblem({ vc, symbol, noun: 'trade', before: true });
    if (refProblem) { setQ({ status: 'refused', vc, why: refProblem }); return; }
    const r = await fetchQuote(asked);
    if (g !== gen.current) return;
    if (r.error) { setQ({ status: 'error', error: r.error }); return; }
    const quote = r.quote;
    const base = { quote, quotedAt: r.quotedAt, params: asked, vc };
    // LI.FI's decimals for both tokens against the chain's.
    const a = quote?.action || {};
    const decWrong = [];
    if (Number(a.fromToken?.decimals) !== fromDecimals) decWrong.push(`${fromSymbol}: LI.FI says ${a.fromToken?.decimals ?? 'nothing'}, the chain ${fromDecimals}`);
    if (Number(a.toToken?.decimals) !== toDecimals) decWrong.push(`${toSymbol}: LI.FI says ${a.toToken?.decimals ?? 'nothing'}, the chain ${toDecimals}`);
    // First, since every figure below is read in these decimals.
    if (decWrong.length) { setQ({ status: 'refused', ...base, facts: quoteFacts(quote), why: `LI.FI's token decimals do not match the ones read on ${chain.name} (${decWrong.join('; ')}), so the quote is not used.` }); return; }
    const c = checkQuote({ quote, params: asked, side, amount: parsed.value, slippage: SLIPPAGE, vc, symbol, noun: 'trade' });
    if (!c.ok) { setQ({ status: 'refused', ...base, facts: c.facts, ...(c.check ? { check: c.check } : {}), why: c.why }); return; }
    setQ({ status: 'ready', ...base, facts: c.facts, check: c.check, lp: c.lp, lpGap: c.gap, at: Date.now() });
    setNow(Date.now());
    if (c.facts.approvalAddress) readAllowanceNow(c.facts.approvalAddress, asked.fromAddress);
    else setAllowance({ none: true });
  };

  const f = q.facts;
  const age = q.status === 'ready' ? now - q.at : 0;
  const stale = q.status === 'ready' && age > QUOTE_MAX_AGE_MS;
  const sameWallet = q.status === 'ready' && !!address && lc(address) === lc(q.params.fromAddress);
  const allowShort = q.status === 'ready' && !!f.approvalAddress && allowance?.raw != null && raw != null && allowance.raw < raw;
  const needsApproval = allowShort && !approved;
  const waitingAllowance = allowShort && !!approved;
  const allowanceOk = q.status === 'ready' && (allowance?.none || (allowance?.raw != null && raw != null && allowance.raw >= raw));
  const busy = ['approving', 'confirming', 'signing', 'switching'].includes(wallet.status);
  const canAct = q.status === 'ready' && !stale && sameWallet && agree && !short && !tx && !busy;

  // The age and the wallet are checked again at the click, not only by the
  // 1 s timer.
  const refuseNow = () => {
    if (Date.now() - q.at <= QUOTE_MAX_AGE_MS && lc(address) === lc(q.params.fromAddress)) return false;
    setNow(Date.now());
    return true;
  };

  const switchNow = async () => {
    setWallet({ status: 'switching' });
    try { await ensureChain(chainId); setWallet({ status: 'idle' }); } catch (e) { setWallet({ status: 'error', error: walletErrorText(e) }); }
  };

  const approve = async () => {
    if (refuseNow()) return;
    setWallet({ status: 'approving' });
    const spender = f.approvalAddress;
    const owner = q.params.fromAddress;
    try {
      // Exactly `raw`: approveExact passes the amount to approve() as it is.
      const hash = await approveExact({ chainId, token: fromToken, spender, amount: raw });
      setApproved(hash);
      // The approval is mined; a public endpoint may still answer with the
      // old allowance for a few seconds. Read it every 2 s for up to 30 s
      // until it covers the amount. No second approval is offered.
      setWallet({ status: 'confirming', hash });
      for (let t = 0; t < 15; t += 1) {
        let got = null;
        try { got = await readAllowance({ chainId, token: fromToken, owner, spender }); } catch { got = null; }
        if (got != null) setAllowance({ raw: got, spender });
        if (got != null && got >= raw) break;
        await new Promise((res) => setTimeout(res, 2000));
      }
      setWallet({ status: 'approved', hash });
    } catch (e) {
      setWallet({ status: 'error', error: walletErrorText(e) });
    }
  };

  const POLL_MS = 5000;
  const poll = (hash, g, started, misses) => {
    fetchStatus({ txHash: hash, fromChain: chainId, toChain: chainId }).then((st) => {
      if (g !== gen.current) return;
      const miss = !!st.error || st.status === 'NOT_FOUND';
      const n = miss ? misses + 1 : misses;
      const elapsed = Date.now() - started;
      const done = st.status === 'DONE' || st.status === 'FAILED';
      const giveUp = !done && ((miss && (n >= 120 || elapsed > 10 * 60e3)) || elapsed > 60 * 60e3);
      setTx((t) => (t && t.hash === hash ? { ...t, lifi: st, unknown: giveUp ? (miss ? 'unseen' : 'pending') : false } : t));
      if (done || giveUp) return;
      pollRef.current = setTimeout(() => poll(hash, g, started, n), POLL_MS);
    });
  };

  const sign = async () => {
    if (refuseNow()) return;
    setWallet({ status: 'signing' });
    try {
      // LI.FI's transaction as quoted and checked, passed through.
      const hash = await sendSwap({ chainId, transactionRequest: q.quote.transactionRequest });
      setWallet({ status: 'sent' });
      setTx({ hash, lifi: null });
      const g = gen.current;
      pollRef.current = setTimeout(() => poll(hash, g, Date.now(), 0), POLL_MS);
      setBalTick((t) => t + 1);
    } catch (e) {
      setWallet({ status: 'error', error: walletErrorText(e) });
    }
  };

  const quota = quotaState();
  const est = q.quote?.estimate || {};
  const outText = f ? (rawText(est.toAmount, f.toDecimals) || tok(f.toAmount)) : null;
  const outMinText = f ? (rawText(est.toAmountMin, f.toDecimals) || tok(f.toAmountMin)) : null;
  const fromText = raw != null ? rawText(raw, fromDecimals) : null;
  const balText = bal?.raw != null && fromDecimals != null ? `${rawText(bal.raw, fromDecimals)} ${fromSymbol}` : null;
  const vc = q.vc;

  return (
    <Card aria-label={`${buy ? 'Buy' : 'Sell'} ${symbol}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-fg">{buy ? `Buy ${symbol} on ${chain.name}` : `Sell ${symbol} on ${chain.name}`}</h3>
        <span className="text-[12px] text-muted">Routed by LI.FI in your browser. Your wallet signs; Tnega never holds funds.</span>
      </div>

      {!address ? (
        <div className="mt-3">
          <p className="text-[13px] text-muted mb-2">Connect a wallet to read its balance and ask LI.FI for a route. Connecting signs nothing.</p>
          <button type="button" className={btn} onClick={() => openConnectModal?.()} disabled={walletStatus === 'connecting' || walletStatus === 'reconnecting'}>Connect a wallet</button>
        </div>
      ) : (
        <>
          <dl className="mt-3 divide-y divide-line border-y border-line">
            {chain.pay.length > 1 && (
              <Row label={buy ? 'Pay with' : 'Receive'}>
                <div className="flex flex-wrap gap-3">
                  {chain.pay.map((p) => (
                    <label key={p.address} className="inline-flex items-center gap-1.5">
                      <input type="radio" name={`pay-${v.key}-${side}`} checked={p.address === pay.address} onChange={() => setPayAddr(p.address)} disabled={!!tx} />
                      {p.symbol}
                    </label>
                  ))}
                </div>
              </Row>
            )}
            <Row label={buy ? `You pay, in ${pay.symbol}` : `You sell, in ${symbol}`}>
              <div className="flex items-center gap-2 max-w-[320px]">
                {buy && <span className="text-muted" aria-hidden="true">$</span>}
                <input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} aria-label={buy ? `Dollars of ${pay.symbol} to pay` : `${symbol} to sell`}
                  className={input} value={text} onChange={(e) => setText(e.target.value.trim())} disabled={!!tx || busy} placeholder={buy ? '100' : '0.01'} />
                {!buy && <button type="button" className={`${btn2} shrink-0`} onClick={setMax} disabled={bal?.raw == null || fromDecimals == null || !!tx || busy}>Max</button>}
              </div>
              {text && amountError && <span role="alert" className="block mt-1 text-[12px] text-warn">{amountError}</span>}
              {buy && !amountError && <span className="block mt-1 text-[12px] text-muted">{parsed.text} {pay.symbol}, taken at $1 a token.</span>}
            </Row>
            <Row label={`Your ${fromSymbol} balance`}>
              {balText || (bal?.error ? <span className="text-warn">not read: {bal.error}</span> : 'reading')}
              {balText && <span className="block text-[12px] text-muted">{shortAddress(address)}, read on {chain.name} just now.</span>}
              {short && <span className="block text-[12px] text-warn">Less than {fromText} {fromSymbol}; nothing can be signed until the wallet holds it.</span>}
              {(bal?.error || short) && <button type="button" className="mt-1 text-[12px] text-accent hover:underline" onClick={() => setBalTick((t) => t + 1)}>Read it again</button>}
            </Row>
            <Row label="You receive">
              {toSymbol} on {chain.name}
              <span className="block text-[12px] text-muted">How much is LI.FI&apos;s quote below, not a figure from Tnega.</span>
            </Row>
            <Row label="Max slippage">{pct(SLIPPAGE)}<span className="block text-[12px] text-muted">The route has to guarantee at least the estimate less this.</span></Row>
          </dl>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className={q.status === 'ready' && !stale ? btn2 : btn} onClick={getQuote} disabled={!params || !decOk || !!amountError || q.status === 'quoting' || busy || !!tx}>
              {q.status === 'quoting' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {q.status === 'idle' ? 'Get a LI.FI quote' : 'Get a new quote'}
            </button>
            <span className="text-[11px] text-muted">One request to li.quest from this browser, only when you press it. This browser has used {quota.used} of LI.FI&apos;s {QUOTA_LIMIT} per 2 hours.</span>
          </div>
          {dec.bad && <p role="alert" className="mt-2 text-[13px] text-neg">The token decimals read on {chain.name} do not agree ({dec.bad.join('; ')}), so nothing is quoted or signed. Neither value was kept. <button type="button" className="underline" onClick={() => setDecTick((t) => t + 1)}>Read them again</button></p>}
          {dec.error && <p role="alert" className="mt-2 text-[13px] text-warn">The tokens&apos; decimals could not be read on {chain.name} ({dec.error}); nothing is quoted until they are. <button type="button" className="underline" onClick={() => setDecTick((t) => t + 1)}>Read them again</button></p>}
          {!decOk && !dec.bad && !dec.error && <p className="mt-2 text-[12px] text-muted">Reading both tokens&apos; decimals on {chain.name}.</p>}

          {q.status === 'error' && <p role="alert" className="mt-3 text-[13px] text-neg">{q.error}</p>}
          {q.status === 'refused' && (
            <div role="alert" className="mt-3 rounded border border-neg/50 p-3 text-[13px]">
              <p className="text-neg font-semibold">{q.why}</p>
              {q.check?.value && <p className="mt-1 text-muted">Checked against {q.check.value.basis}: {fmtUsd(q.check.value.price)} per token.</p>}
              {f?.tools?.length > 0 && <p className="mt-1 text-muted">Route: {f.tools.join(', ')}. Quoted at {clockText(Date.parse(q.quotedAt))}.</p>}
            </div>
          )}
          {q.status === 'ready' && (
            <dl className="mt-3 divide-y divide-line border-y border-line">
              <Row label="You receive, LI.FI's estimate">{outText} {f.toSymbol}</Row>
              <Row label={`At least, after ${pct(SLIPPAGE)} slippage`}>{outMinText} {f.toSymbol}<span className="block text-[12px] text-muted">LI.FI&apos;s minimum: the swap reverts if it would receive less.</span></Row>
              <Row label={buy ? 'You pay' : 'You sell'}>{fromText} {fromSymbol}</Row>
              {f.fees.map((x) => (
                <Row key={x.name} label={x.name}>
                  {Number.isFinite(x.pct) && x.pct < 1 ? pct(x.pct) : ''}{Number.isFinite(x.usd) ? ` (${usdSmall(x.usd)}, LI.FI's dollar figure)` : ''}{x.included ? (buy ? ', taken out of the amount paid' : `, taken out of the ${fromSymbol} sold, so out of what you receive`) : ''}
                </Row>
              ))}
              {f.gas.map((g, i) => (
                <Row key={`gas-${i}`} label="Network fee, LI.FI's estimate">{tok(g.amount, 6)} {g.symbol}{Number.isFinite(g.usd) ? ` (${usdSmall(g.usd)})` : ''}</Row>
              ))}
              <Row label="Route">{f.tools.join(', ') || 'not named'}{f.steps ? `, ${f.steps} step${f.steps === 1 ? '' : 's'}` : ''}</Row>
              <Row label="Quoted at">
                {clockText(Date.parse(q.quotedAt))}
                <span className={`block text-[12px] ${stale ? 'text-warn' : 'text-muted'}`}>{stale ? 'Over 60 s ago: get a new quote before signing.' : `${Math.round(age / 1000)} s ago. A quote is signed only while it is under 60 s old.`}</span>
              </Row>
              <Row label="Price check">
                {[['value', 'our measured price'], ['lifi', q.check.lifi.source]].map(([k, name]) => {
                  const x = q.check[k];
                  return (
                    <span key={k} className="block">
                      {buy
                        ? <>At {name}, {fmtUsd(x.price)} per token, at least {outMinText} {f.toSymbol} is worth {fmtUsd(x.valueOut)} for {fmtUsd(x.valueIn)} paid: </>
                        : <>At {name}, {fmtUsd(x.price)} per token, {fromText} {fromSymbol} is worth {fmtUsd(x.valueIn)}, for at least {outMinText} {f.toSymbol}: </>}
                      {x.loss >= 0 ? `${pct(x.loss)} less, within this trade's ${pct(q.check.value.limit)} limit` : `${pct(-x.loss)} more, within 5%`}.
                    </span>
                  );
                })}
                <span className="block text-[12px] text-muted">
                  Ours is {vc.basis}, measured {clockText(vc.measuredAt)}{now - vc.measuredAt > REFERENCE_MAX_AGE_MS ? ' (now over 30 minutes old: get a new quote)' : ''}. The minimum has to pass at both prices. This trade&apos;s limit is {pct(vc.limit)}: the rule, the smaller of 5% and the larger of 2% and three times our measured cost without gas, gives {pct(vc.ruleLimit)} here ({vc.limitBasis}), and the Buy and Sell tabs use at most 2% until our reference comes signed. The two prices are {pct(Math.abs(q.lpGap))} apart, within 5%. The stablecoin is taken at $1.
                </span>
              </Row>
              <Row label="Approval">
                {f.approvalAddress ? <>LI.FI&apos;s contract <Ext href={addressUrl(chainId, f.approvalAddress)} mono>{f.approvalAddress}</Ext></> : 'none needed'}
                {needsApproval && <span className="block text-[12px] text-muted">Allowance now {rawText(allowance.raw, fromDecimals)} {fromSymbol}. An approval for exactly {fromText} {fromSymbol} comes first, as its own wallet prompt; never an unlimited one.</span>}
                {allowanceOk && f.approvalAddress && <span className="block text-[12px] text-muted">The allowance already covers the amount; no approval needed.</span>}
                {allowance?.error && <span className="block text-[12px] text-warn">Allowance not read: {allowance.error}</span>}
              </Row>
            </dl>
          )}

          <ol className="mt-3 divide-y divide-line border-t border-line">
            <Step n={1} done={walletChain === chainId} active={walletChain !== chainId} title={`Be on ${chain.name}`}>
              {walletChain !== chainId && (
                <>
                  <p>Your wallet is on {BUY_CHAINS[walletChain]?.name || `chain ${walletChain}`}. It is asked to switch when you approve or sign, or now.</p>
                  <button type="button" className={`${btn2} mt-2`} onClick={switchNow} disabled={busy}>{wallet.status === 'switching' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Switch to {chain.name}</button>
                </>
              )}
            </Step>
            <Step n={2} done={q.status === 'ready' && !stale} active={q.status !== 'ready' || stale} title="A LI.FI quote under 60 s old">
              {(q.status !== 'ready' || stale) && <p>Get a quote above; the swap signed is the one quoted.</p>}
              {q.status === 'ready' && !sameWallet && <p role="alert" className="text-warn">The connected wallet is not the one this quote was asked for. Get a new quote.</p>}
            </Step>
            <Step n={3} done={allowanceOk} active={needsApproval || waitingAllowance} title={f?.approvalAddress === null ? 'No approval needed' : `Approve exactly ${fromText || ''} ${fromSymbol}`}>
              {needsApproval && (
                <button type="button" className={`${btn2} mt-1`} onClick={approve} disabled={!canAct}>
                  {wallet.status === 'approving' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  Approve exactly {fromText} {fromSymbol}
                </button>
              )}
              {needsApproval && !agree && <p className="mt-1">Tick the box below first.</p>}
              {wallet.status === 'approving' && <p className="mt-1">Confirm the approval in your wallet, then wait for one confirmation.</p>}
              {wallet.status === 'confirming' && <p className="mt-1">Approved: <Ext href={txUrl(chainId, approved)}>{shortAddress(approved)}</Ext>. Reading the new allowance on {chain.name}.</p>}
              {approved && wallet.status !== 'confirming' && (
                <p className="mt-1">Approved: <Ext href={txUrl(chainId, approved)}>{shortAddress(approved)}</Ext>.{waitingAllowance ? ` ${chain.name}'s endpoint does not show the new allowance yet; no second approval is asked for.` : ''}{stale ? ' The quote is now over 60 s old: get a new one, then sign.' : ''}</p>
              )}
              {waitingAllowance && wallet.status !== 'confirming' && (
                <button type="button" className={`${btn2} mt-2`} onClick={() => readAllowanceNow(f.approvalAddress, q.params.fromAddress)}>Read the allowance again</button>
              )}
            </Step>
            <Step n={4} done={!!tx} active={allowanceOk && !tx} title={`Sign the swap: ${fromSymbol} to ${toSymbol}`}>
              <div className="rounded bg-inset p-3 mt-1 text-fg">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">Who may hold {symbol}{issuer ? `, in ${issuer}’s words` : ''}</div>
                <Eligibility e={v.eligibility} />
                <label className="mt-3 flex items-start gap-2">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" disabled={!!tx} />
                  <span>I am not a restricted person under {issuer ? `${issuer}’s` : 'the issuer’s'} terms</span>
                </label>
                <p className="mt-1 text-[11px] text-muted">Shown, not enforced: Tnega does not check who you are.</p>
              </div>
              <button type="button" className={`${btn} mt-3`} onClick={sign} disabled={!canAct || !allowanceOk}>
                {wallet.status === 'signing' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Sign the swap
              </button>
              {wallet.status === 'signing' && <p className="mt-1">Confirm the swap in your wallet.</p>}
            </Step>
          </ol>
          {wallet.status === 'error' && <p role="alert" className="mt-2 text-[13px] text-neg">{wallet.error}</p>}
          {tx && (
            <div className="mt-3 rounded border border-line p-3 text-[13px]" aria-live="polite">
              <div>Sent: <Ext href={txUrl(chainId, tx.hash)} mono>{tx.hash}</Ext></div>
              <div className="mt-1 text-muted">
                {tx.unknown === 'pending'
                  ? 'LI.FI still reports it as pending after an hour; check the explorer.'
                  : tx.unknown
                  ? 'Status unknown: LI.FI has not reported it. Check the explorer.'
                  : <>LI.FI status: {tx.lifi?.status ? `${tx.lifi.status}${tx.lifi.substatus ? ` (${tx.lifi.substatus})` : ''}${tx.lifi.message ? `: ${tx.lifi.message}` : ''}` : tx.lifi?.error ? `not read yet: ${tx.lifi.error}` : 'checking every 5 s'}</>}
              </div>
            </div>
          )}
        </>
      )}
      <p className="mt-3 text-[12px] text-muted">
        The quote and the swap come from LI.FI; Tnega passes LI.FI&apos;s transaction to your wallet as LI.FI built it, after the checks above. LI.FI takes a 0.25% fee; Tnega takes none.
      </p>
    </Card>
  );
}
