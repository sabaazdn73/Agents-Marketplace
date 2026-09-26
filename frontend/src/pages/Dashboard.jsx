// Dashboard.jsx
//
// "/". The connected wallet's holdings: the whole of what /wallet used to
// show (wallet/WalletHome.jsx), unchanged. With no wallet connected,
// WalletHome shows what the page reads and a way to connect, and nothing
// else: no list of instruments until one exists and works end to end.
//
// `onSignIn` is what the connect button does with no wallet connected. Both
// apps pass the /signin page, the same place the header's "Sign in" goes.

import React from 'react';
import WalletHome from '../wallet/WalletHome';
import { PageFrame } from './PageFrame';

export default function Dashboard({ layout = 'web', onSignIn = null }) {
  return (
    <PageFrame layout={layout} title="Dashboard">
      <section aria-label="Holdings of the connected wallet">
        <WalletHome layout={layout} embedded onConnect={onSignIn} />
      </section>
    </PageFrame>
  );
}
