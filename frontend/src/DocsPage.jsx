// DocsPage.jsx
//
// Self-hosted documentation viewer at /docs — GitBook-style: a sidebar
// listing every real page from docs/SUMMARY.md (in that file's real
// order), a content pane rendering the selected page's real markdown.
// Renders the actual docs/*.md files directly — nothing here duplicates
// or rewrites that content, this is only a renderer for it.
//
// Content source, and why: docs/ lives at the repo root, a sibling of
// frontend/, and is static, versioned content that changes only when a
// commit changes it — not runtime data. So it's bundled at BUILD TIME via
// Vite's `import.meta.glob(..., { query: '?raw' })` rather than served
// from a new backend route: a backend endpoint would mean either
// duplicating these files into the backend's own tree or re-reading disk
// on every request for content that's genuinely fixed per-deploy, plus an
// extra network round trip with nothing gained. Bundling means the docs
// ship on the same CDN, in the same deploy, as everything else describing
// them — simpler and more honestly "static" given how this repo is
// actually laid out. (See vite.config.js's `server.fs.allow` — required
// in dev only, to let Vite's dev server read one directory above
// frontend/; the production build resolves these at build time
// regardless of that setting.)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Menu, X, ExternalLink } from 'lucide-react';
import { parseDocsMarkdown } from './docsMarkdown';

const docModules = import.meta.glob('../../docs/*.md', { eager: true, query: '?raw', import: 'default' });

// filename (e.g. "README.md") -> raw markdown content
const DOCS = {};
for (const [modPath, content] of Object.entries(docModules)) {
  DOCS[modPath.split('/').pop()] = content;
}

function filenameToSlug(filename) {
  if (/^README\.md$/i.test(filename)) return '';
  return filename.replace(/\.md$/i, '').toLowerCase();
}

function slugToFilename(slug) {
  if (!slug) return 'README.md';
  return Object.keys(DOCS).find((f) => filenameToSlug(f) === slug) || 'README.md';
}

// Real nav order comes from parsing docs/SUMMARY.md itself — its one list
// block's link items, in file order — rather than a hardcoded copy that
// could drift out of sync with it.
const NAV_ITEMS = (() => {
  const summary = DOCS['SUMMARY.md'];
  if (!summary) return [];
  const listBlock = parseDocsMarkdown(summary).find((b) => b.type === 'list');
  if (!listBlock) return [];
  return listBlock.items
    .map((inline) => inline.find((p) => p.t === 'link'))
    .filter(Boolean)
    .map((link) => ({ title: link.v, filename: link.href, slug: filenameToSlug(link.href) }));
})();

// Real mermaid.js, lazy-loaded only when a /docs page with a diagram is
// actually opened — matching the code-splitting pattern already used for
// EcosystemGlobePage.jsx's three.js, so no visitor pays for this unless
// they open /docs.
let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid').then((m) => m.default);
  return mermaidPromise;
}
let mermaidCounter = 0;

function MermaidDiagram({ code }) {
  const [svg, setSvg] = useState(null);
  const [error, setError] = useState(null);
  const idRef = useRef(`docs-mermaid-${++mermaidCounter}`);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => {
        mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'strict', fontFamily: 'inherit' });
        return mermaid.render(idRef.current, code);
      })
      .then(({ svg: renderedSvg }) => { if (!cancelled) setSvg(renderedSvg); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'diagram failed to render'); });
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <pre className="text-xs bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-3 rounded-lg overflow-x-auto my-5 whitespace-pre-wrap">
        Diagram failed to render ({error})
      </pre>
    );
  }
  if (!svg) {
    return (
      <div className="text-xs text-gray-400 dark:text-gray-500 py-8 text-center my-5 border border-dashed border-gray-200 dark:border-gray-800 rounded-xl">
        Rendering diagram…
      </div>
    );
  }
  return (
    <div
      className="my-6 flex justify-center overflow-x-auto bg-white dark:bg-[#1E293B] rounded-xl border border-gray-200 dark:border-gray-800 p-4"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function InlineContent({ parts, onNavigate }) {
  return parts.map((p, i) => {
    if (p.t === 'text') return <React.Fragment key={i}>{p.v}</React.Fragment>;
    if (p.t === 'bold') return <strong key={i} className="font-semibold text-gray-900 dark:text-white">{p.v}</strong>;
    if (p.t === 'italic') return <em key={i}>{p.v}</em>;
    if (p.t === 'code') {
      return (
        <code key={i} className="text-[0.85em] bg-gray-100 dark:bg-gray-800 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 rounded font-mono">
          {p.v}
        </code>
      );
    }
    if (p.t === 'link') {
      // Real internal doc link (e.g. "architecture.md" or
      // "features.md#advantage-report") — resolved within /docs, not left
      // to 404 or point at GitHub.
      const docMatch = p.href.match(/^([\w-]+\.md)(#[\w-]*)?$/i);
      if (docMatch) {
        const slug = filenameToSlug(docMatch[1]);
        const hash = (docMatch[2] || '').slice(1);
        return (
          <a
            key={i}
            href={`/docs${slug ? '/' + slug : ''}${hash ? '#' + hash : ''}`}
            onClick={(e) => { e.preventDefault(); onNavigate(slug, hash); }}
            className="text-indigo-500 hover:underline"
          >
            {p.v}
          </a>
        );
      }
      // Same-page anchor
      if (p.href.startsWith('#')) {
        const hash = p.href.slice(1);
        return (
          <a key={i} href={p.href} onClick={(e) => { e.preventDefault(); onNavigate(undefined, hash); }} className="text-indigo-500 hover:underline">
            {p.v}
          </a>
        );
      }
      // Real external link
      return (
        <a key={i} href={p.href} target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline inline-flex items-center gap-0.5">
          {p.v}<ExternalLink size={10} />
        </a>
      );
    }
    return null;
  });
}

const HEADING_SIZE = {
  1: 'text-2xl mt-1 mb-5 pb-4 border-b border-gray-200 dark:border-gray-800',
  2: 'text-xl mt-10 mb-3',
  3: 'text-base mt-7 mb-2',
  4: 'text-sm mt-6 mb-2',
};

function DocContent({ filename, onNavigate }) {
  const blocks = useMemo(() => parseDocsMarkdown(DOCS[filename] || `# Not found\n\nThis page doesn't exist.`), [filename]);
  return (
    <div>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const Tag = `h${b.level}`;
          return (
            <Tag key={i} id={b.id} className={`font-bold scroll-mt-24 ${HEADING_SIZE[b.level]}`}>
              <InlineContent parts={b.inline} onNavigate={onNavigate} />
            </Tag>
          );
        }
        if (b.type === 'paragraph') {
          return (
            <p key={i} className="text-sm leading-relaxed text-gray-600 dark:text-gray-300 mb-4">
              <InlineContent parts={b.inline} onNavigate={onNavigate} />
            </p>
          );
        }
        if (b.type === 'list') {
          const ListTag = b.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={i} className={`text-sm leading-relaxed text-gray-600 dark:text-gray-300 mb-4 pl-5 space-y-1.5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
              {b.items.map((item, j) => <li key={j}><InlineContent parts={item} onNavigate={onNavigate} /></li>)}
            </ListTag>
          );
        }
        if (b.type === 'table') {
          return (
            <div key={i} className="overflow-x-auto mb-5 rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/60">
                    {b.header.map((cell, j) => (
                      <th key={j} className="text-left font-semibold px-3 py-2 border-b border-gray-200 dark:border-gray-800 whitespace-nowrap">
                        <InlineContent parts={cell} onNavigate={onNavigate} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, j) => (
                    <tr key={j} className="border-b border-gray-100 dark:border-gray-800/60 last:border-0">
                      {row.map((cell, k) => (
                        <td key={k} className="px-3 py-2 text-gray-600 dark:text-gray-300 align-top">
                          <InlineContent parts={cell} onNavigate={onNavigate} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.type === 'code') {
          return (
            <div key={i} className="mb-5 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800">
              {b.lang && (
                <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800/60 px-3 py-1 border-b border-gray-200 dark:border-gray-800">
                  {b.lang}
                </div>
              )}
              <pre className="text-xs leading-relaxed bg-gray-900 dark:bg-black text-gray-100 p-3 overflow-x-auto">
                <code>{b.content}</code>
              </pre>
            </div>
          );
        }
        if (b.type === 'mermaid') return <MermaidDiagram key={i} code={b.content} />;
        if (b.type === 'hr') return <hr key={i} className="my-8 border-gray-200 dark:border-gray-800" />;
        return null;
      })}
    </div>
  );
}

// No sidebar+content split on narrow screens — a real, honest call: two
// real columns don't fit a phone width without either column becoming
// too cramped to read. A hamburger-triggered drawer for section
// navigation (the same pattern mobile docs sites/apps generally use) is
// the more usable real mobile layout, kept as its own explicit branch
// rather than the same JSX squeezed by responsive classes.
export default function DocsPage({ path, navigate, onBack, isMobile }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [pathname, hash = ''] = path.split('#');
  const slug = pathname.replace(/^\/docs\/?/, '');
  const filename = slugToFilename(slug);

  const handleNavigate = (targetSlug, targetHash) => {
    if (targetSlug !== undefined) {
      const to = `/docs${targetSlug ? '/' + targetSlug : ''}${targetHash ? '#' + targetHash : ''}`;
      navigate(to);
      setDrawerOpen(false);
    } else if (targetHash) {
      document.getElementById(targetHash)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (hash) {
      // Real markdown is parsed synchronously, so the target heading's id
      // already exists in the DOM by the time this runs.
      document.getElementById(hash)?.scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [pathname, hash]);

  const sidebar = (
    <nav className="space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const active = item.slug === slug;
        return (
          <a
            key={item.filename}
            href={`/docs${item.slug ? '/' + item.slug : ''}`}
            onClick={(e) => { e.preventDefault(); handleNavigate(item.slug, ''); }}
            className={`block text-sm px-3 py-2 rounded-lg transition-colors ${
              active
                ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 font-semibold'
                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            {item.title}
          </a>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#F4F5F8] dark:bg-[#0F172A] text-gray-900 dark:text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
            <ArrowLeft size={16} /> Back to Marketplace
          </button>
          {isMobile && (
            <button onClick={() => setDrawerOpen(true)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-white">
              <Menu size={18} /> Sections
            </button>
          )}
        </div>

        <div className="flex gap-8 items-start">
          {!isMobile && (
            <aside className="w-56 shrink-0">
              <div className="sticky top-6">{sidebar}</div>
            </aside>
          )}

          <main className="flex-1 min-w-0 bg-white dark:bg-[#1E293B] rounded-2xl border border-gray-200 dark:border-gray-800 p-6 sm:p-8">
            <DocContent filename={filename} onNavigate={handleNavigate} />
          </main>
        </div>
      </div>

      {isMobile && drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-72 max-w-[80vw] h-full bg-white dark:bg-[#0F172A] p-4 overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-bold">Documentation</span>
              <button onClick={() => setDrawerOpen(false)}><X size={18} /></button>
            </div>
            {sidebar}
          </div>
        </div>
      )}
    </div>
  );
}
