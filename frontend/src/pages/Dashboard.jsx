// Dashboard.jsx
//
// /dashboard, laid out like getquin's dashboard (owner's reference,
// dashboard-01 to 03). Left: Portfolio (value and chart), Positions,
// Dividends. Right: Allocation, Performance by year and the cost breakdown.
// The cards read POST /api/site/portfolio (dashboard/cards.jsx), and each
// renders nothing where the answer has nothing for it.
//
// Until that endpoint serves, the wallet's holdings come from the existing
// reads in wallet/* (WalletHome: the Hyperliquid account and the named
// tokens on EVM chains, with what the Hyperliquid habits cost), shown under
// the cards. With no wallet connected: a thin banner with one action, as
// getquin shows a signed-out visitor.

import React from 'react';
import { useSignIn } from '../wallet/SignInProvider';
import WalletHome from '../wallet/WalletHome';
import { useTe } from '../te/api';
import { DATA_LIVE } from '../dataLive';
import { Card, PrimaryButton } from '../ui/primitives';
import { PortfolioCard, PositionsCard, AllocationCard, PerformanceCard, DividendsCard } from '../dashboard/cards';

export default function Dashboard({ layout = 'web', onSignIn = null }) {
  const mobile = layout === 'mobile';
  const { status, address } = useSignIn();
  const connected = status !== 'disconnected' && !!address;
  // keep: false (the default): a wallet change clears the previous wallet's
  // answer at once, so its figures never show under the new address.
  // Not called until the portfolio route serves real data (dataLive.js).
  const read = useTe(connected && DATA_LIVE ? '/api/site/portfolio' : null, { method: 'POST', body: connected ? { addresses: [address] } : undefined });
  const portfolio = read.data;

  if (!connected) {
    return (
      <div className={mobile ? 'px-4 pt-5 pb-6' : 'w-full'}>
        <h1 className="sr-only">Dashboard</h1>
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-[18px] font-bold text-fg">Connect a wallet to see what it holds.</p>
            <p className="mt-1 text-[14px] text-muted">Every tokenized stock, ETF and vault it holds, with what each cost, read from the chain. Nothing to sign up for.</p>
          </div>
          <PrimaryButton onClick={() => onSignIn?.()}>Connect wallet</PrimaryButton>
        </Card>
      </div>
    );
  }

  return (
    <div className={mobile ? 'px-4 pt-5 pb-6 space-y-4' : 'w-full space-y-6'}>
      <h1 className="sr-only">Dashboard</h1>
      {read.loading && <p className="text-[13px] text-muted" role="status">Reading this wallet&apos;s tokenized equities.</p>}
      <div className={mobile ? 'space-y-4' : 'grid grid-cols-12 gap-6 items-start'}>
        <div className={mobile ? 'space-y-4' : 'col-span-8 space-y-6'}>
          <PortfolioCard data={portfolio} />
          <PositionsCard data={portfolio} compact={mobile} />
          <DividendsCard data={portfolio} />
        </div>
        <div className={mobile ? 'space-y-4' : 'col-span-4 space-y-6'}>
          <AllocationCard data={portfolio} />
          <PerformanceCard data={portfolio} />
        </div>
      </div>
      <section aria-label="Wallet holdings">
        <WalletHome layout={layout} embedded onConnect={onSignIn} showHires={false} />
      </section>
    </div>
  );
}
