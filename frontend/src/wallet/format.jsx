// format.jsx
//
// Number and date formatting for the wallet page, and the one component that
// shows why a figure is absent. Every absence on the page goes through
// Withheld, which prints the route's own sentence for the reason code, so the
// page never shows a zero or a dash where the answer is "not measured".

import React from 'react';

const MINUS = '−';

export function fmtUsd(v, { sign = false } = {}) {
  if (v == null || !Number.isFinite(v)) return null;
  const abs = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v < 0) return `${MINUS}$${abs}`;
  return `${sign && v > 0 ? '+' : ''}$${abs}`;
}

export function fmtAmount(v, maxDigits = 6) {
  if (v == null || !Number.isFinite(v)) return null;
  const abs = Math.abs(v);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : maxDigits;
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: digits });
  return v < 0 ? `${MINUS}${s}` : s;
}

export function fmtPct(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return null;
  return `${(v * 100).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function fmtRate(v) {
  // Fee rates are tiny fractions; show them as percentages to three places.
  if (v == null || !Number.isFinite(v)) return null;
  return `${(v * 100).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 4 })}%`;
}

export function fmtCount(n) {
  return n == null ? null : Number(n).toLocaleString();
}

/** A UTC timestamp, the same clock the route's own labels use. */
export function fmtUtc(iso, { withTime = true } = {}) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (!withTime) return day;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${day} ${time} UTC`;
}

export function fmtSpan(hours) {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  if (hours < 48) return `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hours`;
  return `${(hours / 24).toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;
}

export function fmtDays(days) {
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 2) return `${(days * 24).toLocaleString(undefined, { maximumFractionDigits: 1 })} hours`;
  return `${days.toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;
}

export function fmtAge(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  if (seconds < 90 * 60) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 48 * 3600) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

/** A fee as the venue signs it: positive paid, negative a rebate received. */
export function feeWords(v, token) {
  if (v == null) return null;
  if (v < 0) return { amount: `${fmtAmount(Math.abs(v))} ${token}`, word: 'received as rebate', tone: 'text-pos' };
  return { amount: `${fmtAmount(v)} ${token}`, word: 'paid', tone: 'text-fg' };
}

/** The route's sentence for a reason code, or a plain fallback naming the
 *  code, so an unknown code is shown rather than hidden. */
export function reasonText(reasons, code) {
  if (!code) return null;
  return (reasons && reasons[code]) || `Not stated here (${code}).`;
}

export function Withheld({ reasons, code, className = '' }) {
  const text = reasonText(reasons, code);
  if (!text) return null;
  return <p className={`text-label text-muted ${className}`}>{text}</p>;
}

/** The small grey line under a figure: its window and sample count. */
export function Basis({ children, className = '' }) {
  return <p className={`text-label text-muted mt-1 ${className}`}>{children}</p>;
}

/** A clause from the route (a `basis`, written to follow a comma) shown on its
 *  own as a sentence: first letter capitalised, one closing full stop. The
 *  route's text is left as it is; only the display changes. */
export function asSentence(text) {
  if (!text) return null;
  const t = String(text).trim();
  const s = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** A section name from the route's `missing` list, in words. */
export function sectionName(section) {
  const map = {
    account: 'Account',
    fees: 'Fees paid',
    taker_share: 'Taker share',
    funding: 'Funding',
    post_only: 'Post-only rejection',
    'holdings.spot': 'Spot balances',
  };
  if (map[section]) return map[section];
  if (section.startsWith('holdings.perps.')) return `Perp dex ${section.slice('holdings.perps.'.length)}`;
  if (section.startsWith('fees.')) {
    const [, token, side] = section.split('.');
    return side ? `Fees, ${token}, ${side}` : `Fees, ${token}`;
  }
  return section;
}
