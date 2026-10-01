// guide/trading.jsx: the Buy and Sell tabs of a stock page, and what is
// checked before anything is offered for signing.

import React from 'react';
import { Q, Terms } from './parts';
import { TRADE_CHAIN_IDS } from '../trade/tradeLive';
import { BUY_CHAINS } from '../trade/chains';

/** The chains switched on in trade/tradeLive.js, in words. */
export function switchedOnWords() {
  // The site's usual order, then any other chain switched on.
  const ORDER = [1, 8453, 42161, 56, 4663, 999];
  const ids = [...ORDER.filter((id) => TRADE_CHAIN_IDS.includes(id)), ...TRADE_CHAIN_IDS.filter((id) => !ORDER.includes(id))];
  const names = ids.map((id) => BUY_CHAINS[id]?.name || `chain ${id}`);
  if (!names.length) return 'none yet';
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function Body() {
  return (
    <>
      <Q q="Where you can buy and sell">
        <p>Buy and Sell are tabs of one version on its stock page. They are switched on per chain in this site's settings; switched on today: {switchedOnWords()}. Of these, a real trade has been run on Base so far; the others were switched on on 1 October 2026 for real tests. On any other chain the tab says it is not switched on yet and offers no control. A buy is from $1 to $10,000, the same bounds as an order prepared through your assistant.</p>
        <p>Buy pays the chain&apos;s stablecoin and receives the stock token. Sell parts with the stock token your wallet holds and receives the stablecoin; Max fills in the balance read on chain. The stablecoin is taken at $1 a token.</p>
      </Q>
      <Q q="Who does what">
        <p>The route and the transaction come from LI.FI, asked from your browser. Tnega passes LI.FI&apos;s transaction to your wallet as LI.FI built it, after the checks below. Your wallet signs; Tnega never holds funds or keys, and nothing goes to Tnega&apos;s API except the read of its own measurements. LI.FI takes a 0.25% fee; Tnega takes none.</p>
        <p>Connecting a wallet signs nothing: it lets the tab read your balance and ask LI.FI for a route. Every wallet prompt comes only from your own click.</p>
      </Q>
      <Q q="The quote">
        <p>&ldquo;Get a LI.FI quote&rdquo; sends one request to li.quest from this browser, only when you press it. LI.FI allows a limited number per browser (75 every 2 hours); the tab shows how many this browser has used. Any change of amount, stablecoin or wallet drops the quote.</p>
        <p>&ldquo;You receive&rdquo; is LI.FI&apos;s estimate, not a figure from Tnega. &ldquo;At least&rdquo; is LI.FI&apos;s minimum after the maximum slippage (0.5%): the route has to guarantee at least the estimate less this, and the swap reverts if it would receive less. The fees and the network fee are LI.FI&apos;s figures. A quote is signed only while it is under 60 seconds old, and only for the wallet it was asked for.</p>
      </Q>
      <Q q="What is checked before you can sign">
        <p>The same checks as the signing page, in this order; the first one that fails refuses the quote and says why:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Both tokens&apos; decimals are read on chain before anything is quoted: the stablecoin&apos;s must match this site&apos;s list, and the stock token&apos;s is read twice, from two endpoints, and kept only when they agree. LI.FI&apos;s decimals must match the chain&apos;s. If they do not agree, nothing is quoted or signed.</li>
          <li>LI.FI&apos;s answer matches the request: the chains, the tokens, the amount, your wallet as the recipient at every step, and LI.FI&apos;s own contract, pinned per chain, as both the contract called and the approval&apos;s spender.</li>
          <li>No step is routed through Jupiter.</li>
          <li>Tnega&apos;s own measured price for the token exists and is under 30 minutes old. If it does not, no quote is asked for at all, and your address goes nowhere.</li>
          <li>LI.FI&apos;s own price for the token is within 5% of Tnega&apos;s.</li>
          <li>The minimum you receive passes at both prices: valued at Tnega&apos;s measured price and at LI.FI&apos;s, it may be worth less than you pay by no more than this trade&apos;s limit.</li>
        </ul>
      </Q>
      <Terms items={[
        ['Price check', 'For each of the two prices: the price per token, what the minimum is worth against what you pay, and how far apart they are, against the limit.'],
        ['The limit', 'The smaller of 5% and the larger of 2% and three times Tnega’s measured cost without gas. The Buy and Sell tabs use at most 2% until Tnega’s reference comes signed. The panel shows the rule’s figure, what it is based on, and the limit used.'],
        ['Our reference', 'Tnega’s measured price, named with its basis and the time it was measured. If it becomes over 30 minutes old, get a new quote.'],
        ['Approval', 'When the allowance does not cover the amount, an approval for exactly that amount comes first, as its own wallet prompt, to LI.FI’s contract shown with its address: never an unlimited one, and offered once. After it, the allowance is read every 2 seconds for up to 30 seconds; no second approval is asked for.'],
        ['Who may hold', 'The issuer’s words on who may hold the token, with a box to tick before you sign. Shown, not enforced: Tnega does not check who you are.'],
        ['After you sign', 'The transaction link, and LI.FI’s status, checked every 5 seconds until it is done, failed, or unknown after a long wait; then check the explorer.'],
      ]} />
    </>
  );
}

export default {
  id: 'trading',
  title: 'Buying and selling',
  summary: 'The Buy and Sell tabs, who does what, and every check before you sign.',
  Body,
};
