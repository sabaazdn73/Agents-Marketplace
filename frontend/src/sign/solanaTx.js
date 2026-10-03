// sign/solanaTx.js
//
// The transaction Jupiter built, read BEFORE the wallet is asked to sign it.
// Jupiter's /swap answers with a ready transaction; nothing in the quote
// proves the transaction does what the quote says, so the page reads the
// transaction itself and offers it only if it is, instruction by instruction,
// what the order needs and nothing else. This is the Solana counterpart of
// the EVM page's quoteMismatch (trade/lifi.js), which pins LI.FI's contract
// and the recipient of every step.
//
// WHAT IS REQUIRED
//   * one signature, the order's wallet, which is also the fee payer;
//   * every instruction's program is one of:
//       ComputeBudget      limit, price, loaded-accounts size only; the
//                          priority fee they add up to is capped
//       Associated Token   Create / CreateIdempotent, paid by the wallet, for
//                          the wallet (a token account for the wallet's own
//                          use, at its derived address). This is how a first
//                          xStock purchase gets its Token-2022 account.
//       Token / Token-2022 InitializeAccount(3), InitializeImmutableOwner,
//                          SyncNative, and CloseAccount back to the wallet.
//                          No Transfer, Approve or SetAuthority at top level.
//       Jupiter v6         exactly one route / shared-accounts route
//   * the Jupiter instruction names the wallet's token accounts for the two
//     mints (derived under each mint's own token program), and its trailing
//     arguments equal the quote's: the amount in, the quoted amount out, the
//     slippage, and no platform fee;
//   * a System Program instruction anywhere is refused (nothing here wraps SOL).
// Anything else is refused with the reason, and nothing is offered for
// signing. The list of programs is the constant ALLOWED below, in one place.
//
// What this does NOT prove: that Jupiter's own program, which the swap runs
// through, does what its published code does; and the instructions inside
// the route (they are Jupiter's CPIs to the pools). Those are Jupiter's.
//
// Loaded by the Solana view only (lazy chunk): it needs @solana/web3.js.

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM } from './solanaOrder.js';

export const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** Anchor discriminators sha256("global:<name>")[:8], as hex, of the two
 *  Jupiter instructions this page accepts. (Computed, not remembered:
 *  scripts/solana_selfcheck.mjs recomputes them.) */
export const JUP_ROUTE = 'e517cb977ae3ad2a';
export const JUP_SHARED_ROUTE = 'c1209b3341d69c81';

/** The most priority fee a swap may carry, in lamports (0.01 SOL). */
export const MAX_PRIORITY_LAMPORTS = 10_000_000n;
/** Rent a new token account costs, roughly, for the words (lamports). */
export const ATA_RENT_LAMPORTS_APPROX = 2_100_000;

const TOKEN_OK_IX = new Set([1, 9, 17, 18, 22]); // InitializeAccount, CloseAccount, SyncNative, InitializeAccount3, InitializeImmutableOwner
const COMPUTE_OK_IX = new Set([2, 3, 4]); // SetComputeUnitLimit, SetComputeUnitPrice, SetLoadedAccountsDataSizeLimit

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** The associated token account address of `owner` for `mint` under
 *  `tokenProgram` (all base58 strings). */
export function ataAddress(owner, mint, tokenProgram) {
  return PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ATA_PROGRAM),
  )[0].toBase58();
}

/** Read the tail of a Jupiter route instruction's data: in_amount u64,
 *  quoted_out_amount u64, slippage_bps u16, platform_fee_bps u8 (the last 19
 *  bytes of both `route` and `shared_accounts_route`). */
export function jupiterTail(data) {
  if (!data || data.length < 8 + 19) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = data.length;
  return {
    inAmount: dv.getBigUint64(n - 19, true),
    quotedOut: dv.getBigUint64(n - 11, true),
    slippageBps: dv.getUint16(n - 3, true),
    platformFeeBps: dv.getUint8(n - 1),
  };
}

/** Read the swap transaction against the order.
 *    txBase64   Jupiter's swapTransaction
 *    order      the Solana order (sign/solanaOrder.js)
 *    quote      the quote the transaction was built from
 *    req        the quote request (sign/jupiter.js quoteRequest)
 *    mints      { token, pay } as parseMint returns them (owner = token program)
 *  Resolves { ok: true, tx, facts } or { ok: false, why: [..] }. */
export function inspectSwapTx({ txBase64, order, quote, req, mints }) {
  const why = [];
  let tx;
  try { tx = VersionedTransaction.deserialize(b64ToBytes(txBase64)); } catch { return { ok: false, why: ['the transaction could not be read'] }; }
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const ixs = msg.compiledInstructions;
  const wallet = order.wallet;

  if (msg.header.numRequiredSignatures !== 1) why.push(`it needs ${msg.header.numRequiredSignatures} signatures, not one`);
  if (keys[0] !== wallet) why.push('its fee payer is not the order’s wallet');

  const tokenProgramOf = { [order.token.address]: mints.token.owner, [order.pay.address]: mints.pay.owner };
  const expectAtas = new Map(Object.entries(tokenProgramOf).map(([mint, prog]) => [mint, ataAddress(wallet, mint, prog)]));
  const createdAtas = [];
  let jupiter = 0;
  let cuLimit = null;
  let cuPrice = null;
  const programsSeen = new Set();

  ixs.forEach((ix, n) => {
    if (ix.programIdIndex >= keys.length) { why.push(`instruction ${n + 1} names its program through an address table`); return; }
    const program = keys[ix.programIdIndex];
    const data = ix.data;
    const acct = (i) => (ix.accountKeyIndexes[i] != null && ix.accountKeyIndexes[i] < keys.length ? keys[ix.accountKeyIndexes[i]] : null);
    programsSeen.add(program);
    if (program === COMPUTE_BUDGET_PROGRAM) {
      if (!COMPUTE_OK_IX.has(data[0])) { why.push(`instruction ${n + 1} is a compute-budget call this page does not accept`); return; }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data[0] === 2 && data.length >= 5) cuLimit = BigInt(dv.getUint32(1, true));
      if (data[0] === 3 && data.length >= 9) cuPrice = dv.getBigUint64(1, true);
      return;
    }
    if (program === ATA_PROGRAM) {
      const kind = data.length === 0 ? 0 : data[0];
      if (data.length > 1 || (kind !== 0 && kind !== 1)) { why.push(`instruction ${n + 1} is an associated-token call this page does not accept`); return; }
      const [payer, ata, owner, mint, , tokenProg] = [acct(0), acct(1), acct(2), acct(3), acct(4), acct(5)];
      if (payer !== wallet || owner !== wallet) { why.push(`instruction ${n + 1} creates a token account for or at the cost of another address`); return; }
      if (!mint || (tokenProg !== TOKEN_PROGRAM && tokenProg !== TOKEN_2022_PROGRAM) || ata !== ataAddress(wallet, mint, tokenProg)) { why.push(`instruction ${n + 1} creates a token account that is not the wallet's associated account`); return; }
      createdAtas.push({ mint, ata, tokenProgram: tokenProg });
      return;
    }
    if (program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) {
      if (!TOKEN_OK_IX.has(data[0])) { why.push(`instruction ${n + 1} is a token-program call this page does not accept (type ${data[0]})`); return; }
      if (data[0] === 9 && (acct(1) !== wallet || acct(2) !== wallet)) why.push(`instruction ${n + 1} closes a token account to an address other than the wallet`);
      return;
    }
    if (program === JUPITER_PROGRAM) {
      jupiter += 1;
      const disc = hex(data.subarray(0, 8));
      if (disc !== JUP_ROUTE && disc !== JUP_SHARED_ROUTE) { why.push(`the Jupiter instruction is not a route this page accepts (${disc})`); return; }
      const names = new Set(ix.accountKeyIndexes.map((i) => (i < keys.length ? keys[i] : null)));
      if (!names.has(wallet)) why.push('the Jupiter instruction does not include the order’s wallet');
      for (const [mint, ata] of expectAtas) {
        if (!names.has(ata)) why.push(`the Jupiter instruction does not use the wallet's ${mint === order.token.address ? (order.token.symbol || 'stock token') : 'USDC'} account (${ata})`);
      }
      const t = jupiterTail(data);
      if (!t) { why.push('the Jupiter instruction is too short to read'); return; }
      if (t.inAmount !== BigInt(req.amount)) why.push(`it spends ${t.inAmount} units, the order ${req.amount}`);
      if (t.quotedOut !== BigInt(quote.outAmount)) why.push('its quoted amount out is not the quote’s');
      if (t.slippageBps !== Number(req.slippageBps)) why.push(`its slippage is ${t.slippageBps} bps, the order ${req.slippageBps}`);
      if (t.platformFeeBps !== 0) why.push('it takes a platform fee');
      return;
    }
    if (program === SYSTEM_PROGRAM) { why.push(`instruction ${n + 1} is a System Program call (a transfer of SOL is possible), which this swap does not need`); return; }
    why.push(`instruction ${n + 1} calls a program this page does not accept (${program})`);
  });

  if (jupiter !== 1) why.push(`it has ${jupiter} Jupiter swap instructions, not one`);
  const priority = cuLimit != null && cuPrice != null ? (cuLimit * cuPrice) / 1_000_000n : 0n;
  if (priority > MAX_PRIORITY_LAMPORTS) why.push(`its priority fee is ${Number(priority) / 1e9} SOL, over the ${Number(MAX_PRIORITY_LAMPORTS) / 1e9} SOL this page allows`);

  if (why.length) return { ok: false, why };
  return {
    ok: true,
    tx,
    facts: {
      feePayer: keys[0],
      programs: [...programsSeen],
      createdAtas,
      priorityLamports: Number(priority),
      computeUnitLimit: cuLimit != null ? Number(cuLimit) : null,
      instructions: ixs.length,
    },
  };
}
