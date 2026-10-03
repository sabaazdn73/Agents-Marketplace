// sign/SolanaConnectModal.jsx
//
// The Solana wallet list, in the dress of the wallet sign-in modal
// (wallet/SignInModal.jsx): a centred dialog on a wide screen, a sheet from
// the bottom on a phone, the same surface, border, close button and type.
// RainbowKit's modal is for EVM wallets and does not list Solana ones, so a
// Solana order gets this one. It lists the wallets this browser announces
// through the wallet standard (Phantom, Solflare, Backpack and others);
// nothing is listed that is not installed, and connecting signs nothing.
//
// Loaded with the Solana view only (a lazy chunk).

import React, { useEffect } from 'react';
import { WalletReadyState } from '@solana/wallet-adapter-base';
import { Wallet, X } from 'lucide-react';

const INSTALLABLE = [
  ['Phantom', 'https://phantom.com/download'],
  ['Solflare', 'https://www.solflare.com/download/'],
];

export default function SolanaConnectModal({ wallets, onPick, onClose, orderWallet, error }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const found = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sol-connect-title"
        className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto bg-surface text-fg border border-line rounded-t-xl sm:rounded-md p-5 pb-8 sm:pb-5"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id="sol-connect-title" className="text-title font-bold">Connect a Solana wallet</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 -m-1 rounded-md flex items-center justify-center text-muted hover:text-fg hover:bg-inset">
            <X size={16} />
          </button>
        </div>

        <p className="text-body text-muted mb-4">
          This order was prepared for <span className="figure text-fg">{orderWallet.slice(0, 4)}...{orderWallet.slice(-4)}</span>.
          Connect the wallet that holds that address. Connecting signs nothing.
        </p>

        {found.length > 0 ? (
          <ul className="space-y-2 mb-4">
            {found.map((w) => (
              <li key={w.adapter.name}>
                <button
                  type="button"
                  onClick={() => onPick(w.adapter.name)}
                  className="w-full h-11 px-3 rounded-md border border-line-strong text-body font-medium text-fg hover:bg-inset inline-flex items-center gap-3"
                >
                  {w.adapter.icon
                    ? <img src={w.adapter.icon} alt="" width="22" height="22" className="rounded" />
                    : <Wallet size={18} aria-hidden="true" />}
                  <span className="flex-1 text-left">{w.adapter.name}</span>
                  <span className="text-label text-muted">{w.readyState === WalletReadyState.Installed ? 'Detected' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-line bg-inset p-3 mb-4 text-label text-muted space-y-2">
            <p><span className="font-semibold text-fg">No Solana wallet was found in this browser.</span> Install one, then reload this page; the order stays valid until its link expires.</p>
            <p>
              {INSTALLABLE.map(([n, href], i) => (
                <React.Fragment key={n}>
                  {i > 0 && ' or '}
                  <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-accent">{n}</a>
                </React.Fragment>
              ))}
              . On a phone, open this link inside the wallet app&apos;s own browser.
            </p>
          </div>
        )}

        {error && <p role="alert" className="text-label text-neg mb-3">{error}</p>}

        <div className="rounded-md border border-line bg-inset p-3 space-y-2 text-label text-muted">
          <p><span className="font-semibold text-fg">What connecting does.</span> It shows this page the address of the wallet you pick. Nothing is sent to Tnega.</p>
          <p><span className="font-semibold text-fg">What it does not do.</span> It signs nothing, moves no funds and approves nothing. The swap is signed later, in your wallet, on your click.</p>
        </div>
      </div>
    </div>
  );
}
