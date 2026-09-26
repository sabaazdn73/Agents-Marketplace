// vaults/DepositPanel.jsx
//
// What Deposit and Withdraw open: everything a visitor should read before
// signing anything, then a link out to the venue. No transaction is built
// and nothing is signed here; the deposit or withdrawal happens on the
// venue, in the visitor's own wallet. In-site signing waits on the owner's
// confirmation of vault Level 2 (vaults/venues.js).
//
// Shown, in this order: the lock-up, the fees, what the curator and admins
// can do, and that Tnega does not hold the funds. Each line is the vault's
// own reading from GET /api/vaults/{platform}/{address}; a line the answer
// does not carry is left out, not guessed.

import React, { useEffect, useRef } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { VENUES } from './venues';
import { CopyAddress } from '../ui/detail';

export default function DepositPanel({ vault, mode = 'deposit', onClose }) {
  const box = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    box.current?.querySelector('button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    const main = document.querySelector('main');
    const prevBody = document.body.style.overflow;
    const prevMain = main ? main.style.overflow : '';
    document.body.style.overflow = 'hidden';
    if (main) main.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevBody;
      if (main) main.style.overflow = prevMain;
      prev?.focus?.();
    };
  }, [onClose]);

  const venue = VENUES[vault.platform_key] || { name: vault.platform, url: null };
  const verb = mode === 'withdraw' ? 'Withdraw' : 'Deposit';
  const powers = vault.powers?.rows || [];
  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/70 p-0 md:p-4" onClick={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="deposit-title"
        className="w-full md:max-w-[520px] max-h-[90dvh] overflow-y-auto bg-surface border border-line rounded-t md:rounded p-5"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="deposit-title" className="text-[18px] font-bold text-fg">{verb}: {vault.name}</h2>
            <div className="mt-1 text-[13px] text-muted">{venue.name} · {vault.chain}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded flex items-center justify-center text-muted hover:text-fg hover:bg-inset">
            <X size={16} />
          </button>
        </div>

        <p className="mt-4 rounded border border-line-strong p-3 text-[13px] font-semibold text-fg">
          Tnega does not hold your funds. The {verb.toLowerCase()} happens on {venue.name}, signed in your own wallet.
        </p>

        <dl className="mt-4 divide-y divide-line text-[13px]">
          {vault.lockup?.text && <div className="py-2.5"><dt className="text-muted">Lock-up</dt><dd className="mt-0.5 text-fg">{vault.lockup.text}</dd></div>}
          {vault.fees?.text && <div className="py-2.5"><dt className="text-muted">Fees</dt><dd className="mt-0.5 text-fg">{vault.fees.text}</dd></div>}
          {powers.length > 0 && (
            <div className="py-2.5">
              <dt className="text-muted">What the curator and admins can do</dt>
              <dd className="mt-1 space-y-1.5">
                {powers.map(([role, what]) => (
                  <div key={role} className="text-fg"><span className="font-semibold">{role}:</span> {what}</div>
                ))}
                {vault.powers.moves && <div className="text-muted">{vault.powers.moves}</div>}
              </dd>
            </div>
          )}
          <div className="py-2.5">
            <dt className="text-muted">Vault address, to find it on {venue.name}</dt>
            <dd className="mt-0.5"><CopyAddress address={vault.address} /></dd>
          </div>
        </dl>

        {venue.url ? (
          <a href={venue.url} target="_blank" rel="noopener noreferrer"
            className="mt-5 w-full inline-flex items-center justify-center gap-2 h-10 rounded bg-accent text-accent-fg text-[14px] font-semibold hover:opacity-90">
            Open on {venue.name} <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : (
          <p className="mt-5 text-[13px] text-muted">{venue.name} has no public page we have checked to link to. Use the address above in the venue&apos;s own app.</p>
        )}
      </div>
    </div>
  );
}
