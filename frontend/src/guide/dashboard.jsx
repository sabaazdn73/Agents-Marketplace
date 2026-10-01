// guide/dashboard.jsx
//
// The guide's Dashboard section: the (i) texts of the Dashboard's cards
// (dashboard/cards.jsx, wallet/WalletHome.jsx) gathered into one readable
// section. The cards keep their (i); this is the same content in one place,
// without the figures of any one wallet.

import React from 'react';
import { Q, Terms, P } from './parts';

function Body() {
  return (
    <>
      <P>
        The Dashboard reads one address&apos;s public balances on chain and its Hyperliquid record,
        without signing anything. Signing in changes only what the page calls the address
        (&quot;Your wallet&quot; or &quot;This address&quot;).
      </P>

      <Q q="What is read?">
        <p>
          Every listed stock and ETF version, each chain&apos;s own coin and the named stablecoins, on
          Ethereum, Base, Arbitrum, BNB Chain, Robinhood Chain and HyperEVM. Other tokens and Solana
          are not read. A chain that could not be read is named, with its reason, behind the (i)
          beside the line that says so; totals leave out what was not read.
        </p>
      </Q>

      <Q q="What does each card mean?">
        <Terms items={[
          ['Portfolio', 'The sum of the positions that carry a value. Each value\'s source and time is on its hover; rows without a value are not in it. Vaults are not checked for an EVM address and are not counted. Tnega keeps no stored price history for these positions, so there is no chart and no change over a day, week or year.'],
          ['Allocation', 'Each class\'s share of the valued total. Only positions with a value count.'],
          ['Positions', 'Every position read, by class. Buy-in is not read yet: Tnega does not read the wallet\'s purchase transactions, so there is no buy-in or P/L.'],
          ['Stocks, ETFs', 'The tokenized versions Tnega lists, read on six chains. Stock or ETF is the type in Tnega\'s universe file. Where only some rows are valued, the card says how many; the total leaves out the rest.'],
          ['Tokens', 'Each chain\'s own coin, the stablecoins an order can be paid with (USDC; USDT and USDC on BNB Chain; USDG on Robinhood Chain), and USD1, U, USD₮0 and USDe. Stablecoins you pay with at $1, an assumption about the peg; each chain\'s coin at a 30-minute on-chain average; USD1, U, USD₮0 and USDe are not valued.'],
          ['Vaults', 'The vaults Tnega lists are on Solana and are held through a Solana address, so a dashboard connected to an EVM address cannot tell whether you hold any. Not counted in the total or the allocation.'],
          ['Dividends', 'Tokenized stocks pass on dividends as a change in each token\'s multiplier or as extra tokens. Tnega does not read those changes for a wallet yet, so nothing received is shown.'],
          ['Performance', 'Returns by year, price gain and costs need the wallet\'s purchases and a price history. Tnega reads neither yet, so no return is shown.'],
          ['Hyperliquid', 'Read from the venue\'s public record, sometimes from the server\'s cache; the (i) gives the time and the number of calls to the venue.'],
        ]} />
      </Q>

      <Q q="Hiding amounts">
        <p>The eye button hides every amount on the page, in the figures and in their hover text.</p>
      </Q>
    </>
  );
}

export default {
  id: 'dashboard',
  title: 'Dashboard',
  summary: 'What the Dashboard reads for an address, and what each card means.',
  Body,
};
