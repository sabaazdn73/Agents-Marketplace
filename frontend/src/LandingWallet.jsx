// LandingWallet.jsx
//
// The top of the home page, since 2026-09-25: the wallet story. The owner's
// decision is that Home leads with it, so it comes before the agent hero and
// story, which follow below unchanged.
//
// It shows no figures. A preview with numbers in it would be numbers nobody
// measured, which is the thing this project exists not to publish. It says what
// the page measures and where each figure comes from, and sends the visitor to
// /wallet, which is where the numbers are.

import React from 'react';
import { ArrowRight, Coins, Percent, Timer, Ban, Wallet } from 'lucide-react';
import ThemeToggle from './theme/ThemeToggle';
import appMark from './assets/app-mark.png';

const WHAT = [
  { icon: Coins, title: 'Fees paid', body: 'As maker and as taker, per token, over the fills the venue returns, with how many fills and the hours they cover.' },
  { icon: Percent, title: 'Taker share', body: 'How much of the last 15 days of volume crossed the spread rather than rested, beside your own fee rates.' },
  { icon: Timer, title: 'Funding', body: 'Paid and received, net, with the span actually covered stated first, because a busy account may cover hours rather than 30 days.' },
  { icon: Ban, title: 'Post-only refusals', body: 'How often the venue refused your post-only orders, with the order window and how old the newest order is.' },
];

export default function LandingWallet({ onOpenWallet, onExplore }) {
  return (
    <section className="bg-page text-fg border-b border-line" aria-labelledby="wallet-lead">
      <div className="max-w-[1440px] mx-auto px-6 xl:px-14">
        <div className="h-14 flex items-center gap-3">
          <img src={appMark} alt="" className="w-8 h-8" />
          <span className="text-title font-bold">Tnega</span>
          <div className="flex-1" />
          <a href="/market" onClick={(e) => { e.preventDefault(); onExplore?.(); }} className="hidden sm:inline text-body font-medium text-muted hover:text-fg">Explore agents</a>
          <ThemeToggle />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-10 lg:py-16 items-start">
          <div className="lg:col-span-6">
            <p className="text-label font-semibold uppercase tracking-wide text-accent">Your wallet, measured</p>
            <h1 id="wallet-lead" className="text-[32px] leading-[40px] sm:text-[44px] sm:leading-[52px] font-bold tracking-tight mt-2">
              What your trading habits cost you
            </h1>
            <p className="text-body sm:text-title text-muted mt-3 max-w-xl">
              Connect a wallet to see what it holds, and what its trading on Hyperliquid has cost it in fees and
              funding, read from the venue&apos;s public record. Every figure carries the window and the number of
              records behind it. Where something could not be read, the page says why instead of showing a zero.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <a
                href="/wallet"
                onClick={(e) => { e.preventDefault(); onOpenWallet?.(); }}
                className="h-11 px-5 rounded-md bg-accent text-accent-fg text-body font-semibold hover:opacity-90 inline-flex items-center gap-2"
              >
                <Wallet size={16} aria-hidden="true" /> Open your wallet <ArrowRight size={16} aria-hidden="true" />
              </a>
              <a
                href="/market"
                onClick={(e) => { e.preventDefault(); onExplore?.(); }}
                className="h-11 px-5 rounded-md border border-line-strong text-body font-semibold text-fg hover:bg-inset inline-flex items-center"
              >
                Explore agents
              </a>
            </div>
            <p className="text-label text-muted mt-4 max-w-xl">
              Read-only. Nothing to approve and no funds moved. Signing in is optional and only changes whether the
              page calls the address your wallet.
            </p>
          </div>

          <ul className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {WHAT.map(({ icon: Icon, title, body }) => (
              <li key={title} className="card p-4">
                <Icon size={18} className="text-accent" aria-hidden="true" />
                <p className="text-body font-semibold mt-2">{title}</p>
                <p className="text-label text-muted mt-1">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
