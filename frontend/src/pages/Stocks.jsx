// Stocks.jsx
//
// /stocks, Stocks & ETFs. The top search lands here with its words in
// ?q=. Nothing is listed yet, so a search finds nothing, and the page says
// that rather than showing an empty result list that looks like a real
// miss.

import React from 'react';
import { PageFrame, BeingBuilt } from './PageFrame';

export default function Stocks({ layout = 'web', query = '' }) {
  const q = (query || '').trim();
  return (
    <PageFrame layout={layout} title="Stocks & ETFs">
      <BeingBuilt what="Search, pick an amount, and see the cost and route of a buy before your wallet signs it.">
        {q && (
          <p className="text-body text-fg mt-3">
            You searched for <span className="font-semibold">&ldquo;{q}&rdquo;</span>. Nothing matched, because nothing is listed yet.
          </p>
        )}
      </BeingBuilt>
    </PageFrame>
  );
}
