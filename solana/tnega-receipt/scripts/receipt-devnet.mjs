#!/usr/bin/env node
// scripts/receipt-devnet.mjs
//
// Talks to the deployed tnega_receipt program on Solana devnet, with plain
// @solana/web3.js (no Anchor client needed).
//
//   node scripts/receipt-devnet.mjs status
//   node scripts/receipt-devnet.mjs init
//   node scripts/receipt-devnet.mjs issue --receipt <content_hash>.json --buyer-sig <base58>
//   node scripts/receipt-devnet.mjs issue --record order.json --tx <purchase signature or 0x hash> --buyer-sig <base58>
//                                        [--chain solana|<evm chain id>] [--executed-bps 1] [--quoted-bps 1]
//   node scripts/receipt-devnet.mjs show <receipt address>
//   node scripts/receipt-devnet.mjs revoke <receipt address>   (attestor or authority; marks it inactive)
//
// The key that pays and signs is the Solana CLI wallet given by --keypair or
// ANCHOR_WALLET, default ~/.config/solana/tnega-receipt-deployer.json. In
// `init` it becomes both the authority and the attestor (fine on devnet).
//
// `issue` reads a Tnega order record (the JSON tnega_prepare_buy returns, or
// any JSON describing the purchase), adds the purchase transaction to it, and
// writes a receipt whose address is ["receipt", SHA-256 of that record].
// The record file with the tx added is saved next to the input as
// <name>.receipt.json, so anyone can recompute the hash.
//
// THE BUYER SIGNS FIRST (opt-in, architecture flow 2). The buyer's wallet signs
// the text receiptMessage(content_hash) below, on tnega.app/receipt/<hash>;
// `issue` takes that signature as --buyer-sig, checks it here, checks that
// the purchase on Solana mainnet succeeded and was paid by the buyer, then
// sends ONE devnet transaction: an Ed25519 program instruction verifying the
// buyer's signature, followed by issue_receipt. If the signature is wrong
// the whole transaction fails, so a receipt issued this way always carries
// the buyer's verified signature in its issuing transaction. Program version
// 2 also refuses to write a receipt unless that Ed25519 check comes right
// before issue_receipt and is by the buyer over this content hash.
//
// VERSION 2 adds, from the record: executed_at (record.execution.block_time)
// and up to 8 readings (record.readings: chain, token suffix, state, cost, price
// per share, size, time, block or slot, source), stored on the receipt.
//
// --receipt <file>: the published record as served at
// tnega.app/receipts/<content_hash>.json ({purchase, record}, canonical
// JSON); its own SHA-256 is the content hash, and it must re-serialise to
// exactly the same bytes.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection, Ed25519Program, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const PROGRAM_ID = new PublicKey(process.env.TNEGA_RECEIPT_PROGRAM || '6Nzn82QGVZTiU3iv26ZT9UKQFfyYyjyCoWqUZJ5LLrxP');
const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';
// chain_id stored for a Solana purchase. EVM purchases use their chain id.
export const SOLANA_CHAIN_ID = 0n;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };

const sha256 = (b) => createHash('sha256').update(b).digest();
const disc = (name) => sha256(Buffer.from(`global:${name}`)).subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(Number(n)); return b; };
const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };

export const MAX_READINGS = 8;
const READING_STATES = { filled: 0, too_thin: 1, no_route: 2, no_pool: 2, not_a_venue: 2 };

/** One record reading -> the program's Reading (50 bytes on chain). */
export function readingFromRecord(r) {
  const [chainPart, token] = String(r.key || '').split('/');
  if (!chainPart || !token) throw new Error(`a reading needs a key like 4663/0x... or solana/<mint>: ${JSON.stringify(r.key)}`);
  const solana = chainPart === 'solana';
  const tokenBytes = solana ? Buffer.from(bs58.decode(token)) : Buffer.from(token.replace(/^0x/, ''), 'hex');
  if (tokenBytes.length < 8) throw new Error(`a reading's token is too short: ${r.key}`);
  const state = READING_STATES[r.state];
  if (state === undefined) throw new Error(`unknown reading state ${r.state}`);
  const filled = state === 0;
  return {
    chainId: solana ? 0n : BigInt(chainPart),
    tokenSuffix: tokenBytes.subarray(tokenBytes.length - 8),
    state,
    costBps: filled ? Math.round(Number(r.cost_bps)) : 0,
    pricePerShareMicros: filled && r.allin_per_share_usd != null ? BigInt(Math.round(Number(r.allin_per_share_usd) * 1e6)) : 0n,
    sizeUsd: Number(r.size_usd),
    asOf: BigInt(Math.floor(Date.parse(r.as_of) / 1000)),
    block: BigInt(r.block ?? r.slot ?? 0),
    source: r.block != null ? 0 : 1,
  };
}

const encodeReading = (r) => Buffer.concat([
  u64(r.chainId), Buffer.from(r.tokenSuffix), Buffer.from([r.state]), u32(r.costBps), u64(r.pricePerShareMicros),
  u32(r.sizeUsd), i64(r.asOf), u64(r.block), Buffer.from([r.source]),
]);

export const configPda = () => PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0];
export const receiptPda = (contentHash) => PublicKey.findProgramAddressSync([Buffer.from('receipt'), contentHash], PROGRAM_ID)[0];

export function initializeIx(authority, attestor) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc('initialize'), attestor.toBuffer()]),
  });
}

export const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');

export function issueIx(attestor, f) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: attestor, isSigner: true, isWritable: true },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: receiptPda(f.contentHash), isSigner: false, isWritable: true },
      { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      disc('issue_receipt'), f.contentHash, u64(f.chainId), f.txHash, f.buyer,
      u32(f.quotedBps), u32(f.executedBps), u64(f.notionalCents),
      i64(f.executedAt), u32(f.readings.length), ...f.readings.map(encodeReading),
    ]),
  });
}

export function revokeIx(revoker, receipt) {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: revoker, isSigner: true, isWritable: false },
      { pubkey: configPda(), isSigner: false, isWritable: false },
      { pubkey: receipt, isSigner: false, isWritable: true },
    ],
    data: disc('revoke_receipt'),
  });
}

/** The exact text the buyer's wallet signs: UTF-8, no trailing newline. */
export const receiptMessage = (hashHex) => `Tnega Receipt v1\ncontent_hash: ${hashHex}`;

const MAINNET_RPC = process.env.SOLANA_MAINNET_RPC || 'https://solana-rpc.publicnode.com';

/** The attestor's check of a Solana purchase: it succeeded, and the buyer paid its fee. */
async function checkSolanaPurchase(signature, buyer) {
  const main = new Connection(MAINNET_RPC, 'confirmed');
  const t = await main.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: 'finalized' });
  if (!t) throw new Error(`purchase ${signature} was not found as finalized on Solana mainnet`);
  if (t.meta?.err) throw new Error(`purchase ${signature} failed on chain: ${JSON.stringify(t.meta.err)}`);
  const payer = t.transaction.message.staticAccountKeys[0].toBase58();
  if (payer !== buyer) throw new Error(`purchase ${signature} was paid by ${payer}, not the buyer ${buyer}`);
  return { slot: t.slot, blockTime: t.blockTime };
}

/** 32-byte buyer: a Solana address as is, an EVM address left-padded. */
export function buyerBytes(addr) {
  if (/^0x[0-9a-fA-F]{40}$/.test(addr)) return Buffer.concat([Buffer.alloc(12), Buffer.from(addr.slice(2), 'hex')]);
  return new PublicKey(addr).toBuffer();
}

/** 32-byte tx: an EVM 0x hash as is; a Solana signature (base58, 64 bytes) hashed with SHA-256. */
export function txBytes(tx) {
  if (/^0x[0-9a-fA-F]{64}$/.test(tx)) return Buffer.from(tx.slice(2), 'hex');
  const ALPH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of tx) { const v = ALPH.indexOf(ch); if (v < 0) throw new Error('the tx is neither a 0x hash nor a base58 signature'); n = n * 58n + BigInt(v); }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of tx) { if (ch === '1') bytes.unshift(0); else break; }
  if (bytes.length !== 64) throw new Error(`a Solana signature is 64 bytes; this one is ${bytes.length}`);
  return sha256(Buffer.from(bytes));
}

/** Canonical JSON: keys sorted, no spaces, so the hash does not depend on formatting. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** The receipt's fields from a Tnega order record (tnega_prepare_buy's answer or its `value`). */
export function fieldsFromRecord(rec, tx, chainOpt, quotedOpt, executedOpt) {
  const v = rec.value || rec;
  const order = v.order || {};
  const wallet = order.wallet || v.wallet;
  if (!wallet) throw new Error('the record has no order.wallet');
  const usd = Number(order.amount_unit === 'usd' || order.side === 'buy' ? order.amount : v.usd_amount);
  if (!(usd > 0)) throw new Error('the record has no dollar amount (order.amount)');
  const chain = chainOpt || (order.chain === 'solana' || v.chain === 'solana' ? 'solana' : String(v.chosen?.chain_id ?? ''));
  const chainId = chain === 'solana' ? SOLANA_CHAIN_ID : BigInt(chain);
  const impact = v.measured?.price_impact_bps ?? v.quote?.price_impact_bps ?? v.tolerance?.cost_ex_gas_bps ?? 0;
  const quotedBps = quotedOpt != null ? Number(quotedOpt) : Math.round(Number(impact));
  const recordedExecuted = v.execution?.executed_cost_bps;
  const executedBps = executedOpt != null ? Number(executedOpt) : recordedExecuted != null ? Number(recordedExecuted) : quotedBps;
  const full = { record: rec, purchase: { chain, tx } };
  const text = canonical(full);
  const blockTime = Date.parse(v.execution?.block_time ?? '');
  const readings = (Array.isArray(v.readings) ? v.readings : []).map(readingFromRecord);
  if (readings.length > MAX_READINGS) throw new Error(`a receipt holds at most ${MAX_READINGS} readings; the record has ${readings.length}`);
  return {
    full, text,
    contentHash: sha256(Buffer.from(text)),
    chainId, txHash: txBytes(tx), buyer: buyerBytes(wallet),
    quotedBps, executedBps, notionalCents: Math.round(usd * 100),
    executedAt: Number.isFinite(blockTime) ? BigInt(Math.floor(blockTime / 1000)) : null,
    readings,
  };
}

/** The published receipt file ({purchase, record}, canonical JSON): its
 *  fields, after checking it re-serialises to exactly its own bytes. */
export function fieldsFromReceiptFile(text, executedOpt, quotedOpt) {
  const file = JSON.parse(text);
  if (!file.record || !file.purchase?.tx) throw new Error('the file is not a published receipt: it needs {record, purchase}');
  const f = fieldsFromRecord(file.record, file.purchase.tx, file.purchase.chain, quotedOpt, executedOpt);
  if (f.text !== text.replace(/\n$/, '')) throw new Error('the file is not in canonical form, so its hash would not be the content hash');
  return f;
}

export function decodeReceipt(data) {
  const b = Buffer.from(data);
  let o = 8;
  const take = (n) => { const x = b.subarray(o, o + n); o += n; return x; };
  const r = {
    content_hash: take(32).toString('hex'),
    chain_id: take(8).readBigUInt64LE().toString(),
    tx_hash: take(32).toString('hex'),
    buyer: take(32),
    quoted_cost_bps: take(4).readUInt32LE(),
    executed_cost_bps: take(4).readUInt32LE(),
    notional_usd: Number(take(8).readBigUInt64LE()) / 100,
    issued_at: new Date(Number(take(8).readBigInt64LE()) * 1000).toISOString(),
    issuer: new PublicKey(take(32)).toBase58(),
    active: take(1)[0] === 1,
  };
  take(1); // bump
  if (b.length > o) {
    // Version 2: version, executed_at, readings.
    r.version = take(1)[0];
    r.executed_at = new Date(Number(take(8).readBigInt64LE()) * 1000).toISOString();
    const n = take(4).readUInt32LE();
    r.readings = [];
    for (let i = 0; i < n; i += 1) {
      r.readings.push({
        chain_id: take(8).readBigUInt64LE().toString(),
        token_suffix: take(8).toString('hex'),
        state: ['filled', 'too_thin', 'no_route'][take(1)[0]] || 'unknown',
        cost_bps: take(4).readUInt32LE(),
        price_per_share_usd: Number(take(8).readBigUInt64LE()) / 1e6,
        size_usd: take(4).readUInt32LE(),
        as_of: new Date(Number(take(8).readBigInt64LE()) * 1000).toISOString(),
        block: take(8).readBigUInt64LE().toString(),
        source: ['pool at block', 'Jupiter quote'][take(1)[0]] || 'unknown',
      });
    }
  }
  r.buyer = r.buyer.subarray(0, 12).every((x) => x === 0) ? `0x${r.buyer.subarray(12).toString('hex')}` : new PublicKey(r.buyer).toBase58();
  return r;
}

const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

function loadKeypair() {
  const p = opt('keypair', process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/tnega-receipt-deployer.json'));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p.replace(/^~/, os.homedir()), 'utf8'))));
}

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  if (cmd === 'status') {
    const prog = await conn.getAccountInfo(PROGRAM_ID);
    const cfg = await conn.getAccountInfo(configPda());
    console.log('program ', PROGRAM_ID.toBase58(), prog ? (prog.executable ? 'deployed' : 'not executable') : 'NOT DEPLOYED', explorer('address', PROGRAM_ID.toBase58()));
    if (cfg) {
      const d = Buffer.from(cfg.data);
      console.log('config  ', configPda().toBase58(), 'authority', new PublicKey(d.subarray(8, 40)).toBase58(), 'attestor', new PublicKey(d.subarray(40, 72)).toBase58(), 'paused', d[72] === 1);
    } else console.log('config   not initialised (run: init)');
    return;
  }
  if (cmd === 'show') {
    const a = new PublicKey(args[1]);
    const info = await conn.getAccountInfo(a);
    if (!info) throw new Error('no such account on devnet');
    console.log(JSON.stringify({ address: a.toBase58(), ...decodeReceipt(info.data), explorer: explorer('address', a.toBase58()) }, null, 2));
    return;
  }
  if (cmd !== 'init' && cmd !== 'issue' && cmd !== 'revoke') { console.log('usage: status | init | issue --record order.json --tx <signature> --buyer-sig <base58> | show <receipt address> | revoke <receipt address>'); return; }
  const kp = loadKeypair();
  if (cmd === 'init') {
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(initializeIx(kp.publicKey, kp.publicKey)), [kp]);
    console.log('initialised; authority and attestor', kp.publicKey.toBase58());
    console.log(explorer('tx', sig));
    return;
  }
  if (cmd === 'revoke') {
    const a = new PublicKey(args[1]);
    const info = await conn.getAccountInfo(a);
    if (!info) throw new Error('no such receipt on devnet');
    const before = decodeReceipt(info.data);
    if (!before.active) { console.log('receipt   ', a.toBase58(), 'is already revoked'); return; }
    const sig = await sendAndConfirmTransaction(conn, new Transaction().add(revokeIx(kp.publicKey, a)), [kp]);
    const after = decodeReceipt((await conn.getAccountInfo(a)).data);
    console.log('revoked   ', a.toBase58(), 'active =', after.active);
    console.log('revoked in', explorer('tx', sig));
    return;
  }
  if (cmd === 'issue') {
    const receiptPath = opt('receipt');
    const recPath = opt('record');
    let f;
    let rec;
    let out;
    let tx;
    if (receiptPath) {
      const text = readFileSync(receiptPath, 'utf8');
      f = fieldsFromReceiptFile(text, opt('executed-bps'), opt('quoted-bps'));
      rec = f.full.record;
      tx = f.full.purchase.tx;
      out = receiptPath;
    } else {
      tx = opt('tx');
      if (!recPath || !tx) throw new Error('issue needs --receipt <content_hash>.json, or --record <order.json> and --tx <purchase tx>');
      rec = JSON.parse(readFileSync(recPath, 'utf8'));
      f = fieldsFromRecord(rec, tx, opt('chain'), opt('quoted-bps'), opt('executed-bps'));
      out = recPath.replace(/\.json$/, '') + '.receipt.json';
      writeFileSync(out, f.text);
    }
    if (f.executedAt == null) throw new Error('the record has no execution.block_time: version 2 stores when the purchase happened');
    const hashHex = f.contentHash.toString('hex');
    const buyerSig = opt('buyer-sig');
    if (!buyerSig) {
      console.log('content   ', hashHex, `(SHA-256 of ${out})`);
      console.log('No --buyer-sig: the receipt is opt-in, so nothing is written. The buyer signs it at');
      console.log(`           https://www.tnega.app/receipt/${hashHex}`);
      return;
    }
    const v = rec.value || rec;
    const buyer = (v.order || {}).wallet || v.buyer;
    if (/^0x/.test(buyer)) throw new Error('an EVM buyer signs with secp256k1; this script handles a Solana buyer only');
    const sigBytes = Buffer.from(bs58.decode(buyerSig));
    if (sigBytes.length !== 64) throw new Error(`a buyer signature is 64 bytes; this one is ${sigBytes.length}`);
    const message = Buffer.from(receiptMessage(hashHex), 'utf8');
    const { ed25519 } = await import('@noble/curves/ed25519').catch(() => import('@noble/curves/ed25519.js'));
    if (!ed25519.verify(sigBytes, message, buyerBytes(buyer))) throw new Error(`the buyer signature does not verify for ${buyer} over the receipt message`);
    console.log('buyer sig  ok, by', buyer);
    if (f.full.purchase.chain === 'solana') {
      const p = await checkSolanaPurchase(tx, buyer);
      console.log('purchase   ok, finalized on Solana mainnet at slot', p.slot);
    } else {
      console.log('purchase   on chain', f.full.purchase.chain, 'is not checked by this script');
    }
    const ixs = new Transaction()
      .add(Ed25519Program.createInstructionWithPublicKey({ publicKey: buyerBytes(buyer), message, signature: sigBytes }))
      .add(issueIx(kp.publicKey, f));
    const sig = await sendAndConfirmTransaction(conn, ixs, [kp]);
    const addr = receiptPda(f.contentHash).toBase58();
    console.log('receipt   ', addr);
    console.log('content   ', hashHex, `(SHA-256 of ${out})`);
    console.log('account   ', explorer('address', addr));
    console.log('issued in ', explorer('tx', sig));
    console.log('card      ', `https://www.tnega.app/receipt/${hashHex}`);
    return;
  }
  console.log('usage: status | init | issue --record order.json --tx <signature> --buyer-sig <base58> | show <receipt address>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error('error:', e.message || e); process.exit(1); });
}
