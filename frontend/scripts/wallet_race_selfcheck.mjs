// wallet_race_selfcheck.mjs
//
// Guards the account-switch race on the wallet page, reproduced 2026-09-25:
// after switching from a funded address to an empty one, the empty one showed
// the funded one's balances, because a late RPC answer for the old address was
// written under the chain id alone.
//
// Runs the real hooks (src/wallet/useEvmHoldings.js, src/wallet/useHabits.js)
// through React's own reconciler, with a mock RPC client and a mock habits
// route whose answers arrive in a chosen order, and checks:
//   1. useEvmHoldings: A's answers, arriving after the switch to B, are
//      dropped; B shows B's own (empty) balances.
//   2. useHabits: B answers before A; A's late answer does not replace B's
//      state, and the page does not stay on "loading".
//
// Run: node scripts/wallet_race_selfcheck.mjs

import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = new URL('../src/wallet/', import.meta.url).pathname;
const nm = new URL('../node_modules/', import.meta.url).pathname;

// Mocks: the wagmi client and config the hook reads through. Each call parks
// on a gate the test opens, so the test picks the order answers arrive in.
const mocks = {
  'wagmi/actions': `
    export const gates = [];
    export function getPublicClient(_cfg, { chainId }) {
      const park = (kind, address, value) => new Promise((resolve) => {
        globalThis.__gates.push({ chainId, kind, address: address.toLowerCase(), open: () => resolve(value) });
      });
      return {
        getBlockNumber: () => Promise.resolve(100n),
        getBalance: ({ address }) => park('native', address, globalThis.__balances[address.toLowerCase()] ?? 0n),
        multicall: ({ contracts }) => Promise.resolve(contracts.map((c) => ({
          status: 'success', result: globalThis.__balances[c.args[0].toLowerCase()] ?? 0n,
        }))),
      };
    }`,
  'wagmiConfig': 'export const wagmiConfig = {};',
};

const entry = `
  import React from 'react';
  import Reconciler from 'react-reconciler';
  import { useEvmHoldings } from '${src}useEvmHoldings.js';
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
  export { useEvmHoldings, useHabits };

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
  plugins: [{
    name: 'mocks',
    setup(b) {
      b.onResolve({ filter: /^wagmi\/actions$|wagmiConfig$/ }, (a) => ({
        path: a.path.includes('wagmiConfig') ? 'wagmiConfig' : a.path, namespace: 'mock',
      }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({ contents: mocks[a.path], loader: 'js' }));
    },
  }],
});

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name} ${detail}`); }
}
const tick = () => new Promise((r) => setTimeout(r, 10));

globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const { mount, useEvmHoldings, useHabits } = await import(outfile);

const A = '0xAAAA000000000000000000000000000000000001';
const B = '0xBBBB000000000000000000000000000000000002';

// 1. useEvmHoldings
console.log('\nuseEvmHoldings: A funded, switch to empty B, A answers late\n');
{
  globalThis.__gates = [];
  globalThis.__balances = { [A.toLowerCase()]: 5n * 10n ** 18n, [B.toLowerCase()]: 0n };
  const { out, render } = mount((a) => useEvmHoldings(a), A);
  await tick();
  const aGates = globalThis.__gates.filter((g) => g.address === A.toLowerCase());
  check('A read started on every chain', aGates.length === 3, `got ${aGates.length}`);
  render(B);
  await tick();
  const bGates = globalThis.__gates.filter((g) => g.address === B.toLowerCase());
  bGates.forEach((g) => g.open()); // B answers first
  await tick();
  aGates.forEach((g) => g.open()); // A's answers arrive after the switch
  await tick();
  const chains = Object.values(out.value.byChain);
  check('every chain answered for B', chains.length === 3 && chains.every((c) => c.status === 'ok'),
    JSON.stringify(chains.map((c) => c.status)));
  check('every chain entry is tagged with B', chains.every((c) => c.forKey === B.toLowerCase()));
  check('B shows its own zero balances, not A\'s 5 BNB', chains.every((c) => c.native.raw === 0n),
    JSON.stringify(chains.map((c) => String(c.native?.raw))));

  // Same race, the other order: A's late answer lands while B is still loading.
  render(A);
  await tick();
  const a2 = globalThis.__gates.filter((g) => g.address === A.toLowerCase()).slice(-3);
  render(B);
  await tick();
  a2.forEach((g) => g.open()); // A answers while B is still reading
  await tick();
  const mid = Object.values(out.value.byChain);
  check('A\'s answer during B\'s read is dropped (B still reading)', mid.every((c) => c.status === 'loading'),
    JSON.stringify(mid.map((c) => c.status)));
  globalThis.__gates.filter((g) => g.address === B.toLowerCase()).slice(-3).forEach((g) => g.open());
  await tick();
  const end = Object.values(out.value.byChain);
  check('then B\'s own answer shows', end.every((c) => c.status === 'ok' && c.native.raw === 0n));
}

// 2. useHabits
console.log('\nuseHabits: A asked, switch to B, B answers before A\n');
{
  const waits = [];
  globalThis.fetch = (url, init) => {
    const { address } = JSON.parse(init.body);
    return new Promise((resolve) => {
      waits.push({ address, open: () => resolve({
        status: 200, ok: true, headers: { get: () => null },
        json: async () => ({ address, holdings: address === A.toLowerCase() ? 'A-data' : 'B-data' }),
      }) });
    });
  };
  const { out, render } = mount((a) => useHabits(a), A);
  await tick();
  render(B);
  await tick();
  const wA = waits.find((w) => w.address === A.toLowerCase());
  const wB = waits.find((w) => w.address === B.toLowerCase());
  check('both addresses were asked once', waits.length === 2, `got ${waits.length}`);
  wB.open();
  await tick();
  check('B shows B\'s answer', out.value.status === 'ok' && out.value.data?.holdings === 'B-data',
    JSON.stringify({ s: out.value.status, d: out.value.data }));
  wA.open();
  await tick();
  check('A\'s late answer does not replace B\'s', out.value.status === 'ok' && out.value.data?.holdings === 'B-data',
    JSON.stringify({ s: out.value.status, d: out.value.data }));
  render(A);
  await tick();
  check('A\'s late answer was kept for A: going back shows it with no new request',
    out.value.data?.holdings === 'A-data' && waits.length === 2, JSON.stringify({ d: out.value.data, n: waits.length }));
}

console.log(`\n${pass} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
