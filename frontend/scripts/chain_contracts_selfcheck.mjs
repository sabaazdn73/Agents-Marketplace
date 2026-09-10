// chain_contracts_selfcheck.mjs
//
// Guards the rule that contract addresses are resolved PER CHAIN and never
// assumed to be the same everywhere.
//
// This exists because of a real, live collision rather than a hypothetical
// one: 0x9dbA8EbB…1333 is AgentAccessMarket on BSC and AgentBudgetEscrow on
// Arbitrum and Robinhood Chain. Both contracts answer owner(), feeBps() and
// MAX_FEE_BPS() identically, so nothing about a wrong-chain call looks wrong
// until an ERC-20 approval has already been granted to the wrong contract.
//
// Run: node scripts/chain_contracts_selfcheck.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBudgetEscrowAddress, getAgentMarketAddress, isBudgetHiringAvailable,
  isEscrowHiringAvailable, budgetHiringChainIds, escrowHiringChainIds,
  hiringOptionsFor,
} from '../src/chainContracts.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name} ${detail}`); }
}

const COLLIDING = '0x9dbA8EbB17FA4aC5c9Da083632e9294845Ad1333'.toLowerCase();
const BSC_ESCROW = '0x4728f03693DDABbe50E79c7BfFCb930e522D585B'.toLowerCase();

console.log('\nper-chain resolution');
check('BSC budget escrow is its own address, not the colliding one',
  getBudgetEscrowAddress(56).toLowerCase() === BSC_ESCROW);
check('Arbitrum budget escrow resolves', getBudgetEscrowAddress(42161).toLowerCase() === COLLIDING);
check('Robinhood budget escrow resolves', getBudgetEscrowAddress(4663).toLowerCase() === COLLIDING);
check('an undeployed chain resolves to empty, not a default',
  getBudgetEscrowAddress(8453) === '' && getBudgetEscrowAddress(1) === '');
check('no chain id at all resolves to empty', getBudgetEscrowAddress(undefined) === '');

console.log('\nthe collision itself');
check('the colliding address is NOT served as the market on Arbitrum',
  getAgentMarketAddress(42161) === '',
  `got ${getAgentMarketAddress(42161)}`);
check('the colliding address is NOT served as the market on Robinhood',
  getAgentMarketAddress(4663) === '');
check('the market resolves on BSC', getAgentMarketAddress(56).toLowerCase() === COLLIDING);
check('market and budget escrow differ on BSC, where both exist',
  getAgentMarketAddress(56).toLowerCase() !== getBudgetEscrowAddress(56).toLowerCase());

console.log('\nhiring availability');
check('budget hiring on all three deployed chains',
  [56, 42161, 4663].every(isBudgetHiringAvailable));
check('budget hiring nowhere else', ![8453, 1, 42220, 143].some(isBudgetHiringAvailable));
check('escrow hiring is BSC only', isEscrowHiringAvailable(56)
  && ![42161, 4663, 8453].some(isEscrowHiringAvailable));
check('BNB testnet (97) is NOT reachable as an escrow chain',
  !isEscrowHiringAvailable(97) && !escrowHiringChainIds().includes(97),
  'no testnet value may be reachable from a production path');
check('budgetHiringChainIds matches the map', budgetHiringChainIds().sort((a, b) => a - b).join() === '56,4663,42161');

console.log('\nreasons are specific, not blanket');
const arb = hiringOptionsFor(42161);
check('Arbitrum says budget works', arb.budget.available && arb.anyAvailable);
check('Arbitrum explains escrow does not, and why',
  !arb.escrow.available && /ERC-8183/.test(arb.escrow.reason) && /BNB Chain only/.test(arb.escrow.reason));
const base = hiringOptionsFor(8453);
check('an undeployed chain offers nothing and names itself',
  !base.anyAvailable && /Base|chain 8453/.test(base.budget.reason));

console.log('\nno bare addresses outside chainContracts.js');
const srcDir = new URL('../src/', import.meta.url).pathname;
const offenders = [];
for (const f of readdirSync(srcDir)) {
  if (!/\.(js|jsx)$/.test(f) || f === 'chainContracts.js') continue;
  const body = readFileSync(join(srcDir, f), 'utf8');
  // Strip comments: the warning text legitimately names these addresses.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const addr of [COLLIDING, BSC_ESCROW]) {
    if (code.toLowerCase().includes(addr)) offenders.push(`${f} hardcodes ${addr}`);
  }
}
check('no source file hardcodes a contract address', offenders.length === 0, offenders.join('; '));

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`  - ${f}`)); process.exit(1); }
