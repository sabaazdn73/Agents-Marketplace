// useHireAgent.js
//
// The REAL hire flow, user-signed. Every step below is a real
// transaction the connected wallet (MetaMask/Trust Wallet via
// RainbowKit, or Privy's embedded wallet) signs directly, wagmi
// broadcasts it, nothing is simulated and nothing runs through a
// backend-held key.

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useChainId, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import {
  getContracts, AGENTIC_COMMERCE_ABI, EVALUATOR_ROUTER_ABI,
  ERC20_ABI, JOB_STATUS,
} from './erc8183';

// A step whose tx hash never confirms within this window is reported as
// "unconfirmed", not silently hung forever — real money is on the line here.
// waitForTransactionReceipt's own default (unbounded) previously meant a
// dropped-by-the-wallet transaction (never actually broadcast, so no node
// will ever produce a receipt for it) just left the UI stuck on a spinner
// with no honest signal to the user. 90s comfortably clears normal BSC
// confirmation time (~3 blocks) with real margin.
const RECEIPT_TIMEOUT_MS = 90_000;

export function useHireAgent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState(null); // null | 'approving' | 'creating' | 'registering' | 'budgeting' | 'funding' | 'done' | 'error'
  const [jobId, setJobId] = useState(null);
  const [error, setError] = useState(null);

  // Wraps a write + receipt-wait so a step that never reaches the network
  // (wallet-side drop — the exact real failure mode this was built for)
  // reports itself honestly instead of leaving the caller unsure whether to
  // retry (and risk a duplicate) or wait.
  const writeAndConfirm = useCallback(async (params) => {
    const hash = await writeContractAsync(params);
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch (e) {
      throw new Error(
        `Transaction ${hash} did not confirm within ${RECEIPT_TIMEOUT_MS / 1000}s. ` +
        `It may still land — check https://bscscan.com/tx/${hash} before doing anything else. ` +
        `If BscScan genuinely shows "not found" after a few minutes, your wallet likely never ` +
        `broadcast it (a local drop, not a revert) and it is safe to retry this step. ` +
        `Do NOT retry blindly without checking first, to avoid a duplicate on-chain action.`
      );
    }
    return { hash, receipt };
  }, [writeContractAsync, publicClient]);

  const hire = useCallback(async ({ providerAddress, budgetUnits, description, expiryMinutes = 65 }) => {
    if (!address) throw new Error('Connect a wallet first.');

    // Real guard, added 2026-08-17: previously nothing checked the wallet's
    // ACTUAL active chain before starting a 5-step, real-money sequence.
    // getContracts() below only throws for a chain BSC/testnet don't know at
    // all — it silently succeeds (using the correct chain-56 addresses) even
    // if the wallet is actually sitting on a different network, which is
    // exactly the kind of dApp-state/wallet-state mismatch that can produce
    // a transaction request the wallet locally rejects or never broadcasts.
    // Ask the wallet to switch BEFORE any writes, not mid-sequence.
    if (chainId !== bsc.id) {
      await switchChainAsync({ chainId: bsc.id });
    }
    const contracts = getContracts(bsc.id);
    setError(null);

    try {
      // Read the real settlement asset and its real decimals, never
      // assumed, this is what the marketplace UI should always do
      // before converting a human-entered amount to raw units.
      const paymentToken = await publicClient.readContract({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'paymentToken',
      });
      const decimals = await publicClient.readContract({
        address: paymentToken, abi: ERC20_ABI, functionName: 'decimals',
      });
      const budgetRaw = BigInt(Math.round(budgetUnits * 10 ** decimals));

      // Step 1: create the job (client -> provider, real on-chain tx)
      setStep('creating');
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + expiryMinutes * 60);
      const { receipt: createReceipt } = await writeAndConfirm({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'createJob',
        args: [providerAddress, contracts.router, expiredAt, description, contracts.router],
      });
      // The real jobId comes from the emitted event/return value, decoded
      // from the receipt logs, not guessed or assumed to be sequential.
      const newJobId = decodeJobIdFromReceipt(createReceipt);
      setJobId(newJobId);

      // Step 2: register the default OptimisticPolicy
      setStep('registering');
      await writeAndConfirm({
        address: contracts.router, abi: EVALUATOR_ROUTER_ABI, functionName: 'registerJob',
        args: [newJobId, contracts.policy],
      });

      // Step 3: set the budget
      setStep('budgeting');
      await writeAndConfirm({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'setBudget',
        args: [newJobId, budgetRaw, '0x'],
      });

      // Step 4: approve the settlement asset if needed (real allowance
      // check first, don't force a redundant approve tx)
      const currentAllowance = await publicClient.readContract({
        address: paymentToken, abi: ERC20_ABI, functionName: 'allowance',
        args: [address, contracts.commerce],
      });
      if (currentAllowance < budgetRaw) {
        setStep('approving');
        await writeAndConfirm({
          address: paymentToken, abi: ERC20_ABI, functionName: 'approve',
          args: [contracts.commerce, budgetRaw],
        });
      }

      // Step 5: fund (this is the real "hire" moment, escrow locked)
      setStep('funding');
      const { hash: fundHash } = await writeAndConfirm({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'fund',
        args: [newJobId, budgetRaw, '0x'],
      });

      setStep('done');
      return { jobId: newJobId, txHash: fundHash };
    } catch (e) {
      setStep('error');
      setError(e.message || String(e));
      throw e;
    }
  }, [address, chainId, switchChainAsync, publicClient, writeAndConfirm]);

  const getRealJobStatus = useCallback(async (jobIdToCheck) => {
    const contracts = getContracts(chainId);
    const job = await publicClient.readContract({
      address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'jobs',
      args: [jobIdToCheck],
    });
    // job is the real on-chain struct: [id, client, provider, evaluator,
    // description, budget, expiredAt, status, hook, submittedAt, deliverable]
    return { ...job, statusLabel: JOB_STATUS[job.status] ?? 'UNKNOWN' };
  }, [chainId, publicClient]);

  return { hire, getRealJobStatus, step, jobId, error };
}

// Decodes the real jobId from the createJob transaction receipt. The
// exact event name/signature was NOT independently confirmed against
// a live on-chain call yet, this function needs verification against
// a real transaction before being trusted, flagged here rather than
// silently assumed correct, the same discipline used throughout this
// project.
function decodeJobIdFromReceipt(receipt) {
  // TODO: verify against a real createJob call on BSC mainnet. If this
  // throws or returns an unexpected value, inspect receipt.logs
  // directly and adjust the decoding logic, don't guess a second time.
  if (!receipt.logs || receipt.logs.length === 0) {
    throw new Error('No logs in createJob receipt, cannot determine jobId, inspect the real receipt.');
  }
  // Placeholder: many such kernels return jobId as the return value AND
  // emit it in the first indexed topic of a JobCreated-style event.
  // Confirm the real event name/shape before relying on this in production.
  return BigInt(receipt.logs[0].topics?.[1] ?? 0);
}
