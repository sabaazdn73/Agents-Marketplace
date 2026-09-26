// MyEtfs.jsx
//
// /my-etfs. The curated baskets from GET /api/baskets/curated, each with
// its legs, its all-in cost and the largest size its thinnest leg allows.
// The builder and the basket buy (SPEC C.3) arrive with the buy flow. The
// grid renders only with baskets.

import React from 'react';
import { useTe, hasRows } from '../te/api';
import { BasketCard } from '../home/cards';
import { PageFrame } from './PageFrame';

export default function MyEtfs({ layout = 'web' }) {
  const mobile = layout === 'mobile';
  const data = useTe('/api/baskets/curated').data;
  return (
    <PageFrame layout={layout} title="My ETFs" sub={data?.note || null}>
      {hasRows(data?.baskets) && (
        <div className={mobile ? 'space-y-3' : 'grid grid-cols-3 gap-6'}>
          {data.baskets.map((b) => <BasketCard key={b.code || b.name} basket={b} source={data} />)}
        </div>
      )}
    </PageFrame>
  );
}
