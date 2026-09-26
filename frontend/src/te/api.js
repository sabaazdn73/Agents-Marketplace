// te/api.js
//
// Every tokenized-equity read the pages make, in one place, and the shape
// each page expects back. The endpoints are SPEC.md §B.7; the backend builds
// them. A page never invents a figure: a read that fails, answers non-200 or
// comes back without the field a card needs renders nothing (no placeholder,
// no zero). Owner rule: ship only what works.
//
// DEV FIXTURES. With `VITE_TE_FIXTURES=1` in a dev server (`npm run dev`),
// reads are answered from te/fixtures.dev.js instead of the API, so the
// layout can be built before the backend exists. The check is on
// import.meta.env.DEV, which Vite replaces with `false` in a production
// build, so the branch and its dynamic import are removed and the fixture
// file is not in the bundle (checked after every build: grep the output for
// FIXTURE_MARKER). Every fixture answer carries `_fixture: true`, and the
// pages draw a "Dev fixture" tag beside anything fed from one, so a
// screenshot of fixture data cannot pass for a measurement.
//
// RESPONSE SHAPES the pages read (fields not listed are ignored):
//
//   GET /api/te/summary
//     { tokens, issuers, chains, computed_at,
//       chain_list: [{ name, group: 'evm'|'nonevm', tokens }] }
//   (eligibility and who_may_hold are always { text, url, read_on }: the
//    issuer's own words, linked and dated, never shown without both.)
//   GET /api/te/list?type=stock|etf&group=all|evm|nonevm&limit=&sort=
//     { rows: [{ underlying, name, type, versions, eligibility,
//                best: { key, symbol, issuer, chain, group,
//                        paid_per_token, cost_usd, cost_bps },
//                spark: [number] }], sort, size, computed_at }
//   GET /api/te/search?q=
//     { results: [{ kind: 'instrument'|'vault', underlying?, key?, symbol,
//                   name, issuer?, chain?, group?, platform? }] }
//   GET /api/te/underlying/{ticker}?size=1000
//     { ticker, name, size, computed_at,
//       versions: [{ key, symbol, issuer, chain, group, cost_usd, cost_bps,
//                    paid_per_token, filled_fraction, pool_usd, eligibility,
//                    controls: { pause, freeze, burn, upgrade } }] }
//   GET /api/te/curve/{ticker}
//     { ticker, stops: [usd], computed_at,
//       chains: [{ chain, group, symbol, issuer, bps: [number|null],
//                  pool_usd: [number|null] }] }
//   GET /api/te/controls?by=issuer
//     { computed_at, rows: [{ programme, issuer, chains: [string],
//         pause, freeze, burn, upgrade: { text, state? },
//         who_may_hold: { text, url, read_on } }] }
//   GET /api/baskets/curated
//     { note, baskets: [{ name, code, legs: [{ ticker, symbol, weight_bps }],
//         cost_bps_1k, signatures, evm, nonevm, cap_usd, cap_leg }] }
//   GET /api/vaults?platform=&limit=&offset=   (T6, branch te-vaults; limit <= 100)
//     { computed_at, as_of, read_only, deposits, notice, rule, order,
//       total, count, offset, limit, partial?, missing?,
//       vaults: [{ key, name, platform, chain, group, address, manager,
//                  audits, assets, controls, fees, lockup,
//                  tvl_usd, tvl_amount, tvl_symbol, tvl_slot,
//                  tvl_source: 'computed_from_chain'|'vault_recorded',
//                  tvl_basis, tvl_reconciliation, tvl_partial,
//                  tvl_last_written, stale?: bool (the latest read of this
//                  vault failed; the figures are the previous read's),
//                  nested_in?: key of the listed vault this one sits
//                  inside (its dollars are already in that vault's TVL),
//                  provenance: { <field>: { class: 'A'|'D', slot?, url?,
//                                           read_on?, source? } },
//                  read_at,
//                  // not served by T6 yet; rendered when present:
//                  return_30d?: { pct, basis, from, to },
//                  series?: { share_price: [[t_ms, v]], tvl: [[t_ms, usd]] },
//                  age_days? }],
//       platforms: [{ platform, platform_key, chain, group,
//                     status: 'listed'|'none_qualifying', listed, as_of,
//                     read_at, text, reason_class?, discovered?, slot?,
//                     excluded?: [{ reason, count }],
//                     named_exclusions?: [{ address, name?, reason }],
//                     upgrade?: { text, class, slot },
//                     evidence?, sources?, sources_read_on? }] }
//   GET /api/vaults/{platform}/{address}   (T6)
//     { kind, platform, platform_key, chain, group, address, program, name,
//       token: { mint, symbol, decimals }, slots,
//       tvl: { usd, amount, symbol, slot, source, basis, reconciliation,
//              partial, vault_recorded?: { amount, field, slot },
//              difference_pct? },
//       fees, lockup: { text, class, slot, ... },
//       manager: { text, class, slot, vault_admin?, allocation_admin?,
//                  pending_admin? (each { kind, address, text, ... }) },
//       assets: { text, class, slot, allocations?: [{ reserve,
//                 lending_market, market_owner_text, target_weight,
//                 value_tokens }] },
//       controls: { class, slot, admin?, allocation_admin?,
//                   global_admin?: { text }, market_owners?: [string],
//                   pause?: { text, class },
//                   upgrade?: { programs: [{ program, state, authority,
//                                            last_deploy_slot, slot,
//                                            authority_detail?: { text } }] } },
//       audits: { text, class, url, read_on, entries?: [{ auditor,
//                 date_as_stated, scope }], note? },
//       powers: { class, source, read_on, rows: [[role, what]], moves },
//       read_at, row (the list row), notice,
//       // not served by T6 yet; rendered when present:
//       return_30d?, series?, age_days?, depositors?: [...],
//       activity?: [...] }
//   GET /api/baskets/{code}
//     { code, name, creator, created_at, version, description,
//       legs: [{ ticker, symbol, issuer, chain, group, weight_bps }],
//       value_usd_indicative?, value_basis?, return_since_creation_pct?,
//       followers_count?, series?: [[t_ms, usd]],
//       cost_at_size?: { stops: [usd], bps: [number|null] },
//       changes: [{ version, at, legs: [...], note? }],
//       followers?: [{ address, since }] }
//   POST /api/site/portfolio { addresses: [address] }
//     { total_usd, change_usd, change_pct, computed_at,
//       series: { '1D'|'1W'|'1M'|'YTD'|'1Y'|'Max': [[t_ms, usd]] },
//       positions: [{ key, symbol, name, issuer, chain, qty, buy_in_usd,
//                     buy_in_reason, price_usd, value_usd, pl_usd, pl_pct }],
//       allocation: { type|chain|issuer: [{ label, usd }] },
//       performance: { by_year: [{ year, pct }], price_gain_usd,
//                      dividends_usd, tx_costs_usd, total_return_usd },
//       dividends: { received_usd, yield_ttm_pct,
//                    by_year: [{ year, usd }],
//                    payments: [{ date, symbol, step, usd }] } }

import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const USE_FIXTURES = import.meta.env.DEV && import.meta.env.VITE_TE_FIXTURES === '1';

async function fixtureFor(path, body) {
  if (!USE_FIXTURES) return null;
  const m = await import('./fixtures.dev.js');
  return m.answer(path, body);
}

/** One read. Resolves to { data } with the parsed JSON, or { error } with
 *  why it failed (a non-200 status or a network failure). */
export async function teRead(path, { method = 'GET', body } = {}) {
  if (USE_FIXTURES) {
    const d = await fixtureFor(path, body);
    // A path the fixtures do not know answers as the API would: not found.
    return d ? { data: d } : { error: 'HTTP 404' };
  }
  try {
    const r = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) {
    return { error: e?.message || 'network error' };
  }
}

/** A read as React state: { data, loading, error, stale, ever }.
 *
 *  `path` null means "do not read" (all fields empty, no request).
 *
 *  NOTHING READ FOR ANOTHER KEY PAINTS AS CURRENT. The state records the
 *  key it was read for; while it is not the current key (the render between
 *  a key change and the effect), data is null, or with `keep` the old rows
 *  marked stale. After that:
 *    by default the old answer is gone at once, so a new wallet never shows
 *    the previous wallet's figures (the Dashboard relies on this);
 *    with `keep: true` (a list whose filter changed) the previous rows stay
 *    on screen, dimmed and labelled "Updating" (`stale`), until the new
 *    answer replaces them.
 *  An answer that arrives after the key moved on is dropped.
 *
 *  `ever` is true once this hook has had an answer. A list shows its
 *  "Couldn't read" state only then (a failed filter change), never as the
 *  first thing a visitor sees. */
export function useTe(path, { method = 'GET', body, keep = false } = {}) {
  const key = path ? `${method} ${path} ${body ? JSON.stringify(body) : ''}` : null;
  const [state, setState] = useState({ key: null, data: null, error: null, loading: false, heldFrom: null });
  const [ever, setEver] = useState(false);
  useEffect(() => {
    if (!key) { setState({ key: null, data: null, error: null, loading: false, heldFrom: null }); return undefined; }
    let live = true;
    setState((s) => ({ key, data: keep ? s.data : null, error: null, loading: true, heldFrom: keep && s.data ? s.key : null }));
    teRead(path, { method, body }).then((r) => {
      if (!live) return;
      setState({ key, data: r.data ?? null, error: r.error ?? null, loading: false, heldFrom: null });
      if (r.data) setEver(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.key !== key) {
    // Never undimmed: with keep the old rows show only as stale; otherwise
    // nothing shows until this key's answer arrives.
    const held = keep && key ? state.data : null;
    return { data: held, error: null, loading: !!key, stale: !!held, ever };
  }
  const stale = state.loading && !!state.data && state.heldFrom !== null;
  return { data: state.data, error: state.error, loading: state.loading, stale, ever };
}

/** Is a list present and non-empty? */
export const hasRows = (a) => Array.isArray(a) && a.length > 0;
