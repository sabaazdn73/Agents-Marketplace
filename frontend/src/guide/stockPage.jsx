// guide/stockPage.jsx: one stock or ETF's page (/stocks/<ticker>).

import React from 'react';
import { Q, Terms, See } from './parts';

function Body() {
  return (
    <>
      <Q q="Every version at your size">
        <p>The page lists every tokenized version of the stock or ETF that Tnega lists: the token, its issuer, its chain, and what it costs at the order size chosen above the table ($100 to $250,000). Change the size and every figure is read again at that size.</p>
        <p>The crown marks the lowest all-in price per share among versions that fill the size and whose share ratio is read. All-in is the size, gas, the L1 fee and LI.FI&apos;s 0.25% fee, over the tokens received, over the shares per token (<See id="costs">How costs are measured</See>). When another version rounds to the same cent, both show four decimals and the page says they are tied; the engine still ranks them by the unrounded figure.</p>
        <p>A version whose share ratio is not read is shown at its price per token, says &ldquo;not ranked&rdquo; and is never crowned.</p>
      </Q>
      <Terms items={[
        ['Cost (vs pool mid)', 'Fees and price impact against each pool’s own price, in bps. It does not rank one version against another.'],
        ['Depth ±2%', 'The smaller side of the pool within 2% either side of its price.'],
        ['Fills $1,000', 'The pool can take the whole order at this size.'],
        ['Fills part of', 'The pool can take only part of the order at this size.'],
        ['Pool too thin', 'A pool exists but is too small to quote at this size.'],
        ['No pool found', 'No pool for this version was found on its chain.'],
        ['Not searched', 'This chain’s pools were not searched for this version.'],
        ['Not a venue', 'The pools found charge more in fees, or take more on a small test buy, than the engine’s ceiling, so they are not counted as a place to buy. Open the state for the figures.'],
        ['Quote failed', 'The simulated swap failed; open the state for the engine’s reason.'],
        ['Held back', 'The engine held the figure back, for example while the token’s share ratio is in doubt. Open the state for its reason.'],
      ]} />
      <Q q="Order size and cost by chain">
        <p>The order size card shows, per chain, the best ranked version at that size and its cost in bps (fees and price impact against the pool&apos;s own price), with its symbol and the pool&apos;s depth. Move the slider and the whole page follows. Chains with no quotable pool are listed under it, each with its reason. These are simulated on the pools, not quoted, and the card says when they were measured.</p>
      </Q>
      <Q q="One version: Details, Buy and Sell">
        <p>Under the table, the chosen version has three tabs. Details shows who may hold the token, its Aave V4 collateral status when it is on Base, and its issuer controls. Buy and Sell are described in <See id="trading">Buying and selling</See>.</p>
        <p>The line under the version&apos;s name gives its token address (linked to the chain&apos;s explorer), its shares per token and the block the figures were read at.</p>
      </Q>
      <Q q="Who may hold it">
        <p>The issuer&apos;s own words on who may hold the token, linked to where they are written and dated with the day Tnega read them. They are shown, not enforced: Tnega does not check who you are.</p>
      </Q>
      <Q q="Collateral on Aave V4 (Base only)">
        <p>For a version on Base, the page reads on Base whether Aave V4 accepts it as collateral. A version outside Base shows nothing about Aave. When it has not been read yet on this server the page says &ldquo;not read yet&rdquo; and shows no figure; when it is not listed it says so, with the reason in plain words.</p>
        <p>When it is listed: borrowing is allowed up to the collateral factor (max LTV) of the collateral&apos;s value, and liquidation starts at the same figure. V4 has one collateral factor, so there is no buffer between the two. A position keeps the factor stored at its last health-checked action; the one shown is the reserve&apos;s current one.</p>
        <p>&ldquo;Supplied to the market&rdquo; is what is supplied to the market, with the supply cap and how much of it is used. V4 turns collateral on per user, so no market-wide collateral total exists to read.</p>
        <p>The USDC borrow rate is the hub&apos;s drawn rate, an APR, not compounded. A borrower pays it times one plus a risk premium that depends on the collateral. Utilization is shown beside it.</p>
        <p>Every figure carries the block and time it was read. Reads run only when someone asks, so after a quiet spell a figure can be from an earlier day. A figure older than the 10-minute refresh, or one whose latest read failed, is marked &ldquo;stale&rdquo; with its age, and a new read is started. Aave&apos;s own words on who the token is offered to are quoted with a link and a date; they are not enforced by Tnega. The addresses come from Aave&apos;s address book at a named commit, and every figure is read on chain.</p>
      </Q>
      <Q q="Issuer controls on this token">
        <p>Pause, freeze or denylist, burn or seize, upgrade, mint and allowlist, as read on chain for this token, each with who holds the power and &ldquo;Show details&rdquo; for the evidence. What each power means, and how they are read: <See id="issuer-controls">Issuer controls</See>. &ldquo;Compare with every issuer&rdquo; opens the same token among every issuer&apos;s.</p>
      </Q>
    </>
  );
}

export default {
  id: 'stock-page',
  title: "One stock's page",
  summary: 'Every version of one stock or ETF, the size selector, and the Details tab.',
  Body,
};
