// solana_selfcheck.mjs
//
// Headless checks for the Solana signing path (sign/solanaOrder.js,
// solanaQuote.js, solanaTx.js, solanaStatus.js, jupiter.js, base58.js and the
// shared sign/orderMath.js). Run before every build.
//
// EVERY FIXTURE HERE IS CONSTRUCTED. The mints, wallets, quotes, prices and
// transactions below are made up to exercise the rules: none is a measured
// figure, a real Jupiter answer or a real transaction, and nothing here says
// anything about a market. The sandbox that wrote this could not reach
// Jupiter or a wallet; see the report for what is therefore untested live.
//
// Run: node scripts/solana_selfcheck.mjs

import { createHash } from 'node:crypto';
import {
  PublicKey, Keypair, TransactionMessage, VersionedTransaction, SystemProgram, ComputeBudgetProgram, TransactionInstruction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import { base58Decode, isSolanaAddress, isSolanaSignature } from '../src/sign/base58.js';
import {
  rawAgreesSolana, USDC_MINT, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, isSolanaData, normaliseSolanaOrder, payloadMismatchSolana,
  rawAmountSolana, parseMint, mintsMismatch, effectiveMultiplier, solscanTx,
} from '../src/sign/solanaOrder.js';
import { quoteRequest, quoteUrl, swapBody, fetchJupiterQuote, fetchJupiterSwap, jupiterErrorText } from '../src/sign/jupiter.js';
import { checkJupiterQuote, quoteMismatchJup, unitsOf, rawText } from '../src/sign/solanaQuote.js';
import {
  inspectSwapTx, lookupTableAddresses, ataAddress, jupiterTail, JUPITER_PROGRAM, ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM, JUP_ROUTE, JUP_SHARED_ROUTE,
} from '../src/sign/solanaTx.js';
import { solanaErrorText, signatureOutcome } from '../src/sign/solanaStatus.js';
import { limitFor, orderCheck, referenceProblem, decimalKey } from '../src/sign/orderMath.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` - ${detail}` : ''}`); console.log(`  FAIL ${name} ${detail}`); }
}
const section = (s) => console.log(`\n${s}`);

// ---- constructed addresses (made up from fixed bytes) ----
const pk = (n) => new PublicKey(Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + n) % 256));
const STOCK = pk(11).toBase58();   // constructed xStock-like Token-2022 mint
const WALLET = pk(22).toBase58();  // constructed wallet
const OTHER = pk(33).toBase58();   // constructed other address
const NOW = Date.parse('2026-10-03T12:00:00Z');
const EXP = NOW + 600e3;

const sell = { side: 'sell', chain: 'solana', mint: STOCK, pay_mint: USDC_MINT, amount: '0.5', slippage_bps: 100, wallet: WALLET, expires_at: new Date(EXP).toISOString(), token: { symbol: 'SYMx', decimals: 8 } };
const buy = { ...sell, side: 'buy', amount: { usd: '25.00' } };

// ---------------------------------------------------------------- base58
section('base58');
check('USDC mint is a Solana address', isSolanaAddress(USDC_MINT));
check('System program (all ones) is a Solana address', isSolanaAddress('11111111111111111111111111111111'));
check('0x address is not', !isSolanaAddress('0x0000000000000000000000000000000000000001'));
const b58enc = (bytes) => { // test-only encoder, to build addresses of the wrong length
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let out = ''; while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = `1${out}`; else break; }
  return out;
};
check('31 and 33 bytes are not addresses, 32 is', !isSolanaAddress(b58enc(Uint8Array.from({ length: 31 }, (_, i) => i + 1))) && !isSolanaAddress(b58enc(Uint8Array.from({ length: 33 }, (_, i) => i + 1))) && isSolanaAddress(b58enc(Uint8Array.from({ length: 32 }, (_, i) => i + 1))));
check('"0", "O", "I", "l" are not base58', !isSolanaAddress(`0${USDC_MINT.slice(1)}`) && !isSolanaAddress(`O${USDC_MINT.slice(1)}`) && !isSolanaAddress(`l${USDC_MINT.slice(1)}`));
check('decode round-trips with web3.js', Buffer.from(base58Decode(WALLET)).equals(Buffer.from(new PublicKey(WALLET).toBytes())));
const sig64 = Keypair.generate().secretKey.slice(0, 64);
check('64-byte base58 is a signature, 32 is not', isSolanaSignature(b58enc(sig64)) && !isSolanaSignature(b58enc(sig64.slice(0, 32))) && !isSolanaSignature('x'));

// ------------------------------------------------------- order parsing
section('order parsing (constructed)');
const parse = (o, now = NOW) => normaliseSolanaOrder(o, now);
const ok = parse(sell);
check('a sell parses', !!ok.order && ok.order.side === 'sell' && ok.order.family === 'solana' && ok.order.slippageBps === 100 && ok.order.pay.symbol === 'USDC');
check('a buy with {usd} parses', parse(buy).order?.amount === '25.00');
check('wrapped in {order} parses', !!parse({ order: sell }).order);
check('isSolanaData sees chain "solana"', isSolanaData(sell) && !isSolanaData({ chain: 'Base', chain_id: 8453 }) && !isSolanaData({ chain_id: 8453 }));
check('unknown chain is refused', !!parse({ ...sell, chain: 'sui' }).error);
check('EVM chain id is refused here', !!parse({ ...sell, chain: 'base', chain_id: 8453 }).error);
check('bad base58 mint refused', !!parse({ ...sell, mint: `0${STOCK.slice(1)}` }).error);
check('EVM address as mint refused', !!parse({ ...sell, mint: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' }).error);
check('bad base58 wallet refused', !!parse({ ...sell, wallet: 'not-a-wallet' }).error);
check('pay_mint other than USDC refused', !!parse({ ...sell, pay_mint: OTHER }).error);
check('same token both sides refused', !!parse({ ...sell, mint: USDC_MINT }).error);
check('slippage 300 accepted, 301 refused', !!parse({ ...sell, slippage_bps: 300 }).order && !!parse({ ...sell, slippage_bps: 301 }).error);
check('slippage 0, negative, fractional, text refused', [0, -5, 50.5, 'x', null].every((m) => !!parse({ ...sell, slippage_bps: m }).error));
check('missing amount / zero / negative / text refused', ['', '0', '-1', '1e3', 'abc', '0.0'].every((a) => !!parse({ ...sell, amount: a }).error));
check('a buy given {tokens} is refused, a sell given {usd} is refused', !!parse({ ...buy, amount: { tokens: '1' } }).error && !!parse({ ...sell, amount: { usd: '1' } }).error);
check('expired link is flagged expired', parse(sell, EXP + 61e3).expired === true);
check('within the clock-skew allowance is not expired', !!parse(sell, EXP + 30e3).order);
check('no expiry refused', !!parse({ ...sell, expires_at: undefined }).error);
check('no side refused', !!parse({ ...sell, side: undefined }).error);
check('epoch seconds expiry accepted', parse({ ...sell, expires_at: Math.round(EXP / 1000) }).order?.expiresAt === Math.round(EXP / 1000) * 1000);

// An answer shaped like backend/core/te/prepare_solana.py order_view (read 2026-10-03), constructed values.
const backendShaped = { status: 'ok', side: 'sell', chain: 'solana', mint: STOCK, pay_mint: USDC_MINT, amount: '0.5', amount_unit: 'tokens', slippage_bps: 100, wallet: WALLET, expires_at: new Date(EXP).toISOString(), from_amount_raw: '50000000', pay_token: { role: 'receive', symbol: 'USDC', mint: USDC_MINT }, slippage: 0.01, seconds_left: 590, token: { key: `solana/${STOCK}`, mint: STOCK, address: STOCK, symbol: 'SYMx', ticker: 'SYM', issuer: 'Constructed Issuer', decimals: 8 } };
check('an answer shaped like the backend\'s parses', (() => { const r = parse(backendShaped); return !!r.order && r.order.token.decimals === 8 && r.order.serverRaw === '50000000' && r.order.token.issuer === 'Constructed Issuer' && r.order.key === `solana/${STOCK}`; })());

section('payload (link id) agreement');
const pl = { s: 's', c: 'solana', t: STOCK, p: USDC_MINT, a: '0.50', w: WALLET, m: 100, e: Math.round(EXP / 1000), b: 40 };
check('matching payload has no differences', payloadMismatchSolana(pl, ok.order).length === 0);
check('each field is checked', ['s', 'c', 't', 'p', 'a', 'w', 'm', 'e'].every((k) => payloadMismatchSolana({ ...pl, [k]: k === 'm' || k === 'e' ? 1 : k === 's' ? 'b' : k === 'a' ? '9' : 'zzz' }, ok.order).length === 1));
check('an EVM payload (numeric c) differs', payloadMismatchSolana({ ...pl, c: 8453 }, ok.order).includes('the chain'));
check('addresses are compared case-sensitively', payloadMismatchSolana({ ...pl, w: WALLET.toLowerCase() }, ok.order).includes('the wallet'));

section('amounts');
check('sell 0.5 of 8 decimals = 50000000', rawAmountSolana(ok.order, 8) === 50000000n);
check('buy $25.00 = 25000000 USDC units', rawAmountSolana(parse(buy).order, 8) === 25000000n);
check('more decimals than the token has is refused, not rounded', rawAmountSolana({ ...ok.order, amount: '0.123456789' }, 8) === null);
check('trailing zeros beyond decimals are fine', rawAmountSolana({ ...ok.order, amount: '0.500000000' }, 8) === 50000000n);
check('unknown decimals give null', rawAmountSolana(ok.order, null) === null);
check('server exact amount: absent or equal agrees, different disagrees, non-digits refused', rawAgreesSolana(ok.order, 50000000n) && rawAgreesSolana(parse({ ...sell, from_amount_raw: '50000000' }).order, 50000000n) && !rawAgreesSolana(parse({ ...sell, from_amount_raw: '5000000' }).order, 50000000n) && !!parse({ ...sell, from_amount_raw: '5e7' }).error);
check('decimalKey 10.50 = 10.5', decimalKey('10.50') === decimalKey('10.5'));

section('mints (constructed accounts)');
function mintData({ decimals = 8, ext = null }) {
  const d = new Uint8Array(ext ? 166 + ext.length : 82);
  d[44] = decimals; d[45] = 1;
  if (ext) { d[165] = 1; d.set(ext, 166); }
  return d;
}
const tlv = (type, body) => { const b = new Uint8Array(4 + body.length); new DataView(b.buffer).setUint16(0, type, true); new DataView(b.buffer).setUint16(2, body.length, true); b.set(body, 4); return b; };
const scaled = (m, nm = 0) => { const b = new Uint8Array(56); const dv = new DataView(b.buffer); dv.setFloat64(32, m, true); dv.setFloat64(48, nm, true); return tlv(25, b); };
const usdcMint = parseMint(TOKEN_PROGRAM, mintData({ decimals: 6 }));
const stock22 = parseMint(TOKEN_2022_PROGRAM, mintData({ decimals: 8, ext: tlv(18, new Uint8Array(64)) }));
check('Token-2022 mint with an extension parses', stock22.decimals === 8 && stock22.extensions.includes(18) && stock22.owner === TOKEN_2022_PROGRAM);
check('agreeing mints give no differences', mintsMismatch(ok.order, { token: stock22, pay: usdcMint }).length === 0);
check('decimals differing from the order are reported', mintsMismatch(ok.order, { token: parseMint(TOKEN_2022_PROGRAM, mintData({ decimals: 6 })), pay: usdcMint }).length === 1);
check('order without decimals is refused', mintsMismatch({ ...ok.order, token: { ...ok.order.token, decimals: null } }, { token: stock22, pay: usdcMint }).length === 1);
check('a non-token-program owner is an error', !!parseMint(OTHER, mintData({})).error);
check('uninitialised mint is an error', !!parseMint(TOKEN_PROGRAM, new Uint8Array(82)).error);
check('scaled UI multiplier 1 passes', mintsMismatch(ok.order, { token: parseMint(TOKEN_2022_PROGRAM, mintData({ decimals: 8, ext: scaled(1) })), pay: usdcMint }).length === 0);
check('scaled UI multiplier != 1 is refused on a sale', mintsMismatch(ok.order, { token: parseMint(TOKEN_2022_PROGRAM, mintData({ decimals: 8, ext: scaled(1.05) })), pay: usdcMint }).length === 1);
{
  const scaledMint = parseMint(TOKEN_2022_PROGRAM, mintData({ decimals: 8, ext: scaled(1.05) }));
  const buyOrder = { ...ok.order, side: 'buy' };
  check('scaled UI multiplier != 1 is accepted on a buy (quoted in raw units)', mintsMismatch(buyOrder, { token: scaledMint, pay: usdcMint }).length === 0);
  check('effective multiplier of a scaled mint is read', effectiveMultiplier(scaledMint.scaledUi, 0) === 1.05);
  check('effective multiplier is 1 without the extension', effectiveMultiplier(null) === 1);
  check('the new multiplier applies after its effective time', effectiveMultiplier({ multiplier: 1.05, newMultiplier: 1.1, effectiveAt: 100 }, 200) === 1.1);
  check('the current multiplier applies before the effective time', effectiveMultiplier({ multiplier: 1.05, newMultiplier: 1.1, effectiveAt: 300 }, 200) === 1.05);
  check('an unusable multiplier is refused on a buy', mintsMismatch(buyOrder, { token: { ...scaledMint, scaledUi: { multiplier: 0, newMultiplier: 0, effectiveAt: 0 } }, pay: usdcMint }).length === 1);
}
check('USDC owned by Token-2022 is refused', mintsMismatch(ok.order, { token: stock22, pay: parseMint(TOKEN_2022_PROGRAM, mintData({ decimals: 6 })) }).length === 1);

// ------------------------------------------------------ value check
section('shared rule (orderMath)');
check('limitFor: floor 2%, 3x cost, cap 5%', limitFor(10) === 0.02 && limitFor(100) === 0.03 && limitFor(500) === 0.05);
const vc = { limit: 0.02, price: 100, measuredAt: NOW - 60e3, basis: 'constructed', limitBasis: 'constructed' };
check('reference: fresh passes', referenceProblem({ vc, symbol: 'SYMx', now: NOW, venue: 'Jupiter' }) === null);
check('reference: old fails', /over 30 minutes/.test(referenceProblem({ vc: { ...vc, measuredAt: NOW - 31 * 60e3 }, symbol: 'SYMx', now: NOW, venue: 'Jupiter' })));
check('reference: future fails', /in the future/.test(referenceProblem({ vc: { ...vc, measuredAt: NOW + 6 * 60e3 }, symbol: 'SYMx', now: NOW, venue: 'Jupiter' })));
check('reference: reason fails and names the venue', /Jupiter/.test(referenceProblem({ vc: { reason: 'none sent' }, symbol: 'SYMx', now: NOW, venue: 'Jupiter' })));
check('reference words for LI.FI are unchanged by default', /LI\.FI/.test(referenceProblem({ vc: { reason: 'x' }, symbol: 'S', now: NOW })));

// ----------------------------------------------------------- quotes
section('Jupiter quote checks (constructed quotes, constructed prices)');
const rawIn = rawAmountSolana(ok.order, 8); // sell 0.5 tokens
const sellReq = quoteRequest({ inputMint: STOCK, outputMint: USDC_MINT, amount: rawIn, slippageBps: 100 });
const plan = (a, b) => [{ swapInfo: { label: 'ConstructedAMM', inputMint: a, outputMint: b }, percent: 100 }];
// 0.5 tokens at a constructed $100 = $50; USDC has 6 decimals
const sellQuote = (over = {}) => ({ inputMint: STOCK, inAmount: String(rawIn), outputMint: USDC_MINT, outAmount: '49900000', otherAmountThreshold: '49401000', swapMode: 'ExactIn', slippageBps: 100, platformFee: null, priceImpactPct: '0.001', routePlan: plan(STOCK, USDC_MINT), ...over });
const chk = (quote, extra = {}) => checkJupiterQuote({ quote, req: sellReq, side: 'sell', amount: 0.5, slippage: 0.01, vc, symbol: 'SYMx', tokenDecimals: 8, now: NOW, ...extra });
check('a sound sell quote passes', chk(sellQuote()).ok === true);
check('wrong output mint refused', !chk(sellQuote({ outputMint: OTHER })).ok);
check('wrong input mint refused', !chk(sellQuote({ inputMint: OTHER })).ok);
check('different amount in refused', !chk(sellQuote({ inAmount: String(rawIn + 1n) })).ok);
check('ExactOut refused', !chk(sellQuote({ swapMode: 'ExactOut' })).ok);
check('different slippage refused', !chk(sellQuote({ slippageBps: 300 })).ok);
check('platform fee refused', !chk(sellQuote({ platformFee: { amount: '5', feeBps: 10 } })).ok);
check('empty route refused', !chk(sellQuote({ routePlan: [] })).ok);
check('route that does not end at the output refused', !chk(sellQuote({ routePlan: plan(STOCK, OTHER) })).ok);
check('minimum above estimate refused', !chk(sellQuote({ otherAmountThreshold: '50000000' })).ok);
check('missing/garbage amounts refused', !chk(sellQuote({ outAmount: 'x' })).ok && !chk(sellQuote({ outAmount: undefined })).ok);
check('minimum further below estimate than slippage refused', (() => { const r = chk(sellQuote({ otherAmountThreshold: '47000000' })); return !r.ok && r.check.why.includes('min'); })());
check('loss over the limit at our price refused (minimum worth $47 of $50 > 2%... )', (() => { const r = chk(sellQuote({ outAmount: '48000000', otherAmountThreshold: '47520000' })); return !r.ok && r.check.why.includes('loss'); })());
check('more than 5% above refused (wrong decimals/price)', (() => { const r = chk(sellQuote({ outAmount: '60000000', otherAmountThreshold: '59400000' })); return !r.ok && r.check.why.includes('gain'); })());
check('a stale reference refuses the quote', /over 30 minutes/.test(chk(sellQuote(), { vc: { ...vc, measuredAt: NOW - 40 * 60e3 } }).why));
check('no reference refuses the quote', !chk(sellQuote(), { vc: { reason: 'none' } }).ok);
const buyReq = quoteRequest({ inputMint: USDC_MINT, outputMint: STOCK, amount: 25000000n, slippageBps: 100 });
const buyQuote = (over = {}) => ({ inputMint: USDC_MINT, inAmount: '25000000', outputMint: STOCK, outAmount: '24900000', otherAmountThreshold: '24651000', swapMode: 'ExactIn', slippageBps: 100, routePlan: plan(USDC_MINT, STOCK), ...over });
// $25 at constructed $100 = 0.25 tokens = 25,000,000 units of 8 decimals; 24,900,000 is 0.249
const bchk = (q) => checkJupiterQuote({ quote: q, req: buyReq, side: 'buy', amount: 25, slippage: 0.01, vc, symbol: 'SYMx', tokenDecimals: 8, now: NOW });
check('a sound buy quote passes', bchk(buyQuote()).ok === true);
check('a buy giving far fewer tokens is refused', !bchk(buyQuote({ outAmount: '20000000', otherAmountThreshold: '19800000' })).ok);
check('unitsOf / rawText', unitsOf('49900000', 6) === 49.9 && rawText('49900000', 6) === '49.9' && rawText('50000000', 6) === '50');
check('quoteMismatchJup of a sound quote is empty', quoteMismatchJup(sellQuote(), sellReq).length === 0);

section('Jupiter requests (a fake fetch, constructed answers)');
check('quote URL carries the exact request', (() => { const u = new URL(quoteUrl('https://lite-api.jup.ag', sellReq)); return u.pathname === '/swap/v1/quote' && u.searchParams.get('inputMint') === STOCK && u.searchParams.get('amount') === String(rawIn) && u.searchParams.get('slippageBps') === '100' && u.searchParams.get('swapMode') === 'ExactIn'; })());
check('swap body is the quote, for the wallet, no wrapping', (() => { const b = swapBody({ a: 1 }, WALLET); return b.userPublicKey === WALLET && b.wrapAndUnwrapSol === false && b.quoteResponse.a === 1; })());
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
let calls = [];
const fake = (plan2) => async (url, init) => { calls.push({ url, init }); const f = plan2.shift(); return typeof f === 'function' ? f() : f; };
calls = [];
let r1 = await fetchJupiterQuote(sellReq, { fetchImpl: fake([res(200, sellQuote())]), bases: ['https://lite-api.jup.ag', 'https://api.jup.ag'], gapMs: 1 });
check('quote: success from the first base, no key header', r1.quote?.outAmount === '49900000' && r1.base === 'https://lite-api.jup.ag' && !JSON.stringify(calls[0].init.headers).toLowerCase().includes('x-api-key'));
r1 = await fetchJupiterQuote(sellReq, { fetchImpl: fake([res(503, {}), res(200, sellQuote())]), bases: ['https://lite-api.jup.ag', 'https://api.jup.ag'], gapMs: 1 });
check('quote: falls to the second base when the first is down', r1.base === 'https://api.jup.ag');
r1 = await fetchJupiterQuote(sellReq, { fetchImpl: fake([res(429, {}), res(200, sellQuote())]), bases: ['https://lite-api.jup.ag'], gapMs: 1 });
check('quote: one retry after 429', !!r1.quote);
r1 = await fetchJupiterQuote(sellReq, { fetchImpl: fake([res(400, { error: 'Could not find any route' })]), bases: ['https://lite-api.jup.ag', 'https://api.jup.ag'], gapMs: 1 });
check('quote: 400 stops and says no route', /no route/.test(r1.error));
r1 = await fetchJupiterQuote(sellReq, { fetchImpl: async () => { throw new Error('boom'); }, bases: ['https://lite-api.jup.ag'], gapMs: 1 });
check('quote: network error is an error, not a throw', /boom/.test(r1.error));
const sw = await fetchJupiterSwap(sellQuote(), WALLET, { fetchImpl: fake([res(200, { swapTransaction: 'AAAA', lastValidBlockHeight: 123 })]), base: 'https://lite-api.jup.ag', gapMs: 1 });
check('swap: returns tx and last valid block height', sw.swap?.tx === 'AAAA' && sw.swap.lastValidBlockHeight === 123);
check('swap: missing transaction is an error', !!(await fetchJupiterSwap(sellQuote(), WALLET, { fetchImpl: fake([res(200, {})]), base: 'https://lite-api.jup.ag', gapMs: 1 })).error);
check('error words', /busy/.test(jupiterErrorText({ status: 429 }, 'quote')));

// ------------------------------------------------- transaction reading
section('swap transaction reading (constructed transactions)');
const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
check('Jupiter discriminators equal sha256("global:...")', Buffer.from(disc('route')).toString('hex') === JUP_ROUTE && Buffer.from(disc('shared_accounts_route')).toString('hex') === JUP_SHARED_ROUTE);
const mints = { token: stock22, pay: usdcMint };
const walletKey = new PublicKey(WALLET);
const stockAta = ataAddress(WALLET, STOCK, TOKEN_2022_PROGRAM);
const usdcAta = ataAddress(WALLET, USDC_MINT, TOKEN_PROGRAM);
check('ATA derivation differs by token program', stockAta !== ataAddress(WALLET, STOCK, TOKEN_PROGRAM));
function jupData({ inAmount = rawIn, quotedOut = 49900000n, slippage = 100, fee = 0, name = 'shared_accounts_route' } = {}) {
  const body = new Uint8Array(40 + 19);
  const dv = new DataView(body.buffer);
  dv.setBigUint64(40, BigInt(inAmount), true); dv.setBigUint64(48, BigInt(quotedOut), true); dv.setUint16(56, slippage, true); dv.setUint8(58, fee);
  return Buffer.concat([disc(name), Buffer.from(body)]);
}
const jupIx = (accts, data) => new TransactionInstruction({ programId: new PublicKey(JUPITER_PROGRAM), keys: accts.map((a, i) => ({ pubkey: new PublicKey(a), isSigner: a === WALLET, isWritable: i % 2 === 0 })), data });
const ataIx = (payer = WALLET, owner = WALLET, ata = stockAta, mint = STOCK, prog = TOKEN_2022_PROGRAM) => new TransactionInstruction({
  programId: new PublicKey(ATA_PROGRAM),
  keys: [payer, ata, owner, mint, '11111111111111111111111111111111', prog].map((a, i) => ({ pubkey: new PublicKey(a), isSigner: i === 0, isWritable: i < 2 })),
  data: Buffer.from([1]),
});
function build(ixs, payer = WALLET) {
  const msg = new TransactionMessage({ payerKey: new PublicKey(payer), recentBlockhash: new PublicKey(pk(99)).toBase58(), instructions: ixs }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}
const good = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
  ataIx(),
  jupIx([TOKEN_PROGRAM, OTHER, WALLET, stockAta, OTHER, OTHER, usdcAta, STOCK, USDC_MINT], jupData()),
];
const inspect = (ixs, over = {}) => inspectSwapTx({ txBase64: build(ixs, over.payer), order: ok.order, quote: sellQuote(), req: sellReq, mints });
const g = inspect(good());
check('a sound swap transaction passes', g.ok === true, JSON.stringify(g.why));
check('...and reports the account it creates (Token-2022)', g.ok && g.facts.createdAtas.length === 1 && g.facts.createdAtas[0].tokenProgram === TOKEN_2022_PROGRAM);
check('...and its priority fee', g.ok && g.facts.priorityLamports === 300);
check('jupiterTail reads the last 19 bytes', (() => { const t = jupiterTail(jupData()); return t.inAmount === rawIn && t.quotedOut === 49900000n && t.slippageBps === 100 && t.platformFeeBps === 0; })());
const refuses = (name, ixs, over, re) => { const r = inspect(ixs, over); check(`refused: ${name}`, !r.ok && (!re || r.why.some((w) => re.test(w))), JSON.stringify(r.why)); };
refuses('fee payer is not the wallet', good(), { payer: OTHER }, /fee payer|signatures/);
refuses('an unknown program', [...good(), new TransactionInstruction({ programId: new PublicKey(OTHER), keys: [], data: Buffer.alloc(0) })], {}, /program this page does not accept/);
refuses('a System transfer of SOL', [...good(), SystemProgram.transfer({ fromPubkey: walletKey, toPubkey: new PublicKey(OTHER), lamports: 1_000_000_000 })], {}, /System Program/);
refuses('a token Transfer at top level', [...good(), new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), keys: [{ pubkey: new PublicKey(usdcAta), isSigner: false, isWritable: true }, { pubkey: new PublicKey(OTHER), isSigner: false, isWritable: true }, { pubkey: walletKey, isSigner: true, isWritable: false }], data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]) })], {}, /token-program call/);
refuses('a token SetAuthority', [...good(), new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), keys: [{ pubkey: new PublicKey(usdcAta), isSigner: false, isWritable: true }, { pubkey: walletKey, isSigner: true, isWritable: false }], data: Buffer.from([6, 2, 0]) })], {}, /token-program call/);
refuses('closing a token account to another address', [...good(), new TransactionInstruction({ programId: new PublicKey(TOKEN_PROGRAM), keys: [{ pubkey: new PublicKey(usdcAta), isSigner: false, isWritable: true }, { pubkey: new PublicKey(OTHER), isSigner: false, isWritable: true }, { pubkey: walletKey, isSigner: true, isWritable: false }], data: Buffer.from([9]) })], {}, /closes a token account/);
refuses('creating an account for another owner', [ataIx(WALLET, OTHER, ataAddress(OTHER, STOCK, TOKEN_2022_PROGRAM)), ...good().slice(3)], {}, /another address/);
refuses('creating an account at a non-associated address', [ataIx(WALLET, WALLET, OTHER), ...good().slice(3)], {}, /not the wallet's associated/);
refuses('a compute-budget call that is not limit/price', [new TransactionInstruction({ programId: new PublicKey(COMPUTE_BUDGET_PROGRAM), keys: [], data: Buffer.from([1, 0, 0, 0, 0]) }), ...good().slice(2)], {}, /compute-budget/);
refuses('an enormous priority fee', [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 }), ...good().slice(2)], {}, /priority fee/);
refuses('Jupiter spends more than the order', [...good().slice(0, 3), jupIx([TOKEN_PROGRAM, OTHER, WALLET, stockAta, usdcAta], jupData({ inAmount: rawIn * 2n }))], {}, /spends/);
refuses('Jupiter slippage differs', [...good().slice(0, 3), jupIx([TOKEN_PROGRAM, OTHER, WALLET, stockAta, usdcAta], jupData({ slippage: 300 }))], {}, /slippage/);
refuses('Jupiter quoted out differs from the quote', [...good().slice(0, 3), jupIx([TOKEN_PROGRAM, OTHER, WALLET, stockAta, usdcAta], jupData({ quotedOut: 1n }))], {}, /quoted amount out/);
refuses('Jupiter takes a platform fee', [...good().slice(0, 3), jupIx([TOKEN_PROGRAM, OTHER, WALLET, stockAta, usdcAta], jupData({ fee: 50 }))], {}, /platform fee/);
refuses('Jupiter does not use the wallet\'s USDC account (pays out elsewhere)', [...good().slice(0, 3), jupIx([TOKEN_PROGRAM, OTHER, WALLET, stockAta, OTHER], jupData())], {}, /USDC account/);
refuses('Jupiter does not use the wallet\'s stock account', [...good().slice(0, 3), jupIx([TOKEN_PROGRAM, OTHER, WALLET, OTHER, usdcAta], jupData())], {}, /account \(/);
refuses('not a route instruction', [...good().slice(0, 3), jupIx([TOKEN_PROGRAM, WALLET, stockAta, usdcAta], Buffer.concat([disc('exact_out_route'), Buffer.alloc(59)]))], {}, /not a route/);
refuses('no Jupiter instruction', good().slice(0, 3), {}, /0 Jupiter/);
refuses('two Jupiter instructions', [...good(), good()[3]], {}, /2 Jupiter/);
check('garbage is refused, not thrown', inspectSwapTx({ txBase64: 'AAAA', order: ok.order, quote: sellQuote(), req: sellReq, mints }).ok === false);

section('swap transaction reading, accounts named through an address lookup table');
// Jupiter's v0 transactions name the mint, the token programs and most route
// accounts through a lookup table. Until 2026-10-11 the page read only the
// message's own keys, so a real first buy of a Token-2022 xStock was refused
// ("instruction 2 creates a token account that is not the wallet's
// associated account"): the mint and Token-2022 sat in the table.
const ALT_KEY = new PublicKey(pk(77));
const altOf = (addresses, key = ALT_KEY) => new AddressLookupTableAccount({ key, state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: addresses.map((a) => new PublicKey(a)) } });
const tableAddrs = [STOCK, USDC_MINT, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, stockAta, usdcAta, OTHER, '11111111111111111111111111111111'];
const altGood = altOf(tableAddrs);
function buildAlt(ixs, tables) {
  const msg = new TransactionMessage({ payerKey: walletKey, recentBlockhash: new PublicKey(pk(99)).toBase58(), instructions: ixs }).compileToV0Message(tables);
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}
const altTx = buildAlt(good(), [altGood]);
check('the constructed transaction really uses the table', lookupTableAddresses(altTx).length === 1 && lookupTableAddresses(altTx)[0] === ALT_KEY.toBase58());
const inspectAlt = (tx, tables) => inspectSwapTx({ txBase64: tx, order: ok.order, quote: sellQuote(), req: sellReq, mints, lookupTables: tables });
{
  const r = inspectAlt(altTx, [altGood]);
  check('a sound swap naming accounts through a table passes', r.ok === true, JSON.stringify(r.why));
  check('...and still reports the Token-2022 account it creates', r.ok && r.facts.createdAtas.length === 1 && r.facts.createdAtas[0].mint === STOCK && r.facts.createdAtas[0].tokenProgram === TOKEN_2022_PROGRAM);
}
{
  const r = inspectAlt(altTx, []);
  check('refused: the table was not read', !r.ok && r.why.some((w) => /address table/.test(w)), JSON.stringify(r.why));
}
{
  const r = inspectAlt(altTx, [altOf(tableAddrs, new PublicKey(pk(78)))]);
  check('refused: a table at another address is not used', !r.ok && r.why.some((w) => /address table/.test(w)), JSON.stringify(r.why));
}
{
  // The same transaction read against a table holding a different mint at the
  // mint's index: the account it creates is then not the wallet's stock account.
  const swapped = [...tableAddrs]; swapped[0] = OTHER;
  const r = inspectAlt(altTx, [altOf(swapped)]);
  check('refused: what the table holds is what is checked', !r.ok, JSON.stringify(r.why));
}
{
  const r = inspectAlt(altTx, [altOf(tableAddrs.slice(0, 2))]);
  check('refused: an index the table does not hold', !r.ok && r.why.some((w) => /does not hold|address table/.test(w)), JSON.stringify(r.why));
}
{
  // A real Jupiter transaction (lite-api.jup.ag, 11 Oct 2026): $4 of USDC to
  // AAPLx for KN9H7Z...zkqG, one table, the mint and Token-2022 read from it.
  // The table is rebuilt from its on-chain entries at the indexes this
  // transaction uses (placeholders elsewhere; only those indexes are read).
  const REAL_TX = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAQAFCgS0XFfCVH+Fs6dKBTYxIezrU/UoagbdHeQGo66gXEnDG9l/FxgHXpyPFbSIs0DMf7MSfHQVwajFNTKIfxHFPGwudrUC7CNcg0bA9GElTjAJcesRcJRDRLohTem1UPjVTeJ1HZhFL8uRKa6JXEtgr1sYr/A0dlrLCeCg7Yx6xJGk5Ctrgj7XbaPPRcgSwWeVcjXoBiY/sZvxHtyru1WzDycAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMGRm/lIRcy/+ytunLDm+e8jOW7xfcSayxDmzpAAAAABHnVW/IxwG7udMVuzmgVB/2xst6j9I5RArHNola8E4+MlyWPTiSJ8bs9ECkUjg2DC1oTmdr/EIQEjnvY2+n4WbQ/+if11/ZKdMCbHylYed5LCas238ndUUsyGqezjOXosP+FJdfjPcBxko4Gm2figb2TMIpnpqKXxQviIAWfu8cDBgAFAq96AQAIBgABABMFEgEBBxwSAAMBBxMHCQcUABUOAwELDAoREhAWEw0EAg8HI+UXy5d6460qAQAAAChkAAEACT0AAAAAAMcVEgAAAAAAMgAAAad98Kpf9X01WG421wPgR1KfDd/2ZRTUOLHbkWiXTgblBpCZkZWUsgcLBwiSCpYc';
  const REAL_TABLE = 'CGpU7yBFzm5RHjdf5VELCvRKzYiWdp2cz4URxAdMXSmz';
  const entries = { 7: TOKEN_PROGRAM, 8: TOKEN_2022_PROGRAM, 10: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 11: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 28: USDC_MINT, 144: '2awJDHp8rrwx335V34xQswF1sqZuGbASu1CPt7by66fs', 145: '69u6oEwRayMozqCWF9Vny6qiYN5f18pZVUtboaDJkXuj', 146: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', 148: 'ApniVWuZbZoruTAJdyJcLBA4AVw4DKGdV5fHxo6qrAZT', 149: '8ubgr7huZE1Z7ji2U7JZBrfZuq4wKiM4TRCeXVcWcPFC', 150: 'DrdecJVzkaRsf1TQu1g7iFncaokikVTHqpzPjenjRySY', 153: '3zBLzabogNNQ4s2zcuioXncdbTPED4jPx1x2J3Jn8Ezt', 178: 'EsY5gY7EqTqsmCdCvRNjSDSdJDopBNzCH1qd84YRuUQ2' };
  const realTable = altOf(Array.from({ length: 244 }, (_, i) => entries[i] || '11111111111111111111111111111111'), new PublicKey(REAL_TABLE));
  const realWallet = 'KN9H7Zc9nmcCjcz8MeURTmXKfMRyDYhfkHXTyoKzkqG';
  const AAPLX = 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp';
  const realOrder = { ...ok.order, side: 'buy', wallet: realWallet, token: { ...ok.order.token, address: AAPLX, symbol: 'AAPLx' }, pay: { ...ok.order.pay, address: USDC_MINT } };
  const realMints = { token: { ...stock22, owner: TOKEN_2022_PROGRAM }, pay: usdcMint };
  const msg = VersionedTransaction.deserialize(Buffer.from(REAL_TX, 'base64')).message;
  const jupData0 = msg.compiledInstructions.find((ix) => msg.staticAccountKeys[ix.programIdIndex].toBase58() === JUPITER_PROGRAM).data;
  const tail = jupiterTail(jupData0);
  const realReq = { amount: '4000000', slippageBps: 50 };
  const realQuote = { outAmount: String(tail.quotedOut) };
  const before = inspectSwapTx({ txBase64: REAL_TX, order: realOrder, quote: realQuote, req: realReq, mints: realMints });
  check('the real transaction, without its table, is refused and says why', !before.ok && before.why.some((w) => /address table/.test(w)), JSON.stringify(before.why));
  const r = inspectSwapTx({ txBase64: REAL_TX, order: realOrder, quote: realQuote, req: realReq, mints: realMints, lookupTables: [realTable] });
  check('the real AAPLx buy, read through its table, passes', r.ok === true, JSON.stringify(r.why));
  check('...creating the wallet\'s AAPLx account under Token-2022', r.ok && r.facts.createdAtas.length === 1 && r.facts.createdAtas[0].mint === AAPLX && r.facts.createdAtas[0].tokenProgram === TOKEN_2022_PROGRAM && r.facts.createdAtas[0].ata === ataAddress(realWallet, AAPLX, TOKEN_2022_PROGRAM));
  const wrongAmount = inspectSwapTx({ txBase64: REAL_TX, order: realOrder, quote: realQuote, req: { ...realReq, amount: '3000000' }, mints: realMints, lookupTables: [realTable] });
  check('...and is still refused when it spends more than the order', !wrongAmount.ok && wrongAmount.why.some((w) => /spends/.test(w)));
}

section('error and status words');
check('user rejection', /declined/.test(solanaErrorText(Object.assign(new Error('User rejected the request.'), { name: 'WalletSignTransactionError' }))));
check('rejection nested in cause', /declined/.test(solanaErrorText(Object.assign(new Error('wrapped'), { cause: { code: 4001, message: 'x' } }))));
check('blockhash expiry', /expired/.test(solanaErrorText(new Error('block height exceeded'))) && /expired/.test(solanaErrorText(new Error('Blockhash not found'))));
check('token shortfall (0x1)', /enough of the token/.test(solanaErrorText(Object.assign(new Error('failed'), { logs: ['Program log: Error: insufficient funds', 'custom program error: 0x1'] }))));
check('SOL shortfall', /SOL/.test(solanaErrorText(new Error('Attempt to debit an account but found no record of a prior credit.'))));
check('slippage exceeded (0x1771)', /slippage/.test(solanaErrorText(new Error('custom program error: 0x1771'))));
check('outcome: confirmed / failed / expired / pending', signatureOutcome({ confirmationStatus: 'confirmed' }, null, 10).state === 'confirmed' && signatureOutcome({ err: {} }, null, 10).state === 'failed' && signatureOutcome(null, 11, 10).state === 'expired' && signatureOutcome(null, 9, 10).state === 'pending');
check('solscan link', solscanTx('abc') === 'https://solscan.io/tx/abc');

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { console.error(failures.map((f) => `  - ${f}`).join('\n')); process.exit(1); }
