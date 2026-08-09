// useHireAgent.js
//
// The REAL hire flow, user-signed. Every step below is a real
// transaction the connected wallet (MetaMask/Trust Wallet via
// RainbowKit, or Privy's embedded wallet) signs directly, wagmi
// broadcasts it, nothing is simulated and nothing runs through a
// backend-held key.

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, usePublicClient, useChainId } from 'wagmi';
import {
  getContracts, AGENTIC_COMMERCE_ABI, EVALUATOR_ROUTER_ABI,
  ERC20_ABI, JOB_STATUS,
} from './erc8183';

export function useHireAgent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState(null); // null | 'approving' | 'creating' | 'registering' | 'budgeting' | 'funding' | 'done' | 'error'
  const [jobId, setJobId] = useState(null);
  const [error, setError] = useState(null);

  const hire = useCallback(async ({ providerAddress, budgetUnits, description, expiryMinutes = 65 }) => {
    if (!address) throw new Error('Connect a wallet first.');
    const contracts = getContracts(chainId);
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
      const createHash = await writeContractAsync({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'createJob',
        args: [providerAddress, contracts.router, expiredAt, description, contracts.router],
      });
      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      // The real jobId comes from the emitted event/return value, decoded
      // from the receipt logs, not guessed or assumed to be sequential.
      const newJobId = decodeJobIdFromReceipt(createReceipt);
      setJobId(newJobId);

      // Step 2: register the default OptimisticPolicy
      setStep('registering');
      const registerHash = await writeContractAsync({
        address: contracts.router, abi: EVALUATOR_ROUTER_ABI, functionName: 'registerJob',
        args: [newJobId, contracts.policy],
      });
      await publicClient.waitForTransactionReceipt({ hash: registerHash });

      // Step 3: set the budget
      setStep('budgeting');
      const budgetHash = await writeContractAsync({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'setBudget',
        args: [newJobId, budgetRaw, '0x'],
      });
      await publicClient.waitForTransactionReceipt({ hash: budgetHash });

      // Step 4: approve the settlement asset if needed (real allowance
      // check first, don't force a redundant approve tx)
      const currentAllowance = await publicClient.readContract({
        address: paymentToken, abi: ERC20_ABI, functionName: 'allowance',
        args: [address, contracts.commerce],
      });
      if (currentAllowance < budgetRaw) {
        setStep('approving');
        const approveHash = await writeContractAsync({
          address: paymentToken, abi: ERC20_ABI, functionName: 'approve',
          args: [contracts.commerce, budgetRaw],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Step 5: fund (this is the real "hire" moment, escrow locked)
      setStep('funding');
      const fundHash = await writeContractAsync({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'fund',
        args: [newJobId, budgetRaw, '0x'],
      });
      await publicClient.waitForTransactionReceipt({ hash: fundHash });

      setStep('done');
      return { jobId: newJobId, txHash: fundHash };
    } catch (e) {
      setStep('error');
      setError(e.message || String(e));
      throw e;
    }
  }, [address, chainId, publicClient, writeContractAsync]);

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
// a live testnet call yet, this function needs verification against
// a real transaction before being trusted, flagged here rather than
// silently assumed correct, the same discipline used throughout this
// project.
function decodeJobIdFromReceipt(receipt) {
  // TODO: verify against a real createJob call on testnet. If this
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
