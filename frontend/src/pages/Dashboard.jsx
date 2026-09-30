// Dashboard.jsx
//
// /dashboard: the connected wallet's holdings, from the reads in wallet/*
// (WalletHome: Stocks, ETFs and Vaults from POST /api/wallet/holdings and the
// vault list, the Hyperliquid account and what its habits cost from POST
// /api/wallet/habits, and the named tokens on EVM chains read in the
// browser). With no wallet connected: a thin banner with one action, as
// getquin shows a signed-out visitor.
//
// The portfolio cards (dashboard/cards.jsx: value and chart, positions with
// buy-in and P/L, dividends, allocation, performance) are not shown and
// their read is not made (2026-09-30): they need POST /api/site/portfolio,
// which the backend does not serve, so every load sent the connected address
// to a route that answered 404 and the cards rendered nothing. The cards stay
// in dashboard/cards.jsx for when a route serves that history.

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
      <section aria-label="Wallet holdings">
        <WalletHome layout={layout} embedded onConnect={onSignIn} showHires={false} />
      </section>
    </div>
  );
}
