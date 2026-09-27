// Vaults.jsx
//
// /vaults and /vaults/<platform>/<address>: the list (vaults/VaultList.jsx)
// or one vault (vaults/VaultDetail.jsx), in the layout of Hyperliquid's
// vault pages (owner's reference). Vaults taking a stablecoin deposit, from T6's GET
// /api/vaults. Deposit and Withdraw hand off to the venue; nothing is signed
// here. Behind DATA_LIVE (dataLive.js).

import React from 'react';
import { useTe, VAULT_LIST_HEADERS_MS } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import VaultList from '../vaults/VaultList';
import VaultDetail from '../vaults/VaultDetail';
import { PageFrame } from './PageFrame';

export default function Vaults({ layout = 'web', path = '/vaults', onNavigate }) {
  const m = (path || '').split('#')[0].match(/^\/vaults\/([a-z]+)\/([A-Za-z0-9]+)$/);
  const list = useTe(DATA_LIVE && !m ? '/api/vaults?limit=100' : null, { headersTimeoutMs: VAULT_LIST_HEADERS_MS });
  if (m) {
    return (
      <div className={layout === 'mobile' ? 'px-4 pt-5 pb-6' : 'w-full'}>
        <VaultDetail platform={m[1]} address={m[2]} layout={layout} onNavigate={onNavigate} />
      </div>
    );
  }
  return (
    <PageFrame layout={layout} title="Vaults" sub="Vaults taking a stablecoin deposit, checked on chain. Tnega never holds funds.">
      <VaultList state={list} layout={layout} onNavigate={onNavigate} />
    </PageFrame>
  );
}
