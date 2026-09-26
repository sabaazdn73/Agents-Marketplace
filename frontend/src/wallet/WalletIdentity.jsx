// WalletIdentity.jsx
//
// The wallet control in both headers: the web header's compact bar and the
// mobile menu sheet's full-width block. One component, so the two apps cannot
// describe the same wallet in two different ways.
//
// The label is the point of it. A connected wallet that has not signed is
// "this address": the site can read it, but nothing shows the visitor
// controls it. A signed one is "your wallet". The words follow useSignIn()'s
// status and nothing else.

import React from 'react';
import { useDisconnect } from 'wagmi';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useSignIn } from './SignInProvider';
import { shortAddress } from './useConnectedWallet';
import { SIGN_IN_BUTTON } from './signInButton';

export function identityLabel(status) {
  return status === 'signed' ? 'Your wallet' : 'This address';
}

// `onOpenSignInPage`, when given, is what "Sign in" does for a visitor with
// no wallet connected: it opens the /signin page, which lists the wallets.
// Once a wallet is connected, signing happens in the modal, from wherever the
// visitor is, because leaving the page to sign one message is a detour.
export default function WalletIdentity({ layout = 'bar', onBeforeOpen, onOpenSignInPage }) {
  const { status, address, openSignIn } = useSignIn();
  const { disconnect } = useDisconnect();
  const open = () => { onBeforeOpen?.(); openSignIn(); };
  const start = () => {
    onBeforeOpen?.();
    if (onOpenSignInPage) onOpenSignInPage();
    else openSignIn();
  };

  if (status === 'disconnected') {
    return layout === 'bar' ? (
      <button
        type="button"
        onClick={start}
        className={`h-8 px-3 text-label whitespace-nowrap ${SIGN_IN_BUTTON}`}
      >
        Sign in
      </button>
    ) : (
      <button
        type="button"
        onClick={start}
        className={`w-full h-11 px-4 text-body flex items-center justify-between ${SIGN_IN_BUTTON}`}
      >
        <span>Sign in with your wallet</span>
        <span className="text-label font-medium opacity-80">Connect, then sign</span>
      </button>
    );
  }

  const signed = status === 'signed';
  const badge = (
    <button
      type="button"
      onClick={open}
      title={signed ? 'Signed in. Open to sign out.' : 'Connected, not signed in. Open to sign in.'}
      className={`min-w-0 flex items-center gap-2 text-left ${layout === 'bar' ? 'h-8 pl-2.5 pr-2' : 'flex-1 p-3'} hover:bg-inset rounded-md`}
    >
      {signed
        ? <ShieldCheck size={layout === 'bar' ? 14 : 16} className="text-pos shrink-0" aria-hidden="true" />
        : <span className="w-1.5 h-1.5 rounded-full bg-muted shrink-0" aria-hidden="true" />}
      <span className={`flex ${layout === 'bar' ? 'items-baseline gap-1.5' : 'flex-col'} min-w-0`}>
        <span className={`${layout === 'bar' ? 'text-micro' : 'text-label'} font-semibold uppercase tracking-wide ${signed ? 'text-pos' : 'text-muted'} whitespace-nowrap`}>
          {identityLabel(status)}
        </span>
        <span className="figure text-label text-fg truncate">{shortAddress(address)}</span>
      </span>
    </button>
  );

  if (layout === 'bar') {
    return (
      <div className="flex items-center h-8 rounded-md border border-line bg-surface">
        {badge}
        {!signed && (
          <button type="button" onClick={open} className={`h-6 px-2 mr-1 text-micro whitespace-nowrap ${SIGN_IN_BUTTON}`}>
            Sign in
          </button>
        )}
        <button
          type="button"
          onClick={() => disconnect()}
          title="Disconnect"
          aria-label="Disconnect wallet"
          className="w-7 h-7 mr-0.5 rounded flex items-center justify-center text-muted hover:text-fg"
        >
          <LogOut size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center rounded-md border border-line bg-inset">{badge}</div>
      <div className="flex gap-2">
        {!signed && (
          <button type="button" onClick={open} className={`flex-1 h-11 text-body ${SIGN_IN_BUTTON}`}>
            Sign in
          </button>
        )}
        <button
          type="button"
          onClick={() => disconnect()}
          className="flex-1 h-11 rounded border border-line-strong text-neg text-body font-semibold flex items-center justify-center gap-2"
        >
          <LogOut size={16} aria-hidden="true" /> Disconnect
        </button>
      </div>
    </div>
  );
}
