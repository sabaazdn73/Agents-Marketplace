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
// A wallet that does not have the chain is OFFERED it, through
// wallet_addEthereumChain, rather than being told to go and add it by hand.
// Telling someone to leave the page and configure a network themselves is a
// poor answer when the request exists. Robinhood Chain is the case that
// matters, since no wallet ships with it. Only if the add is refused or fails
// does the manual instruction appear.
//
// Note this component is no longer on the hiring path. Hiring switches as
// part of funding, the way BNB Chain hiring is one action. This is still used
// where an action genuinely cannot happen on the current chain at all.
//
// Shared by web and mobile deliberately; both render the same component so
// the wording cannot drift between them.

import React, { useState } from 'react';
import { useSwitchChain } from 'wagmi';
import { AlertTriangle, Loader2, ArrowLeftRight } from 'lucide-react';
import { chainName } from './chainContracts';

/** Chain parameters handed to the wallet when it has to ADD a chain.
 *
 * wagmi's connector calls wallet_addEthereumChain itself when the wallet
 * answers a real 4902, deriving most of this from the chain definition. These
 * are passed explicitly anyway so the entry a user ends up with is a good one:
 * a name they recognise, the explorer, and the RPC this project actually
 * verified rather than whichever happens to be first in the definition.
 *
 * Robinhood Chain is the case that matters. No wallet ships with it, so it
 * will always take the add path, and what it adds is what the user keeps. */
const ADD_CHAIN_PARAMS = {
  4663: {
    chainName: 'Robinhood Chain',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
    blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
  },
  42161: {
    chainName: 'Arbitrum One',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://arb1.arbitrum.io/rpc'],
    blockExplorerUrls: ['https://arbiscan.io'],
  },
};

/** Ask the wallet to switch, adding the chain if it does not have it.
 *
 * Throws an Error whose message is meant to be shown to a user as-is.
 *
 * The message discrimination here is the point. Before 2026-09-10 this read
 * `err.code === 4902` and said "your wallet doesn't know about this chain",
 * which was reported as wrong by a user whose MetaMask has had Arbitrum since
 * install. It was wrong: viem gives its SwitchChainError class a static
 * `code = 4902`, the same code MetaMask uses for an unknown chain, and wagmi
 * throws that error WITHOUT ASKING THE WALLET when the chain is missing from
 * the app's own wagmi config. So an app configuration bug arrived wearing the
 * wallet's error code and got reported to the user as their problem.
 *
 * Both causes are now separated by name rather than by code, and the config
 * case says plainly that it is ours. */
export async function switchToChain(switchChainAsync, targetChainId) {
  const target = Number(targetChainId);
  try {
    await switchChainAsync({
      chainId: target,
      addEthereumChainParameter: ADD_CHAIN_PARAMS[target],
    });
  } catch (err) {
    const name = err?.name || err?.cause?.name;
    const code = err?.code ?? err?.cause?.code;

    // Not the wallet's doing. The chain is missing from wagmiConfig.js, so
    // nothing was ever requested. Named explicitly because this used to be
    // reported to users as a wallet problem.
    if (name === 'ChainNotConfiguredError' || err?.cause?.name === 'ChainNotConfiguredError') {
      throw new Error(
        `${chainName(target)} isn't configured in this app, so the switch was never sent to your wallet. `
        + 'That is a bug on our side, not a problem with your wallet.',
      );
    }
    if (code === 4001 || name === 'UserRejectedRequestError') {
      throw new Error('You dismissed the request in your wallet, so nothing changed.');
    }
    // A genuine 4902 is handled by wagmi, which follows it with
    // wallet_addEthereumChain. Reaching here means the add itself failed or
    // was refused.
    throw new Error(
      `Your wallet wouldn't switch to ${chainName(target)}`
      + `${err?.shortMessage ? ` (${err.shortMessage})` : ''}. `
      + 'If it offered to add the network and you declined, try again and accept. '
      + 'Some wallets cannot switch chains from a website at all, in which case switch '
      + 'manually and this page will follow.',
    );
  }
}

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
      await switchToChain(switchChainAsync, target);
      // No success state on purpose: on success this unmounts, because the
      // parent re-renders against the new chain.
    } catch (err) {
      setFailure(err.message);
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
