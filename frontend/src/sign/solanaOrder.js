// sign/solanaOrder.js
//
// A Solana order: read from our API's answer, checked, and put in the shape
// the signing page draws (sign/SolanaOrderView.jsx). The EVM order is
// sign/order.js; readOrder there hands a Solana answer to normaliseSolanaOrder
// here. Plain module: no React, no @solana/web3.js (so a page that never
// signs on Solana does not load it), no imports from the site's build, so
// node loads it for scripts/solana_selfcheck.mjs.
//
// THE ORDER (the answer's fields; the link's own short keys are accepted for
// the ones that have them: s, c, t, p, a, w, e, m):
//   side           "buy" | "sell"
//   chain          "solana"
//   mint           the stock token's mint (base58, 32 bytes)
//   pay_mint       the stablecoin's mint: USDC only, EPjFWdd5...Dt1v
//   amount         decimal string; dollars on a buy, tokens on a sale
//                  ({"usd": ".."} / {"tokens": ".."} is accepted too)
//   slippage_bps   whole bps, 1 to 300
//   wallet         the signer (base58)
//   expires_at     ISO time or epoch seconds
//   value_check    the measured reference and limit, exactly as the EVM
//                  order carries them (sign/order.js readValueCheck)
// Anything else is refused, and nothing is quoted or signed for an order that
// fails any of these.

import { isSolanaAddress } from './base58.js';
import { decimalKey } from './orderMath.js';

export const SOLANA = 'solana';
/** Circle's USDC on Solana, 6 decimals. The only stablecoin a Solana order
 *  pays with or receives. */
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOLANA_PAY = [{ symbol: 'USDC', address: USDC_MINT, decimals: 6 }];
export const MAX_SLIPPAGE_BPS = 300;
/** How far behind the signed expiry this browser's clock may run. */
export const CLOCK_SKEW_MS = 60e3;

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const lc = (a) => String(a || '').toLowerCase();
const isDecimal = (s) => /^\d+(\.\d+)?$/.test(String(s || ''));
const first = (...xs) => xs.find((x) => x !== undefined && x !== null && x !== '');
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});

/** Does this answer name Solana as its chain? Looks where the EVM order
 *  looks for its chain (chain, chain_id, chainId, c, chain.id, chain.name). */
export function isSolanaData(data) {
  const o = obj(data?.order || data);
  const c = obj(o.chain);
  return [o.chain, o.chain_id, o.chainId, o.c, c.id, c.name, c.slug].some((x) => typeof x === 'string' && lc(x) === SOLANA);
}

/** The order the answer carries, or { error } / { expired: true, error }.
 *  `now` is this browser's clock; a link past its expiry (less the clock
 *  skew allowance) is expired. */
export function normaliseSolanaOrder(data, now = Date.now()) {
  const o = obj(data?.order || data);
  const tokenObj = obj(o.token);
  const payObj = obj(first(o.pay, o.pay_token, o.receive));
  const sideRaw = lc(first(o.side, o.s));
  const side = sideRaw === 's' || sideRaw === 'sell' ? 'sell' : sideRaw === 'b' || sideRaw === 'buy' ? 'buy' : null;
  const mint = first(o.mint, o.token_mint, tokenObj.mint, tokenObj.address, o.token_address, typeof o.token === 'string' ? o.token : null, o.t);
  const payMint = first(o.pay_mint, payObj.mint, payObj.address, o.pay_address, typeof o.pay === 'string' ? o.pay : null, o.p);
  const amountObj = obj(o.amount);
  const wantKey = side === 'sell' ? 'tokens' : 'usd';
  const otherKey = side === 'sell' ? 'usd' : 'tokens';
  const wallet = first(o.wallet, o.w);
  const serverRaw = first(o.from_amount_raw) ?? null;
  const expiresRaw = first(o.expires_at, o.e);
  const expiresAt = typeof expiresRaw === 'number' ? expiresRaw * (expiresRaw < 1e12 ? 1000 : 1) : Date.parse(expiresRaw);
  const slippageRaw = first(o.max_slippage_bps, o.slippage_bps, o.m);
  const slippageBps = typeof slippageRaw === 'string' && /^\d+$/.test(slippageRaw) ? Number(slippageRaw) : slippageRaw;

  if (!side) return { error: 'The order does not say whether it buys or sells.' };
  if (!isSolanaData(data)) return { error: 'The order is not on Solana.' };
  if (!isSolanaAddress(mint)) return { error: 'The order has no token mint, or it is not a Solana address.' };
  if (!isSolanaAddress(payMint)) return { error: 'The order has no stablecoin mint, or it is not a Solana address.' };
  const pay = SOLANA_PAY.find((x) => x.address === payMint);
  if (!pay) return { error: 'The order pays with a token that is not USDC on Solana, the only stablecoin this page uses there.' };
  if (mint === payMint) return { error: 'The order names the same token on both sides.' };
  if (!isSolanaAddress(wallet)) return { error: 'The order has no wallet address, or it is not a Solana address.' };
  // {"usd": ".."} on a buy, {"tokens": ".."} on a sell: the other key, or
  // dollars where tokens are meant, is refused rather than guessed at.
  if (amountObj[otherKey] != null && amountObj[wantKey] == null) return { error: `The order gives its amount in ${otherKey === 'usd' ? 'dollars' : 'tokens'}, but a ${side} is in ${wantKey === 'usd' ? 'dollars' : 'tokens'}.` };
  const amount = String(first(amountObj[wantKey], typeof o.amount === 'string' || typeof o.amount === 'number' ? o.amount : null, o.a, '') ?? '');
  if (!isDecimal(amount) || !(Number(amount) > 0)) return { error: 'The order has no amount.' };
  if (!Number.isInteger(slippageBps) || slippageBps <= 0 || slippageBps > MAX_SLIPPAGE_BPS) return { error: 'The order names a slippage this page does not accept (above 3%, the most Tnega prepares).' };
  if (!Number.isFinite(expiresAt)) return { error: 'The order has no expiry.' };
  if (serverRaw != null && !/^\d+$/.test(String(serverRaw))) return { error: 'The order\u2019s exact amount is not a whole number of units.' };
  if (expiresAt + CLOCK_SKEW_MS <= now) return { error: 'The link has expired.', expired: true };

  const tokenDecimals = Number(first(tokenObj.decimals, o.token_decimals));
  const secondsLeft = Number(o.seconds_left);
  const order = {
    family: SOLANA,
    side,
    chainId: SOLANA,
    chainName: 'Solana',
    key: `${SOLANA}/${mint}`,
    token: {
      address: mint,
      symbol: first(tokenObj.symbol, o.symbol, o.token_symbol) || null,
      name: first(tokenObj.name, o.name, o.token_name) || null,
      ticker: first(tokenObj.ticker, o.ticker, o.underlying) || null,
      issuer: first(tokenObj.issuer_name, tokenObj.issuer, o.issuer_name, o.issuer) || null,
      decimals: Number.isInteger(tokenDecimals) && tokenDecimals >= 0 && tokenDecimals <= 18 ? tokenDecimals : null,
    },
    pay: { ...pay, chainId: SOLANA, chainName: 'Solana' },
    amount,
    // The server's exact amount in the smallest unit. The page works out its
    // own (rawAmountSolana) from the chain's decimals and refuses the order if
    // the two differ.
    serverRaw: serverRaw != null ? String(serverRaw) : null,
    wallet,
    slippageBps,
    slippage: slippageBps / 10000,
    expiresAt,
    signedExpiry: expiresAt,
    deadline: Number.isFinite(secondsLeft) ? Math.min(now + secondsLeft * 1000, expiresAt) : expiresAt,
    controls: data?.controls && typeof data.controls === 'object' ? data.controls : (o.controls && typeof o.controls === 'object' ? o.controls : null),
    eligibility: first(o.eligibility, data?.eligibility) || null,
    valueCheck: null, // filled in by readOrder, from the cost signed into the link
  };
  return { order };
}

/** Where the answer's order differs from the one in the link's id: [] when
 *  none. The link's keys: s side (b|s), c "solana", t mint, p pay mint, a
 *  amount, w wallet, m slippage bps, e expiry (epoch seconds). Base58 is case
 *  sensitive, so addresses are compared exactly. */
export function payloadMismatchSolana(p, order) {
  const bad = [];
  const side = p.s === 'b' ? 'buy' : p.s === 's' ? 'sell' : null;
  if (side !== order.side) bad.push('buy or sell');
  if (lc(p.c) !== SOLANA) bad.push('the chain');
  if (p.t !== order.token.address) bad.push('the token');
  if (p.p !== order.pay.address) bad.push('the stablecoin');
  if (decimalKey(p.a) == null || decimalKey(p.a) !== decimalKey(order.amount)) bad.push('the amount');
  if (p.w !== order.wallet) bad.push('the wallet');
  if (Number(p.m) !== order.slippageBps) bad.push('the slippage');
  if (Number.isFinite(Number(p.e)) && Math.round(order.expiresAt / 1000) !== Number(p.e)) bad.push('the expiry');
  return bad;
}

/** The exact amount the wallet parts with, in the token's smallest unit, as a
 *  BigInt: a buy pays `amount` dollars in USDC (6 decimals, taken at $1); a
 *  sale parts with `amount` tokens. null while the decimals are unknown, or if
 *  the amount has more decimals than the token has (it is not rounded). */
export function rawAmountSolana(order, tokenDecimals) {
  const d = order.side === 'buy' ? order.pay.decimals : tokenDecimals;
  if (!Number.isInteger(d) || d < 0 || d > 18) return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(order.amount));
  if (!m) return null;
  const frac = m[2] || '';
  if (frac.replace(/0+$/, '').length > d) return null;
  const raw = BigInt(m[1] + frac.padEnd(d, '0').slice(0, d));
  return raw > 0n ? raw : null;
}

/** Does the server's exact amount, when it sends one, equal the page's? */
export function rawAgreesSolana(order, raw) {
  return order.serverRaw == null || raw == null || String(raw) === order.serverRaw;
}

/** One mint account, read: { owner, decimals, extensions, scaledUi } from the
 *  account's owner (base58) and data (Uint8Array), or { error }. Works for
 *  both token programs: the first 82 bytes are the same, and a Token-2022
 *  mint with extensions carries them after byte 165 as type/length/value. */
export function parseMint(owner, data) {
  if (owner !== TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) return { error: 'the account is not a mint of the token program or Token-2022' };
  if (!data || data.length < 82) return { error: 'the mint account is too short' };
  if (data[45] !== 1) return { error: 'the mint is not initialised' };
  const decimals = data[44];
  const out = { owner, decimals, extensions: [], scaledUi: null };
  if (owner === TOKEN_2022_PROGRAM && data.length > 165) {
    if (data[165] !== 1) return { error: 'the Token-2022 account is not a mint' };
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let at = 166;
    while (at + 4 <= data.length) {
      const type = dv.getUint16(at, true);
      const len = dv.getUint16(at + 2, true);
      if (type === 0 && len === 0) break;
      if (at + 4 + len > data.length) return { error: 'the mint’s extension data is cut short' };
      out.extensions.push(type);
      // ScaledUiAmountConfig (25): authority(32) multiplier f64(8)
      // effective_timestamp i64(8) new_multiplier f64(8).
      if (type === 25 && len >= 56) {
        out.scaledUi = { multiplier: dv.getFloat64(at + 4 + 32, true), newMultiplier: dv.getFloat64(at + 4 + 32 + 16, true), effectiveAt: Number(dv.getBigInt64(at + 4 + 32 + 8, true)) };
      }
      at += 4 + len;
    }
  }
  return out;
}

/** The mints read on chain against the order: [] when they agree, else the
 *  reasons in words. `mints` is { token: parseMint(..), pay: parseMint(..) }. */
export function mintsMismatch(order, mints) {
  const bad = [];
  const sym = order.token.symbol || 'the stock token';
  if (mints.token.error) bad.push(`${sym}: ${mints.token.error}`);
  if (mints.pay.error) bad.push(`USDC: ${mints.pay.error}`);
  if (bad.length) return bad;
  if (mints.pay.owner !== TOKEN_PROGRAM) bad.push('USDC is not owned by the token program');
  if (mints.pay.decimals !== order.pay.decimals) bad.push(`USDC has ${mints.pay.decimals} decimals on chain, this site's list says ${order.pay.decimals}`);
  if (order.token.decimals == null) bad.push('the order does not state the stock token’s decimals');
  else if (mints.token.decimals !== order.token.decimals) bad.push(`${sym} has ${mints.token.decimals} decimals on chain, the order says ${order.token.decimals}`);
  // A scaled-UI-amount mint shows balances as raw x multiplier, so "0.5
  // tokens" on screen is not 0.5 x 10^decimals raw. Not handled: refused
  // rather than signed with the wrong amount.
  const s = mints.token.scaledUi;
  if (s && (s.multiplier !== 1 || (s.newMultiplier !== 1 && s.newMultiplier !== 0 && Number.isFinite(s.newMultiplier)))) {
    bad.push(`${sym} shows balances scaled by a multiplier (${s.multiplier}), which this page does not support yet`);
  }
  return bad;
}

export const solscanTx = (sig) => (sig ? `https://solscan.io/tx/${sig}` : null);
export const solscanAccount = (a) => (a ? `https://solscan.io/account/${a}` : null);
export const solscanToken = (a) => (a ? `https://solscan.io/token/${a}` : null);
