// DocsFooter.jsx
//
// Small attribution-strip footer, styled identically to
// DataSourcesFooter.jsx / HackathonPartnersFooter.jsx, pointing at the
// real self-hosted /docs section built from the actual docs/*.md files.
// Shared by web + mobile.
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
