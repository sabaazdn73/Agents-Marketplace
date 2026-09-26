// Vaults.jsx
//
// /vaults. Real-world-asset vaults only, when it exists: stablecoins,
// tokenized stocks and ETFs, treasuries. Nothing is listed yet.

import React from 'react';
import { PageFrame, BeingBuilt } from './PageFrame';

export default function Vaults({ layout = 'web' }) {
  return (
    <PageFrame layout={layout} title="Vaults">
      <BeingBuilt what="Vaults holding real-world assets on Solana and Hyperliquid, each with its platform, manager, assets, fees, lockup and audit status." />
    </PageFrame>
  );
}
