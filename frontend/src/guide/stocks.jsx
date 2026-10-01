// guide/stocks.jsx: the Stocks & ETFs lists (/stocks).

import React from 'react';
import { Q, Terms, See } from './parts';

function Body() {
  return (
    <>
      <Q q="What the two lists show">
        <p>Tokenized stocks and tokenized ETFs, one row per stock or ETF. A stock is often tokenized several times, by different issuers and on different chains; each of those tokens is a version. A row shows one of them: the version with the lowest all-in price per share that fills the list&apos;s order size ($1,000 unless the list says otherwise). Open a row to see every version (<See id="stock-page">One stock&apos;s page</See>).</p>
        <p>The search in the header looks through stocks and ETFs, and through vaults only when its answer says vaults were searched. A match that Tnega does not list is shown apart, with the reason it is not listed.</p>
      </Q>
      <Terms items={[
        ['Per share, all-in', <>What one share of the stock costs through this version, with every cost of buying it included. How it is worked out: <See id="costs">How costs are measured</See>.</>],
        ['Tokens per $1,000', 'How many tokens $1,000 buys through this version, after every cost.'],
        ['Cost to buy $1,000', 'The cost in dollars, and under it in basis points (bps; 100 bps is 1%): fees and price impact against the pool’s own price. It does not rank one version against another; the all-in price per share does.'],
        ['Versions', 'How many tokenized versions of the stock or ETF Tnega lists, on every chain.'],
        ['7 days', 'The price over the last seven days, when a price history exists. When it does not, the list says why under its (i).'],
        ['Priced N bps above or below the reference', 'Shown in amber when a version’s price differs from the stock’s reference price by more than 50 bps. Hover it for the reference used.'],
        ['All, EVM, Non-EVM', 'Filters the list by the chain family of the version shown. Costs are measured on EVM chains only for now, so under Non-EVM the list says so rather than showing a cost.'],
      ]} />
      <Q q="What the counts cover">
        <p>&ldquo;N stocks ranked at $1,000&rdquo; counts the stocks (or ETFs) with a version that fills the order size and is ranked. The (i) beside it gives the rest: those with a version that fills but is not ranked, because no version has a read share ratio (shares per token), and those with no version that fills the size at all.</p>
        <p>These counts cover only the stocks and ETFs with at least one EVM version the cost engine reads, with a pool or without one. Tnega lists more across all chains; the (i) gives the difference, worked out on the page from the served counts: the other list&apos;s stocks or ETFs, and the stocks and ETFs with no EVM version the engine reads.</p>
      </Q>
      <Q q="The order, and when it was measured">
        <p>The list&apos;s order is said under the (i) at its foot, with the reason when the intended order is not available yet (ordering by 7-day swap volume needs swap-volume reads, so until then the lists are ordered by cost at $1,000). The line beside it says when the figures were measured, and whether the US market was open or closed then.</p>
      </Q>
    </>
  );
}

export default {
  id: 'stocks',
  title: 'Stocks & ETFs',
  summary: 'The two lists, what each column means and what the counts cover.',
  Body,
};
