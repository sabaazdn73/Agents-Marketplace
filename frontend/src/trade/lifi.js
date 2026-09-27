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

export function quoteUrl({ fromChain, toChain, fromToken, toToken, fromAmount, fromAddress }) {
  const q = new URLSearchParams({
    fromChain: String(fromChain), toChain: String(toChain),
    fromToken, toToken, fromAmount: String(fromAmount), fromAddress,
    slippage: String(SLIPPAGE), order: 'CHEAPEST',
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

/** Does the quote answer the question asked? A mismatch refuses it. */
export function quoteMismatch(quote, p) {
  const a = quote?.action || {};
  const tr = quote?.transactionRequest || {};
  const bad = [];
  if (Number(a.fromChainId) !== Number(p.fromChain)) bad.push('the paying chain');
  if (Number(a.toChainId) !== Number(p.toChain)) bad.push("the stock's chain");
  if (lc(a.fromToken?.address) !== lc(p.fromToken)) bad.push('the token paid');
  if (lc(a.toToken?.address) !== lc(p.toToken)) bad.push('the token bought');
  if (String(a.fromAmount) !== String(p.fromAmount)) bad.push('the amount');
  if (lc(a.fromAddress) !== lc(p.fromAddress)) bad.push('the wallet');
  if (!tr.to || !tr.data) bad.push('the transaction');
  if (tr.from && lc(tr.from) !== lc(p.fromAddress)) bad.push("the transaction's sender");
  if (tr.chainId != null && Number(tr.chainId) !== Number(p.fromChain)) bad.push("the transaction's chain");
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
