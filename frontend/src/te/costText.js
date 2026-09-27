// te/costText.js
//
// How a cost figure and a version's state are worded, in one place, for
// every card that shows T3a's answers (the versions card, the lists, the
// cost curve, the sign-in showcase), in both apps.
//
// THE HEADLINE FIGURE is allin_per_share: what one share's worth of the
// stock costs through this version, all in (the size, gas, the L1 fee and
// LI.FI's 0.25% fee, over the tokens received, over the shares per token).
// tokens_per_1000 sits under it. cost_bps is a secondary figure and always
// carries its label, because it is measured against the pool's own mid and
// so cannot rank one version against another. A version whose share ratio
// is not read has no price per share: it shows its price per token, says so
// beside the figure, and is never crowned.

const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('en-US');

const num = (v) => typeof v === 'number' && Number.isFinite(v);

export const priceText = (v) => (num(v) ? usd2.format(v) : null);
export const depthText = (v) => (num(v) ? `depth ±2%: ${usd0.format(v)}` : null);
export const blockText = (b) => (num(b) ? `block ${int.format(b)}` : null);

/** "4.4281 tokens per $1,000": four decimals under ten tokens, fewer above. */
export function tokensText(v) {
  if (!num(v)) return null;
  const d = v < 10 ? 4 : v < 1000 ? 2 : 0;
  return `${v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })} tokens per $1,000`;
}

export const bpsText = (v) => (num(v) ? `cost ${v.toFixed(1)} bps` : null);

/** "1.0008 shares per token", or the engine's own words when not read. */
export function shareRatioText(v) {
  if (num(v.share_ratio)) return `${v.share_ratio.toFixed(4)} shares per token`;
  return v.share_ratio_basis || 'share ratio not read';
}

/** The price a version is shown at, and what the figure is. */
export function headline(v) {
  // A list row's best carries no `comparable`: it is ranked, so its ratio
  // is read. An underlying's version says so either way.
  if (v.comparable !== false && num(v.allin_per_share)) return { value: priceText(v.allin_per_share), unit: 'per share, all-in' };
  if (num(v.allin_per_token)) return { value: priceText(v.allin_per_token), unit: 'per token (ratio not read)' };
  return null;
}

/** The gap to the underlying's reference price, only when the engine flags
 *  it (beyond 50 bps). The basis names the reference. */
export function refGap(v) {
  if (!v.ref_gap_flag || !num(v.ref_gap_bps)) return null;
  const n = Math.abs(v.ref_gap_bps).toFixed(0);
  return { text: `Priced ${n} bps ${v.ref_gap_bps > 0 ? 'above' : 'below'} the reference`, basis: v.ref_gap_basis || null };
}

const strip = (reason, prefix) => (typeof reason === 'string' && reason.toLowerCase().startsWith(prefix) ? reason.slice(prefix.length) : reason);

/** A version with no cost at this size: what happened, named apart from
 *  every other state, with the engine's reason. */
export function stateText(v, size) {
  const on = v.chain ? ` on ${v.chain}` : '';
  const at = num(size) ? usd0.format(size) : 'this size';
  switch (v.state) {
    case 'partial': return { label: `Fills part of ${at}`, reason: v.reason };
    case 'failed': return { label: `Quote failed${on}`, reason: v.reason };
    case 'too_thin': return { label: `Pool too thin${on}`, reason: strip(v.reason, 'too thin: ') };
    case 'not_a_venue': return { label: `Not a venue${on}`, reason: strip(v.reason, 'not a venue: ') };
    case 'not_searched': return { label: `Not searched${on}`, reason: v.reason };
    case 'no_pool': return { label: `No pool found${on}`, reason: v.reason };
    case 'held': return { label: `Held back${on}`, reason: v.reason };
    default: return { label: v.state ? `Not measured${on}` : 'Not measured', reason: v.reason };
  }
}

/** "27 Sep 2026, 09:46 UTC" from an ISO time. */
export function timeText(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date}, ${time} UTC`;
}

/** "US market closed" when every figure was read with the market in the
 *  same state; nothing when they differ or it was not read. */
export function marketText(values) {
  const seen = [...new Set(values.filter((x) => x === true || x === false))];
  if (seen.length !== 1) return null;
  return seen[0] ? 'US market open' : 'US market closed';
}

/** "Measured 27 Sep 2026, 09:46 UTC, US market closed." */
export function measuredLine(computedAt, marketValues = []) {
  const t = timeText(computedAt);
  if (!t) return null;
  const m = marketText(marketValues);
  return `Measured ${t}${m ? `, ${m}` : ''}.`;
}

/** The first letter up, for a reason quoted as a sentence. */
export const sentence = (s) => (typeof s === 'string' && s ? s[0].toUpperCase() + s.slice(1) : s);
