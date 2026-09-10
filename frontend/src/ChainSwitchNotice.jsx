// ChainSwitchNotice.jsx
//
// Shown when the wallet is on a chain where the action the user is looking at
// cannot happen. It names the chain they are on, names the chains where the
// action does work, and offers to switch.
//
// The point of this component is to fail EARLY and in words, not late and in
// a wallet dialog. Without it the sequence is: user fills in a form, presses
// the button, the wallet pops up, and either the transaction reverts or it
// silently targets a contract that does not exist at that address on that
// chain. The address collision documented in chainContracts.js makes the
// second outcome realistic rather than theoretical.
//
// Not every wallet can switch. Hardware wallets, some in-app browsers, and
// any wallet that has not been told about a chain will reject
// wallet_switchEthereumChain. When that happens we say so and tell the user
// to switch manually, rather than leaving a spinner running or pretending the
// switch worked. The two cases worth distinguishing are handled explicitly:
// 4902 (chain unknown to the wallet) and 4001 (user rejected).
//
// Shared by web and mobile deliberately; both render the same component so
// the wording cannot drift between them.

import React, { useState } from 'react';
import { useSwitchChain } from 'wagmi';
import { AlertTriangle, Loader2, ArrowLeftRight } from 'lucide-react';
import { chainName } from './chainContracts';

export default function ChainSwitchNotice({
  currentChainId,
  targetChainIds = [],
  reason,
  actionLabel = 'this action',
  className = '',
}) {
  const { switchChainAsync } = useSwitchChain();
  const [busy, setBusy] = useState(null);
  const [failure, setFailure] = useState(null);

  const targets = targetChainIds.filter((c) => Number(c) !== Number(currentChainId));

  async function go(target) {
    setBusy(target);
    setFailure(null);
    try {
      await switchChainAsync({ chainId: Number(target) });
      // Deliberately no success state: on success this component unmounts,
      // because the parent re-renders against the new chain.
    } catch (err) {
      const code = err?.code ?? err?.cause?.code;
      if (code === 4001) {
        setFailure('You dismissed the switch request, so nothing changed.');
      } else if (code === 4902) {
        setFailure(
          `Your wallet doesn't know about ${chainName(target)} yet and wouldn't add it automatically. `
          + 'Add the network in your wallet, then come back to this page.',
        );
      } else {
        setFailure(
          `Your wallet refused to switch to ${chainName(target)}`
          + `${err?.shortMessage ? ` (${err.shortMessage})` : ''}. `
          + 'Some wallets can\'t switch chains from a website — switch manually in your wallet and this page will follow.',
        );
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-[12px] text-amber-700 dark:text-amber-400 ${className}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold">
            {actionLabel} isn&apos;t available on {chainName(currentChainId)}.
          </p>
          {reason && <p className="mt-1 opacity-90">{reason}</p>}

          {targets.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {targets.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => go(t)}
                  disabled={busy !== null}
                  // 44px minimum touch target, per the platform guidance the
                  // rest of the app follows.
                  className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[12px] font-semibold"
                >
                  {busy === t
                    ? <Loader2 size={13} className="animate-spin" />
                    : <ArrowLeftRight size={13} />}
                  Switch to {chainName(t)}
                </button>
              ))}
            </div>
          )}

          {failure && (
            <p className="mt-2 text-red-600 dark:text-red-400">{failure}</p>
          )}
        </div>
      </div>
    </div>
  );
}
