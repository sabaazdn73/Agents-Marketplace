// scripts/receipt_selfcheck.mjs
//
// The Tnega Receipt page's reading of the chain (src/receipt/receiptChain.js),
// checked against constructed bytes and the published AAPL receipt record.
// Runs with plain node: no network, no bundler.
//
//   node scripts/receipt_selfcheck.mjs

import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { Ed25519Program, Keypair } from '@solana/web3.js';
import {
  receiptMessage, base58Encode, bytesOfHex, hexOf, sameBytes, buyerBytes, txHashBytes, parseEd25519,
  decodeReceipt, readingFromRecord, sameReading, expectedFields, balanceChange, READING_BYTES, receiptPda,
} from '../src/receipt/receiptChain.js';
import { base58Decode } from '../src/sign/base58.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

let pass = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); } else { failures.push(`${name} ${detail}`); console.log(`  FAIL ${name} ${detail}`); }
};

const HASH = 'b029c6c2622bdcec5d2a3e9c49cf56608bbfac136198a21052b7aba8963a8a07';
const text = readFileSync(new URL(`../public/receipts/${HASH}.json`, import.meta.url), 'utf8');
const file = JSON.parse(text);

console.log('\nthe published record');
check('its SHA-256 is the name it is served under', createHash('sha256').update(text).digest('hex') === HASH);
check('it is {purchase, record}', !!file.purchase?.tx && !!file.record?.order);
const exp = expectedFields(file);
check('expected fields: Solana purchase, buyer, quoted 8 bps, paid 10 bps, $4.00',
  exp.chain === 'solana' && exp.buyer === 'KN9H7Zc9nmcCjcz8MeURTmXKfMRyDYhfkHXTyoKzkqG' && exp.quotedBps === 8 && exp.executedBps === 10 && exp.notionalCents === 400n,
  JSON.stringify({ ...exp, notionalCents: String(exp.notionalCents), readings: exp.readings.length }));
check('executed_at is the purchase block time', exp.executedAt === 1791715366);
check('seven readings, each converted', exp.readings.length === 7 && exp.readings.every(Boolean));
const coinbase = exp.readings.find((r) => r.chainId === 8453n);
check('a token suffix is the LAST 8 bytes (Coinbase tokens all start 0xb2000000)', hexOf(coinbase.tokenSuffix) === 'e324d24d7eecd1fb', hexOf(coinbase.tokenSuffix));
const solanaX = exp.readings[0];
check('a Solana reading: chain 0, Jupiter source, slot as block', solanaX.chainId === 0n && solanaX.source === 1 && solanaX.block === 455550225n);
check('a filled reading keeps its rounded cost and price in micro-dollars', solanaX.costBps === 9 && solanaX.pricePerShareMicros === 336667688n);
const thin = exp.readings[5];
check('a reading that did not fill carries no cost and no price', thin.state === 1 && thin.costBps === 0 && thin.pricePerShareMicros === 0n);
check('a reading with an unknown state is not converted', readingFromRecord({ ...file.record.readings[0], state: 'odd' }) === null);

console.log('\nkeys, signatures and the message');
check('the message the buyer signs', receiptMessage(HASH) === `Tnega Receipt v1\ncontent_hash: ${HASH}`);
const sig = webcrypto.getRandomValues(new Uint8Array(64));
check('base58 of a 64-byte signature decodes back', sameBytes(base58Decode(base58Encode(sig)), sig));
check('base58 keeps leading zero bytes', base58Encode(new Uint8Array([0, 0, 1])) === '112');
check('a Solana buyer is its 32 bytes', sameBytes(buyerBytes(exp.buyer), base58Decode(exp.buyer)));
check('an EVM buyer is left-padded with 12 zero bytes', (() => { const b = buyerBytes('0x' + 'ab'.repeat(20)); return b.length === 32 && b.slice(0, 12).every((x) => x === 0) && b[12] === 0xab; })());
const th = await txHashBytes(file.purchase.tx);
check('a Solana tx_hash is SHA-256 of the 64-byte signature', hexOf(th) === createHash('sha256').update(base58Decode(file.purchase.tx)).digest('hex'));

const buyer = Keypair.generate();
const msg = new TextEncoder().encode(receiptMessage(HASH));
const { ed25519 } = await import('@noble/curves/ed25519').catch(() => import('@noble/curves/ed25519.js'));
const s = ed25519.sign(msg, buyer.secretKey.slice(0, 32));
const ix = Ed25519Program.createInstructionWithPublicKey({ publicKey: buyer.publicKey.toBytes(), message: msg, signature: s });
const parsed = parseEd25519(new Uint8Array(ix.data));
check('the Ed25519 instruction web3.js writes is read back: one signature, all inside', parsed.length === 1 && parsed[0].self);
check('...with the buyer key and the message', sameBytes(parsed[0].publicKey, buyer.publicKey.toBytes()) && sameBytes(parsed[0].message, msg));
const elsewhere = new Uint8Array(ix.data);
elsewhere[4] = 0; elsewhere[5] = 0; // signature_instruction_index = 0, not "this instruction"
check('offsets into another instruction are not trusted', parseEd25519(elsewhere)[0].self === false);

console.log('\nthe receipt account');
// Build a version 2 account the way the program lays it out.
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };
const i64 = (n) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(n), true); return b; };
const cat = (...parts) => { const out = new Uint8Array(parts.reduce((s2, p) => s2 + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const encReading = (r) => cat(u64(r.chainId), r.tokenSuffix, Uint8Array.of(r.state), u32(r.costBps), u64(r.pricePerShareMicros), u32(r.sizeUsd), i64(r.asOf), u64(r.block), Uint8Array.of(r.source));
check('one reading is 50 bytes', encReading(exp.readings[0]).length === READING_BYTES);
const issuer = Keypair.generate().publicKey;
const account = cat(
  new Uint8Array(8), bytesOfHex(HASH), u64(0), th, buyerBytes(exp.buyer), u32(8), u32(10), u64(400), i64(1791716000),
  issuer.toBytes(), Uint8Array.of(1), Uint8Array.of(254),
  Uint8Array.of(2), i64(exp.executedAt), u32(exp.readings.length), ...exp.readings.map(encReading),
);
const r = decodeReceipt(account);
check('version 1 fields decode', sameBytes(r.contentHash, bytesOfHex(HASH)) && r.chainId === 0n && sameBytes(r.txHash, th) && r.quotedBps === 8 && r.executedBps === 10 && r.notionalCents === 400n && r.issuer === issuer.toBase58() && r.active);
check('version 2 fields decode', r.version === 2 && r.executedAt === exp.executedAt && r.readings.length === 7);
check('every reading decodes to what the record says', exp.readings.every((e, i) => sameReading(e, r.readings[i])));
const v1 = decodeReceipt(account.slice(0, 8 + 162));
check('a version 1 account decodes as version 1, with no readings', v1.version === 1 && v1.readings.length === 0 && v1.executedAt === null);
check('a short buffer is not a receipt', decodeReceipt(new Uint8Array(40)) === null);
check('the receipt address for this hash', receiptPda(bytesOfHex(HASH)).toBase58() === '8w9EaQ8adnD3u4P16zjApdq13AAB1ib4xX837vozGv7G');

console.log('\nthe purchase');
const meta = {
  preTokenBalances: [{ owner: exp.buyer, mint: 'USDC', uiTokenAmount: { amount: '4117632' } }],
  postTokenBalances: [{ owner: exp.buyer, mint: 'USDC', uiTokenAmount: { amount: '117632' } }, { owner: exp.buyer, mint: 'X', uiTokenAmount: { amount: '1186472' } }],
};
check('balance changes by owner and mint', balanceChange(meta, exp.buyer, 'USDC') === -4000000n && balanceChange(meta, exp.buyer, 'X') === 1186472n);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
