// guide/myEtfs.jsx
//
// The guide's My ETFs section: the example baskets, the builder and how a
// basket's cost is read. The text the pages carried before they were made
// short (etfs/BasketBuilder.jsx, etfs/BasketBreakdown.jsx,
// etfs/BasketDetail.jsx) is here.

import React from 'react';
import { Q, Terms, P } from './parts';

function Body() {
  return (
    <>
      <P>
        A basket is a fixed list of up to five tokenized stocks or ETFs with weights. The example
        baskets are fixed, with equal or stated weights; none is a recommendation.
      </P>

      <Q q="How does Build your own work?">
        <p>
          Up to five stocks or ETFs, whole-percent weights summing to 100%. Each leg buys the
          version with the lowest measured cost at its size, or one version you choose.
        </p>
        <p>
          The basket is priced by Tnega&apos;s cost engine and forgotten: nothing is stored. It lives
          in its link, which carries the weights as basis points (100% = 10,000), and opens the
          builder filled in and priced.
        </p>
      </Q>

      <Q q="How is a basket's cost read?">
        <Terms items={[
          ['Size', 'The engine measures 11 sizes, from $100 to $250,000; a basket is priced at one of them.'],
          ['Leg cost', 'Fees and price impact against the pool\'s own mid price, with LI.FI\'s 0.25% fee where the answer says it is included. Simulated on the pools, not quoted, at the time shown.'],
          ['Leg amounts', 'Some legs\' amounts are not measured sizes; each of those is priced at the next measured size up, as its row says. Nothing is interpolated. Under the smallest size, a leg is costed from the parts measured there.'],
          ['Cost to buy', 'The basket\'s fees and price impact against each pool\'s own price, in basis points and dollars, or the reason there is none.'],
          ['Largest basket under 1%', 'The largest size at which the basket costs under the threshold, and the leg that sets it. "At least": a limiting leg is under the threshold even at the largest size measured.'],
          ['Signatures', 'One swap per leg, and up to one approval per leg where the allowance is short (the allowance is not known in advance). Chain switches are counted apart, plus one if your wallet starts on another chain.'],
          ['Does not fill / Not ranked', 'A leg with no version that fills at this size, or none the engine ranks, says which and why.'],
        ]} />
      </Q>

      <div id="my-etfs-basket" className="scroll-mt-24">
        <Q q="What does following a basket mean?">
          <p>
            A basket is a static list of tokens and weights. Each follower buys the tokens into their
            own wallet: one signature per token, plus an approval where a token needs one. There are
            no pooled funds, no lock-up and no profit share, and nothing trades in a follower&apos;s
            wallet without their signature.
          </p>
          <p>
            A basket&apos;s page shows its value and return where measured (indicative), its
            composition, the cost at every size and each weight change with its version. Your holding
            is the tokens in your own wallet; it is not read there.
          </p>
        </Q>
      </div>
    </>
  );
}

export default {
  id: 'my-etfs',
  title: 'My ETFs',
  summary: 'Example baskets, building your own, and how a basket\'s cost is read.',
  Body,
};
