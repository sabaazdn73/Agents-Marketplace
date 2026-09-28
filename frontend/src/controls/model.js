// controls/model.js
//
// Issuer controls, shared by the home section's summary (home/cards.jsx,
// ControlsSummaryCard) and the page /issuer-controls
// (pages/IssuerControls.jsx), so the two name each power in the same words.
//
// One read serves both: GET /api/te/controls?by=issuer (te/api.js). Its rows
// are programmes, an issuer on one chain family (xStocks on Solana is a row,
// xStocks on four EVM chains another). The counts below are worked out from
// those rows and from nothing else: the issuers are the distinct issuers, the
// tokens the sum of each row's `tokens`, the chains the distinct chain names.
// No issuer, chain or count is typed here.

import { BUY_CHAINS } from '../trade/chains';

// The powers, in the home section's order. `ask` is the holder's question,
// `means` what the power would do to a holder. Pause, freeze, burn and
// upgrade are read on chain; who may hold is the issuer's own words
// (class D), linked and dated, and says so wherever it is shown.
export const POWERS = [
  {
    key: 'pause', label: 'Pause', ask: 'Can trading be stopped?',
    means: 'Whoever holds the pause power can stop transfers of the token. While it is paused you cannot send it, sell it on chain or move it to another wallet.',
  },
  {
    key: 'freeze', label: 'Freeze', ask: 'Can your wallet be blocked?',
    means: 'A freeze authority, a denylist or a compliance check can stop one address from sending or receiving the token. The tokens stay in that wallet and cannot move.',
  },
  {
    key: 'burn', label: 'Burn or seize', ask: 'Can tokens be taken from your wallet?',
    means: 'Some contracts let a role holder burn or move tokens out of any wallet without the holder signing. Where no such function exists today, the row says whether an upgrade could add one, and how fast.',
  },
  {
    key: 'upgrade', label: 'Upgrade', ask: "Can the contract's rules be changed?",
    means: "An upgradeable token can have its code replaced, and with it every rule above. Who holds the upgrade, and whether a timelock delays it, decides how quickly that can happen.",
  },
  {
    key: 'who_may_hold', label: 'Who may hold', ask: 'Who is allowed to own it?',
    means: "The issuer's own terms on who may hold the token, quoted with a link to where they are written and the date we read them. These are the issuer's words, not a chain read.",
    issuerWords: true,
  },
];

/** "2026-09-26T21:25:13Z" to "26 Sep 2026" (UTC), or null. */
export function dayText(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** What the home summary names, from the served rows only. Null without rows. */
export function coverage(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rows.length) return null;
  const issuers = [];
  const seen = new Set();
  for (const r of rows) {
    const id = r.issuer_slug || r.issuer;
    if (id && !seen.has(id)) { seen.add(id); issuers.push(r.issuer); }
  }
  const chains = new Set(rows.flatMap((r) => r.chains || []));
  const tokens = rows.every((r) => Number.isFinite(r.tokens)) ? rows.reduce((s, r) => s + r.tokens, 0) : null;
  return { issuers, chains: chains.size, tokens, asOf: dayText(data.computed_at) };
}

/** The issuers and chains a filter offers, in the served order. */
export function filterOptions(rows) {
  const issuers = [];
  const chains = [];
  for (const r of rows || []) {
    if (r.issuer_slug && !issuers.some((i) => i.id === r.issuer_slug)) issuers.push({ id: r.issuer_slug, label: r.issuer });
    (r.chains || []).forEach((name, i) => {
      const id = (r.chain_slugs || [])[i] || name;
      if (!chains.some((c) => c.id === id)) chains.push({ id, label: name });
    });
  }
  return { issuers, chains };
}

/** Does a programme row match the filter? A free-text query matches the
 *  programme, the issuer or a chain name. */
export function rowMatches(r, { issuer, chain, text }) {
  if (issuer && r.issuer_slug !== issuer) return false;
  if (chain && !(r.chain_slugs || []).includes(chain) && !(r.chains || []).includes(chain)) return false;
  if (text) {
    const t = text.trim().toLowerCase();
    if (t && ![r.programme, r.issuer, ...(r.chains || [])].some((s) => (s || '').toLowerCase().includes(t))) return false;
  }
  return true;
}

/** A row's anchor id, used for "#" links and the token deep link. */
export const rowAnchor = (r) => `programme-${r.family || `${r.issuer_slug}-${(r.chain_slugs || []).join('-')}`}`;

/** The programme row a single token belongs to (GET ?by=key answer). */
export function rowForToken(rows, tok) {
  if (!tok || !Array.isArray(rows)) return null;
  return rows.find((r) => r.issuer_slug === tok.issuer_slug && (r.chain_slugs || []).includes(tok.chain_slug)) || null;
}

/** A cell's headline and the rest of its served text. The headline is the
 *  served `state`. The served `text` repeats the state (whole, or its first
 *  words, as "not paused" for "not paused (all 193 tokens read)") and goes
 *  on with who holds the power; that remainder is the rest, shown as it is
 *  served, never rewritten. */
export function splitCell(c) {
  if (!c) return { head: null, rest: null };
  const text = c.text || '';
  const state = c.state || '';
  if (!state) return { head: text || null, rest: null };
  if (!text || text === state) return { head: state, rest: null };
  if (text.startsWith(state)) return { head: state, rest: text.slice(state.length).replace(/^[;,\s]+/, '') || null };
  const cut = text.indexOf('; ');
  if (cut > 0 && state.startsWith(text.slice(0, cut))) return { head: state, rest: text.slice(cut + 2) || null };
  return { head: state, rest: text };
}

const CHAIN_IDS = Object.fromEntries(Object.entries(BUY_CHAINS).map(([id, c]) => [c.name, Number(id)]));

/** An explorer link for an address read on a named chain, or null. */
export function explorerUrl(chainName, address) {
  if (!address) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) {
    const id = CHAIN_IDS[chainName];
    return id ? `${BUY_CHAINS[id].explorer}/address/${address}` : null;
  }
  if (chainName === 'Solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return `https://solscan.io/account/${address}`;
  return null;
}

/** "each token (193)" stays as served; a block or slot reads "block 73,181,588",
 *  a range "slots 450,708,624 to 450,708,660", a source read "verified source". */
export function atText(e) {
  if (!e) return null;
  const unit = e.unit || 'block';
  if (e.block_or_slot == null) return unit === 'source' ? 'verified source' : null;
  const n = (v) => Number(v).toLocaleString('en-US');
  if (e.block_or_slot_to != null && e.block_or_slot_to !== e.block_or_slot) return `${unit}s ${n(e.block_or_slot)} to ${n(e.block_or_slot_to)}`;
  return `${unit} ${n(e.block_or_slot)}`;
}

/** The link to one token's row on /issuer-controls. */
export const tokenLink = (key) => `/issuer-controls?token=${encodeURIComponent(key)}`;
