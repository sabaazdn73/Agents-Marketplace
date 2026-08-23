// PasskeyBadge.jsx
//
// A real, on-chain-verified "Passkey-verified" badge, shared VERBATIM by web
// and mobile. Shown ONLY when a live KeyStore read genuinely confirms the
// wallet's admin key is a P-256 (WebAuthn/passkey) key — never a client-side
// claim, never shown for unregistered wallets, private-key signers, or
// anything unconfirmed. See passkeyKeystore.js for the full real investigation
// (curve-membership math on real on-chain-read bytes — the KeyStore contract
// itself stores both key types as byte-for-byte identical opaque data, so
// this is the genuine distinguishing signal, not a naive format check).
//
// Visually distinct from the existing "Verified" (8004scan reputation) badge
// on purpose — these are two unrelated real signals and must never be
// confused for one another.

import React, { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { usePublicClient } from 'wagmi';
import { checkPasskeyVerified } from './passkeyKeystore';

/** Real, live on-chain check — no caching, no assumed state. */
export function usePasskeyVerified(ownerAddress) {
  const publicClient = usePublicClient();
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!ownerAddress || !publicClient) { setResult(null); return; }
    let cancelled = false;
    setResult(null);
    checkPasskeyVerified(publicClient, ownerAddress).then((r) => { if (!cancelled) setResult(r); });
    return () => { cancelled = true; };
  }, [ownerAddress, publicClient]);
  return result;
}

// Copy audit (2026-08-22): this tooltip used to say things like "plaintext
// private key" and "on-chain KeyStore contract" — real, but meaningless to
// someone without a crypto background. Rewritten in plain language; the
// underlying check (usePasskeyVerified above) is unchanged.
const PLAIN_TOOLTIP =
  "This account unlocks with Face ID or a fingerprint, not a secret password someone could steal or lose. " +
  "We checked this directly, ourselves — it's not just something the owner claims. " +
  "It doesn't prove one specific real person controls it, though.";

export default function PasskeyBadge({ ownerAddress, className = '' }) {
  const result = usePasskeyVerified(ownerAddress);
  if (!result || result.status !== 'passkey') return null; // no badge unless genuinely confirmed — ever
  return (
    <span
      title={PLAIN_TOOLTIP}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 ${className}`}
    >
      <Fingerprint size={11} /> Uses Face ID / fingerprint
    </span>
  );
}
