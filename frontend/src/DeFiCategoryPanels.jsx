// DeFiCategoryPanels.jsx
//
// The four DeFi categories as one uniform set: a row of titles, and
// expanding one opens a panel with that category's detail. Same shape for
// all four, so none of them reads as the one added last.
//
// THE STATE RULE THIS FILE EXISTS TO ENFORCE
// A panel is mounted the first time it is opened and is NEVER unmounted
// afterwards. Collapsing hides it with CSS. That is the whole design, and
// it is deliberate:
//
//   - the cards read the chain on mount (lending positions, balances, the
//     pool's slot0). Unmounting on collapse would throw that away and
//     re-read it on every reopen, which is the stray refetch this is meant
//     to avoid.
//   - a half-filled form in one panel survives opening another.
//   - wallet connection lives in wagmi's provider above this component, so
//     it is untouched by any of this either way. What would NOT survive an
//     unmount is the per-card read derived from it, which is exactly what
//     staying mounted preserves.
//
// So `hidden` here is a CSS state, not a mount state. Using conditional
// rendering instead would be the obvious way to write this and would
// reintroduce the refetch on every expand.

import React, { useCallback, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function DeFiCategoryPanels({ categories, accent, surface, mutedBorder }) {
  // One open at a time. null means all collapsed.
  const [openKey, setOpenKey] = useState(categories[0]?.key ?? null);
  // Every key ever opened. Only grows, so nothing already mounted unmounts.
  const [mounted, setMounted] = useState(
    () => new Set(categories[0]?.key ? [categories[0].key] : []),
  );

  const toggle = useCallback((key) => {
    setMounted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setOpenKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <div className="space-y-2">
      {categories.map(({ key, title, icon: Icon, badge, render }) => {
        const isOpen = openKey === key;
        const isMounted = mounted.has(key);
        return (
          <div
            key={key}
            className={`rounded-2xl border overflow-hidden ${mutedBorder}`}
            style={{ background: surface }}
          >
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-expanded={isOpen}
              aria-controls={`defi-panel-${key}`}
              className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                {Icon && (
                  <span className="p-1.5 rounded-lg shrink-0" style={{ background: `${accent}1a` }}>
                    <Icon size={16} style={{ color: accent }} />
                  </span>
                )}
                <span className="font-bold text-sm truncate">{title}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {badge && (
                  <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    {badge}
                  </span>
                )}
                <ChevronDown
                  size={16}
                  className={`opacity-50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
              </span>
            </button>

            {/* Mounted once, then only hidden. See the note at the top of
                this file: conditional rendering here would re-read the
                chain every time a panel is reopened. */}
            {isMounted && (
              <div
                id={`defi-panel-${key}`}
                hidden={!isOpen}
                className="px-5 pb-5 pt-1 border-t border-gray-100 dark:border-gray-800/60 max-h-[50vh] overflow-y-auto"
              >
                {render()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
