// useChainView.js
//
// Shared data access for every non-BSC chain view.
//
// Each view (Ethereum, Solana, Multi-Chain) owns its own presentation but
// they all read the same paginated backend surface, so the fetching lives
// here once rather than being copied three times. The BSC view is NOT a
// consumer of this: it keeps its own existing hook and its own endpoint,
// untouched.
//
// Deliberately paginated and uncached. /api/chain-view/{view} is a bounded
// skip/limit read on the backend precisely so displaying these chains adds
// no resting memory to a service that has been OOM-prone all day. Holding
// every page in the browser forever would move that problem rather than
// avoid it, so this keeps only what has been scrolled to and starts fresh
// when the view changes.

import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const CHAIN_VIEW_PAGE_SIZE = 24;

/** The view list (labels, counts, hireable/coming-soon flags) straight from
 * the backend, so the UI never hardcodes which chains exist or whether one
 * can be hired from. */
export function useChainViewIndex() {
  const [state, setState] = useState({ loading: true, views: [], error: null });
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/chain-views`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setState({ loading: false, views: d.views || [], error: null }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, views: [], error: e.message }); });
    return () => { cancelled = true; };
  }, []);
  return state;
}

/** One view's agents, paginated. `loadMore()` appends the next page.
 *
 * Returns `hireable` and `comingSoon` from the backend rather than deriving
 * them locally: whether a chain can be hired from is a backend fact (escrow
 * is deployed on BSC only), and a view should not be able to disagree with
 * it by accident. */
export function useChainView(viewId) {
  const [agents, setAgents] = useState([]);
  const [meta, setMeta] = useState({ hireable: false, comingSoon: false, label: '', statusNote: '', verifiedChains: [], unverifiedChains: [], capabilities: null, hire_paths: null, total: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const offsetRef = useRef(0);
  const [page, setPage] = useState(1);

  const fetchPage = useCallback(async (offset, append) => {
    const res = await fetch(`${API_BASE_URL}/api/chain-view/${viewId}?offset=${offset}&limit=${CHAIN_VIEW_PAGE_SIZE}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    setMeta({
      hireable: !!d.hireable,
      comingSoon: !!d.coming_soon,
      label: d.label || '',
      statusNote: d.status_note || '',
 // Which of this view's chains are genuinely health-checked. Comes
      // from the backend so the UI cannot claim more than the data layer.
      verifiedChains: d.verified_chains || [],
      unverifiedChains: d.unverified_chains || [],
 // Which evaluation signals this view can genuinely produce, and the
 // reason for each one it cannot. From the backend so the UI
      // cannot claim a signal the data layer has no way to compute.
      capabilities: d.capabilities || null,
      // Which hire paths work for this view, per path and per chain. Named
      // explicitly like everything else here: this object is built field by
      // field rather than spread from the response, so a new backend field
      // is invisible to the UI until it is added on this line. That is what
      // hid hire_paths on first wiring.
      hire_paths: d.hire_paths || null,
      // Total agents in this view, so a hireable chain can show numbered
      // pages instead of an open-ended "load more".
      total: typeof d.total === 'number' ? d.total : null,
    });
    setAgents((prev) => (append ? [...prev, ...(d.agents || [])] : (d.agents || [])));
    setHasMore(!!d.has_more);
    offsetRef.current = offset + (d.agents || []).length;
  }, [viewId]);

  useEffect(() => {
    if (!viewId) return;
    let cancelled = false;
    setLoading(true); setError(null); setAgents([]); offsetRef.current = 0; setPage(1);
    fetchPage(0, false)
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [viewId, fetchPage]);

  /** Jump to a numbered page, replacing the list rather than appending.
   *
   * The read-only theme keeps loadMore below; a hireable chain uses this.
   * Both go through the same fetchPage, so the two themes cannot end up
   * fetching differently, only presenting differently. */
  const goToPage = useCallback((pageNumber) => {
    const n = Math.max(1, Number(pageNumber) || 1);
    setLoading(true); setError(null);
    fetchPage((n - 1) * CHAIN_VIEW_PAGE_SIZE, false)
      .then(() => { setPage(n); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fetchPage]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    fetchPage(offsetRef.current, true)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMore(false));
  }, [fetchPage, hasMore, loadingMore]);

  return { agents, ...meta, loading, loadingMore, hasMore, error, loadMore,
    page, goToPage, pageSize: CHAIN_VIEW_PAGE_SIZE };
}
