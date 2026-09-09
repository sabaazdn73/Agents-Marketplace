// yieldHistory.js
//
// Historical APY for the BSC protocols the Yield Optimisation agent can
// actually execute against, from DefiLlama.
//
// CONFIRMED BEFORE BUILDING, not assumed. The doubt was whether DefiLlama
// carries history for Venus, Lista and Ankr on BSC at all. It does. Checked
// live on 2026-09-09 against yields.llama.fi/chart/{pool}:
//
//   Lista  slisBNB   475 points from 2025-05-23, 0 null
//   Ankr   ankrBNB  1537 points from 2022-06-08, 0 null
//   Venus  WBNB     1527 points from 2022-07-06, 0 null
//   Aave   WBNB      822 points from 2024-06-10, 0 null
//
// Fetched straight from the browser rather than proxied. DefiLlama answers
// with access-control-allow-origin: *, confirmed on the same check, and the
// backend is the service that OOMs on a 512Mi cap, so routing four 74 KB
// series through it would add memory pressure for nothing.
//
// The pool ids are pinned. DefiLlama's ids are stable per pool, and picking
// a pool by scanning for a project name at render time would silently
// change which pool is charted when their listing changes.
//
// Venus and Aave are lending markets with dozens of pools each, so WBNB is
// charted for both: it is the asset Lista and Ankr are denominated in, which
// makes the four lines a comparison of the same thing rather than four
// unrelated rates.

export const DEFILLAMA_CHART = 'https://yields.llama.fi/chart';

export const YIELD_POOLS = [
  { key: 'lista', label: 'Lista slisBNB', pool: '50bb5f69-85ea-4f70-81da-3661a1633fc4', color: '#6366F1' },
  { key: 'ankr',  label: 'Ankr ankrBNB',  pool: '76ce5019-2483-4d1b-ae06-01b890360045', color: '#14B8A6' },
  { key: 'venus', label: 'Venus WBNB',    pool: '747b58ab-aefd-42e1-a312-01ad5a0ab7f5', color: '#F59E0B' },
  { key: 'aave',  label: 'Aave v3 WBNB',  pool: '9380e5ac-3b75-468c-951c-c24ff6497e80', color: '#A855F7' },
];

export const RANGE_DAYS = 180;
const MAX_POINTS = 180;

export class YieldHistoryError extends Error {}

/** Evenly thin a series for drawing. Keeps the last point, because the most
 *  recent rate is the one the card also states as a number and the two must
 *  not disagree. */
export function downsample(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max - 1; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/**
 * One pool's history. Returns { key, label, color, points, latest, error }.
 * A failure is returned rather than thrown, so one dead pool does not remove
 * the three that answered.
 */
export async function fetchPoolHistory(entry, { days = RANGE_DAYS, signal } = {}) {
  try {
    const res = await fetch(`${DEFILLAMA_CHART}/${entry.pool}`, { signal });
    if (!res.ok) throw new YieldHistoryError(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.status && body.status !== 'success') {
      throw new YieldHistoryError(`status ${body.status}`);
    }
    const raw = Array.isArray(body.data) ? body.data : null;
    if (!raw) throw new YieldHistoryError('no data array in the response');

    const cutoff = Date.now() - days * 86400_000;
    const points = raw
      .map((d) => ({ x: Date.parse(d.timestamp), y: d.apy == null ? null : Number(d.apy) }))
      .filter((p) => Number.isFinite(p.x) && p.x >= cutoff)
      .sort((a, b) => a.x - b.x);

    if (!points.length) throw new YieldHistoryError(`no points in the last ${days} days`);

    const withValue = points.filter((p) => p.y != null);
    return {
      ...entry,
      points: downsample(points),
      latest: withValue.length ? withValue[withValue.length - 1].y : null,
      pointCount: points.length,
      error: null,
    };
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return { ...entry, points: [], latest: null, pointCount: 0, error: e.message || String(e) };
  }
}

/** All four, in parallel. Never rejects on a single pool failing. */
export async function fetchYieldHistory({ days = RANGE_DAYS, signal } = {}) {
  const results = await Promise.all(
    YIELD_POOLS.map((p) => fetchPoolHistory(p, { days, signal })),
  );
  return {
    series: results.filter((r) => r.points.length > 0),
    missing: results.filter((r) => r.points.length === 0),
    fetchedAt: Date.now(),
  };
}

/**
 * What a position would be worth after a year at today's rate, for each
 * protocol that reported one.
 *
 * This is a projection at the current rate, not a forecast and not a
 * history. It is labelled that way on the card. The rate is the live one
 * from the series above, so nothing here is invented; the only assumption
 * is that the rate holds, which is stated.
 */
export function projectAtCurrentRates(series, principal) {
  const p = Number(principal);
  if (!Number.isFinite(p) || p <= 0) return [];
  return series
    .filter((s) => s.latest != null)
    .map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      apy: s.latest,
      yearEnd: p * (1 + s.latest / 100),
      gain: p * (s.latest / 100),
    }))
    .sort((a, b) => b.apy - a.apy);
}

/** Today, from the clock rather than a literal, so the label stays right. */
export function projectionAsOf(now = new Date()) {
  return now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
