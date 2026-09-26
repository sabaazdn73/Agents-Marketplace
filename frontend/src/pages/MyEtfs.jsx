// MyEtfs.jsx
//
// /my-etfs and /my-etfs/<code>: the curated baskets from GET
// /api/baskets/curated, or one public basket (etfs/BasketDetail.jsx) in the
// vault page's shape. Behind DATA_LIVE (dataLive.js).

import React from 'react';
import { useTe, hasRows } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { BasketCard } from '../home/cards';
import BasketDetail from '../etfs/BasketDetail';
import { PageFrame } from './PageFrame';

export default function MyEtfs({ layout = 'web', path = '/my-etfs', onNavigate }) {
  const mobile = layout === 'mobile';
  const m = (path || '').split('#')[0].match(/^\/my-etfs\/([a-z0-9-]+)$/);
  const data = useTe(DATA_LIVE && !m ? '/api/baskets/curated' : null).data;
  if (m) {
    return (
      <div className={mobile ? 'px-4 pt-5 pb-6' : 'w-full'}>
        <BasketDetail code={m[1]} layout={layout} onNavigate={onNavigate} />
      </div>
    );
  }
  return (
    <PageFrame layout={layout} title="My ETFs" sub={data?.note || null}>
      {hasRows(data?.baskets) && (
        <div className={mobile ? 'space-y-3' : 'grid grid-cols-3 gap-6'}>
          {data.baskets.map((b) => <BasketCard key={b.code || b.name} basket={b} source={data} onOpen={() => onNavigate?.(`/my-etfs/${b.code}`)} />)}
        </div>
      )}
    </PageFrame>
  );
}
