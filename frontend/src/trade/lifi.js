// trade/lifi.js
//
// LI.FI, called from the visitor's browser only, keyless (SPEC §0.1, C.1).
// Nothing here talks to Tnega's API: a quote, a route or a status never
// reaches our backend or MCP, and none of it is stored except the buy
// record in this browser's localStorage (tnega_buys_v1: the hash, the
// chains, the token and the time, no LI.FI figure).
//
// RULES THIS FILE ENFORCES
//   - every /quote carries denyExchanges=jupiter, and a route whose steps or
//     tools name Jupiter is refused anyway (jupiterIn);
//   - a quote is asked for only on the visitor's click, never on load;
//   - LI.FI's keyless limit is 75 quotes per 2 hours per IP. Its
//     ratelimit-* headers are not exposed to a browser, so this browser
//     counts its own quotes (tnega_lifi_q_v1, a 2 hour window) and waits
//     10 s between two; a 429 says the network's allowance is used up;
//   - the quote is checked against the request (chains, tokens, amount,
//     address) before anything is shown as a route;
//   - the value check (valueCheck) is ours: tokens out times our own
//     measured all-in price per token, against the dollars in.

import { decodeFunctionData, parseAbi } from 'viem';

export const LIFI = 'https://li.quest/v1';
export const SLIPPAGE = 0.005;

const QUOTA_KEY = 'tnega_lifi_q_v1';
const BUYS_KEY = 'tnega_buys_v1';
export const QUOTA_LIMIT = 75;
export const QUOTA_WINDOW_MS = 2 * 3600e3;
export const QUOTE_GAP_MS = 10e3;
export const QUOTE_MAX_AGE_MS = 60e3;

function readStore(key) {
  try { const v = JSON.parse(window.localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeStore(key, v) {
  try { window.localStorage.setItem(key, JSON.stringify(v)); } catch { /* blocked or full: nothing remembered */ }
}

/** This browser's own count of quotes in the last 2 hours. It cannot see
 *  quotes other people on the same network asked for. */
export function quotaState(now = Date.now()) {
  const times = readStore(QUOTA_KEY).filter((t) => typeof t === 'number' && now - t < QUOTA_WINDOW_MS);
  const last = times.length ? Math.max(...times) : 0;
  return {
    used: times.length,
    left: Math.max(0, QUOTA_LIMIT - times.length),
    waitMs: last ? Math.max(0, QUOTE_GAP_MS - (now - last)) : 0,
  };
}

function recordQuote(now = Date.now()) {
  const times = readStore(QUOTA_KEY).filter((t) => typeof t === 'number' && now - t < QUOTA_WINDOW_MS);
  times.push(now);
  writeStore(QUOTA_KEY, times);
}

// `slippage` is a fraction (0.005 is 0.5%). Left out, it is SLIPPAGE, which
// is what the Buy panel always asks for; a signing link carries its own.
export function quoteUrl({ fromChain, toChain, fromToken, toToken, fromAmount, fromAddress, slippage = SLIPPAGE }) {
  const q = new URLSearchParams({
    fromChain: String(fromChain), toChain: String(toChain),
    fromToken, toToken, fromAmount: String(fromAmount), fromAddress,
    slippage: String(slippage), order: 'CHEAPEST',
    // Always. SPEC §0.1: no Jupiter, on any chain.
    denyExchanges: 'jupiter',
  });
  return `${LIFI}/quote?${q.toString()}`;
}

/** One quote. Resolves to { quote, quotedAt } or { error, kind }.
 *  kind: 'local_limit' | 'wait' | 'rate' | 'no_route' | 'http' | 'network'. */
export async function fetchQuote(params) {
  const qs = quotaState();
  if (qs.left <= 0) return { kind: 'local_limit', error: `This browser has asked LI.FI for ${QUOTA_LIMIT} quotes in the last 2 hours, which is LI.FI's limit without a key. Try again later.` };
  if (qs.waitMs > 0) return { kind: 'wait', error: `Wait ${Math.ceil(qs.waitMs / 1000)} s before asking again (one quote every 10 s).` };
  recordQuote();
  let r;
  try {
    r = await fetch(quoteUrl(params), { headers: { accept: 'application/json' } });
  } catch (e) {
    return { kind: 'network', error: `Couldn't reach LI.FI: ${e?.message || 'network error'}.` };
  }
  if (r.status === 429) return { kind: 'rate', error: "LI.FI's limit for your network is used up; try again later. Without a key LI.FI allows 75 quotes per 2 hours per IP address, shared by everyone on your network." };
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  if (!r.ok) {
    const msg = body?.message || `HTTP ${r.status}`;
    return { kind: r.status === 404 ? 'no_route' : 'http', error: r.status === 404 ? `LI.FI found no route: ${msg}` : `LI.FI answered ${msg}`, status: r.status };
  }
  return { quote: body, quotedAt: new Date().toISOString() };
}

/** The tool names of a route, top level and every included step. */
export function routeTools(quote) {
  const out = [];
  const add = (s) => {
    if (!s || typeof s !== 'object') return;
    // LI.FI's own fee step is named "Integrator Fee" in toolDetails, which
    // reads as a fee to Tnega; Tnega takes none (integratorFee is 0).
    const name = s.tool === 'feeCollection' ? "LI.FI's fee step" : (s.toolDetails?.name || s.tool);
    if (name && !out.includes(name)) out.push(name);
  };
  add(quote);
  for (const s of quote?.includedSteps || []) add(s);
  return out;
}

/** Every place a route names Jupiter: a step's tool, its toolDetails key or
 *  name, at any depth. A non-empty answer refuses the route. */
export function jupiterIn(quote) {
  const hits = [];
  const walk = (x, path) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, `${path}[${i}]`)); return; }
    for (const k of ['tool', 'exchange', 'bridge']) if (typeof x[k] === 'string' && /jupiter/i.test(x[k])) hits.push(`${path}.${k}`);
    if (x.toolDetails && /jupiter/i.test(`${x.toolDetails.key || ''} ${x.toolDetails.name || ''}`)) hits.push(`${path}.toolDetails`);
    for (const [k, v] of Object.entries(x)) if (v && typeof v === 'object' && k !== 'toolDetails') walk(v, `${path}.${k}`);
  };
  walk(quote, 'quote');
  return hits;
}

const lc = (a) => String(a || '').toLowerCase();

// LI.FI's own contract (its "diamond") on each chain a quote may start on:
// the only address a quote may ask to be approved or called. From
// li.quest/v1/chains (diamondAddress), the same pins the server holds in
// backend/core/te/lifi_quote.py DIAMONDS. A chain missing here refuses
// every quote that starts on it.
export const LIFI_DIAMONDS = {
  1: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  8453: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  42161: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  56: '0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae',
  4663: '0xb477751b76cf82d00a686a1232f5fcd772414af3',
  999: '0x0a0758d937d1059c356d4714e57f5df0239bce1a',
};

const NATIVE = /^0x(0{40}|e{40})$/i;
const bigOr = (x) => {
  try { return x == null || x === '' ? 0n : BigInt(String(x)); } catch { return null; }
};

// LI.FI'S SWAP CALL, DECODED. The transaction a quote asks the wallet to
// sign is a call to LI.FI's contract; on a same-chain swap it is one of
// GenericSwapFacetV3's six functions. Their signatures, and LibSwap.SwapData,
// are copied from LI.FI's published contracts:
//   https://github.com/lifinance/contracts/blob/main/src/Facets/GenericSwapFacetV3.sol
//   https://github.com/lifinance/contracts/blob/main/src/Libraries/LibSwap.sol
// (read 2026-09-30). Selectors, worked out from these signatures by viem:
//   0x4666fc80 swapTokensSingleV3ERC20ToERC20   0x5fd9ae2e swapTokensMultipleV3ERC20ToERC20
//   0x733214a3 swapTokensSingleV3ERC20ToNative  0x2c57e884 swapTokensMultipleV3ERC20ToNative
//   0xaf7060fd swapTokensSingleV3NativeToERC20  0x736eac0b swapTokensMultipleV3NativeToERC20
// Every Base route quoted on 2026-09-30 (a buy and a sale of NVDAc) was
// 0x5fd9ae2e. Any other call is refused: this page cannot read what it
// would sign.
const SWAP_DATA = 'struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }';
const V3_HEAD = 'bytes32 _transactionId, string _integrator, string _referrer, address _receiver, uint256 _minAmountOut';
export const GENERIC_SWAP_V3_ABI = parseAbi([
  SWAP_DATA,
  ...['SingleV3ERC20ToERC20', 'SingleV3ERC20ToNative', 'SingleV3NativeToERC20'].map((n) => `function swapTokens${n}(${V3_HEAD}, SwapData _swapData)`),
  ...['MultipleV3ERC20ToERC20', 'MultipleV3ERC20ToNative', 'MultipleV3NativeToERC20'].map((n) => `function swapTokens${n}(${V3_HEAD}, SwapData[] _swapData)`),
]);

export const ROUTE_UNSUPPORTED = 'route type not supported here yet';

/** The swap call's receiver, minimum and swaps, or null when the data is
 *  not one of GenericSwapFacetV3's functions. */
export function decodeSwapCall(data) {
  try {
    const d = decodeFunctionData({ abi: GENERIC_SWAP_V3_ABI, data });
    const swaps = Array.isArray(d.args[5]) ? d.args[5] : [d.args[5]];
    return { fn: d.functionName, receiver: d.args[3], minAmountOut: d.args[4], swaps };
  } catch { return null; }
}

/** Does the quote answer the question asked? A mismatch refuses it.
 *  Besides the chains, tokens, amount and wallet, it checks where the value
 *  goes: the route delivers to the wallet (p.toAddress, or the wallet
 *  itself), every included step delivers to the wallet or to LI.FI's
 *  contract, the transaction sends no native coin when an ERC-20 is paid,
 *  and the contract called and the approval's spender are both LI.FI's
 *  pinned contract on the paying chain. */
export function quoteMismatch(quote, p, { side = 'buy' } = {}) {
  const a = quote?.action || {};
  const tr = quote?.transactionRequest || {};
  const e = quote?.estimate || {};
  const bad = [];
  const wallet = lc(p.toAddress || p.fromAddress);
  const diamond = LIFI_DIAMONDS[Number(p.fromChain)] || null;
  if (lc(a.toAddress) !== wallet) bad.push('the recipient');
  // A cross-chain route (the Buy panel's Arbitrum to Robinhood Chain) may
  // also deliver a step to LI.FI's contract on the receiving chain.
  const toDiamond = LIFI_DIAMONDS[Number(p.toChain)] || null;
  // Every included step, at any depth. A step names where its tokens go
  // (action.toAddress); one that names none is accepted only as LI.FI's
  // "protocol" step (its fee collection), which moves no tokens to anyone.
  // Any other step without a recipient, and any step type LI.FI does not
  // document (swap, cross, lifi, protocol), refuses the route; a missing type
  // is an unknown one. The quote itself is a step too: every real quote read
  // so far (Ethereum, Base, BNB Chain, Robinhood Chain, both sides) is a
  // "lifi" step holding one "protocol" (the fee) and one "swap" step. On one
  // chain a "cross" step (a bridge) has no place, at the top or below, so a
  // same-chain route that names one is refused.
  const sameChain = Number(p.fromChain) === Number(p.toChain);
  const KNOWN = new Set(sameChain ? ['swap', 'lifi', 'protocol'] : ['swap', 'cross', 'lifi', 'protocol']);
  const TOP = new Set(sameChain ? ['lifi', 'swap'] : ['lifi', 'cross', 'swap']);
  if (!quote || typeof quote !== 'object' || !TOP.has(quote.type)) bad.push('a route of a kind not known');
  const steps = [];
  let tooDeep = false;
  const walk = (list, depth) => {
    if (!Array.isArray(list)) return;
    for (const st of list) {
      steps.push(st);
      const inner = st?.includedSteps;
      if (Array.isArray(inner) && inner.length) {
        // Past eight levels the route is not read further, so it is refused
        // rather than passed unread.
        if (depth >= 8) tooDeep = true;
        else walk(inner, depth + 1);
      }
    }
  };
  walk(quote?.includedSteps, 0);
  if (tooDeep) bad.push('a route nested too deep');
  if (!steps.length) bad.push('a route with no steps');
  for (const st of steps) {
    if (!st || typeof st !== 'object' || !KNOWN.has(st.type)) { bad.push("a step of a kind not known"); break; }
    const to = lc(st.action?.toAddress);
    if (!to) {
      if (st.type !== 'protocol') { bad.push("a step with no recipient"); break; }
      continue;
    }
    if (to !== wallet && to !== diamond && to !== toDiamond) { bad.push("a step's recipient"); break; }
  }
  const value = bigOr(tr.value);
  if (value == null) bad.push("the transaction's value");
  else if (NATIVE.test(String(p.fromToken || ''))) {
    if (value !== bigOr(p.fromAmount)) bad.push("the transaction's value");
  } else if (value !== 0n) bad.push("the transaction's value");
  if (!diamond) bad.push('the chain (no LI.FI contract known for it)');
  else {
    if (lc(tr.to) !== diamond) bad.push('the contract called');
    if (lc(e.approvalAddress) !== diamond) bad.push("the approval's spender");
  }
  if (Number(a.fromChainId) !== Number(p.fromChain)) bad.push('the paying chain');
  if (Number(a.toChainId) !== Number(p.toChain)) bad.push("the stock's chain");
  const sell = side === 'sell';
  if (lc(a.fromToken?.address) !== lc(p.fromToken)) bad.push(sell ? 'the token sold' : 'the token paid');
  if (lc(a.toToken?.address) !== lc(p.toToken)) bad.push(sell ? 'the stablecoin received' : 'the token bought');
  if (String(a.fromAmount) !== String(p.fromAmount)) bad.push('the amount');
  if (lc(a.fromAddress) !== lc(p.fromAddress)) bad.push('the wallet');
  if (!tr.to || !tr.data) bad.push('the transaction');
  if (tr.from && lc(tr.from) !== lc(p.fromAddress)) bad.push("the transaction's sender");
  if (tr.chainId != null && Number(tr.chainId) !== Number(p.fromChain)) bad.push("the transaction's chain");

  // What the transaction itself says, decoded, against the quote: the
  // receiver is the wallet, the minimum is the quote's toAmountMin, the
  // first swap spends the token paid and the last delivers the token asked
  // for. A call this page cannot decode is refused.
  const call = tr.data ? decodeSwapCall(tr.data) : null;
  if (!call) bad.push(ROUTE_UNSUPPORTED);
  else {
    if (lc(call.receiver) !== wallet) bad.push("the transaction's receiver");
    if (String(call.minAmountOut) !== String(e.toAmountMin)) bad.push("the transaction's minimum");
    const first = call.swaps[0];
    const last = call.swaps[call.swaps.length - 1];
    if (!first || lc(first.sendingAssetId) !== lc(p.fromToken)) bad.push('the token the transaction spends');
    if (!last || lc(last.receivingAssetId) !== lc(p.toToken)) bad.push('the token the transaction delivers');
    // A step's own approvalAddress is a contract LI.FI's contract approves
    // from its own balance inside the transaction (its fee collector, a
    // DEX router), never the wallet's approval (that is estimate's, above).
    // It has to be LI.FI's contract or one of the approveTo addresses the
    // transaction actually carries, so a step cannot name a spender the
    // call does not use.
    const approveTo = new Set(call.swaps.map((x) => lc(x.approveTo)));
    for (const st of steps) {
      const sp = lc(st?.estimate?.approvalAddress);
      if (sp && sp !== diamond && !approveTo.has(sp)) { bad.push("a step's approval address"); break; }
    }
  }
  return bad;
}

export const units = (raw, decimals) => {
  try {
    const n = BigInt(String(raw));
    const d = 10n ** BigInt(decimals);
    return Number(n / d) + Number(n % d) / Number(d);
  } catch { return null; }
};

/** The price a quote is checked against: our own measured all-in price per
 *  token for THIS version at THIS size, and nothing else. A version that
 *  does not fill the size on our measurement has no price here, and so no
 *  Buy (stocks/StockPage.jsx offers Buy only where this is not null). */
export function referencePrice(v) {
  const num = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
  if (v?.state !== 'filled' || !num(v.allin_per_token)) return null;
  return {
    price: v.allin_per_token,
    costBps: num(v.cost_bps) ? v.cost_bps : 0,
    basis: `our measured all-in price per ${v.symbol} at this size${Number.isFinite(v.block) ? `, block ${v.block.toLocaleString('en-US')}` : ''}`,
  };
}

// The minimum may sit below the estimate by the slippage asked for, plus
// 0.1% for rounding; a wider gap means the route allows more than we asked.
export const MIN_GAP = SLIPPAGE + 0.001;
// A value more than 5% ABOVE what is paid is refused too: at a measured
// price that points to a wrong token, wrong decimals or a wrong price, not
// to a bargain.
export const MAX_GAIN = 0.05;

/** OUR value check (SPEC T4a; T0 route 14 would have paid $1,000 for 0.74
 *  NVDA). It prices the MINIMUM the route enforces (toAmountMin), not the
 *  estimate: value out = minimum tokens x our measured all-in price per
 *  token; value in = the size, the stablecoin taken at $1. Refused when:
 *    the minimum is below the estimate by more than the slippage + 0.1%;
 *    the loss on the minimum exceeds max(2%, 3 x our cost in bps);
 *    the value is more than 5% above what is paid. */
export function valueCheck({ tokens, minTokens, sizeUsd, ref }) {
  if (!ref || !(tokens > 0) || !(minTokens > 0) || !(sizeUsd > 0)) return null;
  const valueOut = minTokens * ref.price;
  const loss = 1 - valueOut / sizeUsd;
  const limit = Math.max(0.02, (3 * ref.costBps) / 10000);
  const minRatio = minTokens / tokens;
  const why = [];
  if (minRatio < 1 - MIN_GAP) why.push('min');
  if (loss > limit) why.push('loss');
  if (-loss > MAX_GAIN) why.push('gain');
  return { tokens, minTokens, minRatio, price: ref.price, valueOut, sizeUsd, loss, limit, ok: why.length === 0, why, basis: ref.basis };
}

/** The figures shown before signing, read off the quote as LI.FI sent it. */
export function quoteFacts(quote) {
  const e = quote?.estimate || {};
  const to = quote?.action?.toToken || {};
  const from = quote?.action?.fromToken || {};
  const dec = Number(to.decimals);
  return {
    toSymbol: to.symbol, toDecimals: dec, fromSymbol: from.symbol, fromDecimals: Number(from.decimals),
    toAmount: units(e.toAmount, dec), toAmountMin: units(e.toAmountMin, dec),
    fees: (e.feeCosts || []).map((f) => ({ name: f.name, pct: Number(f.percentage), usd: Number(f.amountUSD), included: f.included })),
    gas: (e.gasCosts || []).map((g) => ({ usd: Number(g.amountUSD), amount: units(g.amount, Number(g.token?.decimals ?? 18)), symbol: g.token?.symbol })),
    seconds: Number.isFinite(Number(e.executionDuration)) ? Number(e.executionDuration) : null,
    approvalAddress: e.approvalAddress || null,
    tools: routeTools(quote),
    steps: (quote?.includedSteps || []).length,
  };
}

/** LI.FI's status of a sent transaction. { status, substatus, message } or
 *  { error }. */
export async function fetchStatus({ txHash, fromChain, toChain }) {
  const q = new URLSearchParams({ txHash, fromChain: String(fromChain), toChain: String(toChain) });
  try {
    const r = await fetch(`${LIFI}/status?${q.toString()}`, { headers: { accept: 'application/json' } });
    if (r.status === 429) return { error: "LI.FI's limit for your network is used up; the status will be checked again." };
    const b = await r.json().catch(() => null);
    if (!r.ok) return { error: b?.message || `HTTP ${r.status}`, status: r.status };
    return { status: b?.status, substatus: b?.substatus, message: b?.substatusMessage || null, receiving: b?.receiving?.txHash || null };
  } catch (e) {
    return { error: e?.message || 'network error' };
  }
}

/** This browser's record of a buy it sent. No LI.FI figure is kept. */
export function recordBuy({ hash, fromChain, toChain, key, symbol }) {
  const list = readStore(BUYS_KEY);
  list.push({ hash, fromChain, toChain, key, symbol, at: new Date().toISOString() });
  writeStore(BUYS_KEY, list.slice(-200));
}

/** This browser's buys of one version, newest first. */
export function readBuys(key, n = 3) {
  return readStore(BUYS_KEY).filter((b) => b && b.key === key && typeof b.hash === 'string').slice(-n).reverse();
}
