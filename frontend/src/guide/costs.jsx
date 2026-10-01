// guide/costs.jsx: how the costs on the stock lists and pages are measured.

import React from 'react';
import { Q, Terms } from './parts';

function Body() {
  return (
    <>
      <Q q="Simulated on the pools, not quoted">
        <p>Every cost is Tnega&apos;s own measurement. For each version on an EVM chain, the cost engine finds the pools the token trades in and simulates a buy on each, at eleven order sizes from $100 to $250,000, inside a read of the chain (an eth_call on a public endpoint: nothing is sent and nothing is signed). The figure is what that pool would have given at that block. It is not a quote from anyone and not a promise of a price.</p>
        <p>A pool is counted only when it is a usable place to buy: pools whose fees, or whose take on a small test buy, are above the engine&apos;s ceiling are named &ldquo;not a venue&rdquo;, and pools too shallow to measure are named &ldquo;too thin&rdquo;.</p>
      </Q>
      <Terms items={[
        ['All-in price per share', 'The headline figure. The order size, plus gas, plus the L1 fee on chains that charge one, plus LI.FI’s 0.25% fee, divided by the tokens received, divided by the shares each token stands for. It is what one share of the stock costs through this version, so versions on different chains and from different issuers can be set side by side.'],
        ['Shares per token (share ratio)', 'How many shares of the stock one token stands for. A version whose ratio is not read has no price per share: it is shown at its price per token, is not ranked and is never crowned.'],
        ['Tokens per $1,000', 'The tokens $1,000 buys after every cost.'],
        ['Cost in bps', 'Fees and price impact against the pool’s own mid price, in basis points (100 bps is 1%). Because each pool has its own mid, this does not rank one version against another; the all-in price per share does. It always carries its label.'],
        ['Depth ±2%', 'The smaller side of the pool within 2% either side of its price, in dollars.'],
        ['Reference gap', 'When a version’s price is more than 50 bps above or below the stock’s reference price, the figure says so in amber, and its hover names the reference.'],
        ['Measured', 'When the figures were measured, in UTC, and whether the US market was open or closed then.'],
      ]} />
      <Q q="What is not included">
        <p>The figures are for buying on the version&apos;s own chain; moving money from another chain first is not included. Non-EVM versions are listed but not measured yet.</p>
      </Q>
    </>
  );
}

export default {
  id: 'costs',
  title: 'How costs are measured',
  summary: 'Where the all-in price per share, the cost in bps and the depth come from.',
  Body,
};
