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
//   GET /api/te/summary   (T2, with T3a's cost counts)
//     { underlyings (stocks and ETFs), versions_listed (issuer-by-chain
//       tokens), versions_with_pool (a pool FOUND, not a cost), issuers,
//       chains, tokens (= versions; not a count of equities), computed_at,
//       chain_list: [{ name, group: 'evm'|'nonevm', tokens }],
//       cost: { versions_with_cost (best pool fills a $1,000 buy),
//               versions_measured, by_chain: [...], definition,
//               computed_at } | { versions_with_cost: null, reason } }
//   (eligibility and who_may_hold are always { text, url, read_on }: the
//    issuer's own words, linked and dated, never shown without both.)
//   GET /api/te/list?type=stock|etf&group=all|evm|nonevm&limit=&sort=&offset=   (T3a)
//     { rows: [{ underlying, name, type, versions, eligibility,
//                best: { key, symbol, issuer, chain, group, block,
//                        computed_at, us_market_open, allin_per_share,
//                        allin_per_token, tokens_per_1000, share_ratio,
//                        cost_usd, cost_bps, paid_per_token, pool_usd
//                        (±2% depth), ref_gap_bps, ref_gap_flag },
//                spark: [number] | null, spark_reason }],
//       sort, sort_requested, sort_reason?, size, type, group,
//       group_note?, computed_at, rows_total, offset, limit, next_offset,
//       rows_without_filled_version,
//       rows_not_ranked: { count, underlyings, reason },
//       underlyings_without_type, lifi_fee_included, method, coverage,
//       best_rule }
//   GET /api/te/search?q=   (T2)
//     { q, computed_at, total_matches?, reason? (e.g. "empty query"),
//       coverage: { instruments, vaults: string|null, vaults_reason? },
//       results: [{ kind: 'instrument', underlying, symbol, name, type,
//                   versions, issuers: [string], chains: [string],
//                   groups, match: 'ticker'|'name'|'symbol'|'address',
//                   issuer?, chain? (single-version match only),
//                   matched_versions?: [{ key, symbol, issuer, chain,
//                     group, address, listed, not_listed_reason? }] }],
//       unlisted_matches?: [{ underlying?, symbol?, name?, issuer?,
//                             chain?, reason }] }
//   GET /api/te/underlying/{ticker}?size=1000   (T3a)
//     { ticker, name, type, size, computed_at, best: { key, cost_bps } | null,
//       best_rule, blocks: [{ chain_id, block }], lifi_fee_included,
//       method, coverage,
//       versions: [{ key, symbol, issuer, chain, chain_id, group, block,
//                    computed_at, us_market_open, share_ratio,
//                    share_ratio_basis, comparable (ratio read),
//                    ref_gap_bps, ref_gap_flag, ref_gap_basis,
//                    state: 'filled'|'partial'|'failed'|'too_thin'|
//                           'not_a_venue'|'not_searched'|'no_pool'|'held',
//                    reason (every state but filled),
//                    allin_per_share, allin_per_token, tokens_per_1000,
//                    cost_usd, cost_bps, paid_per_token, filled_fraction,
//                    pool_usd (±2% depth; the fill for a partial),
//                    eligibility, controls, pool_search? }] }
//   GET /api/te/curve/{ticker}   (T3a)
//     { ticker, stops: [usd], computed_at, best_rule, lifi_fee_included,
//       chains: [{ chain, chain_id, group, symbol, issuer,
//                  bps: [number|null] (cost_bps of the best ranked
//                  version), pool_usd: [number|null], keys, symbols,
//                  null_reason: [string|null], version_states,
//                  block, computed_at }],
//       chains_without_pool: [{ chain, chain_id, group, symbols, states,
//                               state, reasons }] }
//   GET /api/te/controls?by=issuer
//     { computed_at, rows: [{ programme, issuer, chains: [string],
//         pause, freeze, burn, upgrade: { text, state? },
//         who_may_hold: { text, url, read_on } }] }
//   BASKETS (T7, branch te-baskets, c05df08). Every route takes size= (one of the
//   11 measured stops, default 1000; anything else answers 400 with
//   allowed_size). An error answers { error, reason, rule? } with 400
//   (a bad basket or size), 404 (no curated basket has this code) or 503
//   (the cost store could not be read; `about` says it is the store, not
//   the basket). teRead passes that body on as `body` (useTe: errorBody).
//
//   A BREAKDOWN is what the three routes share for one basket at one size:
//     { size, legs: [LEG], complete, cost_bps | null, cost_usd | null,
//       cost_reason (why cost_bps is null), unfilled_legs: [{ ticker,
//       measured_at_usd, reason }], size_exact, signatures, evm, nonevm,
//       (signatures counts priced legs only), legs_unresolved (legs with
//       no priced version), by_chain: [{ chain, chain_id, group, legs: [ticker],
//       swaps, approvals_up_to }], prompts: { swaps, approvals_up_to,
//       signatures_up_to, chain_switches, basis, partial?, missing? },
//       cap_usd | null, cap_leg, cap_legs (every tied limiting leg, or the
//       legs with no cap), cap_lower_bound ("at least": a limiting leg is
//       under the threshold at the largest size measured), cap_reason (why
//       cap_usd is null), threshold_bps, computed_at, blocks,
//       cost_at_size?: { stops, bps: [number|null], null_reason:
//       [string|null] (each gap's own reason), basis },
//       best_rule, size_basis, cost_basis, cap_basis, lifi_fee_included,
//       coverage, engine_computed_at, source }
//   LEG: { ticker, symbol, weight_bps, leg_usd (size x weight),
//     measured_at_usd (the smallest measured size at or above leg_usd,
//     where the leg is priced), size_exact (leg_usd is itself a measured
//     size; the page says "priced at the $250 measured size" when not),
//     below_smallest_stop (leg_usd under $100: costed from the parts
//     measured at $100), state: 'filled'|'not_ranked'|'unfilled' (any
//     other state is named as served), pinned (the visitor chose this
//     version; an unfilled pinned leg still names it), reason (every state
//     but filled), and when filled: key (as /api/te/underlying serves it),
//     issuer, chain, chain_id, group, cost_bps (the engine's, at
//     measured_at_usd), cost_usd_measured, cost_parts, allin_per_share,
//     allin_per_token, paid_per_token, block, computed_at, us_market_open,
//     leg_cost_bps and leg_cost_usd (what the leg itself costs; the basket
//     cost is their weighted sum), leg_cost_basis (how, in words); always:
//     cap_stop_usd, cap_usd (the largest basket this leg allows under the
//     threshold), cap_lower_bound ("at least"), cap_reason (why none) }
//
//   GET /api/baskets/curated?size=
//     { note, creator, size, file_version, selection_rule, best_rule,
//       size_basis, cost_basis, cap_basis, lifi_fee_included, coverage,
//       engine_computed_at, source, computed_at,
//       baskets: [BREAKDOWN without cost_at_size, plus { code, name,
//         version, created_at, cost_bps_1k }] }
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
//   GET /api/baskets/{code}?size=   (codes are lowercase with hyphens:
//     tech-4, sp500-nasdaq100, semis, gold-silver-tbills)
//     BREAKDOWN with cost_at_size, plus { code, name, creator,
//       creator_kind: 'curated' (drawn as "Tnega (curated)", never as an
//       address) | an address kind, created_at, version, description, note,
//       value_usd_indicative | null, value_basis, return_since_creation_pct
//       | null, return_source, return_basis, series | null,
//       followers_count | null, followers | null, followers_basis,
//       changes: [{ version, at, note, legs: [{ ticker, weight_bps }] }]
//       (a leg names an underlying, never a version),
//       changes_basis }
//   GET /api/baskets/evaluate?b=<base64url>&size=  or  ?legs=TICKER:bps,...
//     Exactly one of b and legs. b is base64url JSON {v:1, legs:[{t, k?,
//     w}]} without padding (baskets/codec.js), k a version key exactly as
//     /api/te/underlying serves it; the builder always sends b, so a pin
//     is priced. A basket someone built, priced and not stored: BREAKDOWN
//     with cost_at_size, plus { legs_param (tickers and weights only),
//     legs_param_basis, b_param (the canonical link, carrying pins; the
//     share link is built from it, or from the page's own identical
//     encoding, never from legs_param), pinned: {ticker: key} | null,
//     stored: false, stored_basis }. The backend accepts b padded or not,
//     and refuses a JSON object with a repeated key. A 400 names what is
//     wrong in `reason`, with `rule` or `allowed_size`.
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

// A dev server started with TE_API=<origin> reads that backend instead,
// with the fixtures off (dataLive.js, vite.config.js). Dev only: a build
// defines __TE_DEV_API__ as "".
const DEV_API = (import.meta.env.DEV && typeof __TE_DEV_API__ !== 'undefined' && __TE_DEV_API__) || null;
const API_BASE_URL = DEV_API || import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

const USE_FIXTURES = import.meta.env.DEV && import.meta.env.VITE_TE_FIXTURES === '1' && !DEV_API;

async function fixtureFor(path, body) {
  if (!USE_FIXTURES) return null;
  const m = await import('./fixtures.dev.js');
  return m.answer(path, body);
}

/** One read. Resolves to { data } with the parsed JSON, or { error } with
 *  why it failed (a non-200 status or a network failure). A non-200 answer
 *  also carries its parsed body, when it has one, as `body`: the baskets
 *  routes explain a 400 in body.reason, and the builder shows it. */
export async function teRead(path, { method = 'GET', body } = {}) {
  if (USE_FIXTURES) {
    const d = await fixtureFor(path, body);
    // A path the fixtures do not know answers as the API would: not found.
    // A fixture may answer with an error status and body, as the API does.
    if (d && d.__status) return { error: `HTTP ${d.__status}`, status: d.__status, body: d.__body };
    return d ? { data: d } : { error: 'HTTP 404', status: 404 };
  }
  try {
    const r = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      let errBody = null;
      try { errBody = await r.json(); } catch { errBody = null; }
      return { error: `HTTP ${r.status}`, status: r.status, body: errBody };
    }
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
      setState({ key, data: r.data ?? null, error: r.error ?? null, errorBody: r.body ?? null, loading: false, heldFrom: null });
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
  return { data: state.data, error: state.error, errorBody: state.errorBody || null, loading: state.loading, stale, ever };
}

/** Is a list present and non-empty? */
export const hasRows = (a) => Array.isArray(a) && a.length > 0;
