// Dashboard.jsx
//
// /dashboard: the connected wallet's holdings (wallet/WalletHome.jsx, with
// the cards in dashboard/cards.jsx): Portfolio, Positions and Allocation,
// then Stocks, ETFs, Vaults and Tokens, all from POST /api/wallet/holdings
// and the vault list, then the Hyperliquid account and what its habits cost
// from POST /api/wallet/habits. With no wallet connected: a thin banner with
// one action, as getquin shows a signed-out visitor.
//
// A value history (the chart and its 1D to Max ranges), buy-in and P/L,
// dividends and performance are not measured, and their cards say so
// (2026-09-30). The route those cards were first drawn for, POST
// /api/site/portfolio, never existed and is not called.

import React from 'react';
import { useSignIn } from '../wallet/SignInProvider';
import WalletHome from '../wallet/WalletHome';
import { Card, PrimaryButton } from '../ui/primitives';

export default function Dashboard({ layout = 'web', onSignIn = null }) {
  const mobile = layout === 'mobile';
  const { status, address } = useSignIn();
  const connected = status !== 'disconnected' && !!address;

  if (!connected) {
    return (
      <div className={mobile ? 'px-4 pt-5 pb-6' : 'w-full'}>
        <h1 className="sr-only">Dashboard</h1>
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-[18px] font-bold text-fg">Connect a wallet to see what it holds.</p>
            <p className="mt-1 text-[14px] text-muted">Its stocks, ETFs and tokens, read from the chain. Nothing to sign up for.</p>
          </div>
          <PrimaryButton onClick={() => onSignIn?.()}>Connect wallet</PrimaryButton>
        </Card>
      </div>
    );
  }

  return (
    <div className={mobile ? 'px-4 pt-5 pb-6 space-y-4' : 'w-full space-y-6'}>
      <h1 className="sr-only">Dashboard</h1>
      <section aria-label="Wallet holdings">
        <WalletHome layout={layout} embedded onConnect={onSignIn} />
      </section>
    </div>
  );
}
