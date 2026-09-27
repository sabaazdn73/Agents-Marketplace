// trade/evmExecute.js
//
// The wallet side of an EVM buy (SPEC C.1 steps 4 to 6), through the app's
// one wagmi config. Three separate wallet prompts at most, each on its own
// click: switch the chain, approve the exact amount, sign the swap.
//
//   approve    only when the allowance to LI.FI's approval address is below
//              the amount, and for exactly the amount: never unlimited;
//   swap       LI.FI's transactionRequest passed through unchanged: `to`,
//              `data` and `value` as LI.FI sent them, and its gasLimit as
//              the gas. Before the wallet is asked, the request built here
//              is compared with the quote's, and any difference refuses it.
//
// Balances and allowances are read through the chain's public endpoint in
// wagmiConfig.js, never through our API.

import { readContract, writeContract, sendTransaction, switchChain, getChainId, waitForTransactionReceipt } from 'wagmi/actions';
import { erc20Abi } from 'viem';
import { wagmiConfig } from '../wagmiConfig';

export async function readBalance({ chainId, token, owner }) {
  return readContract(wagmiConfig, { chainId, address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
}

export async function readAllowance({ chainId, token, owner, spender }) {
  return readContract(wagmiConfig, { chainId, address: token, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
}

/** Ask the wallet to move to `chainId` if it is elsewhere. */
export async function ensureChain(chainId) {
  if (getChainId(wagmiConfig) === chainId) return;
  await switchChain(wagmiConfig, { chainId });
}

/** approve(spender, amount) for exactly `amount`, then one confirmation. */
export async function approveExact({ chainId, token, spender, amount }) {
  await ensureChain(chainId);
  const hash = await writeContract(wagmiConfig, { chainId, address: token, abi: erc20Abi, functionName: 'approve', args: [spender, amount] });
  const receipt = await waitForTransactionReceipt(wagmiConfig, { chainId, hash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error(`The approval failed on chain (transaction ${hash}).`);
  return hash;
}

const hexValue = (v) => {
  if (v == null || v === '') return 0n;
  return BigInt(v);
};

/** The request sent to the wallet, from LI.FI's transactionRequest. Throws
 *  if it would differ from LI.FI's in `to`, `data` or `value`. */
export function swapRequest(tr, chainId) {
  const req = {
    chainId,
    to: tr.to,
    data: tr.data,
    value: hexValue(tr.value),
    ...(tr.gasLimit ? { gas: BigInt(tr.gasLimit) } : {}),
  };
  if (req.to !== tr.to || req.data !== tr.data || req.value !== hexValue(tr.value)) {
    throw new Error('The transaction differs from the one LI.FI quoted; nothing was sent to the wallet.');
  }
  return req;
}

/** One signature: the swap, as LI.FI built it. */
export async function sendSwap({ chainId, transactionRequest }) {
  await ensureChain(chainId);
  const req = swapRequest(transactionRequest, chainId);
  return sendTransaction(wagmiConfig, req);
}

/** A wallet's refusal, told apart from a failure. */
export function walletErrorText(e) {
  const code = e?.code ?? e?.cause?.code;
  const name = e?.name || e?.cause?.name || '';
  if (code === 4001 || /UserRejected/i.test(name)) return 'You declined in the wallet. Nothing was sent.';
  return e?.shortMessage || e?.message || 'The wallet returned an error.';
}
