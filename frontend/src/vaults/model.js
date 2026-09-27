// vaults/model.js
//
// Reading T6's vault rows (GET /api/vaults) the same way everywhere: the
// list, the detail and the home page's table.

/** The platform key. T6's rows carry key "<platform>/<address>" and may not
 *  carry platform_key; both are supported. */
export const platformKeyOf = (v) => v?.platform_key || String(v?.key || '').split('/')[0] || null;

/** Stale: T6 marks the TVL stale when the vault last wrote it more than its
 *  rule allows (tvl_stale, tvl_stale_rule), and the whole read stale when
 *  the latest chain read failed (read_stale). */
export function staleOf(v) {
  if (!v) return null;
  if (v.read_stale) return 'The latest chain read of this vault failed; these figures are from the previous read.';
  if (v.tvl_stale) {
    const rule = v.tvl_stale_rule ? ` (${v.tvl_stale_rule})` : '';
    return v.tvl_source === 'vault_recorded'
      ? `The vault's recorded total is stale${rule}.`
      : `Our computed figure is stale${rule}.`;
  }
  // T6's per-row `stale` is tvl_stale OR read_stale; kept in case a reason
  // field is missing.
  if (v.stale) return 'Stale by the backend\'s rule.';
  return null;
}

/** When the TVL figure was made: computed by T6 (tvl_computed_at, Kamino
 *  and GLAM) or written by the vault itself (tvl_recorded_at, Voltr).
 *  tvl_last_written is the older name, still read. */
export function tvlTime(v) {
  if (!v) return null;
  if (v.tvl_source === 'vault_recorded') {
    const t = v.tvl_recorded_at || v.tvl_last_written;
    return t ? { label: 'recorded', at: String(t) } : null;
  }
  const t = v.tvl_computed_at;
  return t ? { label: 'computed', at: String(t) } : null;
}

export function tvlSourceLabel(src) {
  return src === 'computed_from_chain' ? 'computed from chain' : src === 'vault_recorded' ? 'as recorded by the vault' : null;
}

/** The check column: ✓ the TVL reconciles with the vault's own records;
 *  ⚠ it is the vault's own record, not reconciled, or stale; ? partial. */
export function checkMark(v) {
  if (v.tvl_partial) return { mark: '?', label: 'Partial read: some positions could not be valued' };
  const st = staleOf(v);
  if (st) return { mark: '⚠', label: st };
  if (v.tvl_source === 'computed_from_chain' && /^reconciles/.test(v.tvl_reconciliation || '')) return { mark: '✓', label: v.tvl_reconciliation };
  return { mark: '⚠', label: v.tvl_reconciliation || 'Not reconciled' };
}

/** The total TVL of the rows shown, counting each dollar once. A vault
 *  listed inside another listed vault (nested_in, with the tokens it holds
 *  there) is already part of that vault's TVL, so those tokens are taken
 *  off once; only when the parent is among the rows. Stablecoin tokens are
 *  counted at 1 USD, as T6 counts them. */
export function tvlTotal(vaults) {
  const byAddr = new Set(vaults.map((v) => v.address));
  let gross = 0;
  let nested = 0;
  let nestedRows = 0;
  for (const v of vaults) {
    if (Number.isFinite(v.tvl_usd)) gross += v.tvl_usd;
    const inside = (v.nested_in || []).filter((n) => byAddr.has(n.address) && Number.isFinite(n.tokens));
    if (inside.length) { nestedRows += 1; nested += inside.reduce((a, n) => a + n.tokens, 0); }
  }
  const stale = vaults.filter((v) => staleOf(v)).length;
  const bySource = vaults.reduce((a, v) => ({ ...a, [v.tvl_source]: (a[v.tvl_source] || 0) + 1 }), {});
  const hasNesting = vaults.some((v) => (v.nested_in || []).length || (v.contains_nested || []).length);
  return { total: gross - nested, gross, nested, nestedRows, stale, bySource, hasNesting };
}
