// chain_switch_selfcheck.mjs
//
// Guards the exact condition that broke chain switching.
//
// The bug, reported 2026-09-10 by a user whose MetaMask has had Arbitrum
// since install: the site told them their wallet did not know about Arbitrum
// and they should add it by hand. The wallet was never asked.
//
// wagmi's connector does this before touching the wallet:
//
//     const chain = config.chains.find((x) => x.id === chainId);
//     if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());
//
// wagmiConfig listed `chains: [bsc]`, so a switch to 42161 threw inside our
// own app. It read as a wallet problem because viem gives the SwitchChainError
// class a static `code = 4902`, the same code MetaMask returns for a chain it
// does not have. An app-side config error arrived wearing the wallet's code.
//
// So this checks the condition directly rather than the symptom: every chain
// the app can ask to switch to must be present in the wagmi chain list.
//
// Run: node scripts/chain_switch_selfcheck.mjs

import { readFileSync } from 'node:fs';
import * as chains from 'viem/chains';
import { budgetHiringChainIds } from '../src/chainContracts.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name} ${detail}`); }
}

const src = new URL('../src/', import.meta.url).pathname;
const wagmiSrc = readFileSync(`${src}wagmiConfig.js`, 'utf8');
const mainSrc = readFileSync(`${src}main.jsx`, 'utf8');

// The chains the app can ask a wallet to switch to. Budget hiring is the only
// thing that switches chains, so its chain list IS the requirement.
const required = budgetHiringChainIds();
console.log(`\nchains the app can switch to: ${required.join(', ')}\n`);

const configured = (() => {
  const m = wagmiSrc.match(/chains:\s*\[([^\]]*)\]/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
})();
const supported = (() => {
  const m = mainSrc.match(/supportedChains:\s*\[([^\]]*)\]/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
})();

console.log(`wagmiConfig chains:      ${configured.join(', ') || '(none)'}`);
console.log(`Privy supportedChains:   ${supported.join(', ') || '(none)'}\n`);

// Map viem chain export names to ids so the check compares ids, not spelling.
const nameToId = Object.fromEntries(
  Object.entries(chains)
    .filter(([, v]) => v && typeof v === 'object' && typeof v.id === 'number')
    .map(([k, v]) => [k, v.id]),
);

const configuredIds = configured.map((n) => nameToId[n]).filter((x) => x != null);
const supportedIds = supported.map((n) => nameToId[n]).filter((x) => x != null);

for (const id of required) {
  const chainEntry = Object.values(chains).find((c) => c?.id === id);
  check(`chain ${id} (${chainEntry?.name ?? '?'}) is in wagmiConfig chains`,
    configuredIds.includes(id),
    'a switch to it would throw ChainNotConfiguredError before reaching the wallet');
  check(`chain ${id} is in Privy supportedChains`, supportedIds.includes(id));
}

check('every configured chain name resolved to a real viem chain',
  configuredIds.length === configured.length,
  `unresolved: ${configured.filter((n) => nameToId[n] == null).join(', ')}`);

// Robinhood is the chain no wallet ships with, so its add-parameters must be
// present and must match what was verified on chain.
const noticeSrc = readFileSync(`${src}ChainSwitchNotice.jsx`, 'utf8');
check('wallet_addEthereumChain parameters exist for Robinhood Chain',
  /4663:\s*\{/.test(noticeSrc) && /rpc\.mainnet\.chain\.robinhood\.com/.test(noticeSrc));
check('the switch helper no longer decides on code 4902 alone',
  /ChainNotConfiguredError/.test(noticeSrc),
  'a config error and an unknown-chain error share code 4902 and must be told apart by name');

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`  - ${f}`)); process.exit(1); }
