// sign/SignOrderPage.jsx
//
// /sign/<id>: one order prepared outside the site (through Tnega's MCP
// server), shown in full and signed, step by step, in the visitor's own
// wallet. A standalone page: one component for every width, like /status
// and /privacy (App.jsx returns it before the web/mobile split).
//
// WHAT THE PAGE DOES, each wallet step on the visitor's own click:
//   1. reads the order from our API (sign/order.js): what, which chain, how
//      much, paid or received in which stablecoin, the slippage, the wallet
//      it was prepared for and when the link expires (10 minutes);
//   2. "Get a LI.FI quote": one request from this browser to li.quest for
//      the order's wallet, which needs no wallet connected. The answer is
//      refused if it does not match the order, if a step names Jupiter, if
//      the minimum sits further below the estimate than the order's
//      slippage, or if our own value check fails (sign/order.js orderCheck);
//   3. connect a wallet: it has to be the order's wallet, or nothing is
//      offered for signing;
//   4. "Approve", only when the allowance to LI.FI's approval address is
//      below the amount, and for exactly the amount (trade/evmExecute.js
//      approveExact passes the amount through; never an unlimited approval);
//   5. "Sign the swap": LI.FI's transaction as quoted, only while the quote
//      is under 60 s old, so what is signed was quoted just before;
//   6. the hash, an explorer link, LI.FI's status, and a note to our API that
//      the link was used.
//
// The site's Buy switch (trade/buyLive.js) is not read here: a page load of
// /sign/<id> gets its own wallet config (sign/signWagmi.js) through
// sign/SignRoot.jsx, in place of the site's (main.jsx).

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useConfig, useDisconnect } from 'wagmi';
import { Loader2 } from 'lucide-react';
import { useConnectedWallet, shortAddress } from '../wallet/useConnectedWallet';
import { Card, CardTitle, fmtUsd } from '../ui/primitives';
import { Eligibility } from '../home/cards';
import Brand from '../shell/Brand';
import StandaloneBar from '../shell/StandaloneBar';
import TokenControls from '../controls/TokenControls';
import { tokenLink } from '../controls/model';
import { useTe } from '../te/api';
import { setNoIndex, updatePageMeta } from '../seoMeta';
import { BUY_CHAINS, addressUrl, txUrl } from '../trade/chains';
import { fetchQuote, fetchStatus, quotaState, QUOTE_MAX_AGE_MS, QUOTA_LIMIT } from '../trade/lifi';
import { checkQuote } from '../trade/quoteCheck';
import { readBalance, readAllowance, approveExact, sendSwap, ensureChain, walletErrorText } from '../trade/evmExecute';
import {
  readOrder, markDone, rawAmount, rawAgrees, quoteParams, decimalsMismatch, REFERENCE_MAX_AGE_MS,
} from './order';
import { signWagmiConfig, SIGN_CHAIN_IDS, secondOpinionClient } from './signWagmi';
import { readDecimals, commitDecimals, forgetDecimals } from './tokenMeta';
import { rawText, clockText } from '../trade/format';
import { Tip } from '../dashboard/cards';
import GuideLink from '../guide/GuideLink';
import { tok, pct, amountText, mmss, Row, Ext, btn, btn2, ASK_AGAIN, Step } from './signUi';

// A Solana order is drawn by its own view, loaded only when the order is one:
// @solana/web3.js and the wallet adapter are in that chunk, so a page for an
// EVM order (and every other page of the site) never downloads them.
const SolanaOrderView = lazy(() => import('./SolanaOrderView.jsx'));

class SolanaLoadGuard extends React.Component {
  constructor(p) { super(p); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <Ended state="setup" onRetry={() => window.location.reload()} />
      : this.props.children;
  }
}

const config = signWagmiConfig;
const lc = (a) => String(a || '').toLowerCase();
/** The frame every state of the page shares: the mark, the theme control,
 *  one column. */
function Frame({ children }) {
  return (
    <div className="min-h-screen bg-page text-fg">
      <div className="max-w-[760px] mx-auto px-4 md:px-6 pt-5 pb-12">
        <StandaloneBar className="mb-6">
          <a href="/" aria-label="Tnega home" className="flex items-center"><Brand markClassName="w-[30px] h-[30px]" wordClassName="text-[20px]" /></a>
        </StandaloneBar>
        {children}
      </div>
    </div>
  );
}

/** Expired, invalid, used or unreadable: what happened, and what to do. */
function Ended({ state, reason, onRetry }) {
  const copy = {
    expired: {
      title: 'This signing link has expired',
      body: 'A signing link works for 10 minutes from when the order was prepared. This one has run out, so nothing more can be signed from it.',
    },
    invalid: {
      title: 'This signing link is not valid',
      body: 'The link did not pass Tnega’s check: it may have been cut short or changed on the way. Nothing can be signed from it.',
    },
    used: {
      title: 'This signing link was marked as used',
      // "Used" means a transaction hash was reported for this link (POST
      // /api/sign/<id>/done, which anyone holding the link can call), not
      // that a swap is known to have been sent.
      body: 'A transaction was reported for this link, so it is not offered for signing again. Check your wallet\u2019s activity before doing anything else; if nothing was sent, ask your assistant to prepare a new order.',
    },
    setup: {
      title: 'This page did not load fully',
      body: 'The part of the page that talks to your wallet did not load, so nothing is offered for signing. The link itself may be fine: reload the page.',
    },
    error: {
      title: 'The order could not be read',
      body: 'Tnega’s server did not answer with the order. The link itself may be fine.',
    },
  }[state];
  return (
    <Card className="max-w-[560px]">
      <h1 className="text-[20px] font-semibold text-fg">{copy.title}</h1>
      <p className="mt-2 text-[14px] text-muted">{copy.body}</p>
      {reason && <p className="mt-2 text-[13px] text-muted">{reason}</p>}
      {state !== 'used' && <p className="mt-3 text-[14px] text-fg">{ASK_AGAIN}</p>}
      {state === 'error' && <button type="button" className={`${btn2} mt-4`} onClick={onRetry}>Read the order again</button>}
      {state === 'setup' && <button type="button" className={`${btn2} mt-4`} onClick={onRetry}>Reload the page</button>}
    </Card>
  );
}

export default function SignOrderPage({ id }) {
  // Under the site's providers (sign/SignRoot.jsx failed to load), the
  // wallet could not be switched to most order chains: nothing is offered.
  const active = useConfig();
  if (active !== signWagmiConfig) {
    return <Frame><Ended state="setup" onRetry={() => window.location.reload()} /></Frame>;
  }
  return <SignOrder id={id} />;
}

function SignOrder({ id }) {
  useEffect(() => setNoIndex(true), []);
  useEffect(() => {
    updatePageMeta({ title: 'Sign an order', description: 'An order prepared through Tnega, signed in your own wallet.', path: '/sign' });
  }, []);

  const [load, setLoad] = useState({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ state: 'loading' });
    readOrder(id).then((r) => { if (live) setLoad(r.order ? { state: 'ok', order: r.order } : r); });
    return () => { live = false; };
  }, [id, attempt]);

  if (load.state === 'loading') {
    return <Frame><div className="flex items-center gap-2 text-[14px] text-muted"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Reading the order</div></Frame>;
  }
  if (load.state !== 'ok') return <Frame><Ended state={load.state} reason={load.reason} onRetry={() => setAttempt((a) => a + 1)} /></Frame>;
  if (load.order.family === 'solana') {
    return (
      <Frame>
        <SolanaLoadGuard>
          <Suspense fallback={<div className="flex items-center gap-2 text-[14px] text-muted"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Loading the Solana wallet tools</div>}>
            <SolanaOrderView id={id} order={load.order} />
          </Suspense>
        </SolanaLoadGuard>
      </Frame>
    );
  }
  if (!SIGN_CHAIN_IDS.includes(load.order.chainId)) return <Frame><Ended state="invalid" reason={`This page cannot switch a wallet to chain ${load.order.chainId}.`} /></Frame>;
  return <Frame><Order id={id} order={load.order} /></Frame>;
}

function Order({ id, order }) {
  const buy = order.side === 'buy';
  const { address, chainId: walletChain, status: walletStatus } = useConnectedWallet();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const matches = !!address && lc(address) === lc(order.wallet);
  const chainName = order.chainName;

  // Our read: the token's issuer controls, with their evidence (the same
  // card the stock page shows). Everything else comes with the order.
  const controls = useTe(`/api/te/controls?by=key&key=${encodeURIComponent(order.key)}`);
  const ticker = order.token.ticker || controls.data?.underlying || null;
  const symbol = order.token.symbol || controls.data?.symbol || shortAddress(order.token.address);
  const issuer = order.token.issuer || controls.data?.issuer || null;
  const name = order.token.name || null;
  const eligibility = (order.eligibility && typeof order.eligibility === 'object' ? order.eligibility : null)
    || controls.data?.controls?.who_may_hold || null;
  const vc = order.valueCheck;

  // Both tokens' decimals, ALWAYS read on chain before anything is quoted,
  // and held against the order's: the exact amount is worked out from the
  // chain's figures, so a server answer with other decimals cannot change
  // how many tokens are approved or sold.
  const [dec, setDec] = useState({ token: null, pay: null, error: null });
  const [decTick, setDecTick] = useState(0);
  useEffect(() => {
    let live = true;
    setDec({ token: null, pay: null, error: null });
    const c = order.chainId;
    const both = (opts) => Promise.all([
      readDecimals(config, c, order.token.address, opts),
      readDecimals(config, c, order.pay.address, opts),
    ]).then(([token, pay]) => ({ token, pay }));
    const agrees = (d) => decimalsMismatch(order, d).length === 0;
    const keep = (d) => { commitDecimals(c, order.token.address, d.token); commitDecimals(c, order.pay.address, d.pay); };
    const forget = () => { forgetDecimals(c, order.token.address); forgetDecimals(c, order.pay.address); };
    (async () => {
      // First read (a kept, checked value if there is one). Kept only once
      // it agrees with the order and this site's list.
      let d = await both({});
      if (!agrees(d)) {
        // A disagreement is read once more, past anything kept, from the
        // chain's endpoints starting at a different one, before refusing.
        forget();
        d = await both({ fresh: true, client: secondOpinionClient(c) });
      }
      if (agrees(d)) keep(d);
      if (live) setDec({ ...d, error: null });
    })().catch((e) => { if (live) setDec({ token: null, pay: null, error: e?.shortMessage || e?.message || 'read failed' }); });
    return () => { live = false; };
  }, [order, decTick]);
  const decRead = dec.token != null && dec.pay != null;
  const decBad = decRead ? decimalsMismatch(order, dec) : [];
  const tokenDecimals = decRead ? dec.token : null;

  const computedRaw = decRead && !decBad.length ? rawAmount(order, dec.token, dec.pay) : null;
  // Two workings of one amount; if they differ, nothing is quoted or signed.
  const rawMismatch = computedRaw != null && !rawAgrees(order, computedRaw);
  const raw = rawMismatch ? null : computedRaw;
  const fromToken = buy ? order.pay.address : order.token.address;
  const fromDecimals = buy ? (decRead ? dec.pay : null) : tokenDecimals;
  const fromSymbol = buy ? order.pay.symbol : symbol;

  // The countdown, against the server's seconds left.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = order.deadline - now;
  const expired = left <= 0;

  // The order's wallet's balance of what it pays with, read on the chain
  // once the decimals are (it is shown in them), as a read of its own.
  const [bal, setBal] = useState(null);
  const [balTick, setBalTick] = useState(0);
  useEffect(() => {
    let live = true;
    setBal(null);
    if (!decRead) return undefined;
    readBalance({ chainId: order.chainId, token: fromToken, owner: order.wallet, config })
      .then((r) => { if (live) setBal({ raw: r }); })
      .catch((e) => { if (live) setBal({ error: e?.shortMessage || e?.message || 'read failed' }); });
    return () => { live = false; };
  }, [order.chainId, fromToken, order.wallet, balTick, decRead]);
  const short = bal?.raw != null && raw != null && bal.raw < raw;

  // The quote and everything after it.
  const [q, setQ] = useState({ status: 'idle' });
  const [allowance, setAllowance] = useState(null);
  const [wallet, setWallet] = useState({ status: 'idle' });
  const [agree, setAgree] = useState(false);
  // The hash of the approval sent from this page, once there is one.
  const [approved, setApproved] = useState(null);
  const [tx, setTx] = useState(null);
  const gen = useRef(0);
  const pollRef = useRef(null);
  const stopAll = () => { gen.current += 1; clearTimeout(pollRef.current); pollRef.current = null; };
  useEffect(() => () => stopAll(), []);

  const params = useMemo(() => quoteParams(order, raw), [order, raw]);

  const readAllowanceNow = useCallback(async (spender) => {
    try {
      const a = await readAllowance({ chainId: order.chainId, token: fromToken, owner: order.wallet, spender, config });
      setAllowance({ raw: a, spender });
    } catch (e) {
      setAllowance({ error: e?.shortMessage || e?.message || 'read failed', spender });
    }
  }, [order.chainId, fromToken, order.wallet]);

  const getQuote = async () => {
    if (!params || expired) return;
    stopAll();
    const g = gen.current;
    setQ({ status: 'quoting' }); setAllowance(null);
    if (wallet.status === 'error') setWallet({ status: 'idle' });
    const r = await fetchQuote(params);
    if (g !== gen.current) return;
    if (r.error) { setQ({ status: 'error', error: r.error }); return; }
    const quote = r.quote;
    // Every check, in the order the page has always run them, shared with
    // the stock page's Buy and Sell tabs (trade/quoteCheck.js).
    const c = checkQuote({ quote, params, side: order.side, amount: Number(order.amount), slippage: order.slippage, vc, symbol, noun: 'order' });
    const facts = c.facts;
    const base = { quote, facts, quotedAt: r.quotedAt };
    if (!c.ok) { setQ({ status: 'refused', ...base, ...(c.check ? { check: c.check } : {}), why: c.why }); return; }
    const { check, lp, gap } = c;
    setQ({ status: 'ready', ...base, check, lp, lpGap: gap, at: Date.now() });
    setNow(Date.now());
    if (facts.approvalAddress) readAllowanceNow(facts.approvalAddress);
    else setAllowance({ none: true });
  };

  const f = q.facts;
  const age = q.status === 'ready' ? now - q.at : 0;
  const stale = q.status === 'ready' && age > QUOTE_MAX_AGE_MS;
  const short2 = q.status === 'ready' && !!f.approvalAddress && allowance?.raw != null && raw != null && allowance.raw < raw;
  // Approve is offered once per page: after an approval was sent, a short
  // allowance is read again, never approved again.
  const needsApproval = short2 && !approved;
  const waitingAllowance = short2 && !!approved;
  const allowanceOk = q.status === 'ready' && (allowance?.none || (allowance?.raw != null && raw != null && allowance.raw >= raw));
  const busy = wallet.status === 'approving' || wallet.status === 'confirming' || wallet.status === 'signing' || wallet.status === 'switching';
  const canAct = q.status === 'ready' && !stale && !expired && matches && agree && !short && !tx && !busy;

  const tooOld = () => {
    if (Date.now() - q.at <= QUOTE_MAX_AGE_MS && Date.now() < order.deadline) return false;
    setNow(Date.now());
    return true;
  };

  const switchNow = async () => {
    setWallet({ status: 'switching' });
    try { await ensureChain(order.chainId, config); setWallet({ status: 'idle' }); } catch (e) { setWallet({ status: 'error', error: walletErrorText(e) }); }
  };

  const approve = async () => {
    if (tooOld()) return;
    setWallet({ status: 'approving' });
    try {
      // Exactly `raw`: approveExact passes the amount to approve() as it is.
      const hash = await approveExact({ chainId: order.chainId, token: fromToken, spender: f.approvalAddress, amount: raw, config });
      setApproved(hash);
      // The approval is mined; the public endpoint may still answer with the
      // old allowance for a few seconds. Read it every 2 s for up to 30 s
      // until it covers the amount. No second approval is offered meanwhile,
      // or after (approved is set): the page offers a re-read instead.
      setWallet({ status: 'confirming', hash });
      const spender = f.approvalAddress;
      for (let t = 0; t < 15; t += 1) {
        let a = null;
        try { a = await readAllowance({ chainId: order.chainId, token: fromToken, owner: order.wallet, spender, config }); } catch { a = null; }
        if (a != null) setAllowance({ raw: a, spender });
        if (a != null && a >= raw) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      setWallet({ status: 'approved', hash });
    } catch (e) {
      setWallet({ status: 'error', error: walletErrorText(e) });
    }
  };

  const POLL_MS = 5000;
  const poll = (hash, g, started, misses) => {
    fetchStatus({ txHash: hash, fromChain: order.chainId, toChain: order.chainId }).then((st) => {
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
    if (tooOld()) return;
    setWallet({ status: 'signing' });
    try {
      const hash = await sendSwap({ chainId: order.chainId, transactionRequest: q.quote.transactionRequest, config });
      setWallet({ status: 'sent' });
      setTx({ hash, lifi: null, noted: null });
      markDone(id, hash).then((r) => setTx((t) => (t && t.hash === hash ? { ...t, noted: r } : t)));
      const g = gen.current;
      pollRef.current = setTimeout(() => poll(hash, g, Date.now(), 0), POLL_MS);
    } catch (e) {
      setWallet({ status: 'error', error: walletErrorText(e) });
    }
  };

  const quota = quotaState();
  const rawFrom = rawText(raw, fromDecimals) || amountText(order.amount);
  const est = q.quote?.estimate || {};
  const outText = f ? (rawText(est.toAmount, f.toDecimals) || tok(f.toAmount)) : null;
  const outMinText = f ? (rawText(est.toAmountMin, f.toDecimals) || tok(f.toAmountMin)) : null;
  const payLine = buy
    ? <>{fmtUsd(Number(order.amount))} in {order.pay.symbol} on {chainName}<span className="block text-[12px] text-muted">{amountText(order.amount)} {order.pay.symbol}, taken at $1 a token.</span></>
    : <>{amountText(order.amount)} {symbol} on {chainName}</>;
  const title = buy ? `Buy ${fmtUsd(Number(order.amount))} of ${ticker || symbol}` : `Sell ${amountText(order.amount)} ${symbol}`;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[26px] md:text-[30px] font-bold tracking-[-0.02em] text-fg leading-tight">{title}</h1>
          <GuideLink id="signing" newTab />
        </div>
        <p className="mt-1 text-[14px] text-muted">
          {symbol}{issuer ? ` from ${issuer}` : ''} on {chainName}. Prepared through Tnega for wallet {shortAddress(order.wallet)}. Nothing is signed until you sign each transaction in your own wallet; Tnega never holds funds or keys.
        </p>
        <div className={`mt-3 inline-flex items-center gap-2 rounded border px-3 py-1.5 text-[13px] ${expired ? 'border-neg/50 text-neg' : left < 120e3 ? 'border-warn/60 text-warn' : 'border-line text-fg'}`} aria-live="polite">
          {expired
            ? <>This link has expired. {ASK_AGAIN}</>
            : tx ? <>Sent from this link</> : <span>Link expires in <span className="tabular-nums font-semibold">{mmss(left)}</span><span className="text-muted">, at {clockText(order.signedExpiry)}</span></span>}
        </div>
      </div>

      <Card>
        <CardTitle>The order</CardTitle>
        <dl className="divide-y divide-line border-t border-line">
          <Row label={buy ? 'Buying' : 'Selling'}>
            {name ? `${name}${ticker ? ` (${ticker})` : ''}` : ticker || symbol}
            <span className="block text-[12px] text-muted">Token {symbol}{issuer ? `, issued by ${issuer}` : ''}</span>
          </Row>
          <Row label="Token address"><Ext href={addressUrl(order.chainId, order.token.address)} mono>{order.token.address}</Ext></Row>
          <Row label="Chain">{chainName}</Row>
          <Row label={buy ? 'You pay' : 'You sell'}>{payLine}</Row>
          <Row label="You receive">
            {buy ? symbol : `${order.pay.symbol} on ${chainName}`}
            <span className="block text-[12px] text-muted">How much is LI.FI&apos;s quote below, not a figure from Tnega.</span>
          </Row>
          <Row label="Max slippage">{pct(order.slippage)}<span className="block text-[12px] text-muted">The route has to guarantee at least the estimate less this.</span></Row>
          <Row label="Price check">
            {vc && !vc.reason ? (
              <>
                Valued at our measured price, {fmtUsd(vc.price)} per {symbol}, LI.FI&apos;s minimum may be at most {pct(vc.limit)} below {buy ? 'what you pay' : 'the value of the tokens sold'}, and not over 5% above.
                <span className="block text-[12px] text-muted">
                  {vc.basis ? `${vc.basis}, ` : ''}measured {vc.measuredAt != null ? clockText(vc.measuredAt) : 'at a time not given'}.
                  <span className="inline-flex align-middle ml-1"><Tip label="About the price check" align="left"><span className="block">Tnega&apos;s own measured price for this token, from its cost engine. A measurement over 30 minutes old is not used.</span></Tip></span>
                </span>
                {(vc.measuredAt == null || now - vc.measuredAt > REFERENCE_MAX_AGE_MS) && (
                  <span className="block text-[12px] text-warn">This measurement is {vc.measuredAt == null ? 'undated' : `${Math.floor((now - vc.measuredAt) / 60e3)} minutes old`}, so a quote is not checked against it and nothing can be signed until it is refreshed.</span>
                )}
              </>
            ) : (
              <span className="text-warn">No measured price to check a quote against ({vc?.reason || 'none sent'}), so this order cannot be signed here.</span>
            )}
          </Row>
          <Row label="Fees">
            LI.FI&apos;s 0.25% fee and the network fee, as LI.FI quotes them below. Tnega takes no fee.
          </Row>
          <Row label="Prepared for wallet">
            <Ext href={addressUrl(order.chainId, order.wallet)} mono>{order.wallet}</Ext>
            <span className="block text-[12px] text-muted">Only this wallet can sign this order here.</span>
          </Row>
          <Row label={`The wallet's ${fromSymbol || 'token'} balance`}>
            {bal?.raw != null && fromDecimals != null ? `${rawText(bal.raw, fromDecimals)} ${fromSymbol}` : bal?.error ? <span className="text-warn">not read: {bal.error}</span> : 'reading'}
            {bal?.raw != null && <span className="block text-[12px] text-muted">Read on {chainName} just now.</span>}
            {short && <span className="block text-[12px] text-warn">Less than the order&apos;s {amountText(order.amount)} {fromSymbol}; the swap cannot be signed until the wallet holds it.</span>}
            {(bal?.error || short) && <button type="button" className="mt-1 text-[12px] text-accent hover:underline" onClick={() => setBalTick((t) => t + 1)}>Read it again</button>}
          </Row>
        </dl>
      </Card>

      <Card>
        <CardTitle>LI.FI&apos;s quote</CardTitle>
        <p className="text-[13px] text-muted flex items-center gap-1.5">
          Checked against the order and Tnega&apos;s measured price before it can be signed.
          <Tip label="About the quote" align="left">
            <span className="block">A route and a price from LI.FI (li.quest), asked by this browser for the order&apos;s wallet. It needs no wallet connected.</span>
            <span className="block">Tnega checks it against the order and against our own measured price before it can be signed.</span>
          </Tip>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={q.status === 'ready' && !stale ? btn2 : btn} onClick={getQuote} disabled={!params || expired || q.status === 'quoting' || busy || !!tx}>
            {q.status === 'quoting' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {q.status === 'idle' ? 'Get a LI.FI quote' : 'Get a new quote'}
          </button>
          <span className="text-[11px] text-muted">One request from this browser, only when you press it. This browser has used {quota.used} of LI.FI&apos;s {QUOTA_LIMIT} per 2 hours.</span>
        </div>
        {rawMismatch && <p role="alert" className="mt-2 text-[13px] text-neg">The order&apos;s exact amount ({order.serverRaw} units) does not match {amountText(order.amount)} {fromSymbol} worked out here ({String(computedRaw)} units), so nothing is quoted or signed. {ASK_AGAIN}</p>}
        {decBad.length > 0 && <p role="alert" className="mt-2 text-[13px] text-neg">The token decimals read on {chainName} do not match the order ({decBad.join('; ')}), so nothing is quoted or signed. They were read twice, the second time from another endpoint, and neither value was kept. <button type="button" className="underline" onClick={() => setDecTick((t) => t + 1)}>Read them again</button> {ASK_AGAIN}</p>}
        {dec.error && <p role="alert" className="mt-2 text-[13px] text-warn">The tokens&apos; decimals could not be read on {chainName} ({dec.error}); nothing is quoted until they are. <button type="button" className="underline" onClick={() => setDecTick((t) => t + 1)}>Read them again</button></p>}
        {!params && !rawMismatch && !decBad.length && !dec.error && <p className="mt-2 text-[12px] text-muted">Reading both tokens&apos; decimals on {chainName}.</p>}
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
            <Row label={`At least, after ${pct(order.slippage)} slippage`}>{outMinText} {f.toSymbol}<span className="block text-[12px] text-muted">LI.FI&apos;s minimum: the swap reverts if it would receive less.</span></Row>
            <Row label={buy ? 'You pay' : 'You sell'}>{rawFrom} {fromSymbol}</Row>
            {f.fees.map((x) => (
              <Row key={x.name} label={x.name}>
                {Number.isFinite(x.pct) && x.pct < 1 ? pct(x.pct) : ''}{Number.isFinite(x.usd) ? ` (${fmtUsd(x.usd)}, LI.FI's dollar figure)` : ''}{x.included ? (buy ? ', taken out of the amount paid' : `, taken out of the ${fromSymbol} sold, so out of what you receive`) : ''}
              </Row>
            ))}
            {f.gas.map((g, i) => (
              <Row key={`gas-${i}`} label="Network fee, LI.FI's estimate">{tok(g.amount, 6)} {g.symbol}{Number.isFinite(g.usd) ? ` (${fmtUsd(g.usd)})` : ''}</Row>
            ))}
            <Row label="Route">{f.tools.join(', ') || 'not named'}{f.steps ? `, ${f.steps} step${f.steps === 1 ? '' : 's'}` : ''}</Row>
            <Row label="Quoted at">
              {clockText(Date.parse(q.quotedAt))}
              <span className={`block text-[12px] ${stale ? 'text-warn' : 'text-muted'}`}>{stale ? 'Over 60 s ago: get a new quote before signing.' : `${Math.round(age / 1000)} s ago. A quote is signed only while it is under 60 s old.`}</span>
            </Row>
            <Row label="Price check">
              {(() => {
                const line = (v, name) => (
                  <span className="block">
                    {buy
                      ? <>At {name}, {fmtUsd(v.price)} per token, at least {outMinText} {f.toSymbol} is worth {fmtUsd(v.valueOut)} for {fmtUsd(v.valueIn)} paid: </>
                      : <>At {name}, {fmtUsd(v.price)} per token, {rawFrom} {fromSymbol} is worth {fmtUsd(v.valueIn)}, for at least {outMinText} {f.toSymbol}: </>}
                    {v.loss >= 0 ? `${pct(v.loss)} less, within this order's ${pct(q.check.value.limit)} limit` : `${pct(-v.loss)} more, within 5%`}.
                  </span>
                );
                return <>{line(q.check.value, 'our measured price')}{line(q.check.lifi, q.check.lifi.source)}</>;
              })()}
              <span className="block text-[12px] text-muted">
                Ours is {q.check.value.basis || 'our measured price'}, measured {clockText(vc.measuredAt)}. The two prices are {pct(Math.abs(q.lpGap))} apart, within 5%.
                <span className="inline-flex align-middle ml-1"><Tip label="How the limit is set" align="left">
                  <span className="block">The minimum has to pass at both prices.</span>
                  <span className="block">The limit is the smaller of 5% and the larger of 2% and three times our measured cost without gas{q.check.value.limitBasis ? ` (${q.check.value.limitBasis})` : ''}.</span>
                  <span className="block">The stablecoin is taken at $1.</span>
                </Tip></span>
              </span>
            </Row>
            <Row label="Approval">
              {f.approvalAddress ? <>LI.FI&apos;s contract <Ext href={addressUrl(order.chainId, f.approvalAddress)} mono>{f.approvalAddress}</Ext></> : 'none needed'}
              {needsApproval && <span className="block text-[12px] text-muted">Allowance now {rawText(allowance.raw, fromDecimals)} {fromSymbol}. An approval for exactly {rawFrom} {fromSymbol} comes first, as its own wallet prompt; never an unlimited one.</span>}
              {allowanceOk && f.approvalAddress && <span className="block text-[12px] text-muted">The allowance already covers the amount; no approval needed.</span>}
              {allowance?.error && <span className="block text-[12px] text-warn">Allowance not read: {allowance.error}</span>}
            </Row>
          </dl>
        )}
      </Card>

      <Card>
        <CardTitle>Sign in your wallet</CardTitle>
        <ol className="divide-y divide-line border-t border-line">
          <Step n={1} done={matches} active={!matches} title={matches ? `Connected: ${shortAddress(address)}` : 'Connect the order’s wallet'}>
            {!address && (
              <>
                <p>Connect {shortAddress(order.wallet)}. Connecting signs nothing.</p>
                <button type="button" className={`${btn} mt-2`} onClick={() => openConnectModal?.()} disabled={walletStatus === 'connecting' || walletStatus === 'reconnecting'}>Connect a wallet</button>
              </>
            )}
            {address && !matches && (
              <>
                <p role="alert" className="text-warn">The connected wallet is {shortAddress(address)}. This order was prepared for {shortAddress(order.wallet)}, so nothing is offered for signing. Switch account in your wallet, or connect the other wallet.</p>
                <button type="button" className={`${btn2} mt-2`} onClick={() => disconnect()}>Disconnect</button>
              </>
            )}
          </Step>
          <Step n={2} done={matches && walletChain === order.chainId} active={matches && walletChain !== order.chainId} title={`Be on ${chainName}`}>
            {matches && walletChain !== order.chainId && (
              <>
                <p>Your wallet is on {BUY_CHAINS[walletChain]?.name || `chain ${walletChain}`}. It is asked to switch when you approve or sign, or now.</p>
                <button type="button" className={`${btn2} mt-2`} onClick={switchNow} disabled={busy}>{wallet.status === 'switching' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Switch to {chainName}</button>
              </>
            )}
          </Step>
          <Step n={3} done={q.status === 'ready' && !stale} active={matches && (q.status !== 'ready' || stale)} title="A LI.FI quote under 60 s old">
            {(q.status !== 'ready' || stale) && <p>Get a quote above; the swap signed is the one quoted.</p>}
          </Step>
          <Step n={4} done={allowanceOk} active={(needsApproval || waitingAllowance) && matches} title={f?.approvalAddress === null ? 'No approval needed' : `Approve exactly ${rawFrom} ${fromSymbol}`}>
            {needsApproval && (
              <button type="button" className={`${btn2} mt-1`} onClick={approve} disabled={!canAct}>
                {wallet.status === 'approving' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                Approve exactly {rawFrom} {fromSymbol}
              </button>
            )}
            {wallet.status === 'approving' && <p className="mt-1">Confirm the approval in your wallet, then wait for one confirmation.</p>}
            {wallet.status === 'confirming' && <p className="mt-1">Approved: <Ext href={txUrl(order.chainId, approved)}>{shortAddress(approved)}</Ext>. Reading the new allowance on {chainName}.</p>}
            {approved && wallet.status !== 'confirming' && (
              <p className="mt-1">Approved: <Ext href={txUrl(order.chainId, approved)}>{shortAddress(approved)}</Ext>.{waitingAllowance ? ` ${chainName}'s endpoint does not show the new allowance yet; no second approval is asked for.` : ''}{stale ? ' The quote is now over 60 s old: get a new one, then sign.' : ''}</p>
            )}
            {waitingAllowance && wallet.status !== 'confirming' && (
              <button type="button" className={`${btn2} mt-2`} onClick={() => readAllowanceNow(f.approvalAddress)}>Read the allowance again</button>
            )}
          </Step>
          <Step n={5} done={!!tx} active={allowanceOk && matches && !tx} title={buy ? `Sign the swap: ${order.pay.symbol} to ${symbol}` : `Sign the swap: ${symbol} to ${order.pay.symbol}`}>
            <div className="rounded bg-inset p-3 mt-1 text-fg">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">Who may hold {symbol}{issuer ? `, in ${issuer}’s words` : ''}</div>
              <Eligibility e={eligibility} />
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
            <div>Sent: <Ext href={txUrl(order.chainId, tx.hash)} mono>{tx.hash}</Ext></div>
            <div className="mt-1 text-muted">
              {tx.unknown === 'pending'
                ? 'LI.FI still reports it as pending after an hour; check the explorer.'
                : tx.unknown
                ? 'Status unknown: LI.FI has not reported it. Check the explorer.'
                : <>LI.FI status: {tx.lifi?.status ? `${tx.lifi.status}${tx.lifi.substatus ? ` (${tx.lifi.substatus})` : ''}${tx.lifi.message ? `: ${tx.lifi.message}` : ''}` : tx.lifi?.error ? `not read yet: ${tx.lifi.error}` : 'checking every 5 s'}</>}
            </div>
            {tx.noted?.expired && <div className="mt-1 text-[12px] text-muted">The link had expired when the transaction was reported, so Tnega did not record the link as used. That does not change what your wallet sent; its status is shown above.</div>}
            {tx.noted?.error && !tx.noted.expired && <div className="mt-1 text-[12px] text-muted">Tnega did not record the link as used ({tx.noted.error}). That does not change what your wallet sent; its status is shown above.</div>}
          </div>
        )}
      </Card>

      <TokenControls data={controls.data} link={{ href: tokenLink(order.key), label: 'Compare with every issuer' }} />

      <p className="text-[12px] text-muted">
        The quote and the swap come from LI.FI; Tnega passes LI.FI&apos;s transaction to your wallet as LI.FI built it.
      </p>
    </div>
  );
}
