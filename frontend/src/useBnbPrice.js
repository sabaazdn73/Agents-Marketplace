// useBnbPrice.js
//
// Real, live BNB/USD price (backend/adapters/coingecko.py — this project's
// first actual data-consuming CoinGecko integration; previously CoinGecko
// was only used for a /status reachability check, nothing displayed real
// data from it). Shared by web + mobile so both compute the same real USD
// context next to an agent's owner-wallet BNB balance.
import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
let _cached = null; // one real fetch per page session, not per component instance

export function useBnbPrice() {
  const [usd, setUsd] = useState(_cached);

  useEffect(() => {
    if (_cached != null) return;
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/market/bnb-price`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && typeof d.usd === 'number') { _cached = d.usd; setUsd(d.usd); } })
      .catch(() => { /* real failure — stays null, no fabricated price shown */ });
    return () => { cancelled = true; };
  }, []);

  return usd; // real number, or null (never a fabricated placeholder)
}

/** Formats a real BNB amount with its real live USD equivalent, e.g.
 * "1.23 BNB (≈ $854.36)". Falls back to plain BNB (no parenthetical) when
 * the real price isn't available yet — never a fabricated/stale-looking
 * number. */
export function formatBnbWithUsd(bnbAmount, usdPrice) {
  const bnbText = `${bnbAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} BNB`;
  if (usdPrice == null) return bnbText;
  const usdValue = bnbAmount * usdPrice;
  return `${bnbText} (≈ $${usdValue.toLocaleString(undefined, { maximumFractionDigits: usdValue >= 100 ? 0 : 2 })})`;
}
