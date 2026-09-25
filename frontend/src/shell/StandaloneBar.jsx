// StandaloneBar.jsx
//
// The top row of every page that renders outside the app shell (Status,
// Privacy, Data Sources, Partners, Docs, Canary, Ecosystem). Those routes
// return before the web/mobile split in App.jsx, so neither app's header is
// on screen, and without this they would have no theme control at all.
//
// Back on the left, the theme control on the right. One component, so the
// standalone pages cannot each grow a slightly different version.

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import ThemeToggle from '../theme/ThemeToggle';

export default function StandaloneBar({ onBack, backLabel = 'Back to Dashboard', className = 'mb-8', children = null }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-3 min-w-0">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 text-body font-medium text-muted hover:text-fg transition-colors"
          >
            <ArrowLeft size={16} aria-hidden="true" /> {backLabel}
          </button>
        )}
        {children}
      </div>
      <ThemeToggle />
    </div>
  );
}
