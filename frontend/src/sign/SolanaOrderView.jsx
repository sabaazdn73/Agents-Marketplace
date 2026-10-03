// sign/SolanaOrderView.jsx
//
// The Solana half of /sign/<id>: an order for a tokenized stock on Solana,
// paid or received in USDC, shown in full and signed in the visitor's own
// Solana wallet. Drawn by SignOrderPage.jsx for an order whose chain is
// Solana, and loaded only then (a lazy chunk with @solana/web3.js and the
// wallet adapter in it).
//
// WHAT THE PAGE DOES, each wallet step on the visitor's own click:
//   1. the order was read and checked by sign/order.js (sign/solanaOrder.js
//      for the Solana fields). The two mints are read on chain here: their
//      decimals and token program (Token or Token-2022, which xStocks use)
//      are held against the order's, and the exact amount in the smallest
//      unit is worked out from the chain's decimals;
//   2. "Get a Jupiter quote": one request from this browser to Jupiter for
//      the quote, one for the transaction Jupiter builds for the order's
//      wallet. The quote is refused if it does not match the order or if it
//      deviates from Tnega's measured price by more than the order's limit
//      (sign/solanaQuote.js); the transaction is refused unless, instruction
//      by instruction, it is the swap and nothing else (sign/solanaTx.js);
//   3. connect a Solana wallet: it has to be the order's wallet;
//   4. "Sign the swap": the wallet signs and sends the transaction as
//      checked, only while the quote is under 60 s old. There is no approval
//      step on Solana: the swap moves tokens by the wallet's own signature;
//   5. the signature, a Solscan link, the transaction's progress on chain,
//      and a note to Tnega's API that the link was used.
// Tnega never holds a key or funds and signs nothing: no server is involved
// in the quote, the transaction or the signing.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { Loader2 } from 'lucide-react';
import { shortAddress } from '../wallet/useConnectedWallet';
import { Card, CardTitle, fmtUsd } from '../ui/primitives';
import { Eligibility } from '../home/cards';
import TokenControls from '../controls/TokenControls';
import { tokenLink } from '../controls/model';
import { useTe } from '../te/api';
import { Tip } from '../dashboard/cards';
import GuideLink from '../guide/GuideLink';
import { clockText } from '../trade/format';
import { markDone, REFERENCE_MAX_AGE_MS } from './order';
import { Row, Ext, Step, btn, btn2, tok, pct, amountText, mmss, ASK_AGAIN } from './signUi';
import SolanaConnectModal from './SolanaConnectModal';
import { rawAmountSolana, rawAgreesSolana, mintsMismatch, solscanTx, solscanAccount, solscanToken } from './solanaOrder';
import { quoteRequest, fetchJupiterQuote, fetchJupiterSwap } from './jupiter';
import { checkJupiterQuote, rawText } from './solanaQuote';
import { inspectSwapTx, ATA_RENT_LAMPORTS_APPROX } from './solanaTx';
import { solanaErrorText, outcomeText } from './solanaStatus';
import { primaryConnection, readMints, readTokenBalance, readSol, lookAtSignature, SOLANA_RPCS } from './solanaRpc';

/** A quote is signed only while it is under 60 s old, as on the EVM page:
 *  Jupiter's transaction carries a blockhash that lives about as long. */
const QUOTE_MAX_AGE_MS = 60e3;
/** SOL a swap with a new token account is likely to need: the base fee, the
 *  priority fee and rent. A warning, not a block: the wallet's own simulation
 *  decides. */
const LOW_SOL_LAMPORTS = 5_000_000;
const POLL_MS = 2500;
const POLL_MAX_MS = 5 * 60e3;

export default function SolanaOrderView({ id, order }) {
  const [walletError, setWalletError] = useState(null);
  // wallets={[]}: the wallet standard's own discovery lists what the browser
  // has (Phantom, Solflare, Backpack...); no adapter package is bundled.
  return (
    <ConnectionProvider endpoint={SOLANA_RPCS[0]}>
      <WalletProvider wallets={[]} autoConnect={false} localStorageKey="tnega-sign-solana-wallet" onError={(e) => setWalletError(solanaErrorText(e))}>
        <SolanaOrder id={id} order={order} walletError={walletError} clearWalletError={() => setWalletError(null)} />
      </WalletProvider>
    </ConnectionProvider>
  );
}

function SolanaOrder({ id, order, walletError, clearWalletError }) {
  const buy = order.side === 'buy';
  const { wallets, wallet, publicKey, connected, connecting, select, connect, disconnect, sendTransaction } = useWallet();
  const address = connected && publicKey ? publicKey.toBase58() : null;
  const matches = !!address && address === order.wallet;

  const controls = useTe(`/api/te/controls?by=key&key=${encodeURIComponent(order.key)}`);
  const ticker = order.token.ticker || controls.data?.underlying || null;
  const symbol = order.token.symbol || controls.data?.symbol || shortAddress(order.token.address);
  const issuer = order.token.issuer || controls.data?.issuer || null;
  const name = order.token.name || null;
  const eligibility = (order.eligibility && typeof order.eligibility === 'object' ? order.eligibility : null)
    || controls.data?.controls?.who_may_hold || null;
  const vc = order.valueCheck;

  // The two mints, ALWAYS read on chain before anything is quoted.
  const [mints, setMints] = useState({ status: 'loading' });
  const [mintTick, setMintTick] = useState(0);
  useEffect(() => {
    let live = true;
    setMints({ status: 'loading' });
    readMints(order)
      .then((m) => { if (live) setMints({ status: 'ok', ...m }); })
      .catch((e) => { if (live) setMints({ status: 'error', error: e?.message || 'read failed' }); });
    return () => { live = false; };
  }, [order, mintTick]);
  const mintsRead = mints.status === 'ok';
  const mintBad = mintsRead ? mintsMismatch(order, mints) : [];
  const tokenDecimals = mintsRead && !mints.token.error ? mints.token.decimals : null;
  const computedRaw = mintsRead && !mintBad.length ? rawAmountSolana(order, tokenDecimals) : null;
  // Two workings of one amount (ours from the chain's decimals, the server's
  // from_amount_raw); if they differ, nothing is quoted or signed.
  const rawMismatch = computedRaw != null && !rawAgreesSolana(order, computedRaw);
  const raw = rawMismatch ? null : computedRaw;
  const rawBad = mintsRead && !mintBad.length && computedRaw == null;
  const fromMint = buy ? order.pay.address : order.token.address;
  const fromDecimals = buy ? order.pay.decimals : tokenDecimals;
  const fromSymbol = buy ? 'USDC' : symbol;
  const req = useMemo(() => (raw == null ? null : quoteRequest({
    inputMint: fromMint,
    outputMint: buy ? order.token.address : order.pay.address,
    amount: raw.toString(),
    slippageBps: order.slippageBps,
  })), [raw, fromMint, buy, order]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = order.deadline - now;
  const expired = left <= 0;

  // The order's wallet's balance of what it parts with, and its SOL.
  const [bal, setBal] = useState(null);
  const [balTick, setBalTick] = useState(0);
  useEffect(() => {
    let live = true;
    setBal(null);
    Promise.all([readTokenBalance(order.wallet, fromMint), readSol(order.wallet)])
      .then(([token, sol]) => { if (live) setBal({ token, sol }); })
      .catch((e) => { if (live) setBal({ error: e?.message || 'read failed' }); });
    return () => { live = false; };
  }, [order.wallet, fromMint, balTick]);
  const short = bal?.token != null && raw != null && bal.token < raw;

  const [q, setQ] = useState({ status: 'idle' });
  const [wal, setWal] = useState({ status: 'idle' });
  const [agree, setAgree] = useState(false);
  const [tx, setTx] = useState(null);
  const [picker, setPicker] = useState(false);
  const gen = useRef(0);
  const pollRef = useRef(null);
  const stopAll = () => { gen.current += 1; clearTimeout(pollRef.current); pollRef.current = null; };
  useEffect(() => () => stopAll(), []);

  // Picking a wallet in the list: select it, then connect once it is the
  // selected one.
  const [pick, setPick] = useState(null);
  const connectingRef = useRef(false);
  useEffect(() => {
    if (!pick || wallet?.adapter.name !== pick || connected || connectingRef.current) return;
    connectingRef.current = true;
    setPick(null);
    connect()
      .then(() => setPicker(false))
      .catch((e) => setWal({ status: 'error', error: solanaErrorText(e) }))
      .finally(() => { connectingRef.current = false; });
  }, [pick, wallet, connected, connect]);
  useEffect(() => { if (connected) setPicker(false); }, [connected]);

  const symbolForWords = symbol;
  const getQuote = async () => {
    if (!req || expired) return;
    stopAll();
    const g = gen.current;
    clearWalletError();
    if (wal.status === 'error') setWal({ status: 'idle' });
    setQ({ status: 'quoting' });
    const r = await fetchJupiterQuote(req);
    if (g !== gen.current) return;
    if (r.error) { setQ({ status: 'error', error: r.error }); return; }
    const c = checkJupiterQuote({ quote: r.quote, req, side: order.side, amount: Number(order.amount), slippage: order.slippage, vc, symbol: symbolForWords, tokenDecimals });
    if (!c.ok) { setQ({ status: 'refused', why: c.why, facts: c.facts, quotedAt: r.quotedAt, ...(c.check ? { check: c.check } : {}) }); return; }
    setQ({ status: 'building', facts: c.facts });
    const s = await fetchJupiterSwap(r.quote, order.wallet, { base: r.base });
    if (g !== gen.current) return;
    if (s.error) { setQ({ status: 'error', error: s.error }); return; }
    const ins = inspectSwapTx({ txBase64: s.swap.tx, order, quote: r.quote, req, mints });
    if (!ins.ok) {
      setQ({ status: 'refused', why: `Refused. The transaction Jupiter built is not the swap in this order, so it is not offered for signing: ${ins.why.join('; ')}.`, facts: c.facts, quotedAt: r.quotedAt });
      return;
    }
    setQ({ status: 'ready', quote: r.quote, facts: c.facts, check: c.check, base: r.base, tx: ins.tx, txFacts: ins.facts, lastValid: s.swap.lastValidBlockHeight, quotedAt: r.quotedAt, at: Date.now() });
    setNow(Date.now());
  };

  const f = q.facts;
  const ready = q.status === 'ready';
  const age = ready ? now - q.at : 0;
  const stale = ready && age > QUOTE_MAX_AGE_MS;
  const busy = wal.status === 'signing';
  const canAct = ready && !stale && !expired && matches && agree && !short && !tx && !busy;
  const lowSol = ready && bal?.sol != null && bal.sol < LOW_SOL_LAMPORTS + (q.txFacts?.createdAtas.length || 0) * ATA_RENT_LAMPORTS_APPROX;

  const tooOld = () => {
    if (Date.now() - q.at <= QUOTE_MAX_AGE_MS && Date.now() < order.deadline) return false;
    setNow(Date.now());
    return true;
  };

  const poll = (signature, g, started, lastValid) => {
    lookAtSignature(signature, lastValid).then((o) => {
      if (g !== gen.current) return;
      const elapsed = Date.now() - started;
      const finished = o.state === 'finalized' || o.state === 'failed' || o.state === 'expired';
      setTx((t) => (t && t.signature === signature ? { ...t, outcome: o, gaveUp: !finished && elapsed > POLL_MAX_MS } : t));
      if (finished || elapsed > POLL_MAX_MS) return;
      pollRef.current = setTimeout(() => poll(signature, g, started, lastValid), POLL_MS);
    }).catch(() => {
      if (g !== gen.current) return;
      if (Date.now() - started > POLL_MAX_MS) { setTx((t) => (t && t.signature === signature ? { ...t, gaveUp: true } : t)); return; }
      pollRef.current = setTimeout(() => poll(signature, g, started, lastValid), POLL_MS);
    });
  };

  const sign = async () => {
    if (tooOld()) return;
    if (!matches) return;
    setWal({ status: 'signing' });
    clearWalletError();
    try {
      // The wallet signs and sends the transaction exactly as inspected.
      const signature = await sendTransaction(q.tx, primaryConnection, { preflightCommitment: 'confirmed', maxRetries: 3 });
      setWal({ status: 'sent' });
      setTx({ signature, outcome: { state: 'pending' }, noted: null });
      markDone(id, signature).then((r) => setTx((t) => (t && t.signature === signature ? { ...t, noted: r } : t)));
      const g = gen.current;
      pollRef.current = setTimeout(() => poll(signature, g, Date.now(), q.lastValid), POLL_MS);
    } catch (e) {
      setWal({ status: 'error', error: solanaErrorText(e) });
    }
  };

  const rawFrom = rawText(raw == null ? null : raw.toString(), fromDecimals) || amountText(order.amount);
  const payLine = buy
    ? <>{fmtUsd(Number(order.amount))} in USDC on Solana<span className="block text-[12px] text-muted">{amountText(order.amount)} USDC, taken at $1 a token.</span></>
    : <>{amountText(order.amount)} {symbol} on Solana</>;
  const title = buy ? `Buy ${fmtUsd(Number(order.amount))} of ${ticker || symbol}` : `Sell ${amountText(order.amount)} ${symbol}`;
  const token2022 = mintsRead && mints.token.owner && mints.token.owner !== mints.pay.owner;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-[26px] md:text-[30px] font-bold tracking-[-0.02em] text-fg leading-tight">{title}</h1>
          <GuideLink id="signing" newTab />
        </div>
        <p className="mt-1 text-[14px] text-muted">
          {symbol}{issuer ? ` from ${issuer}` : ''} on Solana. Prepared through Tnega for wallet {shortAddress(order.wallet)}. Nothing is signed until you sign the transaction in your own wallet; Tnega never holds funds or keys.
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
            <span className="block text-[12px] text-muted">Token {symbol}{issuer ? `, issued by ${issuer}` : ''}{token2022 ? ', a Token-2022 token' : ''}</span>
          </Row>
          <Row label="Token mint"><Ext href={solscanToken(order.token.address)} mono>{order.token.address}</Ext></Row>
          <Row label="Chain">Solana</Row>
          <Row label={buy ? 'You pay' : 'You sell'}>{payLine}</Row>
          <Row label="You receive">
            {buy ? symbol : 'USDC on Solana'}
            <span className="block text-[12px] text-muted">How much is Jupiter&apos;s quote below, not a figure from Tnega.</span>
          </Row>
          <Row label="Max slippage">{pct(order.slippage)}<span className="block text-[12px] text-muted">The route has to guarantee at least the estimate less this.</span></Row>
          <Row label="Price check">
            {vc && !vc.reason ? (
              <>
                Valued at our measured price, {fmtUsd(vc.price)} per {symbol}, Jupiter&apos;s minimum may be at most {pct(vc.limit)} below {buy ? 'what you pay' : 'the value of the tokens sold'}, and not over 5% above.
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
            Jupiter&apos;s route and pool fees, inside its quote below, and Solana&apos;s network fee, which your wallet pays in SOL. Tnega takes no fee.
          </Row>
          <Row label="Prepared for wallet">
            <Ext href={solscanAccount(order.wallet)} mono>{order.wallet}</Ext>
            <span className="block text-[12px] text-muted">Only this wallet can sign this order here.</span>
          </Row>
          <Row label={`The wallet's ${fromSymbol || 'token'} balance`}>
            {bal?.token != null && fromDecimals != null ? `${rawText(bal.token.toString(), fromDecimals)} ${fromSymbol}` : bal?.error ? <span className="text-warn">not read: {bal.error}</span> : 'reading'}
            {bal?.token != null && <span className="block text-[12px] text-muted">Read on Solana just now, over every {fromSymbol} account the wallet has.</span>}
            {short && <span className="block text-[12px] text-warn">Less than the order&apos;s {amountText(order.amount)} {fromSymbol}; the swap cannot be signed until the wallet holds it.</span>}
            {(bal?.error || short) && <button type="button" className="mt-1 text-[12px] text-accent hover:underline" onClick={() => setBalTick((t) => t + 1)}>Read it again</button>}
          </Row>
          <Row label="The wallet's SOL">
            {bal?.sol != null ? `${(bal.sol / 1e9).toLocaleString('en-US', { maximumFractionDigits: 6 })} SOL` : bal?.error ? <span className="text-warn">not read</span> : 'reading'}
            <span className="block text-[12px] text-muted">Pays the network fee, and the rent of a new token account the first time the wallet holds a token.</span>
          </Row>
        </dl>
      </Card>

      <Card>
        <CardTitle>Jupiter&apos;s quote</CardTitle>
        <p className="text-[13px] text-muted flex items-center gap-1.5">
          Checked against the order and Tnega&apos;s measured price, and the transaction read instruction by instruction, before it can be signed.
          <Tip label="About the quote" align="left">
            <span className="block">A route and a price from Jupiter (jup.ag), asked by this browser for the order&apos;s wallet. It needs no wallet connected. Jupiter sees that wallet&apos;s address and the amounts; Tnega sees neither.</span>
            <span className="block">Tnega checks the quote against the order and against our own measured price, then reads the transaction Jupiter built: its signer, every program it calls and the amounts it spends, before it is passed to your wallet.</span>
          </Tip>
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={ready && !stale ? btn2 : btn} onClick={getQuote} disabled={!req || expired || q.status === 'quoting' || q.status === 'building' || busy || !!tx}>
            {(q.status === 'quoting' || q.status === 'building') && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {q.status === 'idle' ? 'Get a Jupiter quote' : 'Get a new quote'}
          </button>
          <span className="text-[11px] text-muted">Two requests from this browser to Jupiter, only when you press it.</span>
        </div>
        {mints.status === 'error' && <p role="alert" className="mt-2 text-[13px] text-warn">The two tokens could not be read on Solana ({mints.error}); nothing is quoted until they are. <button type="button" className="underline" onClick={() => setMintTick((t) => t + 1)}>Read them again</button></p>}
        {mintBad.length > 0 && <p role="alert" className="mt-2 text-[13px] text-neg">The tokens read on Solana do not match the order ({mintBad.join('; ')}), so nothing is quoted or signed. <button type="button" className="underline" onClick={() => setMintTick((t) => t + 1)}>Read them again</button> {ASK_AGAIN}</p>}
        {rawMismatch && <p role="alert" className="mt-2 text-[13px] text-neg">The order&apos;s exact amount ({order.serverRaw} units) does not match {amountText(order.amount)} {fromSymbol} worked out here ({String(computedRaw)} units), so nothing is quoted or signed. {ASK_AGAIN}</p>}
        {rawBad && <p role="alert" className="mt-2 text-[13px] text-neg">{amountText(order.amount)} {fromSymbol} cannot be written exactly in {fromSymbol}&apos;s {fromDecimals} decimals, so nothing is quoted or signed. {ASK_AGAIN}</p>}
        {mints.status === 'loading' && <p className="mt-2 text-[12px] text-muted">Reading both tokens on Solana.</p>}
        {q.status === 'error' && <p role="alert" className="mt-3 text-[13px] text-neg">{q.error}</p>}
        {q.status === 'refused' && (
          <div role="alert" className="mt-3 rounded border border-neg/50 p-3 text-[13px]">
            <p className="text-neg font-semibold">{q.why}</p>
            {q.check?.value && <p className="mt-1 text-muted">Checked against {q.check.value.basis}: {fmtUsd(q.check.value.price)} per token.</p>}
            {f?.routes?.length > 0 && <p className="mt-1 text-muted">Route: {f.routes.join(', ')}. Quoted at {clockText(Date.parse(q.quotedAt))}.</p>}
          </div>
        )}
        {ready && (
          <dl className="mt-3 divide-y divide-line border-y border-line">
            <Row label="You receive, Jupiter's estimate">{rawText(f.outRaw, f.outDecimals)} {f.outSymbol}</Row>
            <Row label={`At least, after ${pct(order.slippage)} slippage`}>{rawText(f.outMinRaw, f.outDecimals)} {f.outSymbol}<span className="block text-[12px] text-muted">Jupiter&apos;s minimum: the swap fails and nothing is exchanged if it would receive less.</span></Row>
            <Row label={buy ? 'You pay' : 'You sell'}>{rawFrom} {fromSymbol}</Row>
            <Row label="Route">{f.routes.join(', ') || 'not named'}{f.steps ? `, ${f.steps} step${f.steps === 1 ? '' : 's'}` : ''}{f.priceImpactPct != null ? `. Jupiter reports a price impact of ${f.priceImpactPct}.` : ''}</Row>
            <Row label="Network fee">
              5,000 lamports base fee{q.txFacts.priorityLamports > 0 ? `, plus a priority fee of ${q.txFacts.priorityLamports.toLocaleString('en-US')} lamports` : ''}. 1 SOL is 1,000,000,000 lamports.
              {q.txFacts.createdAtas.length > 0 && (
                <span className="block text-[12px] text-muted">
                  This swap also creates the wallet&apos;s {q.txFacts.createdAtas.map((a) => (a.mint === order.token.address ? symbol : 'USDC')).join(' and ')} token account{q.txFacts.createdAtas.length > 1 ? 's' : ''}
                  {q.txFacts.createdAtas.some((a) => a.tokenProgram !== mints.pay.owner) ? ' (Token-2022)' : ''}, which holds a rent deposit of about 0.002 SOL each. The deposit is yours: closing the account returns it.
                </span>
              )}
              {lowSol && <span className="block text-[12px] text-warn">The wallet&apos;s SOL ({bal?.sol != null ? (bal.sol / 1e9).toFixed(4) : '?'}) may not cover this. Add a little SOL first, or the wallet will refuse.</span>}
            </Row>
            <Row label="Transaction read">
              {q.txFacts.instructions} instruction{q.txFacts.instructions === 1 ? '' : 's'}, signed by {shortAddress(q.txFacts.feePayer)} alone; programs: Jupiter route{q.txFacts.createdAtas.length ? ', associated token account' : ''}{q.txFacts.priorityLamports > 0 || q.txFacts.computeUnitLimit ? ', compute budget' : ''}. Nothing else.
            </Row>
            <Row label="Quoted at">
              {clockText(Date.parse(q.quotedAt))}
              <span className={`block text-[12px] ${stale ? 'text-warn' : 'text-muted'}`}>{stale ? 'Over 60 s ago: get a new quote before signing.' : `${Math.round(age / 1000)} s ago. A quote is signed only while it is under 60 s old.`}</span>
            </Row>
            <Row label="Price check">
              {(() => {
                const v = q.check.value;
                return (
                  <span className="block">
                    {buy
                      ? <>At our measured price, {fmtUsd(v.price)} per token, at least {rawText(f.outMinRaw, f.outDecimals)} {f.outSymbol} is worth {fmtUsd(v.valueOut)} for {fmtUsd(v.valueIn)} paid: </>
                      : <>At our measured price, {fmtUsd(v.price)} per token, {rawFrom} {fromSymbol} is worth {fmtUsd(v.valueIn)}, for at least {rawText(f.outMinRaw, f.outDecimals)} {f.outSymbol}: </>}
                    {v.loss >= 0 ? `${pct(v.loss)} less, within this order's ${pct(v.limit)} limit` : `${pct(-v.loss)} more, within 5%`}.
                  </span>
                );
              })()}
              <span className="block text-[12px] text-muted">
                Ours is {q.check.value.basis || 'our measured price'}, measured {clockText(vc.measuredAt)}. Jupiter&apos;s quote carries no price of its own to hold ours against.
                <span className="inline-flex align-middle ml-1"><Tip label="How the limit is set" align="left">
                  <span className="block">The minimum has to pass at our measured price.</span>
                  <span className="block">The limit is the smaller of 5% and the larger of 2% and three times our measured cost without gas{q.check.value.limitBasis ? ` (${q.check.value.limitBasis})` : ''}.</span>
                  <span className="block">USDC is taken at $1.</span>
                </Tip></span>
              </span>
            </Row>
          </dl>
        )}
      </Card>

      <Card>
        <CardTitle>Sign in your wallet</CardTitle>
        <ol className="divide-y divide-line border-t border-line">
          <Step n={1} done={matches} active={!matches} title={matches ? `Connected: ${shortAddress(address)}` : 'Connect the order’s Solana wallet'}>
            {!address && (
              <>
                <p>Connect {shortAddress(order.wallet)}. Connecting signs nothing.</p>
                <button type="button" className={`${btn} mt-2`} onClick={() => setPicker(true)} disabled={connecting}>{connecting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}Connect a Solana wallet</button>
              </>
            )}
            {address && !matches && (
              <>
                <p role="alert" className="text-warn">The connected wallet is {shortAddress(address)}. This order was prepared for {shortAddress(order.wallet)}, so nothing is offered for signing. Switch account in your wallet, or connect the other wallet.</p>
                <button type="button" className={`${btn2} mt-2`} onClick={() => disconnect()}>Disconnect</button>
              </>
            )}
          </Step>
          <Step n={2} done={ready && !stale} active={matches && (!ready || stale)} title="A Jupiter quote under 60 s old">
            {(!ready || stale) && <p>Get a quote above; the swap signed is the transaction read from it.</p>}
          </Step>
          <Step n={3} done={!!tx} active={ready && !stale && matches && !tx} title={buy ? `Sign the swap: USDC to ${symbol}` : `Sign the swap: ${symbol} to USDC`}>
            <p>No approval step: on Solana the swap moves the tokens by your one signature.</p>
            <div className="rounded bg-inset p-3 mt-1 text-fg">
              <div className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">Who may hold {symbol}{issuer ? `, in ${issuer}’s words` : ''}</div>
              <Eligibility e={eligibility} />
              <label className="mt-3 flex items-start gap-2">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" disabled={!!tx} />
                <span>I am not a restricted person under {issuer ? `${issuer}’s` : 'the issuer’s'} terms</span>
              </label>
              <p className="mt-1 text-[11px] text-muted">Shown, not enforced: Tnega does not check who you are.</p>
            </div>
            <button type="button" className={`${btn} mt-3`} onClick={sign} disabled={!canAct}>
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              Sign the swap
            </button>
            {busy && <p className="mt-1">Confirm the swap in your wallet.</p>}
          </Step>
        </ol>
        {(wal.status === 'error' || walletError) && <p role="alert" className="mt-2 text-[13px] text-neg">{wal.status === 'error' ? wal.error : walletError}</p>}
        {tx && (
          <div className="mt-3 rounded border border-line p-3 text-[13px]" aria-live="polite">
            <div>Sent: <Ext href={solscanTx(tx.signature)} mono>{tx.signature}</Ext></div>
            <div className="mt-1 text-muted">
              {tx.gaveUp && !['finalized', 'failed', 'expired'].includes(tx.outcome.state)
                ? 'Still not final after 5 minutes of looking. Open it on Solscan to see where it stands.'
                : outcomeText(tx.outcome)}
              {' '}<Ext href={solscanTx(tx.signature)}>View on Solscan</Ext>
            </div>
            {tx.noted?.expired && <div className="mt-1 text-[12px] text-muted">The link had expired when the transaction was reported, so Tnega did not record the link as used. That does not change what your wallet sent; its status is shown above.</div>}
            {tx.noted?.error && !tx.noted.expired && <div className="mt-1 text-[12px] text-muted">Tnega did not record the link as used ({tx.noted.error}). That does not change what your wallet sent; its status is shown above.</div>}
          </div>
        )}
      </Card>

      <TokenControls data={controls.data} link={{ href: tokenLink(order.key), label: 'Compare with every issuer' }} />

      <p className="text-[12px] text-muted">
        The quote and the swap come from Jupiter; Tnega reads the transaction Jupiter built and passes it to your wallet only if it is the swap in this order and nothing else.
      </p>

      {picker && !connected && (
        <SolanaConnectModal
          wallets={wallets}
          orderWallet={order.wallet}
          error={wal.status === 'error' ? wal.error : null}
          onClose={() => setPicker(false)}
          onPick={(n) => { setWal({ status: 'idle' }); select(n); setPick(n); }}
        />
      )}
    </div>
  );
}
