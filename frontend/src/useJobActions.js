// useJobActions.js
//
// Real, direct-wagmi post-hire actions (dispute, claim refund) for jobs
// hired through the DIRECT wagmi path (useHireAgent.js) — as opposed to
// AltanaSessionPanel's jobs, which go through the Altana SDK relay
// (settleErc8183Job/buildClaimRefundCall) because THAT wallet is an Altana
// passkey wallet + session, not the connected wagmi wallet.
//
// Real technical reason this exists separately rather than reusing
// altana.js's disputeJob/settleJob: those call the Altana SDK's
// settleErc8183Job(wallet, signer, ...), which expects an Altana Wallet +
// Signer object — not a wagmi-connected wallet. "My Agents" lists jobs for
// whatever address wagmi says is connected, so the only real, honest way to
// sign an action for those jobs is a direct contract write through THAT
// same connected wallet — dispute() on the Policy contract, claimRefund()
// on the Commerce contract. Both ABIs already exist in erc8183.js.

import { useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useChainId, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { getContracts, AGENTIC_COMMERCE_ABI, OPTIMISTIC_POLICY_ABI } from './erc8183';

const RECEIPT_TIMEOUT_MS = 90_000; // same honest timeout as useHireAgent.js

export function useJobActions() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const writeAndConfirm = useCallback(async (params) => {
    const hash = await writeContractAsync(params);
    try {
      await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch (e) {
      throw new Error(
        `This is taking longer than expected (over ${RECEIPT_TIMEOUT_MS / 1000} seconds). ` +
        `Check its status here before trying again: https://bscscan.com/tx/${hash} . If it says ` +
        `"not found" after a few minutes, it never actually went through, and it's safe to retry.`
      );
    }
    return hash;
  }, [writeContractAsync, publicClient]);

  const ensureChain = useCallback(async () => {
    if (chainId !== bsc.id) await switchChainAsync({ chainId: bsc.id });
  }, [chainId, switchChainAsync]);

  /** Client-only, real on-chain call to Policy.dispute(jobId) — valid only
   * inside the dispute window; the contract reverts otherwise. */
  const disputeDirect = useCallback(async (jobId) => {
    if (!address) throw new Error('Connect a wallet first.');
    await ensureChain();
    const contracts = getContracts(bsc.id);
    return writeAndConfirm({
      address: contracts.policy, abi: OPTIMISTIC_POLICY_ABI, functionName: 'dispute',
      args: [BigInt(jobId)],
    });
  }, [address, ensureChain, writeAndConfirm]);

  /** Real on-chain call to AgenticCommerce.claimRefund(jobId) — the
   * guaranteed exit for a FUNDED job whose deadline passed with no
   * delivery. Reverts if the job isn't actually eligible; we don't
   * pre-guess eligibility here, the caller (JobStatusPanel) only shows
   * this action once it's read the real on-chain state that makes it
   * eligible. */
  const claimRefundDirect = useCallback(async (jobId) => {
    if (!address) throw new Error('Connect a wallet first.');
    await ensureChain();
    const contracts = getContracts(bsc.id);
    return writeAndConfirm({
      address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'claimRefund',
      args: [BigInt(jobId)],
    });
  }, [address, ensureChain, writeAndConfirm]);

  return { disputeDirect, claimRefundDirect };
}
