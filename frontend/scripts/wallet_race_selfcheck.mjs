// wallet_race_selfcheck.mjs
//
// Guards the account-switch race on the wallet page, reproduced 2026-09-25:
// after switching from a funded address to an empty one, the empty one showed
// the funded one's balances, because a late RPC answer for the old address was
// written under the chain id alone.
//
// Runs the real hooks (src/wallet/useEquityHoldings.js,
// src/wallet/useHabits.js) through React's own reconciler, with mock routes
// whose answers arrive in a chosen order, and checks, for each:
//   B answers before A; A's late answer does not replace B's state, the
//   page does not stay on "loading", and A's answer is kept for A.
// (The browser-side token read this once also covered, useEvmHoldings.js,
// was removed on 2026-09-30: the server's holdings read covers those tokens.)
//
// Run: node scripts/wallet_race_selfcheck.mjs

import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = new URL('../src/wallet/', import.meta.url).pathname;
const nm = new URL('../node_modules/', import.meta.url).pathname;

const entry = `
  import React from 'react';
  import Reconciler from 'react-reconciler';
  import { useEquityHoldings } from '${src}useEquityHoldings.js';
  import { useHabits } from '${src}useHabits.js';

  const host = {
    supportsMutation: true, isPrimaryRenderer: true, noTimeout: -1,
    createInstance: () => ({}), createTextInstance: () => ({}),
    appendInitialChild() {}, appendChild() {}, appendChildToContainer() {},
    removeChild() {}, removeChildFromContainer() {}, insertBefore() {}, insertInContainerBefore() {},
    finalizeInitialChildren: () => false, prepareUpdate: () => null, commitUpdate() {},
    commitTextUpdate() {}, shouldSetTextContent: () => false,
    getRootHostContext: () => ({}), getChildHostContext: (c) => c, getPublicInstance: (i) => i,
    prepareForCommit: () => null, resetAfterCommit() {}, clearContainer() {},
    scheduleTimeout: setTimeout, cancelTimeout: clearTimeout,
    getCurrentEventPriority: () => 16, detachDeletedInstance() {},
  };
  const R = Reconciler(host);
  export { useEquityHoldings, useHabits };

  export function mount(useHook, address) {
    const out = { value: null };
    function Probe({ a }) { out.value = useHook(a); return null; }
    const root = R.createContainer({}, 0, null, false, null, '', () => {}, null);
    const render = (a) => R.updateContainer(React.createElement(Probe, { a }), root, null, null);
    render(address);
    return { out, render };
  }
`;

const dir = mkdtempSync(join(tmpdir(), 'wallet-race-'));
const outfile = join(dir, 'bundle.mjs');
await build({
  stdin: { contents: entry, resolveDir: src, loader: 'js' },
  bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'error',
  nodePaths: [nm],
  define: { 'import.meta.env.VITE_API_BASE_URL': '"http://api.test"', 'process.env.NODE_ENV': '"development"' },
});

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name} ${detail}`); }
}
const tick = () => new Promise((r) => setTimeout(r, 10));

globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const { mount, useEquityHoldings, useHabits } = await import(outfile);

const A = '0xAAAA000000000000000000000000000000000001';
const B = '0xBBBB000000000000000000000000000000000002';

async function race(name, useHook, answer) {
  console.log(`\n${name}: A asked, switch to B, B answers before A\n`);
  const waits = [];
  globalThis.fetch = (url, init) => {
    const { address } = JSON.parse(init.body);
    return new Promise((resolve) => {
      waits.push({ address, open: () => resolve({
        status: 200, ok: true, headers: { get: () => null },
        json: async () => answer(address === A.toLowerCase() ? 'A-data' : 'B-data'),
      }) });
    });
  };
  const read = (v) => answer.read(v);
  const { out, render } = mount((a) => useHook(a), A);
  await tick();
  render(B);
  await tick();
  const wA = waits.find((w) => w.address === A.toLowerCase());
  const wB = waits.find((w) => w.address === B.toLowerCase());
  check(`${name}: both addresses were asked once`, waits.length === 2, `got ${waits.length}`);
  wB.open();
  await tick();
  check(`${name}: B shows B's answer`, out.value.status === 'ok' && read(out.value.data) === 'B-data',
    JSON.stringify({ s: out.value.status, d: out.value.data }));
  wA.open();
  await tick();
  check(`${name}: A's late answer does not replace B's`, out.value.status === 'ok' && read(out.value.data) === 'B-data',
    JSON.stringify({ s: out.value.status, d: out.value.data }));
  render(A);
  await tick();
  check(`${name}: A's late answer was kept for A: going back shows it with no new request`,
    read(out.value.data) === 'A-data' && waits.length === 2, JSON.stringify({ d: out.value.data, n: waits.length }));
}

const habitsAnswer = Object.assign((tag) => ({ holdings: tag }), { read: (d) => d?.holdings });
const equityAnswer = Object.assign((tag) => ({ status: 'read', stocks: [{ key: tag }] }), { read: (d) => d?.stocks?.[0]?.key });
await race('useHabits', useHabits, habitsAnswer);
await race('useEquityHoldings', useEquityHoldings, equityAnswer);

console.log(`\n${pass} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
