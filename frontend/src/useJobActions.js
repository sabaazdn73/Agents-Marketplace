// useJobActions.js
//
// Real, direct-wagmi post-hire actions (dispute, approve early, claim
// refund) for jobs hired through the direct wagmi path (useHireAgent.js),
// the only real hire path this product has (the Altana session path was
// removed 2026-09-03, see docs/limitations.md). "My Agents" lists jobs
// for whatever address wagmi says is connected, so the only honest way to
// sign an action for those jobs is a direct contract write through that
// same connected wallet — dispute() on the Policy contract, claimRefund()
// on the Commerce contract. Both ABIs already exist in erc8183.js.

import { useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useChainId, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { getContracts, AGENTIC_COMMERCE_ABI, OPTIMISTIC_POLICY_ABI, EVALUATOR_ROUTER_ABI } from './erc8183';

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
        `"not found" after a few minutes, it never went through, and it's safe to retry.`
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

  /** Real, confirmed gap fixed here (full hire-flow audit, 2026-08-28): the
   * router's own real `settle(jobId, evidence)` — a real, client-callable
   * "approve early" action letting a satisfied buyer release payment
   * immediately instead of waiting out the rest of the dispute window —
   * was never wired to ANY button in this app, on either hire path, despite
   * docs/README.md openly advertising "or you approve early" as a real
   * feature. Confirmed by grep: zero call sites for router.settle anywhere
   * in the actual UI before this fix (altana.js's own settleJob export was
   * dead code, same gap on the Altana session path's own hire panel,
   * since removed — see docs/limitations.md). Real, permanent action: once called, the job
   * moves to COMPLETED and can no longer be disputed — the contract itself
   * enforces the real eligibility rule (job must be SUBMITTED), not
   * pre-guessed here, same discipline as claimRefundDirect below. */
  const approveDirect = useCallback(async (jobId) => {
    if (!address) throw new Error('Connect a wallet first.');
    await ensureChain();
    const contracts = getContracts(bsc.id);
    return writeAndConfirm({
      address: contracts.router, abi: EVALUATOR_ROUTER_ABI, functionName: 'settle',
      args: [BigInt(jobId), '0x'],
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

  return { disputeDirect, approveDirect, claimRefundDirect };
}
