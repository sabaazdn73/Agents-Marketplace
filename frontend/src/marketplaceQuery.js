/**
 * marketplaceQuery.js
 *
 * The marketplace grid's data access, shared by the web and mobile apps.
 *
 * WHY THIS EXISTS
 * ---------------
 * Both apps used to fetch `/api/agents` with no parameters, receive all 15,000
 * records as a single 15.7MB response, and do every filter, sort and count in
 * the browser. The endpoint took no chain or limit parameter, so there was no
 * way to ask for less. Three components did this on page load, which meant
 * every visitor pulled the whole catalogue no matter what they looked at.
 *
 * That payload is also the measured driver of the backend's OOM rate. See
 * docs/memory-ceiling.md: a payload that accidentally doubled took OOMs from
 * 0.40/hour to 3.00/hour.
 *
 * WHAT MOVED, AND WHAT DELIBERATELY DID NOT
 * -----------------------------------------
 * Filtering, sorting and paging moved to the server, because a page cannot be
 * cut correctly until the filters have been applied: filtering a page the
 * client already holds gives the wrong page rather than a slower one.
 *
 * The group and hackathon mappings did NOT move. Those are presentation
 * groupings over the fine-grained categories, and categoryGroups.js /
 * hackathonCategories.js remain the single definition. This module resolves an
 * active group to its concrete category list and sends that, so the server
 * never needs a copy of a table that would then be free to drift.
 */

import { useEffect, useRef, useState } from 'react';
import { CATEGORY_GROUPS } from './categoryGroups';
import { HACKATHON_CATEGORIES } from './hackathonCategories';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:8000';

export const PAGE_SIZE = 24;

// Same backoff discipline the old full-list fetch used, and for the same
// reason: the backend is OOM-killed and restarts in seconds, so a single fetch
// that lands in one of those windows should retry rather than render an error.
const RETRY_MS = [400, 900, 2000, 4000];

function categoriesForGroup(groupId) {
  return CATEGORY_GROUPS.find((g) => g.id === groupId)?.categories || [];
}

function categoriesForHackathon(hackathonId) {
  if (hackathonId === 'All') {
    return HACKATHON_CATEGORIES.flatMap((h) => h.categories);
  }
  return HACKATHON_CATEGORIES.find((h) => h.id === hackathonId)?.categories || [];
}

/**
 * Turns the grid's filter state into a query string.
 *
 * Exported on its own so it can be tested and so both apps build the identical
 * request from identical state.
 */
export function buildAgentsQuery({
  categoryView, activeGroup, activeCategory, activeHackathon,
  searchQuery, showUnclassified, onlyResponding, onlyVerified,
  sortKey, sortDir, page, pageSize = PAGE_SIZE,
}) {
  const p = new URLSearchParams();
  p.set('limit', String(pageSize));
  p.set('offset', String(Math.max(0, ((page || 1) - 1) * pageSize)));
  if (sortKey) p.set('sort', sortKey);
  if (sortDir) p.set('sort_dir', sortDir);

  // A specific fine-grained category beats any group narrowing, exactly as the
  // old client pipeline did: both filters applied, and the narrower one wins.
  if (activeCategory && activeCategory !== 'All') {
    p.set('category', activeCategory);
  } else if (categoryView === 'defi') {
    const cats = categoriesForHackathon(activeHackathon);
    if (cats.length) p.set('categories', cats.join(','));
  } else if (activeGroup && activeGroup !== 'All' && activeGroup !== 'Unclassified') {
    const cats = categoriesForGroup(activeGroup);
    if (cats.length) p.set('categories', cats.join(','));
  } else if (activeGroup === 'Unclassified') {
    p.set('category', 'Unclassified');
  }

  if (searchQuery) p.set('search', searchQuery);
  if (!showUnclassified) p.set('unclassified', 'false');
  if (onlyResponding) p.set('status', 'responding');
  if (onlyVerified) p.set('verified', 'true');
  return p.toString();
}

async function fetchWithRetry(url, isCancelled) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
    if (isCancelled()) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      const wait = RETRY_MS[attempt];
      if (wait == null) break;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}

/**
 * One page of agents under the current filters, plus the totals that describe
 * the whole filtered set rather than just this page.
 *
 * `total` and `tiers` come back with the page because both describe the
 * current selection, and computing them costs the server a walk over integers
 * it already holds. The alternative, a second request per filter change, would
 * be two round trips to render one grid.
 */
export function useMarketplacePage(filters, mapAgent) {
  const [state, setState] = useState({
    agents: [], total: 0, tiers: null,
    loading: true, error: null, refreshing: false, confirmedFresh: false,
  });
  const query = buildAgentsQuery(filters);
  // A ref, not state: this tracks whether anything has ever loaded so a filter
  // change shows the previous page dimmed rather than an empty grid, and it
  // must not itself trigger a render.
  const hasLoaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, refreshing: hasLoaded.current, loading: !hasLoaded.current }));
    fetchWithRetry(`${API_BASE_URL}/api/agents?${query}`, () => cancelled)
      .then((data) => {
        if (cancelled || data == null) return;
        hasLoaded.current = true;
        setState({
          agents: (data.agents || []).map(mapAgent),
          total: data.total ?? 0,
          tiers: data.tiers || null,
          loading: false, error: null, refreshing: false, confirmedFresh: true,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep whatever is on screen. An empty grid is a worse answer than a
        // stale one when the backend is simply mid-restart.
        setState((s) => ({
          ...s, refreshing: false, loading: false, confirmedFresh: true,
          error: hasLoaded.current ? null : err.message,
        }));
      });
    return () => { cancelled = true; };
  }, [query, mapAgent]);

  // setAgents is exposed because the grid mutates the agent it is showing (a
  // revoked session clears on one card). That edit belongs to the page on
  // screen and must not trigger a refetch.
  const setAgents = (fn) => setState((s) => ({
    ...s, agents: typeof fn === 'function' ? fn(s.agents) : fn,
  }));
  return { ...state, setAgents };
}

/**
 * The mobile grid's "load more" list: pages accumulated into one array.
 *
 * Mobile appends rather than replacing, so this keeps what it has and fetches
 * the next offset. A filter change resets the accumulation, because the
 * previous rows no longer belong to the new selection.
 *
 * Deliberately not implemented as "ask for a bigger page each time": that
 * would re-download every row already on screen to add twelve, and the page
 * cap is 100 anyway.
 */
export function useMarketplaceInfinite(filters, mapAgent, pageSize = 12) {
  const [state, setState] = useState({
    agents: [], total: 0, tiers: null,
    loading: true, error: null, confirmedFresh: false, loadingMore: false,
  });
  // Everything except the offset. A change here means a different selection,
  // so the accumulated rows are discarded.
  const query = buildAgentsQuery({ ...filters, page: 1, pageSize });
  const [offset, setOffset] = useState(0);

  useEffect(() => { setOffset(0); }, [query]);

  useEffect(() => {
    let cancelled = false;
    const url = `${API_BASE_URL}/api/agents?${query}&offset=${offset}`;
    setState((s) => ({ ...s, loadingMore: offset > 0, loading: offset === 0 && !s.confirmedFresh }));
    fetchWithRetry(url, () => cancelled)
      .then((data) => {
        if (cancelled || data == null) return;
        const rows = (data.agents || []).map(mapAgent);
        setState((s) => ({
          agents: offset === 0 ? rows : [...s.agents, ...rows],
          total: data.total ?? 0,
          tiers: data.tiers || null,
          loading: false, error: null, confirmedFresh: true, loadingMore: false,
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setState((s) => ({
          ...s, loading: false, loadingMore: false, confirmedFresh: true,
          error: s.agents.length ? null : err.message,
        }));
      });
    return () => { cancelled = true; };
  }, [query, offset, mapAgent]);

  const setAgents = (fn) => setState((s) => ({
    ...s, agents: typeof fn === 'function' ? fn(s.agents) : fn,
  }));
  const loadMore = () => setOffset((o) => o + pageSize);
  const hasMore = state.agents.length < state.total;
  return { ...state, setAgents, loadMore, hasMore };
}

/** Resolves one agent by id or token_id, for the ?agent= deep link. */
export async function fetchAgentById(agentId) {
  const res = await fetch(
    `${API_BASE_URL}/api/agents/by-id?agent_id=${encodeURIComponent(agentId)}`
  );
  if (!res.ok) return null;
  const d = await res.json();
  return d.agent || null;
}

/**
 * Catalogue-wide counts: the stat cards, the group and category chips, and
 * which categories exist at all.
 *
 * Fetched once and unfiltered, because everything it feeds describes the whole
 * marketplace rather than the current view. `real_names_only=false` keeps these
 * numbers identical to what the client produced when it counted the raw array
 * itself, so this change moves bytes without moving any number on the page.
 */
export function useMarketplaceFacets() {
  const [facets, setFacets] = useState({
    total: 0, categories: [], tiers: null, totalFeedbacks: 0, loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    fetchWithRetry(`${API_BASE_URL}/api/agents/facets?real_names_only=false`, () => cancelled)
      .then((d) => {
        if (cancelled || d == null) return;
        setFacets({
          total: d.total || 0,
          categories: d.categories || [],
          tiers: d.tiers || null,
          totalFeedbacks: d.total_feedbacks || 0,
          loaded: true,
        });
      })
      .catch(() => { if (!cancelled) setFacets((f) => ({ ...f, loaded: true })); });
    return () => { cancelled = true; };
  }, []);

  return facets;
}

/** Rolls fine-grained category counts up into the presentation groups. */
export function groupCountsFromFacets(categories) {
  const counts = { Unclassified: 0 };
  for (const g of CATEGORY_GROUPS) counts[g.id] = 0;
  const toGroup = {};
  for (const g of CATEGORY_GROUPS) for (const c of g.categories) toGroup[c] = g.id;
  for (const { category, count } of categories || []) {
    const g = toGroup[category];
    if (g) counts[g] += count; else counts.Unclassified += count;
  }
  return counts;
}

/** Per-hackathon counts, same roll-up against the other mapping. */
export function hackathonCountsFromFacets(categories) {
  const toHack = {};
  for (const h of HACKATHON_CATEGORIES) for (const c of h.categories) toHack[c] = h.id;
  const counts = {};
  for (const { category, count } of categories || []) {
    const h = toHack[category];
    if (h) counts[h] = (counts[h] || 0) + count;
  }
  return counts;
}
