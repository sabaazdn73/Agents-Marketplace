// csp_hash_selfcheck.mjs
//
// vercel.json's Content-Security-Policy allows index.html's one inline
// script (the theme-before-first-paint script) by its sha256. Edit that
// script and the hash changes, the browser refuses the script, and every
// dark-mode visitor gets a white first frame. This check runs before every
// build and fails it when the hash in vercel.json is not the script's.
// It also fails if the policy lets any font come from a host other than
// this site.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const csp = vercel.headers?.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value || '';
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter((m) => !/type="application\/ld\+json"/.test(m[1]));
let failed = 0;
for (const m of scripts) {
  const h = `sha256-${createHash('sha256').update(m[2]).digest('base64')}`;
  if (!csp.includes(`'${h}'`)) { console.error(`CSP is missing the inline script hash '${h}' (vercel.json)`); failed++; }
}
const fontSrc = (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('font-src')) || '').split(/\s+/).slice(1);
if (!fontSrc.length || fontSrc.some((t) => t !== "'self'" && t !== 'data:')) { console.error(`font-src must be 'self' data: only, got: ${fontSrc.join(' ')}`); failed++; }
console.log(`${scripts.length} inline script(s) checked; ${failed ? `${failed} failed` : 'CSP in step'}`);
process.exit(failed ? 1 : 0);
