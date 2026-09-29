// trade/evmExecute.js
//
// The wallet side of an EVM buy (SPEC C.1 steps 4 to 6), through the app's
// one wagmi config. Three separate wallet prompts at most, each on its own
// click: switch the chain, approve the exact amount, sign the swap.
//
//   approve    only when the allowance to LI.FI's approval address is below
//              the amount, and for exactly the amount: never unlimited;
//   swap       LI.FI's transactionRequest passed through: `to` and `data`
//              are LI.FI's own values, not copied or re-encoded, `value` is
//              LI.FI's hex read as a number, and its gasLimit is the gas.
//              What the wallet receives was checked against the quote at the
//              wallet in the headless run (scratchpad t4a), not here.
//
// Balances and allowances are read through the chain's public endpoint in
// wagmiConfig.js, never through our API.
//
// `config` is the wagmi config to act through. Every caller on the site
// leaves it out and gets the site's one config; the signing page
// (sign/SignOrderPage.jsx) passes its own, which knows the buy chains while
// the site's does not.

import { readContract, writeContract, sendTransaction, switchChain, getChainId, waitForTransactionReceipt } from 'wagmi/actions';
import { erc20Abi } from 'viem';
import { wagmiConfig } from '../wagmiConfig';

export async function readBalance({ chainId, token, owner, config = wagmiConfig }) {
  return readContract(config, { chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
}

export async function readAllowance({ chainId, token, owner, spender, config = wagmiConfig }) {
  return readContract(config, { chainId, address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
}

/** Ask the wallet to move to `chainId` if it is elsewhere. */
export async function ensureChain(chainId, config = wagmiConfig) {
  if (getChainId(config) === chainId) return;
  await switchChain(config, { chainId });
}

/** approve(spender, amount) for exactly `amount`, then one confirmation. */
export async function approveExact({ chainId, token, spender, amount, config = wagmiConfig }) {
  await ensureChain(chainId, config);
  const hash = await writeContract(config, { chainId, address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] });
  const receipt = await waitForTransactionReceipt(config, { chainId, hash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error(`The approval failed on chain (transaction ${hash}).`);
  return hash;
}

/** The request sent to the wallet, from LI.FI's transactionRequest. */
export function swapRequest(tr, chainId) {
  return {
    chainId,
    to: tr.to,
    data: tr.data,
    value: tr.value == null || tr.value === '' ? 0n : BigInt(tr.value),
    ...(tr.gasLimit ? { gas: BigInt(tr.gasLimit) } : {}),
  };
}

/** One signature: the swap, as LI.FI built it. */
export async function sendSwap({ chainId, transactionRequest, config = wagmiConfig }) {
  await ensureChain(chainId, config);
  const req = swapRequest(transactionRequest, chainId);
  return sendTransaction(config, req);
}

/** A wallet's refusal, told apart from a failure, wherever in the error's
 *  chain of causes the wallet put its 4001 (viem and wagmi wrap it). */
export function walletErrorText(e) {
  for (let x = e, depth = 0; x && depth < 10; x = x.cause, depth += 1) {
    if (x.code === 4001 || /UserRejected/i.test(x.name || '') || /user rejected|user denied/i.test(x.message || '')) {
      return 'You declined in the wallet. Nothing was sent.';
    }
  }
  return e?.shortMessage || e?.message || 'The wallet returned an error.';
}
