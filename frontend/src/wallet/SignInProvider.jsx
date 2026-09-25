// SignInProvider.jsx
//
// The sign-in state for the whole site, and the modal that changes it.
//
// Three states, exposed by useSignIn():
//   disconnected  no wallet connected
//   connected     a wallet is connected but has not signed; the site calls it
//                 "this address", because nothing yet shows the visitor
//                 controls it
//   signed        the connected wallet signed the sign-in message, the
//                 signature checked out, and it has not expired; the site
//                 calls it "your wallet"
//
// See siwe.js for what a signature does and does not prove, and where it is
// checked. The short version, which every caller should keep in mind: the
// proof convinces this page only. No server of ours sees it and none could
// rely on it.
//
// WHERE THE PROOF LIVES
// localStorage, under the address, as the signed message and the signature.
// Every read and write is wrapped. With site data blocked, index.html swaps in
// an in-memory store, so a sign-in then lasts for the page's lifetime only.
//
// WHEN IT ENDS
// After 24 hours (the message's own expiration time), on sign-out, when the
// wallet disconnects, or when the wallet switches to another account. On load,
// proofs stored for any address other than the connected one are deleted, so a
// switch made while the tab was closed ends the old proof too. A stored proof
// is checked again on every load, not trusted because it exists. It is deleted
// only when the check shows a defect in the proof itself (siwe.js
// PROOF_DEFECTS); a network failure while checking leaves it in place and the
// page says "this address" until the check can run.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSignMessage } from 'wagmi';
import { getPublicClient } from 'wagmi/actions';
import { bsc } from 'wagmi/chains';
import { wagmiConfig, RPC_PROVIDER_NAMES } from '../wagmiConfig';
import {
  buildSignInMessage, createVerifier, messageChainId, PROOF_DEFECTS, verifySignIn,
} from './siwe';
import { useConnectedWallet } from './useConnectedWallet';
import SignInModal from './SignInModal';

const STORE_PREFIX = 'tnega_signin_v1:';
const storeKey = (address) => `${STORE_PREFIX}${String(address).toLowerCase()}`;

function readStored(address) {
  try {
    const raw = window.localStorage.getItem(storeKey(address));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(address, record) {
  try {
    window.localStorage.setItem(storeKey(address), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function clearStored(address) {
  try { window.localStorage.removeItem(storeKey(address)); } catch { /* storage blocked */ }
}

/** Delete every stored proof except the one for `keep`. */
function clearOthers(keep) {
  try {
    const keepKey = keep ? storeKey(keep) : null;
    const stale = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(STORE_PREFIX) && k !== keepKey) stale.push(k);
    }
    stale.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* storage blocked */ }
}

// The chains the site issues sign-in messages for, which are the chains it can
// reach: a message naming any other chain is refused, and a contract wallet's
// signature is checked on the chain its message names, not on whatever chain
// the wallet happens to be on now.
const KNOWN_CHAIN_IDS = new Set(wagmiConfig.chains.map((c) => c.id));

const verifier = createVerifier((chainId) => (
  KNOWN_CHAIN_IDS.has(chainId) ? getPublicClient(wagmiConfig, { chainId }) : null
));

export function rpcProviderName(chainId) {
  return RPC_PROVIDER_NAMES[chainId] || RPC_PROVIDER_NAMES[bsc.id];
}

function isUserRejection(e) {
  const text = `${e?.name || ''} ${e?.shortMessage || ''} ${e?.message || ''}`;
  return e?.code === 4001 || /UserRejected|rejected|denied/i.test(text);
}

const SignInContext = createContext(null);

export function SignInProvider({ children }) {
  const { address, isConnected, chainId } = useConnectedWallet();
  const signChainId = KNOWN_CHAIN_IDS.has(chainId) ? chainId : bsc.id;
  const { signMessageAsync } = useSignMessage();

  const [signed, setSigned] = useState(null); // { address, expiresAt, method, chainId }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [modal, setModal] = useState(null); // null | { purpose, onContinue }
  const previous = useRef(null);
  const currentAddress = useRef(null);
  currentAddress.current = address || null;

  const expectation = () => ({
    domain: window.location.host,
    uri: window.location.origin,
    chainIds: KNOWN_CHAIN_IDS,
  });

  // A different account, or none: the previous account's proof is ended, not
  // kept for later. Switching back means signing again.
  useEffect(() => {
    const prev = previous.current;
    if (prev && prev.toLowerCase() !== (address || '').toLowerCase()) clearStored(prev);
    previous.current = address || null;
    setSigned(null);
    setError(null);
    setCheckFailed(false);
    if (address) clearOthers(address);
  }, [address]);

  // A stored proof for this address is re-checked, not trusted.
  useEffect(() => {
    if (!address) return undefined;
    const record = readStored(address);
    if (!record) return undefined;
    let cancelled = false;
    verifySignIn({ message: record.message, signature: record.signature, address, ...expectation(), verify: verifier })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) { setSigned({ address, expiresAt: r.expiresAt, method: r.method, chainId: r.chainId }); return; }
        if (PROOF_DEFECTS.has(r.reason)) clearStored(address);
        else setCheckFailed(true); // verify_failed: keep the proof, say "this address" for now
      });
    return () => { cancelled = true; };
  }, [address]);

  // Expiry ends it on time, not on the next reload.
  useEffect(() => {
    if (!signed) return undefined;
    const ms = new Date(signed.expiresAt).getTime() - Date.now();
    const end = () => { clearStored(signed.address); setSigned(null); };
    if (ms <= 0) { end(); return undefined; }
    const t = setTimeout(end, Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [signed]);

  // Built when asked for, so the modal can show the exact text before the
  // wallet does. Rebuilt at signing if it has gone stale. A host that cannot
  // be a sign-in domain (a bare IPv6 address, for one) is reported, not thrown.
  const draftRef = useRef(null);
  const draftMessage = useCallback(() => {
    if (!address) return { message: null, error: null };
    const fresh = draftRef.current
      && draftRef.current.address === address
      && draftRef.current.chainId === signChainId
      && Date.now() - draftRef.current.at < 5 * 60 * 1000;
    if (!fresh) {
      let message = null;
      let buildError = null;
      try {
        message = buildSignInMessage({
          address, chainId: signChainId, domain: window.location.host, uri: window.location.origin,
        });
      } catch (e) {
        buildError = `This page's address (${window.location.host}) cannot be used in a sign-in message, so signing in is not available here.`;
      }
      draftRef.current = { address, chainId: signChainId, at: Date.now(), message, error: buildError };
    }
    return { message: draftRef.current.message, error: draftRef.current.error };
  }, [address, signChainId]);

  const signIn = useCallback(async () => {
    const startedAs = address;
    if (!startedAs) return false;
    const { message, error: buildError } = draftMessage();
    if (!message) { setError(buildError); return false; }
    setPending(true);
    setError(null);
    try {
      const signature = await signMessageAsync({ message });
      // The account may have changed while the wallet was open. A proof for
      // the old account is not written, and not shown as the new one's.
      if ((currentAddress.current || '').toLowerCase() !== startedAs.toLowerCase()) {
        setError('The wallet switched account while signing, so that signature was not used. Sign again as this account.');
        return false;
      }
      const r = await verifySignIn({ message, signature, address: startedAs, ...expectation(), verify: verifier });
      if ((currentAddress.current || '').toLowerCase() !== startedAs.toLowerCase()) return false;
      if (!r.ok) {
        setError(r.reason === 'bad_signature'
          ? 'The signature did not match this address, so you are not signed in.'
          : r.reason === 'verify_failed'
            ? 'The signature could not be checked because the network did not answer. You are not signed in; try again.'
            : `The signature could not be checked (${r.reason}). You are not signed in.`);
        return false;
      }
      writeStored(startedAs, { message, signature });
      draftRef.current = null;
      setCheckFailed(false);
      setSigned({ address: startedAs, expiresAt: r.expiresAt, method: r.method, chainId: r.chainId });
      return true;
    } catch (e) {
      setError(isUserRejection(e)
        ? 'You declined in your wallet. Nothing was signed.'
        : 'Your wallet did not return a signature. Nothing was signed.');
      return false;
    } finally {
      setPending(false);
    }
  }, [address, signMessageAsync, draftMessage]);

  const signOut = useCallback(() => {
    if (address) clearStored(address);
    setSigned(null);
    setError(null);
  }, [address]);

  const status = !isConnected
    ? 'disconnected'
    : (signed && signed.address === address ? 'signed' : 'connected');

  const value = useMemo(() => ({
    status,
    address,
    expiresAt: status === 'signed' ? signed.expiresAt : null,
    checkedBy: status === 'signed' ? signed.method : null,
    checkedOnChainId: status === 'signed' ? signed.chainId : null,
    signChainId,
    checkFailed,
    pending,
    error,
    signIn,
    signOut,
    draftMessage,
    // purpose 'hire' leads with connecting and offers a way straight back to
    // the hire; onContinue is what "Continue to hire" runs.
    openSignIn: (opts = {}) => { setError(null); setModal({ purpose: opts.purpose || 'signin', onContinue: opts.onContinue || null }); },
    closeSignIn: () => setModal(null),
  }), [status, address, signed, signChainId, checkFailed, pending, error, signIn, signOut, draftMessage]);

  return (
    <SignInContext.Provider value={value}>
      {children}
      {modal && (
        <SignInModal
          purpose={modal.purpose}
          onContinue={modal.onContinue}
          onClose={() => setModal(null)}
        />
      )}
    </SignInContext.Provider>
  );
}

/** { status: 'disconnected'|'connected'|'signed', address, signIn(), signOut(), ... } */
export function useSignIn() {
  const ctx = useContext(SignInContext);
  if (!ctx) throw new Error('useSignIn must be used inside SignInProvider');
  return ctx;
}

export { messageChainId };
