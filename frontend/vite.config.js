import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SITE_COPY } from './src/siteCopy.js';

// NO THIRD-PARTY FONT HOST. The WalletConnect modal (@reown/appkit-ui,
// utils/ThemeUtil.js) writes `@import url('https://fonts.googleapis.com/
// css2?family=Inter...')` into the page when it opens, which would send
// every visitor's IP to Google; the privacy page says the site does not do
// that. This transform removes that @import from the Reown and WalletConnect
// modules at build time; the modal's font is set to our self-hosted Hanken
// Grotesk instead (src/index.css, --w3m-font-family). After a build,
// `grep -r fonts.googleapis dist` must find nothing.
const GOOGLE_FONTS_IMPORT = /@import\s+url\(\s*['"]?https:\/\/fonts\.googleapis\.com[^)]*\)\s*;?/g;
function stripGoogleFonts() {
  return {
    name: 'tnega-strip-google-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (!/node_modules[\\/].*(@reown|@walletconnect)[\\/]/.test(id)) return null;
      if (!code.includes('fonts.googleapis.com')) return null;
      return { code: code.replace(GOOGLE_FONTS_IMPORT, ''), map: null };
    },
  };
}

// THE SITE'S TITLE AND DESCRIPTION, from src/siteCopy.js (which follows
// DATA_LIVE) into index.html's __TNEGA_*__ placeholders, and into the
// built manifest.json, so the static tags a scraper reads, the manifest and
// what App.jsx sets at runtime are one copy.
const esc = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function siteCopy() {
  let outDir = 'dist';
  return {
    name: 'tnega-site-copy',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml(html) {
      return html
        .replaceAll('__TNEGA_TITLE__', esc(SITE_COPY.docTitle))
        .replaceAll('__TNEGA_OG_TITLE__', esc(SITE_COPY.ogTitle))
        .replaceAll('__TNEGA_DESCRIPTION__', esc(SITE_COPY.description));
    },
    closeBundle() {
      const f = resolve(outDir, 'manifest.json');
      if (!existsSync(f)) return;
      const m = JSON.parse(readFileSync(f, 'utf8'));
      m.description = SITE_COPY.description;
      writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [stripGoogleFonts(), siteCopy(), react()],
  // The dev server pre-bundles dependencies with esbuild, which the Rollup
  // transform above does not see; this does the same there.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [{
        name: 'tnega-strip-google-fonts-dev',
        setup(build) {
          build.onLoad({ filter: /(@reown|@walletconnect).*\.js$/ }, async (args) => {
            const fs = await import('node:fs/promises');
            const code = await fs.readFile(args.path, 'utf8');
            if (!code.includes('fonts.googleapis.com')) return undefined;
            return { contents: code.replace(GOOGLE_FONTS_IMPORT, ''), loader: 'js' };
          });
        },
      }],
    },
  },
  server: {
    port: 5173,
    // DocsPage.jsx reads the real docs/*.md files, which live one
    // directory above frontend/ (a sibling under the repo root) — Vite's
    // dev server otherwise 403s any file outside its project root. Only
    // matters in dev; the production build resolves these at build time
    // regardless of this setting.
    fs: { allow: ['..'] },
  },
});
