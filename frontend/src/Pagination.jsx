// Pagination.jsx
//
// Real numbered pagination for the web Marketplace grid/table — reference:
// mercor.com's own real, live listing page (work.mercor.com/jobs), fetched
// and read before building this, not guessed at from scratch: real
// numbered pages with Previous/Next at the ends ("Previous | 1 | 2 | 3 | 4
// | … | 24 | 25 | Next"), which is exactly the shape this reproduces.
//
// Purely client-side — the caller already has the FULL filtered/sorted list
// in memory (this project's known_agents list is fetched once, in full,
// and cached in localStorage; see useMarketplaceAgents in
// AgentMarketplaceApp.web.jsx), so this only ever slices an array already
// on the page. No backend pagination needed for a set this size.

import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Always includes page 1, the last page, and current±1; "…" fills real
 * gaps — the same shape real numbered pagination (Mercor's included)
 * uses so the control never grows unboundedly wide for a large page count. */
function pageNumbers(current, total) {
  const keep = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  let prev = null;
  for (const p of sorted) {
    if (prev != null && p - prev > 1) out.push(`e${p}`);
    out.push(p);
    prev = p;
  }
  return out;
}

export default function Pagination({ page, pageCount, onChange }) {
  if (pageCount <= 1) return null;
  const nums = pageNumbers(page, pageCount);
  return (
    <div className="flex items-center justify-center gap-1.5 mt-10 flex-wrap" role="navigation" aria-label="Pagination">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <ChevronLeft size={14} /> Previous
      </button>
      {nums.map((n) => (typeof n === 'string' && n.startsWith('e')) ? (
        <span key={n} className="px-1.5 text-xs text-gray-400 select-none">…</span>
      ) : (
        <button
          key={n}
          onClick={() => onChange(n)}
          aria-current={n === page ? 'page' : undefined}
          className={`min-w-[32px] px-2.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
            n === page
              ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 border border-transparent'
          }`}
        >
          {n}
        </button>
      ))}
      <button
        onClick={() => onChange(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}
