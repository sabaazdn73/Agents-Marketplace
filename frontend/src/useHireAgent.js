// useHireAgent.js
//
// The REAL hire flow, user-signed. Every step below is a real
// transaction the connected wallet (MetaMask/Trust Wallet via
// RainbowKit, or Privy's embedded wallet) signs directly, wagmi
// broadcasts it, nothing is simulated and nothing runs through a
// backend-held key.
//
// Step tracking is granular on purpose (completedSteps/skippedSteps/
// stepHashes below), added 2026-08-17 to drive a real, visible step
// checklist in the UI (StepChecklist.jsx) — the exact same real state
// this hook already tracked internally, just exposed instead of thrown
// away. Real bug fixed here too: `step` used to be overwritten with the
// literal string 'error' on failure, which lost which of the 5 steps was
// actually active when it failed — exactly the ambiguity a checklist is
// supposed to resolve. Now `step` always stays the real last-active step
// name; `error` (already existed) is the separate error signal, so the
// UI can point at the right row.

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useSignTypedData, usePublicClient, useChainId, useSwitchChain } from 'wagmi';
import { bsc } from 'wagmi/chains';
import {
  getContracts, AGENTIC_COMMERCE_ABI, EVALUATOR_ROUTER_ABI,
  OPTIMISTIC_POLICY_ABI, ERC20_ABI, JOB_STATUS,
} from './erc8183';
import { negotiateJob, buildJobDescription, negotiatedPriceRaw, notifyFunded, buildNotifyAuthorization } from './erc8183Negotiate';

// The one real, confirmed seller-side convention (2026-08-24, live
// stockanalyst-agent) for "this job's notify_funded call MUST carry a real
// EIP-712-signed authorization or it's unconditionally rejected" — see
// buildNotifyAuthorization's own docstring in erc8183Negotiate.js for the
// full trace. Read off the NEGOTIATED terms (echoed back in the on-chain
// description via buildJobDescription), not hardcoded to one agent —
// general on purpose, any seller using this same convention gets the same
// real treatment automatically.
const NOTIFY_CONTEXT_REQUIRED_CRITERION = 'uomp_notify_context_required_v1';

// Generic quality terms sent with every real negotiate attempt. Deliberately
// broad/neutral — this flow doesn't know the specifics of an arbitrary
// marketplace agent's work, unlike the explainer-agent's own scripted test
// jobs which used task-specific terms. A strict seller only needs SOME
// structured terms to sign a quote against; the actual work spec it reads
// back is the on-chain description's own `task` field (the same description
// text this flow already passed in).
const DEFAULT_NEGOTIATE_TERMS = {
  deliverables: 'A completed response to the task described above.',
  quality_standards: 'Accurate, on-topic, and responsive to what was asked.',
};

// A step whose tx hash never confirms within this window is reported as
// "unconfirmed", not silently hung forever — real money is on the line here.
// waitForTransactionReceipt's own default (unbounded) previously meant a
// dropped-by-the-wallet transaction (never actually broadcast, so no node
// will ever produce a receipt for it) just left the UI stuck on a spinner
// with no honest signal to the user. 90s comfortably clears normal BSC
// confirmation time (~3 blocks) with real margin.
const RECEIPT_TIMEOUT_MS = 90_000;

// The real, ordered step keys — matches HIRE_STEP_COPY below and the
// actual execution order in `hire()`. 'approving' is genuinely conditional
// (skipped when the existing allowance already covers the budget).
// 'negotiating' is also genuinely conditional — added 2026-08-22 after a
// real, confirmed incident (job #56636): a strict ERC-8183 seller
// PERMANENTLY rejects a job whose on-chain description carries no signed
// quote. Skipped (not errored) for the many marketplace agents that don't
// implement `negotiate` at all — see erc8183Negotiate.js for the real
// investigation and why a failure here always falls back cleanly rather
// than blocking the hire.
//
// 'notifying' — added 2026-08-24 after a real, confirmed gap: funding a job
// was never actually telling the seller to start work (see
// erc8183Negotiate.js's notifyFunded() for the full trace, found via job
// #56646 sitting funded with zero delivery activity). Genuinely conditional
// same as negotiating: an agent that doesn't implement notify_funded (or is
// briefly unreachable) skips cleanly here — the job is ALREADY funded
// on-chain by this point, so this step can never fail the hire, only note
// that delivery might rely on the agent's own sweep instead.
export const HIRE_STEPS = ['negotiating', 'creating', 'registering', 'budgeting', 'approving', 'funding', 'notifying'];

// Real, confirmed incident (2026-08-22): our own explainer agent only ever
// accepts a job whose description carries a signed quote (verify_signed_job
// permanently rejects a plain-text one) — hire() above already negotiates
// automatically so this "just works" invisibly. But the user is still left
// GUESSING at a budget beforehand: for an agent with a real, knowable fixed
// price, showing a blank/arbitrary default and letting them find out only
// after funding is a real, avoidable gap. This hook runs the SAME real
// negotiate call ahead of time, purely for display — `hire()` still
// negotiates fresh at execution time (a quote has a real TTL; reusing a
// stale one here would be wrong), so this never substitutes for that, only
// previews it.
export function useAgentQuote(agent) {
  const publicClient = usePublicClient();
  // status: 'idle' | 'loading' | 'available' | 'unavailable'
  const [state, setState] = useState({ status: 'idle' });

  useEffect(() => {
    if (!agent?.ownerAddress) { setState({ status: 'idle' }); return; }
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      try {
        const description = `Hire via Tnega: ${agent.name}`;
        const negotiationResult = await negotiateJob(agent.ownerAddress, description, DEFAULT_NEGOTIATE_TERMS);
        const priceRaw = negotiationResult ? negotiatedPriceRaw(negotiationResult) : null;
        if (cancelled) return;
        if (!negotiationResult || priceRaw == null) {
          setState({ status: 'unavailable' });
          return;
        }
        // Real decimals for the real settlement token — never assumed.
        const contracts = getContracts(bsc.id);
        const paymentToken = await publicClient.readContract({
          address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'paymentToken',
        });
        const decimals = await publicClient.readContract({
          address: paymentToken, abi: ERC20_ABI, functionName: 'decimals',
        });
        if (cancelled) return;
        setState({
          status: 'available',
          priceUnits: Number(priceRaw) / 10 ** decimals,
          priceRaw, decimals,
        });
      } catch (e) {
        if (!cancelled) setState({ status: 'unavailable' });
      }
    })();
    return () => { cancelled = true; };
  }, [agent?.ownerAddress, agent?.name, publicClient]);

  return state;
}

export function useHireAgent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [step, setStep] = useState(null); // null | 'creating' | 'registering' | 'budgeting' | 'approving' | 'funding' | 'done'
  const [jobId, setJobId] = useState(null);
  const [error, setError] = useState(null);
  const [completedSteps, setCompletedSteps] = useState([]); // step keys that really finished this run
  const [skippedSteps, setSkippedSteps] = useState([]);      // step keys genuinely not needed this run
  const [stepHashes, setStepHashes] = useState({});          // { [stepKey]: realTxHash }
  const [notifySkipReason, setNotifySkipReason] = useState(null); // real reason the 'notifying' step didn't complete, if any

  // Wraps a write + receipt-wait so a step that never reaches the network
  // (wallet-side drop — the exact real failure mode this was built for)
  // reports itself honestly instead of leaving the caller unsure whether to
  // retry (and risk a duplicate) or wait. Records the real hash against
  // `stepKey` and marks it complete only once a real receipt confirms it.
  const writeAndConfirm = useCallback(async (stepKey, params) => {
    const hash = await writeContractAsync(params);
    setStepHashes((prev) => ({ ...prev, [stepKey]: hash }));
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch (e) {
      throw new Error(
        `This step is taking longer than expected to go through (over ${RECEIPT_TIMEOUT_MS / 1000} seconds). ` +
        `It might still complete — check its status here before doing anything else: https://bscscan.com/tx/${hash} . ` +
        `If that page says the transaction was never found after a few minutes, it likely never left your ` +
        `wallet, and it's safe to try this step again. Please check first, though — trying again without checking ` +
        `could end up paying twice.`
      );
    }
    setCompletedSteps((prev) => [...prev, stepKey]);
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
    setCompletedSteps([]);
    setSkippedSteps([]);
    setStepHashes({});
    setNotifySkipReason(null);
    setJobId(null);

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

      // Step 0: real, best-effort negotiate — see erc8183Negotiate.js for
      // the full investigation (job #56636's permanent rejection, traced to
      // a missing signed quote). Never blocks the hire: any failure here
      // (agent doesn't support negotiate, isn't reachable, or genuinely
      // rejected the terms) falls back to the exact plain-description flow
      // this hook already had — the only difference for those agents is a
      // few real seconds spent finding out negotiate isn't available.
      setStep('negotiating');
      let finalDescription = description;
      let finalBudgetRaw = budgetRaw;
      let negotiationSucceeded = false;
      let requiresNotifyAuthorization = false;
      try {
        const negotiationResult = await negotiateJob(providerAddress, description, DEFAULT_NEGOTIATE_TERMS);
        const price = negotiationResult ? negotiatedPriceRaw(negotiationResult) : null;
        if (negotiationResult && price != null) {
          finalDescription = buildJobDescription(negotiationResult);
          // Never fund less than the agreed price (verify_signed_job requires
          // budget >= price); respect a higher user-chosen spend cap as-is.
          finalBudgetRaw = budgetRaw > price ? budgetRaw : price;
          negotiationSucceeded = true;
          requiresNotifyAuthorization = negotiationResult.response?.terms?.success_criteria === NOTIFY_CONTEXT_REQUIRED_CRITERION;
        }
      } catch (e) {
        // Real, non-fatal: treat a malformed/unexpected negotiate response
        // exactly like an agent that never supported negotiate at all.
      }
      if (negotiationSucceeded) {
        setCompletedSteps((prev) => [...prev, 'negotiating']);
      } else {
        setSkippedSteps((prev) => [...prev, 'negotiating']);
      }

      // Step 1: create the job (client -> provider, real on-chain tx)
      //
      // Real bug fixed 2026-08-19: expiredAt used to be just
      // `now + expiryMinutes*60`, with no idea the on-chain seller's REAL
      // submission cutoff is `expiredAt - disputeWindow`, not `expiredAt`
      // itself (confirmed against bnbagent's own buy_workflow, which pads
      // for exactly this). OptimisticPolicy's real disputeWindow is 7 DAYS
      // — so every job created with the old formula was already past its
      // real submission deadline the moment it was created, regardless of
      // how fast any agent worked. Job #56611 (2026-08-19) died this way:
      // funded, notify_funded accepted, but the on-chain submit() the agent
      // attempted was rejected because the real cutoff had already passed
      // at creation time — read live and confirmed after the fact.
      //
      // Fix: read the real disputeWindow and pad for it, so `expiryMinutes`
      // means what it looks like it means — real usable processing time
      // from now, not a number that gets silently swallowed by a 7-day
      // window nobody here knew about.
      setStep('creating');
      const disputeWindowSeconds = await publicClient.readContract({
        address: contracts.policy, abi: OPTIMISTIC_POLICY_ABI, functionName: 'disputeWindow',
      });
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + expiryMinutes * 60) + disputeWindowSeconds;
      const { receipt: createReceipt } = await writeAndConfirm('creating', {
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'createJob',
        args: [providerAddress, contracts.router, expiredAt, finalDescription, contracts.router],
      });
      // The real jobId comes from the emitted event/return value, decoded
      // from the receipt logs, not guessed or assumed to be sequential.
      const newJobId = decodeJobIdFromReceipt(createReceipt);
      setJobId(newJobId);

      // Step 2: register the default OptimisticPolicy
      setStep('registering');
      await writeAndConfirm('registering', {
        address: contracts.router, abi: EVALUATOR_ROUTER_ABI, functionName: 'registerJob',
        args: [newJobId, contracts.policy],
      });

      // Step 3: set the budget
      setStep('budgeting');
      await writeAndConfirm('budgeting', {
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'setBudget',
        args: [newJobId, finalBudgetRaw, '0x'],
      });

      // Step 4: approve the settlement asset if needed (real allowance
      // check first, don't force a redundant approve tx)
      const currentAllowance = await publicClient.readContract({
        address: paymentToken, abi: ERC20_ABI, functionName: 'allowance',
        args: [address, contracts.commerce],
      });
      if (currentAllowance < finalBudgetRaw) {
        setStep('approving');
        await writeAndConfirm('approving', {
          address: paymentToken, abi: ERC20_ABI, functionName: 'approve',
          args: [contracts.commerce, finalBudgetRaw],
        });
      } else {
        setSkippedSteps((prev) => [...prev, 'approving']);
      }

      // Step 5: fund (this is the real "hire" moment, escrow locked)
      setStep('funding');
      const { hash: fundHash } = await writeAndConfirm('funding', {
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'fund',
        args: [newJobId, finalBudgetRaw, '0x'],
      });

      // Step 6: tell the seller agent to start work. Real, confirmed gap
      // fixed 2026-08-24 (see erc8183Negotiate.js's notifyFunded): funding
      // alone never reached the agent — a strict seller's own background
      // sweep only runs as a side effect of ANOTHER buyer's notify landing
      // first, so a job could sit funded forever with nothing to trigger
      // delivery. Best-effort and NEVER fatal: the job is already funded
      // on-chain by this point, so a failure here can only mean slower
      // delivery, never a failed hire.
      setStep('notifying');
      let notifySucceeded = false;
      let notifyReason = null;
      try {
        // Real, confirmed requirement (2026-08-24, see NOTIFY_CONTEXT_REQUIRED_CRITERION's
        // own comment above): some sellers unconditionally reject notify_funded
        // without a real EIP-712-signed authorization envelope. Build + sign one
        // ONLY when the negotiated terms actually asked for it — no unnecessary
        // wallet prompt for the many sellers (like our own explainer agent) that
        // don't need this.
        const authorization = requiresNotifyAuthorization
          ? await buildNotifyAuthorization({
              chainId: bsc.id, verifyingContract: contracts.commerce, jobId: newJobId, signTypedDataAsync,
            })
          : null;
        const result = await notifyFunded(providerAddress, newJobId, authorization);
        notifySucceeded = result.notified;
        notifyReason = result.reason;
      } catch (e) {
        // Real, non-fatal: same treatment as a negotiate failure — most
        // likely cause here is the wallet rejecting the EIP-712 signature
        // prompt, not a network/agent problem.
        notifyReason = e.message || String(e);
      }
      if (notifySucceeded) {
        setCompletedSteps((prev) => [...prev, 'notifying']);
      } else {
        setSkippedSteps((prev) => [...prev, 'notifying']);
      }
      setNotifySkipReason(notifyReason);

      setStep('done');
      return { jobId: newJobId, txHash: fundHash };
    } catch (e) {
      // step is deliberately left as whatever it was when this threw —
      // that's the real step the checklist should mark as errored.
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

  return { hire, getRealJobStatus, step, jobId, error, completedSteps, skippedSteps, stepHashes, notifySkipReason };
}

// Honest, wallet-matched copy per step — exactly what each real
// transaction actually does, no vaguer marketing language. Shared by web
// and mobile so the two can't drift.
const HIRE_STEP_COPY = {
  negotiating: { label: 'Ask what it charges', description: "Checking whether this agent needs to confirm its price before it'll do the work — some do, some don't" },
  creating: { label: 'Start the job', description: 'Permanently recording your hire request, so both sides can trust it happened' },
  registering: { label: 'Set up protection', description: 'Setting up the rule that protects your money if this job goes wrong (like getting it back if nothing is delivered)' },
  budgeting: { label: 'Set the spending limit', description: 'Setting the maximum this job is allowed to spend' },
  approving: { label: 'Allow the payment', description: "Giving permission to set aside up to {amount} $U — this doesn't spend anything yet, it just unlocks the next step" },
  funding: { label: 'Send the payment', description: 'Puts {amount} $U on hold for the agent to claim once the work is done' },
  notifying: { label: 'Tell the agent to start', description: "Letting the agent know it's been hired and paid, so it starts the work now instead of waiting to notice on its own" },
};

/** Builds the real, current step list for <StepChecklist/>, straight from
 * useHireAgent's own state — no invented progress. `budgetUnits` fills in
 * the {amount} placeholder in the approve/fund copy so the user sees the
 * real number they're approving/spending, not a generic amount. */
export function buildHireStepList({ step, completedSteps, skippedSteps, stepHashes, error, budgetUnits, notifySkipReason }) {
  const amount = budgetUnits != null ? `${budgetUnits} ` : '';
  return HIRE_STEPS.map((key) => {
    const copy = HIRE_STEP_COPY[key];
    const description = copy.description.replace('{amount} ', amount);
    let status = 'pending';
    if (completedSteps.includes(key)) status = 'complete';
    else if (skippedSteps.includes(key)) status = 'skipped';
    else if (step === key) status = error ? 'error' : 'active';
    return {
      key, label: copy.label, description,
      status,
      hash: stepHashes[key] || null,
      reason: key === 'approving' && status === 'skipped' ? 'Already allowed — skipped'
        : key === 'negotiating' && status === 'skipped' ? "This agent doesn't need to confirm a price — skipped"
        : key === 'notifying' && status === 'skipped' ? (notifySkipReason ? `Not delivered yet: ${notifySkipReason}` : "Couldn't reach the agent directly — it'll still pick this job up on its own, just possibly slower")
        : null,
      errorMessage: status === 'error' ? error : null,
    };
  });
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
    throw new Error("The job was created, but we couldn't determine its job number from the confirmation. Check your recent activity on BscScan to find it before trying anything else.");
  }
  // Placeholder: many such kernels return jobId as the return value AND
  // emit it in the first indexed topic of a JobCreated-style event.
  // Confirm the real event name/shape before relying on this in production.
  return BigInt(receipt.logs[0].topics?.[1] ?? 0);
}
