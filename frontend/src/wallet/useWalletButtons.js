// useWalletButtons.js
//
// One button per common wallet on the sign-in page, each connecting that
// wallet directly through the connectors RainbowKit already created
// (wagmiConfig.js, getDefaultConfig). No second wallet library, no new
// connector: the same objects RainbowKit's own modal uses.
//
// WHICH WALLETS
// RainbowKit 2.2's default list is Safe, Rainbow, Base, MetaMask and
// WalletConnect. Safe only connects from inside the Safe app, so it is left to
// the full list behind "Connect wallet". Base is Coinbase's wallet (the
// connector is Base Account, which Coinbase ships in place of the old
// Coinbase Wallet SDK); RainbowKit names it "Base" and so does this page.
//
// HOW EACH ONE CONNECTS, which is how RainbowKit's modal does it:
//   installed in this browser (an extension, found by EIP-6963 or by its
//     flag), or a wallet that opens its own window (Base, the MetaMask SDK):
//     connect directly.
//   WalletConnect: its own connector with WalletConnect's official modal,
//     which shows the QR code or the list of mobile wallets itself.
//   a mobile wallet over WalletConnect (Rainbow, or MetaMask with no
//     extension on a desktop): on a desktop the page shows the QR code for it,
//     drawn from the pairing link the connector emits (display_uri); on a
//     phone it opens the wallet app with that link.
// Anything not covered falls back to RainbowKit's full modal.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

export const SIGNIN_WALLET_IDS = ['metaMask', 'walletConnect', 'base', 'rainbow'];

const onPhone = () => typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

function isRejection(e) {
  const text = `${e?.name || ''} ${e?.shortMessage || ''} ${e?.message || ''}`;
  return e?.code === 4001 || /UserRejected|rejected|denied|reset/i.test(text);
}

export function useWalletButtons() {
  const { connectors, connectAsync } = useConnect();
  const { openConnectModal } = useConnectModal();
  const [pendingId, setPendingId] = useState(null);
  const [qr, setQr] = useState(null); // { id, name, uri }
  const [error, setError] = useState(null);
  const [icons, setIcons] = useState({});
  // Each attempt gets a number; a late answer from an attempt the visitor
  // backed out of does not overwrite the page's state.
  const attempt = useRef(0);

  const wallets = useMemo(() => SIGNIN_WALLET_IDS.map((id) => {
    const rk = connectors.find((c) => c.rkDetails?.id === id
      && (id !== 'walletConnect' || c.rkDetails?.isWalletConnectModalConnector));
    if (!rk) return null;
    // An extension announced through EIP-6963 is the one RainbowKit shows as
    // installed; prefer it to the fallback connector for the same wallet.
    const injected = rk.rkDetails?.rdns ? connectors.find((c) => c.id === rk.rkDetails.rdns) : null;
    return {
      id,
      name: rk.rkDetails?.name || rk.name,
      connector: injected || rk,
      details: rk.rkDetails || {},
      icon: injected?.icon || rk.rkDetails?.iconUrl,
    };
  }).filter(Boolean), [connectors]);

  const iconKey = wallets.map((w) => w.id).join(',');
  useEffect(() => {
    let off = false;
    wallets.forEach(async (w) => {
      try {
        const src = typeof w.icon === 'function' ? await w.icon() : w.icon;
        if (!off && typeof src === 'string') setIcons((p) => ({ ...p, [w.id]: src }));
      } catch { /* no icon; the name is on the button */ }
    });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iconKey]);

  const connect = useCallback(async (w) => {
    const mine = ++attempt.current;
    setError(null);
    setQr(null);
    setPendingId(w.id);
    const c = w.connector;
    const d = w.details;
    try {
      const needsUri = c.type === 'walletConnect' && !d.isWalletConnectModalConnector && c.id !== d.rdns;
      if (needsUri) {
        const phone = onPhone();
        const toLink = phone ? d.mobile?.getUri : d.qrCode?.getUri;
        if (!toLink) {
          setPendingId(null);
          openConnectModal?.();
          return;
        }
        const provider = await c.getProvider();
        provider.once('display_uri', (uri) => {
          if (attempt.current !== mine) return;
          const link = toLink(uri);
          if (phone) window.location.href = link;
          else setQr({ id: w.id, name: w.name, uri: link });
        });
      }
      await connectAsync({ connector: c });
    } catch (e) {
      if (attempt.current !== mine) return;
      setError(isRejection(e)
        ? `${w.name} did not connect: the request was declined or closed. Nothing was connected.`
        : `${w.name} did not connect${e?.shortMessage ? `: ${e.shortMessage}` : '.'}`);
    } finally {
      if (attempt.current === mine) {
        setPendingId(null);
        setQr(null);
      }
    }
  }, [connectAsync, openConnectModal]);

  /** Back out of a QR code or a wait. The wallet may still answer later; if it
   *  does, the connection stands, and the page follows the wallet's state. */
  const cancel = useCallback(() => {
    attempt.current += 1;
    setPendingId(null);
    setQr(null);
  }, []);

  return { wallets, icons, connect, cancel, pendingId, qr, error, openConnectModal };
}
