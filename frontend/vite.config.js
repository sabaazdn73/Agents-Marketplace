import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
