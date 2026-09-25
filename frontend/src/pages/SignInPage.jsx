// SignInPage.jsx
//
// /signin. A split screen at 40/60: on the left the wordmark, the "Sign in"
// heading and the wallet buttons; on the right a headline over a frame for a picture
// of the dashboard. Below 1024px only the left panel shows. It is a
// standalone route (App.jsx), so one component serves every width.
//
// THE FLOW
// Connect a wallet here, then sign the sign-in message in the existing modal
// (wallet/SignInProvider.jsx, SignInModal.jsx), then land on "/". The modal
// opens by itself only after a wallet was connected from this page, not for a
// wallet that was already connected when the page loaded. A visitor already
// signed in is sent straight to "/". Signing is never required to read
// anything: "Continue without signing" and "Browse without a wallet" say so.
//
// THE PANELS
// Left follows the theme: the page colour, black in dark. Right stays dark in
// both themes, so its colours are written out rather than taken from the
// theme roles. Its ground is a neutral near-black, #0b0b0d, not the page's
// black: in the dark theme the two panels would otherwise be one colour and
// the 40/60 split would not read. Its glow is our accent's hue (violet, about
// 270 degrees), as a radial gradient.
//
// Below 1024px the wordmark is 26px and starts 28px under the theme button,
// so the two do not crowd each other at the top of a phone screen. The frame is a placeholder for a screenshot of the
// dashboard and holds nothing, on purpose: no figures that could be read as
// data.

import React, { useEffect, useRef } from 'react';
import { useDisconnect } from 'wagmi';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useSignIn } from '../wallet/SignInProvider';
import { shortAddress } from '../wallet/useConnectedWallet';
import { useWalletButtons } from '../wallet/useWalletButtons';
import { SIGN_IN_BUTTON } from '../wallet/signInButton';
import Wordmark from '../shell/Wordmark';
import ThemeToggle from '../theme/ThemeToggle';

const primaryBtn = `w-full h-10 px-4 text-body ${SIGN_IN_BUTTON}`;
const outlineBtn = 'w-full h-10 px-4 rounded border border-line-strong text-fg text-body font-bold hover:bg-inset transition-colors disabled:opacity-60 flex items-center justify-center gap-2.5';

function InternalLink({ href, navigate, className, children }) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}

function Divider({ children }) {
  return (
    <div className="relative my-4 flex items-center" role="presentation">
      <span className="flex-1 border-t border-line-strong/40" />
      <span className="px-2 text-body text-muted">{children}</span>
      <span className="flex-1 border-t border-line-strong/40" />
    </div>
  );
}

function WalletChoices({ w, onStart }) {
  if (w.qr) {
    return (
      <div className="rounded border border-line-strong p-4 flex flex-col items-center text-center">
        <p className="text-body font-bold text-fg">Scan with {w.qr.name}</p>
        <p className="text-label text-muted mt-1 mb-3">Open {w.qr.name} on your phone and scan this code to connect.</p>
        <div className="bg-white p-3 rounded">
          <QRCodeCanvas value={w.qr.uri} size={184} />
        </div>
        <button type="button" onClick={w.cancel} className="mt-4 inline-flex items-center gap-1.5 text-body text-muted hover:text-fg">
          <ArrowLeft size={14} aria-hidden="true" /> All wallets
        </button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className={primaryBtn} onClick={() => { onStart(); w.openConnectModal?.(); }}>
        Connect wallet
      </button>
      <Divider>or choose a wallet</Divider>
      <div className="space-y-2">
        {w.wallets.map((wallet) => {
          const busy = w.pendingId === wallet.id;
          return (
            <button
              key={wallet.id}
              type="button"
              disabled={Boolean(w.pendingId) && !busy}
              onClick={() => { onStart(); w.connect(wallet); }}
              className={outlineBtn}
              title={wallet.id === 'base' ? "Base, Coinbase's wallet" : undefined}
            >
              {busy
                ? <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                : w.icons[wallet.id]
                  ? <img src={w.icons[wallet.id]} alt="" width={18} height={18} className="rounded-[4px]" />
                  : <span className="w-[18px]" aria-hidden="true" />}
              <span>{busy ? `Waiting for ${wallet.name}` : wallet.name}</span>
            </button>
          );
        })}
      </div>
      {w.pendingId && (
        <button type="button" onClick={w.cancel} className="mt-3 w-full text-center text-label text-muted hover:text-fg">
          Cancel
        </button>
      )}
    </>
  );
}

function Connected({ address, openSignIn, onSkip, onSwitch }) {
  return (
    <div className="space-y-2">
      <p className="text-body text-muted text-center mb-4">
        Connected as <span className="figure text-fg">{shortAddress(address)}</span>. Signing a message shows
        this page the wallet is yours. It moves no funds and costs no gas.
      </p>
      <button type="button" className={primaryBtn} onClick={() => openSignIn()}>Sign in</button>
      <button type="button" className={outlineBtn} onClick={onSkip}>Continue without signing</button>
      <button type="button" onClick={onSwitch} className="w-full h-9 text-label text-muted hover:text-fg">
        Use a different wallet
      </button>
    </div>
  );
}

function Showcase() {
  return (
    <div className="hidden lg:flex lg:w-3/5 relative overflow-hidden flex-col items-center px-12 pt-[100px] bg-[#0b0b0d] text-white">
      {/* The glow, our accent's hue, behind the top of the frame. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(52% 38% at 50% 50%, rgba(150, 82, 245, 0.42) 0%, rgba(150, 82, 245, 0.14) 45%, rgba(11, 11, 13, 0) 78%)' }}
      />
      <h2 className="relative text-center max-w-[640px]">
        <span className="block text-[34px] leading-[1.15] font-bold tracking-[-0.01em]">Wealth, borderless.</span>
        <span className="block mt-3 text-[20px] leading-snug font-normal text-[#b3b3b3]">
          Every tokenized equity, and what it really costs to buy.
        </span>
      </h2>

      {/* The screenshot frame, empty until there is a dashboard worth
          photographing: a desktop, and a phone overlapping its lower right. */}
      <div aria-hidden="true" className="relative mt-auto mb-[9vh] w-full max-w-[680px]">
        <div className="relative w-[88%]">
          <div className="rounded-t-[14px] border border-[#3a3a3c] border-t-[#7a52c7] bg-[#0c0c0d] p-[10px] pb-[14px]">
            <div className="rounded-[4px] border border-[#262628] bg-[#1a1a1b]" style={{ aspectRatio: '16 / 10' }} />
          </div>
          <div className="-mx-[4%] h-[12px] rounded-b-[12px] border border-t-0 border-[#3a3a3c] bg-[#161617]" />
        </div>
        <div className="absolute right-0 -bottom-[4%] w-[25%] rounded-[24px] border border-[#3a3a3c] border-t-[#7a52c7] bg-[#0c0c0d] p-[6px]">
          <div className="rounded-[18px] border border-[#262628] bg-[#1a1a1b]" style={{ aspectRatio: '9 / 19' }} />
        </div>
      </div>
    </div>
  );
}

export default function SignInPage({ navigate }) {
  const { status, address, openSignIn, closeSignIn } = useSignIn();
  const { disconnect } = useDisconnect();
  const w = useWalletButtons();
  const startedHere = useRef(false);
  const previous = useRef(status);

  useEffect(() => {
    const prev = previous.current;
    previous.current = status;
    if (status === 'signed') {
      closeSignIn();
      navigate('/', { replace: true });
      return;
    }
    if (prev === 'disconnected' && status === 'connected' && startedHere.current) {
      startedHere.current = false;
      openSignIn();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="min-h-[100dvh] flex bg-page text-fg">
      <div className="relative w-full lg:w-2/5 min-h-[100dvh] flex flex-col px-6 sm:px-10 xl:px-[70px] pt-[76px] lg:pt-[100px] pb-8">
        <div className="absolute top-4 left-4">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-[436px] mx-auto flex-1 flex flex-col">
          <InternalLink href="/" navigate={navigate} className="self-center text-fg">
            <Wordmark className="text-[26px] lg:text-[40px]" />
          </InternalLink>

          <main className="flex-1 flex flex-col justify-center py-10">
            <h1 className="text-h1 font-bold text-center">Sign in</h1>
            <div className="mt-9">
              {status === 'connected' ? (
                <Connected
                  address={address}
                  openSignIn={openSignIn}
                  onSkip={() => navigate('/')}
                  onSwitch={() => disconnect()}
                />
              ) : status === 'signed' ? (
                <p className="text-body text-muted text-center">Signed in. Opening your dashboard.</p>
              ) : (
                <WalletChoices w={w} onStart={() => { startedHere.current = true; }} />
              )}
              {w.error && status === 'disconnected' && (
                <p role="alert" className="mt-3 text-label text-neg text-center">{w.error}</p>
              )}
            </div>
          </main>

          <footer className="text-center">
            <InternalLink href="/" navigate={navigate} className="inline-flex items-center gap-1 text-body text-fg hover:underline">
              Browse without a wallet <ChevronRight size={16} aria-hidden="true" />
            </InternalLink>
            <p className="mt-3 text-micro text-muted">
              There is no account and no password. Read{' '}
              <InternalLink href="/privacy" navigate={navigate} className="text-fg hover:underline">Privacy</InternalLink>
              {' '}and{' '}
              <InternalLink href="/docs/data-handling" navigate={navigate} className="text-fg hover:underline">Data handling</InternalLink>.
            </p>
          </footer>
        </div>
      </div>
      <Showcase />
    </div>
  );
}
