// DocsFooter.jsx
//
// Small attribution-strip footer pointing at the self-hosted /docs section
// built from the docs/*.md files.
//
// Not rendered anywhere at present. The foot of the page carried three of
// these strips and now carries none: docs and the attribution page are both
// named links in SiteLinks, which sits under the wallet area where someone
// is already looking.
import React from 'react';
import { BookOpen } from 'lucide-react';

export default function DocsFooter({ onOpenDocs, className = '' }) {
  if (!onOpenDocs) return null;
  return (
    <footer className={`border-t border-gray-200 dark:border-gray-800 mt-6 pt-6 pb-4 ${className}`}>
      <button
        onClick={onOpenDocs}
        className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        <BookOpen size={13} />
        <span className="font-semibold uppercase tracking-wider">Full documentation</span>
        <span className="text-indigo-500">→</span>
      </button>
    </footer>
  );
}
