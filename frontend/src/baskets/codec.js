// baskets/codec.js
//
// A built basket travels in its link and nowhere else: nothing is stored.
// Two forms are read (SPEC C.3):
//   ?b=<base64url JSON>   {v:1, legs:[{t:"NVDA", k?:"<key>", w:4000}, ...]}
//   ?legs=NVDA:4000,TSLA:6000   the evaluate route's own form
// and the link this site writes is ?b=, never built from legs= (which
// cannot carry a pinned version). Rules: 1 to 5 legs, tickers unique,
// integer weights in basis points summing to 10,000. The builder edits
// whole percentages, so every weight it writes is a multiple of 100.
//
// A pinned version `k` is written exactly as GET /api/te/underlying serves
// the version's key ("4663/0xd060...", the address in lowercase): it is
// never checksummed or otherwise rewritten. Base64 padding is stripped.

export const MAX_LEGS = 5;
export const BPS = 10000;

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const KEY = /^\d+\/0x[0-9a-f]{40}$/;

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Why a list of legs is not a basket, or null when it is one. */
export function legsProblem(legs) {
  if (!Array.isArray(legs) || legs.length === 0) return 'add at least one stock or ETF';
  if (legs.length > MAX_LEGS) return `a basket has at most ${MAX_LEGS} legs`;
  const seen = new Set();
  for (const l of legs) {
    if (!TICKER.test(l.t || '')) return `"${l.t || ''}" is not a ticker`;
    if (seen.has(l.t)) return `${l.t} is in the basket twice`;
    seen.add(l.t);
    if (!Number.isInteger(l.w) || l.w <= 0) return `${l.t}: the weight must be a whole number above zero`;
    if (l.k != null && !KEY.test(l.k)) return `${l.t}: the version key is not one this site writes`;
  }
  const sum = legs.reduce((a, l) => a + l.w, 0);
  if (sum !== BPS) return `the weights add up to ${sum / 100}%, not 100%`;
  return null;
}

export function encodeB(legs) {
  return b64urlEncode(JSON.stringify({ v: 1, legs: legs.map((l) => (l.k ? { t: l.t, k: l.k, w: l.w } : { t: l.t, w: l.w })) }));
}

/** The legs a link carries: { legs } or { error }. */
export function decodeLink(search) {
  const p = new URLSearchParams(search || '');
  const b = p.get('b');
  const raw = p.get('legs');
  let legs = null;
  try {
    if (b) {
      const j = JSON.parse(b64urlDecode(b));
      if (j?.v !== 1 || !Array.isArray(j.legs)) return { error: 'this basket link is not in a format this site reads' };
      legs = j.legs.map((l) => ({ t: String(l.t || '').toUpperCase(), k: l.k || undefined, w: Number(l.w) }));
    } else if (raw) {
      legs = raw.split(',').map((part) => {
        const [t, w] = part.split(':');
        return { t: String(t || '').trim().toUpperCase(), w: Number(w) };
      });
    }
  } catch {
    return { error: 'this basket link could not be read' };
  }
  if (!legs) return { legs: null };
  const problem = legsProblem(legs);
  return problem ? { error: `This basket link is not valid: ${problem}.`, legs } : { legs };
}

/** The legs as text, for a progress key; not a link (it drops pins). */
export const legsParam = (legs) => legs.map((l) => `${l.t}:${l.w}${l.k ? `@${l.k}` : ''}`).join(',');

/** The share link: the evaluate answer's own b_param when it serves one,
 *  else this page's canonical encoding of the same legs. */
export const shareUrl = (legs, size, bParam = null) => {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.tnega.app';
  const b = (typeof bParam === 'string' && bParam ? bParam : encodeB(legs)).replace(/=+$/, '');
  return `${origin}/my-etfs?b=${b}${size && size !== 1000 ? `&size=${size}` : ''}`;
};
