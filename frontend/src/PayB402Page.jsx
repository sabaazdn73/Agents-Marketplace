// PayB402Page.jsx
//
// The Pay.B402 tab. Shared by web and mobile.
//
// The backend has had a working B402 rail for some time and no way to reach
// it. This is that surface: live facilitator state, the rail checks, and a
// payment a connected wallet can actually make.
//
// THE AMOUNT IS LOCKED ONCE A SESSION EXISTS
// The input is disabled from the moment the server issues requirements. The
// server verifies against its own stored copy, so an edited amount would
// simply fail, but letting someone type a new number next to a signature
// button invites the belief that it changes what is being paid. Changing
// the amount means starting a new session, and the button says so.
//
// All three settle outcomes are separate states. Settled links the
// transaction to BscScan. Broadcast but unconfirmed polls and says plainly
// that the money has already left. Failure prints the facilitator's own
// errorReason instead of a friendlier sentence that would hide it.

import React, { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle, ExternalLink, RefreshCw, Wallet,
} from 'lucide-react';
import {
  fetchReadiness, fetchSelfCheck, createSession, buildTypedData,
  buildPaymentPayload, submitPayment, pollUntilResolved, getSession,
  PAY_OUTCOME, BSCSCAN_TX,
} from './b402Pay';

const CARD = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#131825]';

function Row({ ok, name, detail }) {
  return (
    <div className="flex items-start gap-2.5 py-2">
      {ok
        ? <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
        : <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{name}</div>
        {detail && <div className="text-[11px] text-gray-500 leading-relaxed break-words">{detail}</div>}
      </div>
    </div>
  );
}

export default function PayB402Page({ accent = '#6366F1' }) {
  const { address, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [readiness, setReadiness] = useState(null);
  const [selfCheck, setSelfCheck] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [checking, setChecking] = useState(false);

  const [amount, setAmount] = useState('0.01');
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [payError, setPayError] = useState(null);
  const [tick, setTick] = useState(null);

  const loadChecks = useCallback(async () => {
    setChecking(true);
    try {
      setSelfCheck(await fetchSelfCheck());
    } catch (e) {
      setSelfCheck({ error: e.message });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchReadiness();
        if (!cancelled) setReadiness(r);
      } catch (e) {
        if (!cancelled) setLoadError(e.message);
      }
    })();
    loadChecks();
    return () => { cancelled = true; };
  }, [loadChecks]);

  const start = async () => {
    setPayError(null); setOutcome(null); setBusy('session');
    try {
      const s = await createSession({
        amount,
        orderReference: `tab-${Date.now()}`,
        description: 'Pay.B402 tab payment',
      });
      setSession(s);
    } catch (e) {
      setPayError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    if (!session || !address) return;
    setPayError(null); setBusy('signing');
    try {
      const { authorization, typedData } = buildTypedData(session.requirements, address);
      const signature = await signTypedDataAsync(typedData);

      setBusy('submitting');
      const payload = buildPaymentPayload(session.requirements, authorization, signature);
      const result = await submitPayment(session.sessionId, payload);

      if (result?.already_settled) {
        setOutcome({ kind: PAY_OUTCOME.PAID, settlement: result.settlement, note: 'Already settled.' });
        return;
      }
      if (result?.ok === false && result?.stage === 'verify') {
        setOutcome({ kind: 'verify_rejected', reason: result.reason });
        return;
      }

      const settlement = result?.settlement || {};
      const status = result?.status || settlement.outcome;

      if (status === PAY_OUTCOME.PAID || settlement.outcome === 'success') {
        setOutcome({ kind: PAY_OUTCOME.PAID, settlement });
      } else if (status === PAY_OUTCOME.BROADCAST_UNCONFIRMED
                 || settlement.outcome === 'broadcast_unconfirmed') {
        setOutcome({ kind: PAY_OUTCOME.BROADCAST_UNCONFIRMED, settlement });
        setBusy('polling');
        const final = await pollUntilResolved(session.sessionId, { onTick: setTick });
        setOutcome(final.unresolved
          ? { kind: 'unresolved', settlement }
          : { kind: final.status, settlement: final.settlement || settlement });
      } else {
        setOutcome({ kind: PAY_OUTCOME.FAILED, settlement, reason: settlement.error_reason || result?.reason });
      }
    } catch (e) {
      // A wallet rejection is not a payment failure, and saying so avoids
      // implying something went wrong on chain.
      const msg = String(e?.shortMessage || e?.message || e);
      setPayError(/user rejected|denied|rejected the request/i.test(msg)
        ? 'You cancelled the signature. Nothing was sent and nothing was charged.'
        : msg);
    } finally {
      setBusy(null); setTick(null);
    }
  };

  const reset = () => {
    setSession(null); setOutcome(null); setPayError(null); setTick(null);
  };

  const req = session?.requirements;
  const locked = Boolean(session);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold mb-1">Pay.B402</h1>
        <p className="text-sm text-gray-500 max-w-2xl leading-relaxed">
          Payments for APIs and services over Binance B402, which is the x402 standard settled
          natively on BNB Chain. You pay a stablecoin directly from your own wallet, with no
          bridge and no card.
        </p>
      </div>

      {/* Rail checks, run server side against the live facilitator. */}
      <div className={`${CARD} p-4`}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Rail check
          </h2>
          <button
            onClick={loadChecks}
            disabled={checking}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
          >
            <RefreshCw size={11} className={checking ? 'animate-spin' : ''} /> Run again
          </button>
        </div>
        {!selfCheck && <div className="text-xs text-gray-400 py-2">Checking the rail…</div>}
        {selfCheck?.error && (
          <div className="text-xs text-red-500 py-2">Could not run the checks: {selfCheck.error}</div>
        )}
        {selfCheck?.checks && (
          <>
            <div className={`text-[12px] font-semibold mb-1 ${selfCheck.all_ok ? 'text-emerald-600 dark:text-emerald-500' : 'text-amber-600 dark:text-amber-500'}`}>
              {selfCheck.passed} of {selfCheck.total} passed
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {selfCheck.checks.map((c) => <Row key={c.name} {...c} />)}
            </div>
          </>
        )}
      </div>

      {/* Live facilitator state. */}
      <div className={`${CARD} p-4`}>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          What the facilitator accepts
        </h2>
        {loadError && <div className="text-xs text-red-500">{loadError}</div>}
        {!readiness && !loadError && <div className="text-xs text-gray-400">Reading…</div>}
        {readiness && (
          <>
            <div className="text-[11px] text-gray-500 mb-2">
              {readiness.network_label} ({readiness.network})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-gray-400">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-medium">Asset</th>
                    <th className="py-1 pr-3 font-medium">Scheme</th>
                    <th className="py-1 pr-3 font-medium">Method</th>
                    <th className="py-1 font-medium">Contract</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {(readiness.supported_kinds || []).map((k, i) => (
                    <tr key={`${k.asset}-${k.scheme}-${k.transfer_method}-${i}`} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-1 pr-3">{k.asset_symbol}</td>
                      <td className="py-1 pr-3">{k.scheme}</td>
                      <td className="py-1 pr-3">{k.transfer_method}</td>
                      <td className="py-1 text-gray-500">{k.asset?.slice(0, 10)}…{k.asset?.slice(-6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Payment. */}
      <div className={`${CARD} p-4`}>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-3">
          Make a payment
        </h2>

        {!isConnected ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-gray-500">Connect a wallet holding $U on BNB Chain to pay.</p>
            <ConnectButton.Custom>
              {({ openConnectModal }) => (
                <button
                  onClick={openConnectModal}
                  className="flex items-center gap-2 text-sm font-medium text-white px-4 py-2 rounded-lg"
                  style={{ backgroundColor: accent }}
                >
                  <Wallet size={15} /> Connect a wallet
                </button>
              )}
            </ConnectButton.Custom>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-end gap-2">
              <div className="flex-1 max-w-[180px]">
                <label className="block text-[10px] uppercase tracking-wide text-gray-400 mb-1" htmlFor="b402-amount">
                  Amount
                </label>
                <input
                  id="b402-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={locked}
                  inputMode="decimal"
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent text-sm font-mono disabled:opacity-60"
                />
              </div>
              <span className="text-xs text-gray-400 pb-2.5">$U</span>
              {!session ? (
                <button
                  onClick={start}
                  disabled={busy === 'session'}
                  className="text-sm font-medium text-white px-4 py-2 rounded-lg disabled:opacity-60"
                  style={{ backgroundColor: accent }}
                >
                  {busy === 'session' ? 'Creating…' : 'Create session'}
                </button>
              ) : (
                <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 pb-2.5">
                  Change amount
                </button>
              )}
            </div>

            {req && (
              <div className="rounded-xl bg-gray-50 dark:bg-white/5 p-3 space-y-1 text-[11px] font-mono">
                <div className="text-[10px] uppercase tracking-wide text-gray-400 font-sans mb-1">
                  What the server is asking you to sign
                </div>
                <div><span className="text-gray-400">amount </span>{req.amount} base units</div>
                <div><span className="text-gray-400">asset  </span>{req.asset}</div>
                <div><span className="text-gray-400">payTo  </span>{req.payTo}</div>
                <div><span className="text-gray-400">network</span> {req.network}</div>
                <div className="text-[10px] text-gray-400 font-sans pt-1 leading-relaxed">
                  These came from the server and are held there. Your signature is checked against
                  that stored copy, not against anything sent from this page.
                </div>
              </div>
            )}

            {session && !outcome && (
              <button
                onClick={pay}
                disabled={Boolean(busy)}
                className="w-full text-sm font-semibold text-white px-4 py-2.5 rounded-lg disabled:opacity-60"
                style={{ backgroundColor: accent }}
              >
                {busy === 'signing' && 'Waiting for your wallet…'}
                {busy === 'submitting' && 'Submitting…'}
                {!busy && `Sign and pay ${amount} $U`}
              </button>
            )}

            {payError && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-700 dark:text-amber-500 flex items-start gap-2">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                <span>{payError}</span>
              </div>
            )}

            {outcome?.kind === PAY_OUTCOME.PAID && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12px]">
                <div className="font-semibold text-emerald-700 dark:text-emerald-500 mb-1">Settled on BNB Chain</div>
                {outcome.settlement?.transaction && (
                  <a
                    href={`${BSCSCAN_TX}${outcome.settlement.transaction}`}
                    target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                  >
                    {outcome.settlement.transaction} <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}

            {outcome?.kind === PAY_OUTCOME.BROADCAST_UNCONFIRMED && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-700 dark:text-amber-500">
                <div className="font-semibold mb-1 flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Broadcast, waiting for confirmation
                </div>
                <p className="leading-relaxed">
                  The transaction is on chain already. It is not retried, because sending it again
                  could pay twice for one session.
                </p>
                {tick && <p className="mt-1 text-[11px]">Checked {tick.attempt} of {tick.attempts}, status {tick.status}.</p>}
              </div>
            )}

            {outcome?.kind === 'unresolved' && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] text-amber-700 dark:text-amber-500">
                <div className="font-semibold mb-1">Still unconfirmed</div>
                <p className="leading-relaxed">
                  Polling ran out before the chain confirmed. That is not the same as a failure.
                  {outcome.settlement?.transaction && ' Check the transaction directly.'}
                </p>
                {outcome.settlement?.transaction && (
                  <a href={`${BSCSCAN_TX}${outcome.settlement.transaction}`} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 font-mono text-[11px] hover:underline break-all mt-1">
                    {outcome.settlement.transaction} <ExternalLink size={10} />
                  </a>
                )}
              </div>
            )}

            {(outcome?.kind === PAY_OUTCOME.FAILED || outcome?.kind === 'verify_rejected') && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-600 dark:text-red-400">
                <div className="font-semibold mb-1">
                  {outcome.kind === 'verify_rejected' ? 'Rejected before settlement' : 'Settlement failed'}
                </div>
                <p className="leading-relaxed">Nothing was charged.</p>
                <div className="font-mono text-[11px] mt-1 break-all">
                  {outcome.reason || outcome.settlement?.error_reason || 'no reason given'}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
