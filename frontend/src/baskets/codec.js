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

// The backend's own rules (te-baskets core/te/baskets.py): a ticker is 1 to
// 12 of A-Z 0-9 . -, a weight is ASCII digits only (4e3 is refused), and a
// pinned key must equal a served key exactly. EVM keys are served in
// lowercase and the backend compares them as text, so an uppercase key is
// refused here with that reason rather than changed.
const TICKER = /^[A-Z0-9.-]{1,12}$/;
const KEY = /^\d+\/0x[0-9a-f]{40}$/;
const DIGITS = /^[0-9]{1,7}$/;
const B64URL = /^[A-Za-z0-9_-]{1,1024}={0,2}$/;

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
    // An empty leg is not a wrong ticker; it has not been filled in yet.
    if (!l.t) return 'every leg needs a stock or ETF';
    if (!TICKER.test(l.t)) return `"${l.t}" is not a ticker`;
    if (seen.has(l.t)) return `${l.t} is in the basket twice`;
    seen.add(l.t);
    if (!Number.isInteger(l.w) || l.w <= 0 || l.w > BPS) return `${l.t}: the weight must be a whole number of basis points from 1 to ${BPS.toLocaleString('en-US')}`;
    if (l.k != null && typeof l.k === 'string' && /^\d+\/0x[0-9a-fA-F]{40}$/.test(l.k) && !KEY.test(l.k)) return `${l.t}: the version key has capital letters; keys are used exactly as served, in lowercase`;
    if (l.k != null && !KEY.test(l.k)) return `${l.t}: "${l.k}" is not a version key`;
  }
  const sum = legs.reduce((a, l) => a + l.w, 0);
  if (sum !== BPS) return `the weights add up to ${sum / 100}%, not 100%`;
  return null;
}

export function encodeB(legs) {
  return b64urlEncode(JSON.stringify({ v: 1, legs: legs.map((l) => (l.k ? { t: l.t, k: l.k, w: l.w } : { t: l.t, w: l.w })) }));
}

/** The legs a link carries: { legs } or { error } saying what is wrong:
 *  the encoding, the JSON, or which field. A link that decodes but breaks
 *  a rule still returns its legs, so the builder can show them. */
export function decodeLink(search) {
  const p = new URLSearchParams(search || '');
  const b = p.get('b');
  const raw = p.get('legs');
  const bad = (why, legs = null) => ({ error: `This basket link is not valid: ${why}.`, legs });
  let legs = null;
  if (b != null) {
    if (!B64URL.test(b)) return bad('the b= value is not base64url (A-Z, a-z, 0-9, - and _ only)');
    let text;
    try { text = b64urlDecode(b.replace(/=+$/, '')); } catch { return bad('the b= value does not decode'); }
    let j;
    try { j = JSON.parse(text); } catch { return bad('the b= value decodes, but not to JSON'); }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return bad('the b= JSON is not an object');
    if (j.v !== 1) return bad(`the b= JSON has v ${JSON.stringify(j.v)}; only v 1 is known`);
    if (!Array.isArray(j.legs)) return bad('the b= JSON has no legs list');
    // JSON.parse reads 4e3 as 4000; the backend refuses it, so the text is
    // checked: every w must be written as ASCII digits.
    const ws = [...text.matchAll(/"w"\s*:\s*([^,}\]\s]+)/g)].map((m) => m[1]);
    if (ws.some((w) => !DIGITS.test(w))) return bad('a weight (w) is not written as whole ASCII digits');
    for (const [n, l] of j.legs.entries()) {
      if (!l || typeof l !== 'object' || typeof l.t !== 'string' || !('w' in l)) return bad(`leg ${n + 1} needs t (a ticker) and w (a weight)`);
      const extra = Object.keys(l).filter((k) => !['t', 'k', 'w'].includes(k));
      if (extra.length) return bad(`leg ${n + 1} has an unknown field ${extra[0]}`);
      if ('k' in l && typeof l.k !== 'string') return bad(`leg ${n + 1}: k must be a version key`);
    }
    legs = j.legs.map((l) => ({ t: l.t.toUpperCase(), k: l.k, w: l.w }));
  } else if (raw != null) {
    const parts = raw.split(',');
    legs = [];
    for (const part of parts) {
      const [t, w, more] = part.split(':');
      if (more != null || w == null || !DIGITS.test(w.trim())) return bad(`"${part}" is not TICKER:weight (weight in whole ASCII digits)`);
      legs.push({ t: String(t || '').trim().toUpperCase(), w: Number(w.trim()) });
    }
  }
  if (!legs) return { legs: null };
  const problem = legsProblem(legs);
  return problem ? bad(problem, legs) : { legs };
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
