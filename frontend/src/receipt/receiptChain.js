// receipt/receiptChain.js
//
// The Tnega Receipt, read and re-checked from this browser (architecture
// flow 2 and the verifier, Solana Fall School final project). Plain
// functions, no React, so scripts/receipt_selfcheck.mjs can run them.
//
// A receipt lives at the PDA ["receipt", content_hash] of the tnega-receipt
// program on Solana devnet. content_hash is the SHA-256 of a public JSON file
// (public/receipts/<content_hash>.json): the order the buyer signed, the
// execution read from the source chain, and the prices Tnega had read on the
// other chains, each with its time and source. The buyer opts in by signing
// receiptMessage(content_hash) with their own wallet; Tnega's attestor then
// writes the receipt in ONE transaction that starts with an Ed25519 program
// instruction verifying that signature, so the transaction (and the receipt)
// cannot exist without it.

import { PublicKey } from '@solana/web3.js';
import { base58Decode } from '../sign/base58.js';

export const RECEIPT_PROGRAM = '6Nzn82QGVZTiU3iv26ZT9UKQFfyYyjyCoWqUZJ5LLrxP';
export const DEVNET_RPC = 'https://api.devnet.solana.com';
export const MAINNET_RPC = 'https://solana-rpc.publicnode.com';
export const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';
export const SOLANA_CHAIN_ID = 0n;

/** The exact text the buyer's wallet signs: UTF-8, no trailing newline. */
export const receiptMessage = (hashHex) => `Tnega Receipt v1\ncontent_hash: ${hashHex}`;

export const isContentHash = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
export const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export const bytesOfHex = (hex) => Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16)));
export const sameBytes = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Base58 of any bytes (a 64-byte signature included). */
export function base58Encode(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) out += '1';
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i]];
  return out;
}

const programKey = () => new PublicKey(RECEIPT_PROGRAM);
export const receiptPda = (hashBytes) => PublicKey.findProgramAddressSync([new TextEncoder().encode('receipt'), hashBytes], programKey())[0];
export const configPda = () => PublicKey.findProgramAddressSync([new TextEncoder().encode('config')], programKey())[0];

/** Anchor's account discriminator: the first 8 bytes of SHA-256("account:<Name>"). */
export async function accountDiscriminator(name) {
  return (await sha256(new TextEncoder().encode(`account:${name}`))).subarray(0, 8);
}

/** The Receipt account (state/receipt.rs), after its 8-byte discriminator.
 *  Version 1's fields, then (version 2) version, executed_at and readings. */
export function decodeReceipt(data) {
  const b = data instanceof Uint8Array ? data : Uint8Array.from(data);
  if (b.length < 8 + 32 + 8 + 32 + 32 + 4 + 4 + 8 + 8 + 32 + 1 + 1) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8;
  const take = (n) => { const x = b.subarray(o, o + n); o += n; return x; };
  const u8 = () => { const x = b[o]; o += 1; return x; };
  const u32 = () => { const x = dv.getUint32(o, true); o += 4; return x; };
  const u64 = () => { const x = dv.getBigUint64(o, true); o += 8; return x; };
  const i64 = () => { const x = Number(dv.getBigInt64(o, true)); o += 8; return x; };
  const r = {
    contentHash: take(32),
    chainId: u64(),
    txHash: take(32),
    buyer: take(32),
    quotedBps: u32(),
    executedBps: u32(),
    notionalCents: u64(),
    issuedAt: i64(),
    issuer: new PublicKey(take(32)).toBase58(),
    active: u8() === 1,
    bump: u8(),
    version: 1,
    executedAt: null,
    readings: [],
  };
  if (b.length >= o + 1 + 8 + 4) {
    r.version = u8();
    r.executedAt = i64();
    const n = u32();
    for (let i = 0; i < n && o + READING_BYTES <= b.length; i += 1) {
      r.readings.push({
        chainId: u64(),
        tokenSuffix: take(8),
        state: u8(),
        costBps: u32(),
        pricePerShareMicros: u64(),
        sizeUsd: u32(),
        asOf: i64(),
        block: u64(),
        source: u8(),
      });
    }
  }
  return r;
}

/** One reading on chain: 8 + 8 + 1 + 4 + 8 + 4 + 8 + 8 + 1 bytes. */
export const READING_BYTES = 50;
const READING_STATES = { filled: 0, too_thin: 1, no_route: 2, no_pool: 2, not_a_venue: 2 };

/** A record reading as the attestor writes it on chain (the same rules as
 *  scripts/receipt-devnet.mjs readingFromRecord), or null if malformed. */
export function readingFromRecord(r) {
  const [chainPart, token] = String(r?.key || '').split('/');
  if (!chainPart || !token) return null;
  const solana = chainPart === 'solana';
  const tokenBytes = solana ? base58Decode(token) : (/^0x[0-9a-fA-F]{40}$/.test(token) ? bytesOfHex(token.slice(2).toLowerCase()) : null);
  const state = READING_STATES[r.state];
  if (!tokenBytes || tokenBytes.length < 8 || state === undefined) return null;
  const filled = state === 0;
  return {
    chainId: solana ? 0n : BigInt(chainPart),
    tokenSuffix: tokenBytes.subarray(tokenBytes.length - 8),
    state,
    costBps: filled ? Math.round(Number(r.cost_bps)) : 0,
    pricePerShareMicros: filled && r.allin_per_share_usd != null ? BigInt(Math.round(Number(r.allin_per_share_usd) * 1e6)) : 0n,
    sizeUsd: Number(r.size_usd),
    asOf: Math.floor(Date.parse(r.as_of) / 1000),
    block: BigInt(r.block ?? r.slot ?? 0),
    source: r.block != null ? 0 : 1,
  };
}

export const sameReading = (a, b) => !!a && !!b
  && a.chainId === b.chainId && sameBytes(a.tokenSuffix, b.tokenSuffix) && a.state === b.state
  && a.costBps === b.costBps && a.pricePerShareMicros === b.pricePerShareMicros && a.sizeUsd === b.sizeUsd
  && a.asOf === b.asOf && a.block === b.block && a.source === b.source;

/** The ReceiptConfig account: authority, attestor, paused. */
export function decodeConfig(data) {
  const b = data instanceof Uint8Array ? data : Uint8Array.from(data);
  if (b.length < 8 + 32 + 32 + 1) return null;
  return {
    authority: new PublicKey(b.subarray(8, 40)).toBase58(),
    attestor: new PublicKey(b.subarray(40, 72)).toBase58(),
    paused: b[72] === 1,
  };
}

/** The signatures one Ed25519 program instruction verifies, read from its
 *  data: [count u8, padding u8, count x 7 u16 offsets, payload]. Only offsets
 *  inside the instruction itself (index 0xFFFF) are read; any other index is
 *  reported as such and not trusted here. */
export function parseEd25519(data) {
  const b = data instanceof Uint8Array ? data : Uint8Array.from(data);
  if (b.length < 2) return [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = b[0];
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const at = 2 + i * 14;
    if (at + 14 > b.length) break;
    const u16 = (k) => dv.getUint16(at + k, true);
    const [sigOff, sigIx, pkOff, pkIx, msgOff, msgLen, msgIx] = [u16(0), u16(2), u16(4), u16(6), u16(8), u16(10), u16(12)];
    const self = sigIx === 0xffff && pkIx === 0xffff && msgIx === 0xffff;
    const fits = pkOff + 32 <= b.length && sigOff + 64 <= b.length && msgOff + msgLen <= b.length;
    out.push(self && fits
      ? { self: true, publicKey: b.slice(pkOff, pkOff + 32), signature: b.slice(sigOff, sigOff + 64), message: b.slice(msgOff, msgOff + msgLen) }
      : { self: false });
  }
  return out;
}

/** The 32-byte buyer the program stores: a Solana address as is, an EVM
 *  address left-padded with 12 zero bytes. */
export function buyerBytes(addr) {
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return Uint8Array.from([...new Uint8Array(12), ...bytesOfHex(addr.slice(2).toLowerCase())]);
  const b = base58Decode(addr);
  return b && b.length === 32 ? b : null;
}

/** The 32-byte tx_hash the program stores: an EVM 0x hash as is, a Solana
 *  signature (base58, 64 bytes) hashed with SHA-256. */
export async function txHashBytes(tx) {
  if (/^0x[0-9a-fA-F]{64}$/.test(tx)) return bytesOfHex(tx.slice(2).toLowerCase());
  const b = base58Decode(tx);
  if (!b || b.length !== 64) return null;
  return sha256(b);
}

/** What the record says the receipt's fields must be (the issue script's
 *  fieldsFromRecord, read back). */
export function expectedFields(file) {
  const rec = file?.record || {};
  const v = rec.value || rec;
  const order = v.order || {};
  const exec = v.execution || {};
  const impact = v.measured?.price_impact_bps ?? v.quote?.price_impact_bps ?? v.tolerance?.cost_ex_gas_bps ?? 0;
  const blockTime = Date.parse(exec.block_time ?? '');
  return {
    chain: file?.purchase?.chain,
    tx: file?.purchase?.tx,
    buyer: order.wallet || v.buyer,
    quotedBps: Math.round(Number(impact)),
    executedBps: exec.executed_cost_bps != null ? Number(exec.executed_cost_bps) : Math.round(Number(impact)),
    notionalCents: BigInt(Math.round(Number(order.amount) * 100)),
    executedAt: Number.isFinite(blockTime) ? Math.floor(blockTime / 1000) : null,
    readings: (Array.isArray(v.readings) ? v.readings : []).map(readingFromRecord),
  };
}

/** Token balance change of one owner for one mint in a transaction's meta
 *  (raw units, BigInt): post minus pre. */
export function balanceChange(meta, owner, mint) {
  const sum = (arr) => (arr || []).filter((x) => x.owner === owner && x.mint === mint)
    .reduce((s, x) => s + BigInt(x.uiTokenAmount?.amount || '0'), 0n);
  return sum(meta?.postTokenBalances) - sum(meta?.preTokenBalances);
}

export const pct = (bps) => (bps == null ? null : `${(Number(bps) / 100).toFixed(2)}%`);
export const usd = (n, d = 2) => (n == null ? null : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
export const utcTime = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 19) + ' UTC' : null;
};
export const explorerDevnet = (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
