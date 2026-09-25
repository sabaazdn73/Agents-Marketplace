// siwe.js
//
// Sign-in with a wallet signature (EIP-4361), built and checked on the
// visitor's side. No React and no storage in this file, so it can be tested in
// node against a throwaway account.
//
// WHAT A SIGN-IN HERE PROVES, AND TO WHOM
// That whoever is at the keyboard controls the connected address. The message
// is built here, signed by the wallet, and checked here. Nothing is sent to
// our server and nothing is stored there: the backend holds no keys, signs
// nothing, and has no session to give.
//
// That is also its limit. The proof convinces this page and nothing else. A
// server receiving a request could not tell a signed-in visitor from anyone
// who typed the same address, because no server ever saw the signature. That
// is acceptable because every figure the site shows for a wallet is public
// data keyed by a public address: signing changes how the page describes the
// address ("your wallet" rather than "this address"), not what anybody is
// allowed to read. If a feature ever needs the server to trust who is asking,
// this is not that mechanism, and it must not be stretched into one.
//
// WHERE THE SIGNATURE IS CHECKED, EXACTLY
// An ordinary wallet (a private key, which is what MetaMask and most wallets
// are) is checked by recovering the signer from the signature, in the
// browser. Nothing leaves it: no RPC call, no request of any kind. That was
// not true of the first version, which called a public client's verifyMessage;
// in viem's default mode that makes an eth_call to a verifier contract and so
// sent the address, the message hash and the signature to the chain's RPC
// provider for every sign-in. Found on review, 2026-09-25.
//
// A contract wallet (a smart account, a multisig) has no private key to
// recover, so its signature can only be checked by asking the contract, on
// its chain. That needs an RPC call, and the site says so to the person
// before they sign. See createVerifier.

import { getAddress, recoverMessageAddress } from 'viem';
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe';

// What the wallet shows the person before they sign. Plain words, and the
// three things people worry about: money, permissions, gas.
export const SIGN_IN_STATEMENT =
  'Sign in to Tnega with this wallet. This is a signature, not a transaction: '
  + 'it moves no funds, approves nothing and costs no gas.';

export const SIGN_IN_TTL_MS = 24 * 60 * 60 * 1000;

// A clock that is a little ahead of the wallet's is not an attack. A message
// issued more than this far in the future is.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// The suffix an ERC-6492 signature carries: a smart account that has not been
// deployed yet. Its signature can only be checked on the chain, like any
// other contract wallet's.
const ERC6492_SUFFIX = '6492649264926492649264926492649264926492649264926492649264926492';

/** 16 bytes from the platform's cryptographic generator, as 32 hex digits.
 *
 *  viem's generateSiweNonce uses Math.random, which is not meant for values
 *  that must not be guessed. EIP-4361 requires at least 8 alphanumeric
 *  characters; hex is alphanumeric. */
export function newNonce() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The exact text the wallet is asked to sign. Throws if the page's own host
 *  cannot be a sign-in domain (EIP-4361 rejects some hosts, such as a bare
 *  IPv6 address); callers show that as an error rather than crash. */
export function buildSignInMessage({ address, chainId, domain, uri, now = new Date(), nonce = newNonce() }) {
  return createSiweMessage({
    address: getAddress(address),
    chainId,
    domain,
    uri,
    version: '1',
    statement: SIGN_IN_STATEMENT,
    nonce,
    issuedAt: now,
    expirationTime: new Date(now.getTime() + SIGN_IN_TTL_MS),
  });
}

/** The chain a message was signed for, or null if it cannot be read. */
export function messageChainId(message) {
  try {
    return parseSiweMessage(message)?.chainId ?? null;
  } catch {
    return null;
  }
}

/** A signature checker: the browser first, the chain only for a contract.
 *
 *  getClient(chainId) returns a viem public client for that chain, or null
 *  when the site does not know the chain. It is only ever called when the
 *  local check cannot settle the question, so for an ordinary wallet that
 *  signed correctly it is never called at all.
 *
 *  Resolves to { valid, method } where method is 'local' (recovered in the
 *  browser) or 'rpc' (asked the contract through that chain's RPC provider).
 *  Rejects only when the chain could not be asked, which the caller reports
 *  as verify_failed and must not treat as a bad signature. */
export function createVerifier(getClient) {
  return async ({ address, message, signature, chainId }) => {
    const is6492 = typeof signature === 'string' && signature.toLowerCase().endsWith(ERC6492_SUFFIX);
    if (!is6492) {
      let recovered = null;
      try {
        recovered = await recoverMessageAddress({ message, signature });
      } catch {
        recovered = null;
      }
      if (recovered && recovered.toLowerCase() === address.toLowerCase()) return { valid: true, method: 'local' };
    }
    // The signer did not recover to this address. Either the signature is
    // wrong, or the address is a contract wallet, which recovery cannot
    // check. Only the chain can tell them apart: ask whether the address has
    // code (this sends the address, and nothing else, to the RPC provider).
    const client = getClient(chainId);
    if (!client) throw new Error('unknown chain');
    if (!is6492) {
      const code = await client.getCode({ address });
      if (!code || code === '0x') return { valid: false, method: 'local' };
    }
    const valid = await client.verifyMessage({ address, message, signature });
    return { valid: !!valid, method: 'rpc' };
  };
}

function refused(reason) {
  return { ok: false, reason };
}

// Refusals that describe the proof itself. Any of these will fail the same
// way next time, so a stored proof that gets one is deleted. verify_failed is
// the one that describes the network rather than the proof, and a stored proof
// is kept through it.
export const PROOF_DEFECTS = new Set([
  'missing', 'unreadable', 'malformed', 'wrong_address', 'wrong_domain', 'wrong_uri',
  'wrong_chain', 'wrong_statement', 'expired', 'issued_in_future', 'invalid_fields', 'bad_signature',
]);

/** Check a stored or freshly signed message against the connected address.
 *
 *  Every refusal carries its reason, so a caller can tell "expired" from
 *  "someone else's signature" from "tampered" from "the network is down".
 *  Never throws.
 *
 *  `uri` is what this site issues (its origin); `chainIds` are the chains it
 *  issues messages for. `verify({ address, message, signature, chainId })`
 *  resolves to { valid, method } or a boolean. */
export async function verifySignIn({
  message, signature, address, domain, uri, chainIds, now = new Date(), verify,
}) {
  if (typeof message !== 'string' || typeof signature !== 'string' || !address) return refused('missing');

  let parsed;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    return refused('unreadable');
  }
  if (!parsed || !parsed.address || !parsed.expirationTime || parsed.version !== '1') return refused('malformed');
  if (parsed.address.toLowerCase() !== String(address).toLowerCase()) return refused('wrong_address');
  if (parsed.domain !== domain) return refused('wrong_domain');
  if (uri && parsed.uri !== uri) return refused('wrong_uri');
  if (chainIds && !chainIds.has(parsed.chainId)) return refused('wrong_chain');
  if (parsed.statement !== SIGN_IN_STATEMENT) return refused('wrong_statement');

  const expires = new Date(parsed.expirationTime);
  if (!(expires > now)) return refused('expired');
  if (parsed.issuedAt && new Date(parsed.issuedAt).getTime() > now.getTime() + CLOCK_SKEW_MS) return refused('issued_in_future');

  let fieldsOk = false;
  try {
    fieldsOk = validateSiweMessage({ message: parsed, address: getAddress(address), domain, time: now });
  } catch {
    fieldsOk = false;
  }
  if (!fieldsOk) return refused('invalid_fields');

  let result;
  try {
    result = await verify({ address: getAddress(address), message, signature, chainId: parsed.chainId });
  } catch {
    return refused('verify_failed');
  }
  const valid = typeof result === 'object' ? !!result?.valid : !!result;
  const method = typeof result === 'object' ? result?.method : undefined;
  return valid
    ? { ok: true, expiresAt: expires, chainId: parsed.chainId, method }
    : refused('bad_signature');
}
