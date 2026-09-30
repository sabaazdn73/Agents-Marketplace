// trade/format.js
//
// Amounts and times as the signing page (sign/SignOrderPage.jsx) and the
// stock page's Buy and Sell tabs (trade/StockTrade.jsx) print them. Plain
// module, no React.

import { formatUnits } from 'viem';

/** An exact amount from its smallest unit: every decimal the token has, with
 *  trailing zeros trimmed, and thousands separated. "0.05", "10",
 *  "0.04357211". null when either is missing. */
export function rawText(raw, decimals) {
  try {
    if (raw == null || !Number.isInteger(decimals)) return null;
    const [i, fr] = formatUnits(BigInt(String(raw)), decimals).split('.');
    const int = BigInt(i).toLocaleString('en-US');
    return fr ? `${int}.${fr}` : int;
  } catch { return null; }
}

/** "14:05:09 UTC, 28 Sep 2026", to the second. */
export function clockText(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return `${time} UTC, ${date}`;
}
