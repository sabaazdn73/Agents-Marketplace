// MyEtfs.jsx
//
// /my-etfs and /my-etfs/<code>: the curated baskets from GET
// /api/baskets/curated and Build your own (etfs/BasketBuilder.jsx), or one
// curated basket (etfs/BasketDetail.jsx) in the vault page's shape. A built
// basket's link opens here: /my-etfs?b=<base64url> or ?legs=T:bps,...
// (baskets/codec.js), with ?size= optional; the builder opens filled in and
// priced. Behind DATA_LIVE (dataLive.js).

import ReadError from '../te/ReadError';
import React, { useEffect, useMemo } from 'react';
import { useTe, hasRows } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { BasketCard } from '../home/cards';
import BasketDetail from '../etfs/BasketDetail';
import BasketBuilder from '../etfs/BasketBuilder';
import { decodeLink } from '../baskets/codec';
import { PageFrame } from './PageFrame';

export default function MyEtfs({ layout = 'web', path = '/my-etfs', onNavigate }) {
  const mobile = layout === 'mobile';
  const m = (path || '').split('#')[0].match(/^\/my-etfs\/([a-z0-9-]+)$/);
  const curated = useTe(DATA_LIVE && !m ? '/api/baskets/curated' : null);
  const data = curated.data;
  const link = useMemo(() => {
    try {
      const d = decodeLink(window.location.search);
      const size = Number(new URLSearchParams(window.location.search).get('size'));
      return { ...d, size: Number.isFinite(size) && size > 0 ? size : 1000 };
    } catch { return { legs: null, size: 1000 }; }
  }, []);
  const toBuild = !m && (link.legs || link.error || (path || '').includes('#build'));
  // Again once the curated list has drawn above it and moved it down.
  const listed = !!data;
  useEffect(() => {
    if (toBuild) requestAnimationFrame(() => document.getElementById('build')?.scrollIntoView({ block: 'start' }));
  }, [toBuild, listed]);
  if (m) {
    return (
      <div className={mobile ? 'px-4 pt-5 pb-6' : 'w-full'}>
        <BasketDetail code={m[1]} layout={layout} onNavigate={onNavigate} />
      </div>
    );
  }
  return (
    <PageFrame layout={layout} title="My ETFs" sub={data?.note || null}>
      {!data && curated.error && <ReadError error={curated.error} body={curated.errorBody} what="the curated baskets" />}
      {hasRows(data?.baskets) && (
        <div className={mobile ? 'space-y-3' : 'grid grid-cols-2 xl:grid-cols-4 gap-6'}>
          {data.baskets.map((b) => <BasketCard key={b.code || b.name} basket={b} source={data} onOpen={() => onNavigate?.(`/my-etfs/${b.code}`)} />)}
        </div>
      )}
      {DATA_LIVE && (
        <div id="build" className="scroll-mt-20">
          <BasketBuilder initialLegs={link.legs} initialSize={link.size} linkError={link.error || null} compact={mobile} />
        </div>
      )}
    </PageFrame>
  );
}
