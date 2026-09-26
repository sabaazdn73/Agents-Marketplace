// Vaults.jsx
//
// /vaults. Real vaults only, read-only, from GET /api/vaults: what each
// holds, who manages it, its audits and controls, and its TVL as read on
// chain. There is no deposit anywhere in the tree (SPEC §0.7). The table
// renders only with rows.

import React from 'react';
import { useTe } from '../te/api';
import { VaultTable, VaultChecksCard } from '../home/cards';
import { PageFrame } from './PageFrame';

export default function Vaults({ layout = 'web' }) {
  const mobile = layout === 'mobile';
  const vaults = useTe('/api/vaults?limit=100');
  return (
    <PageFrame layout={layout} title="Vaults">
      <div className={mobile ? 'space-y-4' : 'grid grid-cols-12 gap-6 items-start'}>
        <div className={mobile ? '' : 'col-span-8'}><VaultTable state={vaults} compact={mobile} /></div>
        <div className={mobile ? '' : 'col-span-4'}><VaultChecksCard data={vaults.data} /></div>
      </div>
    </PageFrame>
  );
}
