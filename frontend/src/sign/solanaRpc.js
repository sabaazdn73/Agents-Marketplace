// sign/solanaRpc.js
//
// The reads the Solana signing page makes from this browser: the two mints,
// the wallet's balances, and a sent transaction's progress. Public RPC
// endpoints, tried in order, never through Tnega's server and never with a
// key. Sending is not here: the wallet sends the transaction it signs
// (sign/SolanaOrderView.jsx). Loaded by the Solana view only.

import { Connection, PublicKey } from '@solana/web3.js';
import { parseMint } from './solanaOrder.js';
import { signatureOutcome } from './solanaStatus.js';

// Both allow browser origins and are named in vercel.json's connect-src.
export const SOLANA_RPCS = ['https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];

const conns = SOLANA_RPCS.map((u) => new Connection(u, { commitment: 'confirmed' }));
/** The first endpoint, for the wallet adapter's own use. */
export const primaryConnection = conns[0];

/** Run `fn(connection)` on each endpoint in turn until one answers. */
export async function withRpc(fn) {
  let last = null;
  for (const c of conns) {
    try { return await fn(c); } catch (e) { last = e; }
  }
  throw last || new Error('no Solana endpoint answered');
}

/** { token, pay }: each parseMint's result (decimals, token program,
 *  extensions) for the order's two mints, read on chain. */
export async function readMints(order) {
  const keys = [order.token.address, order.pay.address].map((k) => new PublicKey(k));
  const infos = await withRpc((c) => c.getMultipleAccountsInfo(keys, 'confirmed'));
  const one = (info) => (info ? parseMint(info.owner.toBase58(), new Uint8Array(info.data)) : { error: 'the mint account does not exist' });
  return { token: one(infos[0]), pay: one(infos[1]) };
}

/** The wallet's balance of `mint` in its smallest unit (BigInt), summed over
 *  every token account it has for it, under either token program. */
export async function readTokenBalance(owner, mint) {
  const res = await withRpc((c) => c.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, 'confirmed'));
  let total = 0n;
  for (const { account } of res.value) {
    const amt = account?.data?.parsed?.info?.tokenAmount?.amount;
    if (/^\d+$/.test(String(amt))) total += BigInt(amt);
  }
  return total;
}

export async function readSol(owner) {
  return withRpc((c) => c.getBalance(new PublicKey(owner), 'confirmed'));
}

/** One look at a sent transaction: { state, err? } (solanaStatus.js). */
export async function lookAtSignature(signature, lastValidBlockHeight) {
  return withRpc(async (c) => {
    const st = await c.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const entry = st.value[0];
    const height = entry ? null : await c.getBlockHeight('confirmed');
    return signatureOutcome(entry, height, lastValidBlockHeight);
  });
}
