// budget_amounts_selfcheck.mjs
//
// Guards how money is rendered in the budget flow.
//
// Two bugs prompted this, both reported from a screenshot of a real budget on
// Robinhood Chain that read "7.00e-6 BNB":
//
//   wrong unit     Both formatters defaulted to `symbol = 'BNB'`, so any
//                  caller that did not pass one silently claimed the amount
//                  was BNB. Invisible on BNB Chain, wrong everywhere else.
//
//   exponential    They switched to toExponential(2) below 0.0001, after
//                  passing the value through Number(), which is what produced
//                  the exponent. Money must never render that way: seven
//                  millionths and seven million are one character apart.
//
// Both had already passed a build and a page render, so this checks the
// output rather than the code shape.
//
// Run: node scripts/budget_amounts_selfcheck.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { formatAmount, budgetTokenSymbol, formatBudgetAmount } from '../src/budgetAmounts.js';

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  ok   ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  FAIL ${name} ${detail}`); }
}

const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// The real budget #1 on Robinhood Chain, read from the contract on
// 2026-09-10: total, maxPerDraw and spent are all 7000000000000 wei of the
// native sentinel. This is the exact value that rendered as "7.00e-6 BNB".
const REAL_ROBINHOOD_BUDGET = 7000000000000n;

console.log('\nthe reported case');
const real = formatBudgetAmount(REAL_ROBINHOOD_BUDGET, {
  chainId: 4663, token: NATIVE, nativeSentinel: NATIVE,
});
check('real Robinhood budget renders as 0.000007 ETH', real.text === '0.000007 ETH', `got "${real.text}"`);
check('its tooltip carries the exact value', real.full.startsWith('0.000007'), `got "${real.full}"`);

console.log('\nno scientific notation, at any magnitude');
const magnitudes = [
  1n, 7n, 7000n, 7000000n, 7000000000n, REAL_ROBINHOOD_BUDGET,
  10n ** 15n, 10n ** 18n, 10n ** 21n, 12345678901234567890n, 0n,
];
for (const v of magnitudes) {
  const { text } = formatAmount(v);
  check(`${v} wei renders without an exponent`, !/e[+-]?\d/i.test(text), `got "${text}"`);
}

console.log('\nthe symbol always comes from the chain');
check('native on 4663 is ETH', budgetTokenSymbol(NATIVE, 4663, NATIVE) === 'ETH');
check('native on 42161 is ETH', budgetTokenSymbol(NATIVE, 42161, NATIVE) === 'ETH');
check('native on 56 is BNB', budgetTokenSymbol(NATIVE, 56, NATIVE) === 'BNB');
check('an unknown chain yields NO symbol rather than a guess',
  budgetTokenSymbol(NATIVE, undefined, NATIVE) === '',
  'a fallback token symbol is exactly the bug this file exists to stop');
check('a non-native token is not labelled with the gas token',
  budgetTokenSymbol('0x55d398326f99059fF775485246999027B3197955', 56, NATIVE) === 'tokens');

console.log('\nno component re-implements either of these');
const src = new URL('../src/', import.meta.url).pathname;
const budgetFiles = readdirSync(src).filter((f) => /^(Budget|MyBudgets).*\.jsx$/.test(f));
check('budget components found', budgetFiles.length >= 3, budgetFiles.join(', '));
for (const f of budgetFiles) {
  const body = readFileSync(join(src, f), 'utf8');
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check(`${f} has no 'BNB' literal`, !code.includes("'BNB'"),
    'the symbol must resolve from the chain, never be written into a component');
  check(`${f} does not call toExponential`, !code.includes('toExponential'));
  check(`${f} does not float amounts through Number(formatUnits(`,
    !/Number\(\s*formatUnits\(/.test(code),
    'that conversion is what produced the exponent');
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.error(`  - ${f}`)); process.exit(1); }
