// Dashboard.jsx
//
// "/". With a wallet connected, its holdings sit at the top: the whole of
// what /wallet used to show (wallet/WalletHome.jsx), unchanged. Below that
// is where every covered stock, ETF and vault will be listed, in two groups,
// EVM and non-EVM, and nothing else. Until the instrument list exists (build
// step 2) the groups are empty and say so.

import React from 'react';
import { useSignIn } from '../wallet/SignInProvider';
import WalletHome from '../wallet/WalletHome';
import { CHAIN_GROUPS } from '../chainGroups';
import { PageFrame, BeingBuilt } from './PageFrame';

export default function Dashboard({ layout = 'web' }) {
  const { status } = useSignIn();
  return (
    <PageFrame layout={layout} title="Dashboard">
      {status !== 'disconnected' && (
        <section aria-label="Holdings of the connected wallet">
          <WalletHome layout={layout} embedded />
        </section>
      )}
      <BeingBuilt what="The stocks, ETFs and vaults covered will be listed here, grouped EVM and non-EVM." />
      <div className={`grid gap-4 ${layout === 'mobile' ? 'grid-cols-1' : 'md:grid-cols-2 md:gap-6'}`}>
        {CHAIN_GROUPS.map((g) => (
          <section key={g.id} className="card p-4" aria-labelledby={`group-${g.id}`}>
            <h2 id={`group-${g.id}`} className="text-title font-bold text-fg">{g.label}</h2>
            <p className="text-label text-muted mt-0.5">{g.note}</p>
            <p className="text-body text-muted mt-4">Nothing listed yet.</p>
          </section>
        ))}
      </div>
    </PageFrame>
  );
}
