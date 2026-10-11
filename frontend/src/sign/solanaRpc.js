// sign/solanaRpc.js
//
// The reads the Solana signing page makes from this browser: the two mints,
// the wallet's balances, and a sent transaction's progress. Public RPC
// endpoints, tried in order, never through Tnega's server and never with a
// key. Sending is not here: the wallet sends the transaction it signs
// (sign/SolanaOrderView.jsx). Loaded by the Solana view only.

import { AddressLookupTableAccount, Connection, PublicKey } from '@solana/web3.js';
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

const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const TOKEN_PROGRAMS = ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].map((k) => new PublicKey(k));

/** The wallet's balance of `mint` in its smallest unit (BigInt): its
 *  associated token account under either token program, read as plain
 *  accounts. getParsedTokenAccountsByOwner is refused (403) by the public
 *  endpoints this page uses, so it is not called. A balance held outside the
 *  associated account is not counted. */
export async function readTokenBalance(owner, mint) {
  const o = new PublicKey(owner);
  const m = new PublicKey(mint);
  const atas = TOKEN_PROGRAMS.map((p) => PublicKey.findProgramAddressSync([o.toBuffer(), p.toBuffer(), m.toBuffer()], ATA_PROGRAM)[0]);
  const infos = await withRpc((c) => c.getMultipleAccountsInfo(atas, 'confirmed'));
  let total = 0n;
  infos.forEach((info, i) => {
    if (!info || !info.owner.equals(TOKEN_PROGRAMS[i]) || info.data.length < 72) return;
    const d = new Uint8Array(info.data);
    // Token account: mint(32) owner(32) amount u64 LE at byte 64.
    total += new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(64, true);
  });
  return total;
}

const LOOKUP_TABLE_PROGRAM = new PublicKey('AddressLookupTab1e1111111111111111111111111');

/** The address lookup tables at `addresses`, read on chain, in the same
 *  order; null for one that does not exist or is not a lookup table. The
 *  swap transaction is read against these (solanaTx.js). */
export async function readLookupTables(addresses) {
  if (!addresses.length) return [];
  const keys = addresses.map((a) => new PublicKey(a));
  const infos = await withRpc((c) => c.getMultipleAccountsInfo(keys, 'confirmed'));
  return infos.map((info, i) => {
    if (!info || !info.owner.equals(LOOKUP_TABLE_PROGRAM)) return null;
    try {
      return new AddressLookupTableAccount({ key: keys[i], state: AddressLookupTableAccount.deserialize(new Uint8Array(info.data)) });
    } catch { return null; }
  });
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
