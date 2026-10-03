// sign/jupiter.js
//
// Jupiter's swap API, asked from the visitor's browser and from nowhere
// else: GET /swap/v1/quote, then POST /swap/v1/swap for a transaction built
// for the order's wallet. No key is sent (a key in a browser is public, and
// Tnega pays for none): the free, keyless endpoint.
//
// BASE URL. lite-api.jup.ag is Jupiter's free gateway. Jupiter's migration
// notes (developers.jup.ag/docs/portal/migration, read 2026-10-03) say it is
// being phased out with no date, and that api.jup.ag answers keyless
// requests at a lower rate (0.5 per second). So: lite-api first; if it does
// not answer, api.jup.ag, with its pace respected (one request per 2.2 s).
// VITE_JUPITER_API_BASE overrides both, for a self-hosted or keyed proxy.
//
// Plain module, no React and no @solana/web3.js. `fetchImpl` is injectable
// so the headless checks run it against constructed answers.

export const JUP_BASES = ['https://lite-api.jup.ag', 'https://api.jup.ag'];
const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_JUPITER_API_BASE) || '';
export const jupBases = () => (envBase ? [String(envBase).replace(/\/+$/, '')] : JUP_BASES);

const TIMEOUT_MS = 15e3;
const KEYLESS_GAP_MS = 2200;

/** The quote request for the order: exact-in, the order's own slippage. */
export function quoteRequest({ inputMint, outputMint, amount, slippageBps }) {
  return {
    inputMint, outputMint,
    amount: String(amount),
    slippageBps: Number(slippageBps),
    swapMode: 'ExactIn',
    restrictIntermediateTokens: true,
  };
}

export function quoteUrl(base, req) {
  const q = new URLSearchParams({
    inputMint: req.inputMint, outputMint: req.outputMint, amount: req.amount,
    slippageBps: String(req.slippageBps), swapMode: req.swapMode,
    restrictIntermediateTokens: String(req.restrictIntermediateTokens),
  });
  return `${base}/swap/v1/quote?${q.toString()}`;
}

/** POST /swap body: the quote as it came, for the order's wallet. SOL is not
 *  one of the two tokens, so nothing is wrapped; the compute limit is sized
 *  by Jupiter's simulation. */
export function swapBody(quote, wallet) {
  return {
    userPublicKey: wallet,
    quoteResponse: quote,
    wrapAndUnwrapSol: false,
    dynamicComputeUnitLimit: true,
    asLegacyTransaction: false,
  };
}

async function once(url, init, fetchImpl, signalMs = TIMEOUT_MS) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), signalMs) : null;
  try {
    const res = await fetchImpl(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, ok: res.ok, body };
  } catch (e) {
    return { status: 0, ok: false, body: null, error: e?.name === 'AbortError' ? 'Jupiter did not answer in time' : (e?.message || 'network error') };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET the quote; resolves { quote, quotedAt, base } or { error }. */
export async function fetchJupiterQuote(req, { fetchImpl = globalThis.fetch, bases = jupBases(), gapMs = KEYLESS_GAP_MS } = {}) {
  let last = null;
  for (const base of bases) {
    let r = await once(quoteUrl(base, req), { method: 'GET', headers: { Accept: 'application/json' } }, fetchImpl);
    if (r.status === 429) { await sleep(gapMs); r = await once(quoteUrl(base, req), { method: 'GET', headers: { Accept: 'application/json' } }, fetchImpl); }
    if (r.ok && r.body && typeof r.body === 'object') return { quote: r.body, quotedAt: new Date().toISOString(), base };
    last = r;
    // A refusal that is about the request itself (400 and its kin) would be the
    // same elsewhere: stop. A gateway that does not answer, or is gone, moves on.
    if (r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 404 && r.status !== 403) break;
  }
  return { error: jupiterErrorText(last, 'quote') };
}

/** POST /swap; resolves { swap: { tx (base64), lastValidBlockHeight }, base } or { error }. */
export async function fetchJupiterSwap(quote, wallet, { fetchImpl = globalThis.fetch, base, gapMs = KEYLESS_GAP_MS } = {}) {
  const url = `${base}/swap/v1/swap`;
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(swapBody(quote, wallet)) };
  // api.jup.ag keyless allows one request per 2.2 s: wait it out before the
  // second request (the quote was the first).
  if (/\/\/api\.jup\.ag/.test(base)) await sleep(gapMs);
  let r = await once(url, init, fetchImpl);
  if (r.status === 429) { await sleep(gapMs); r = await once(url, init, fetchImpl); }
  if (!r.ok || !r.body || typeof r.body.swapTransaction !== 'string' || !r.body.swapTransaction) {
    return { error: jupiterErrorText(r, 'swap transaction') };
  }
  const lv = r.body.lastValidBlockHeight;
  return { swap: { tx: r.body.swapTransaction, lastValidBlockHeight: Number.isFinite(Number(lv)) ? Number(lv) : null, priorityFeeLamports: r.body.prioritizationFeeLamports ?? null }, base };
}

/** What went wrong, in words, from a failed request. */
export function jupiterErrorText(r, what) {
  if (!r) return `Jupiter's ${what} could not be read.`;
  if (r.error) return `Jupiter's ${what} could not be read: ${r.error}. Nothing was signed.`;
  const detail = r.body && (r.body.error || r.body.message);
  const d = typeof detail === 'string' ? detail.slice(0, 200) : '';
  if (r.status === 429) return `Jupiter's free service is busy (too many requests). Wait a few seconds and ask for the ${what} again.`;
  if (r.status === 400 && /could not find any route|no routes? found|route not found/i.test(d)) return `Jupiter found no route for this order (${d}). Nothing was signed.`;
  if (r.status === 400 && /liquidity|market not|not tradable|tradable/i.test(d)) return `Jupiter says this token is not tradable right now (${d}). Nothing was signed.`;
  return `Jupiter's ${what} could not be read (HTTP ${r.status}${d ? `: ${d}` : ''}). Nothing was signed.`;
}
