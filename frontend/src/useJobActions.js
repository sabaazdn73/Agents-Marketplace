// useJobActions.js
//
// Real, direct-wagmi post-hire actions (dispute, approve early, claim
// refund) for jobs hired through the direct wagmi path (useHireAgent.js),
// the only hire path this product has (the Altana session path was
// removed 2026-09-03, see docs/limitations.md). "My Agents" lists jobs
// for whatever address wagmi says is connected, so the only way to
// sign an action for those jobs is a direct contract write through that
// same connected wallet, dispute() on the Policy contract, claimRefund()
// on the Commerce contract. Both ABIs already exist in erc8183.js.

import { useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useChainId, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import { getContracts, AGENTIC_COMMERCE_ABI, OPTIMISTIC_POLICY_ABI, EVALUATOR_ROUTER_ABI } from './erc8183';
import { addNotification } from './notifications';

const RECEIPT_TIMEOUT_MS = 90_000; // same timeout as useHireAgent.js

export function useJobActions() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  // Every action here moves money or closes a window on somebody's job, and
  // none of them told the notification centre anything: these were the only
  // wallet writes in the app whose outcome was recorded nowhere the user
  // could look for it afterwards. `notice` is supplied per action so the
  // entry says what happened rather than "transaction confirmed".
  const writeAndConfirm = useCallback(async (params, notice) => {
    const hash = await writeContractAsync(params);
    try {
      await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch (e) {
      // Sent but unconfirmed is exactly the case worth recording: the money
      // has moved and the user needs the hash to check it later.
      if (notice) {
        addNotification(
          `${notice.pending}, not yet confirmed`,
          'It was sent but could not be confirmed in time. It may still go through. '
          + `Check before trying again: https://bscscan.com/tx/${hash}`,
        );
      }
      throw new Error(
        `This is taking longer than expected (over ${RECEIPT_TIMEOUT_MS / 1000} seconds). ` +
        `Check its status here before trying again: https://bscscan.com/tx/${hash} . If it says ` +
        `"not found" after a few minutes, it never went through, and it's safe to retry.`
      );
    }
    if (notice) addNotification(notice.title, notice.body);
    return hash;
  }, [writeContractAsync, publicClient]);

  const ensureChain = useCallback(async () => {
    if (chainId !== bsc.id) await switchChainAsync({ chainId: bsc.id });
  }, [chainId, switchChainAsync]);

 /** Client-only, on-chain call to Policy.dispute(jobId), valid only
   * inside the dispute window; the contract reverts otherwise. */
  const disputeDirect = useCallback(async (jobId) => {
    if (!address) throw new Error('Connect a wallet first.');
    await ensureChain();
    const contracts = getContracts(bsc.id);
    return writeAndConfirm({
      address: contracts.policy, abi: OPTIMISTIC_POLICY_ABI, functionName: 'dispute',
      args: [BigInt(jobId)],
    }, {
      pending: `Job #${jobId}: dispute`,
      title: `Job #${jobId}: disputed`,
      body: 'You flagged this delivery inside the review window. Payment is held while it is resolved.',
    });
  }, [address, ensureChain, writeAndConfirm]);

 /** Real, confirmed gap fixed here (full hire-flow audit, 2026-08-28): the
 * router's own real `settle(jobId, evidence)`, a real, client-callable
   * "approve early" action letting a satisfied buyer release payment
   * immediately instead of waiting out the rest of the dispute window,
   * was never wired to ANY button in this app, on either hire path, despite
 * docs/README.md openly advertising "or you approve early" as a real
   * feature. Confirmed by grep: zero call sites for router.settle anywhere
   * in the UI before this fix (altana.js's own settleJob export was
   * dead code, same gap on the Altana session path's own hire panel,
 * since removed, see docs/limitations.md). Real, permanent action: once called, the job
   * moves to COMPLETED and can no longer be disputed, the contract itself
   * enforces the eligibility rule (job must be SUBMITTED), not
   * pre-guessed here, same discipline as claimRefundDirect below. */
  const approveDirect = useCallback(async (jobId) => {
    if (!address) throw new Error('Connect a wallet first.');
    await ensureChain();
    const contracts = getContracts(bsc.id);
    return writeAndConfirm({
      address: contracts.router, abi: EVALUATOR_ROUTER_ABI, functionName: 'settle',
      args: [BigInt(jobId), '0x'],
    }, {
      pending: `Job #${jobId}: approval`,
      title: `Job #${jobId}: approved and paid`,
      body: 'You released payment early instead of waiting out the review window. The job is now complete.',
    });
  }, [address, ensureChain, writeAndConfirm]);

 /** on-chain call to AgenticCommerce.claimRefund(jobId), the
   * guaranteed exit for a FUNDED job whose deadline passed with no
 * delivery. Reverts if the job isn't eligible; we don't
   * pre-guess eligibility here, the caller (JobStatusPanel) only shows
   * this action once it's read the on-chain state that makes it
   * eligible. */
  const claimRefundDirect = useCallback(async (jobId) => {
    if (!address) throw new Error('Connect a wallet first.');
    await ensureChain();
    const contracts = getContracts(bsc.id);
    return writeAndConfirm({
      address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'claimRefund',
      args: [BigInt(jobId)],
    }, {
      pending: `Job #${jobId}: refund`,
      title: `Job #${jobId}: refunded`,
      body: 'The deadline passed with nothing delivered, so you took your money back.',
    });
  }, [address, ensureChain, writeAndConfirm]);

  return { disputeDirect, approveDirect, claimRefundDirect };
}
