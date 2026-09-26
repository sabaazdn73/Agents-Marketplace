// TopSearch.jsx
//
// The search field at the top of both apps: "Search stocks, ETFs or vaults".
// Until the instrument list exists (build step 2) it searches nothing here;
// submitting opens Stocks & ETFs with the words in the URL (/stocks?q=), and
// that page says plainly that nothing is listed yet. One component, so the
// web header and the mobile search row behave the same.

import React, { useState } from 'react';
import { Search } from 'lucide-react';

export const SEARCH_PLACEHOLDER = 'Search stocks, ETFs or vaults';

export function searchPath(q) {
  const t = (q || '').trim();
  return t ? `/stocks?q=${encodeURIComponent(t)}` : '/stocks';
}

export default function TopSearch({ onSearch, initial = '', autoFocus = false, className = '' }) {
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      onSubmit={(e) => { e.preventDefault(); onSearch(searchPath(q)); }}
      className={`h-10 flex items-center gap-2 px-3 rounded bg-field text-fg ${className}`}
    >
      <Search size={16} className="shrink-0 text-muted" aria-hidden="true" />
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={SEARCH_PLACEHOLDER}
        aria-label={SEARCH_PLACEHOLDER}
        autoFocus={autoFocus}
        className="flex-1 min-w-0 bg-transparent text-body text-fg placeholder:text-muted outline-none"
      />
    </form>
  );
}
