// SignInModal.jsx
//
// Connect, then sign. One modal for both apps: a centred dialog on a wide
// screen, a sheet from the bottom on a phone.
//
// The copy says what signing does and what it does not do, in that order,
// because the second part is what people are actually worried about. Where the
// signature is checked is stated exactly: in this browser for an ordinary
// wallet, and through the chain's named RPC provider for a contract wallet,
// because that is where siwe.js createVerifier checks it.
//
// Opened by Hire (purpose 'hire'), it leads with connecting and says that
// hiring needs a connected wallet only. Once connected, "Continue to hire"
// closes it and carries on with the hire; signing in stays on offer, not in
// the way.

import React, { useEffect, useRef, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { Check, Copy, Loader2, PenLine, ShieldCheck, Wallet, X } from 'lucide-react';
import { useSignIn, rpcProviderName } from './SignInProvider';
import { shortAddress } from './useConnectedWallet';

function Step({ n, title, state, children }) {
  // state: 'done' | 'current' | 'waiting'
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-label font-semibold border ${
          state === 'done' ? 'bg-pos/10 border-pos/40 text-pos'
            : state === 'current' ? 'bg-accent text-accent-fg border-accent'
              : 'border-line-strong text-muted'}`}
        aria-hidden="true"
      >
        {state === 'done' ? <Check size={13} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-body font-semibold ${state === 'waiting' ? 'text-muted' : 'text-fg'}`}>{title}</p>
        {children}
      </div>
    </li>
  );
}

function CopyAddress({ address }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable; the address is on screen in full */ }
  };
  return (
    <button type="button" onClick={copy} aria-label="Copy address" title="Copy address" className="shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-muted hover:text-fg hover:bg-surface">
      {copied ? <Check size={14} className="text-pos" /> : <Copy size={14} />}
    </button>
  );
}

function WhereChecked({ chainId }) {
  return (
    <p>
      <span className="font-semibold text-fg">Where it is checked.</span> For an ordinary wallet, such as
      MetaMask, in this browser: the signature is not sent anywhere. A contract wallet (a smart account or a
      multisig) can only be checked by its contract, so its address, the message and the signature are sent to
      this chain&apos;s public RPC provider, {rpcProviderName(chainId)}. In either case nothing goes to our
      server. The signature is kept in this browser for 24 hours. There is no account, email or password, and
      no login provider holds anything about you.
    </p>
  );
}

export default function SignInModal({ onClose, purpose = 'signin', onContinue = null }) {
  const {
    status, address, pending, error, signIn, signOut, draftMessage, expiresAt, checkedBy, checkedOnChainId,
    signChainId, checkFailed,
  } = useSignIn();
  const { openConnectModal } = useConnectModal();
  const primaryRef = useRef(null);
  const forHire = purpose === 'hire';

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus the one thing to do next whenever the step changes.
  useEffect(() => { primaryRef.current?.focus(); }, [status]);

  const draft = status === 'connected' ? draftMessage() : { message: null, error: null };
  const continueToHire = () => { onClose(); onContinue?.(); };

  const title = status === 'signed' ? 'Signed in'
    : forHire ? 'Connect a wallet to hire'
      : 'Sign in with your wallet';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-surface text-fg border border-line rounded-t-xl sm:rounded-md p-5 pb-8 sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id="signin-title" className="text-title font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 -m-1 rounded-md flex items-center justify-center text-muted hover:text-fg hover:bg-inset">
            <X size={16} />
          </button>
        </div>

        {forHire && status !== 'signed' && (
          <p className="text-body text-fg mb-4 p-3 rounded-md border border-accent/40 bg-accent/10">
            Hiring needs a connected wallet only; signing in is optional. Your wallet signs each hire
            transaction itself.
          </p>
        )}

        {status === 'signed' ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-md border border-line bg-inset">
              <ShieldCheck size={16} className="text-pos shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-label text-muted">Your wallet</p>
                <p className="figure text-body text-fg break-all">{address}</p>
              </div>
              <CopyAddress address={address} />
            </div>
            <p className="text-body text-muted">
              {checkedBy === 'rpc'
                ? <>This is a contract wallet, so its signature was checked through {rpcProviderName(checkedOnChainId)}, this chain&apos;s public RPC provider. </>
                : <>The signature was checked in this browser and was not sent anywhere. </>}
              The site will call this address your wallet until{' '}
              {expiresAt ? new Date(expiresAt).toLocaleString() : 'the signature expires'}, or until you sign out,
              disconnect or switch account.
            </p>
            <div className="flex gap-2">
              {forHire && onContinue ? (
                <button ref={primaryRef} type="button" onClick={continueToHire} className="flex-1 h-10 rounded-md bg-accent text-accent-fg text-body font-semibold hover:opacity-90">
                  Continue to hire
                </button>
              ) : (
                <button ref={primaryRef} type="button" onClick={onClose} className="flex-1 h-10 rounded-md bg-accent text-accent-fg text-body font-semibold hover:opacity-90">
                  Done
                </button>
              )}
              <button type="button" onClick={signOut} className="h-10 px-4 rounded-md border border-line-strong text-body font-medium text-fg hover:bg-inset">
                Sign out
              </button>
            </div>
          </div>
        ) : (
          <>
            <ol className="space-y-4 mb-5">
              <Step n={1} title="Connect a wallet" state={status === 'disconnected' ? 'current' : 'done'}>
                {status === 'disconnected' ? (
                  <>
                    <p className="text-label text-muted mt-0.5 mb-2">Any wallet you already use, such as MetaMask, or one that connects through WalletConnect.</p>
                    <button
                      ref={primaryRef}
                      type="button"
                      onClick={() => openConnectModal?.()}
                      className="h-9 px-3 rounded-md bg-accent text-accent-fg text-label font-semibold hover:opacity-90 inline-flex items-center gap-1.5"
                    >
                      <Wallet size={14} aria-hidden="true" /> Connect a wallet
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-label text-muted mt-0.5">
                      Connected: <span className="figure text-fg">{shortAddress(address)}</span>. Until you sign, the site calls it this address.
                    </p>
                    {forHire && onContinue && (
                      <button
                        ref={primaryRef}
                        type="button"
                        onClick={continueToHire}
                        className="mt-2 h-9 px-3 rounded-md bg-accent text-accent-fg text-label font-semibold hover:opacity-90"
                      >
                        Continue to hire
                      </button>
                    )}
                  </>
                )}
              </Step>
              <Step n={2} title={forHire ? 'Sign in (optional)' : 'Sign a message'} state={status === 'connected' ? 'current' : 'waiting'}>
                {status === 'connected' && (
                  <>
                    {checkFailed && (
                      <p className="text-label text-warn mt-0.5 mb-2">A sign-in saved in this browser could not be checked because the network did not answer. It has been kept; this page will try again next time.</p>
                    )}
                    <p className="text-label text-muted mt-0.5 mb-2">Your wallet will show the message below and ask you to sign it.</p>
                    {draft.error ? (
                      <p role="alert" className="text-label text-neg">{draft.error}</p>
                    ) : (
                      <button
                        ref={forHire && onContinue ? undefined : primaryRef}
                        type="button"
                        onClick={signIn}
                        disabled={pending}
                        className={`h-9 px-3 rounded-md text-label font-semibold disabled:opacity-60 inline-flex items-center gap-1.5 ${
                          forHire ? 'border border-line-strong text-fg hover:bg-inset' : 'bg-accent text-accent-fg hover:opacity-90'}`}
                      >
                        {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <PenLine size={14} aria-hidden="true" />}
                        {pending ? 'Waiting for your wallet' : 'Sign the message'}
                      </button>
                    )}
                    {error && <p role="alert" className="text-label text-neg mt-2">{error}</p>}
                    {draft.message && (
                      <details className="mt-3">
                        <summary className="text-label text-accent cursor-pointer">Show the exact message</summary>
                        <pre className="mt-2 p-2.5 rounded-md bg-inset border border-line text-[11px] leading-snug whitespace-pre-wrap break-all figure text-fg">{draft.message}</pre>
                      </details>
                    )}
                  </>
                )}
              </Step>
            </ol>

            <div className="rounded-md border border-line bg-inset p-3 space-y-2 text-label text-muted">
              <p><span className="font-semibold text-fg">What signing does.</span> It shows this page that you control the address. The site then calls it your wallet rather than this address.</p>
              <p><span className="font-semibold text-fg">What it does not do.</span> It is a message, not a transaction. It moves no funds, approves nothing, grants no access to your wallet and costs no gas.</p>
              <WhereChecked chainId={signChainId} />
              <p><span className="font-semibold text-fg">You do not need it to read.</span> Everything on the site is public and readable without signing.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
