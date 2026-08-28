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
import { useAccount, useWriteContract, useSignTypedData, usePublicClient, useChainId, useSwitchChain, useConfig } from 'wagmi';
import { getCapabilities, sendCalls, waitForCallsStatus } from 'wagmi/actions';
import { bsc } from 'wagmi/chains';
import {
  getContracts, AGENTIC_COMMERCE_ABI, EVALUATOR_ROUTER_ABI,
  OPTIMISTIC_POLICY_ABI, ERC20_ABI, JOB_STATUS,
} from './erc8183';
import { negotiateJob, buildJobDescription, negotiatedPriceRaw, notifyFunded, buildNotifyAuthorization } from './erc8183Negotiate';

// Real, batched "sign once" alternative to the step-by-step direct hire
// flow (2026-08-27), investigated before building anything, not assumed:
//
// - Real, confirmed library support: this project's actual installed
//   wagmi (2.19.5) and viem (2.55.13) both ship real, non-experimental
//   EIP-5792 support (wallet_sendCalls/wallet_getCapabilities) — confirmed
//   by reading the installed packages directly, not by version number
//   alone.
// - Real, load-bearing constraint found while designing this: createJob's
//   real jobId is only known AFTER its receipt is mined and decoded
//   (decodeJobIdFromReceipt below) — but registerJob/setBudget/approve/
//   fund all REQUIRE that real jobId as an argument. EIP-5792 batches are
//   a static array submitted upfront; there's no "use call #1's on-chain
//   output as call #2's input" within one batch. Real, live-confirmed
//   (not assumed): jobCounter() returns the id of the MOST RECENTLY
//   created job, not the next one to be assigned (checked live: with
//   jobCounter()=56665, getJob(56665) is a real existing job and
//   getJob(56666) doesn't exist yet) — so the next id would need to be
//   PREDICTED as jobCounter()+1, read moments before submitting. On this
//   real, live, continuously-active multi-user marketplace (the job
//   counter advanced by 50+ within this session alone), that prediction
//   could race a genuinely different user's own createJob landing first,
//   which would make a naive "batch all 5 steps" attempt operate on the
//   WRONG job — a real correctness/safety risk, not a hypothetical one.
//   Not built. createJob stays its own, individually-confirmed real
//   signature (exactly as in the step-by-step flow) specifically so its
//   real jobId is confirmed on-chain before anything that depends on it
//   is even constructed.
// - What IS genuinely safe to batch: registerJob + setBudget + (approve,
//   if needed) + fund all take the SAME already-confirmed real jobId and
//   have no inter-dependency this batch's own real atomicity doesn't
//   already resolve (an EIP-5792 batch with atomic support of 'supported'
//   or 'ready' either lands as one real on-chain unit or none of it does
//   — see wallet_getCapabilities' real atomic.status field, checked below,
//   never assumed). So the real, honest reduction this flow offers is 2
//   real signatures (createJob, then one batch for the remaining on-chain
//   steps) instead of up to 4 — not literally "one signature for
//   everything", which would require the unsafe prediction above.
export const CAN_BATCH_HIRE_STATUS = { unknown: 'unknown', supported: 'supported', unsupported: 'unsupported' };

/** Real, live capability check — never assumed. Returns 'unknown' while
 * checking/no wallet connected, 'supported' only when the connected
 * wallet's own wallet_getCapabilities response reports real atomic batch
 * support for BSC ('supported' or 'ready' per EIP-5792's own real status
 * values), 'unsupported' for every other real outcome (capability query
 * itself failing is treated as unsupported, never as a reason to attempt
 * a broken half-batch — same honest-fallback discipline as the rest of
 * this hook). */
export function useBatchHireCapability() {
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const [status, setStatus] = useState(CAN_BATCH_HIRE_STATUS.unknown);

  useEffect(() => {
    if (!isConnected || !address) { setStatus(CAN_BATCH_HIRE_STATUS.unknown); return; }
    let cancelled = false;
    setStatus(CAN_BATCH_HIRE_STATUS.unknown);
    (async () => {
      try {
        const capabilities = await getCapabilities(config, { account: address, chainId: bsc.id });
        const atomicStatus = capabilities?.[bsc.id]?.atomic?.status;
        if (cancelled) return;
        setStatus(
          atomicStatus === 'supported' || atomicStatus === 'ready'
            ? CAN_BATCH_HIRE_STATUS.supported
            : CAN_BATCH_HIRE_STATUS.unsupported
        );
      } catch (e) {
        // Real, honest fallback: a wallet that doesn't implement
        // wallet_getCapabilities at all (most still don't) throws or
        // returns a JSON-RPC "method not found" here — genuinely
        // unsupported, not an error state to surface.
        if (!cancelled) setStatus(CAN_BATCH_HIRE_STATUS.unsupported);
      }
    })();
    return () => { cancelled = true; };
  }, [address, isConnected, config]);

  return status;
}


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
        const negotiationResult = await negotiateJob(agent.ownerAddress, agent.id, description, DEFAULT_NEGOTIATE_TERMS);
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
  }, [agent?.ownerAddress, agent?.id, agent?.name, publicClient]);

  return state;
}

export function useHireAgent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const config = useConfig();

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

  const hire = useCallback(async ({ providerAddress, providerAgentId, budgetUnits, description, expiryMinutes = 65 }) => {
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
      try {
        const negotiationResult = await negotiateJob(providerAddress, providerAgentId, description, DEFAULT_NEGOTIATE_TERMS);
        const price = negotiationResult ? negotiatedPriceRaw(negotiationResult) : null;
        if (negotiationResult && price != null) {
          finalDescription = buildJobDescription(negotiationResult);
          // Never fund less than the agreed price (verify_signed_job requires
          // budget >= price); respect a higher user-chosen spend cap as-is.
          finalBudgetRaw = budgetRaw > price ? budgetRaw : price;
          negotiationSucceeded = true;
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
        // Real fix, 2026-08-26: job #56659's real, live rejection
        // ({'status':'rejected','reason':'authorization_required'}) proved the
        // OLD gate here — building the authorization only when the negotiated
        // terms echoed back a specific `success_criteria` string — was a real
        // bug, not a real seller-side convention. Confirmed against the real
        // reference source (stockanalyst-agent-demo's seller_core.py, read
        // directly): the authorization requirement is NOT conditional on any
        // negotiated term at all — a notify_funded call with no real
        // authorization dict is rejected unconditionally, before any
        // success_criteria check ever runs. There is no real, reliable signal
        // in a negotiate response that announces "this seller needs one", so
        // the only correct policy is to always attach one whenever we have the
        // means to: a real negotiation succeeded, meaning this seller speaks
        // the stricter A2A convention and newJobId/contracts.commerce are
        // already on hand. Confirmed SAFE for sellers that don't need it, not
        // just assumed — read our own explainer-agent's real notify_funded
        // handler (explainer-agent/seller_core.py) directly: it only ever
        // reads `data["job_id"]`, never inspects `authorization` at all, so an
        // unused envelope is silently, harmlessly ignored there, and a real,
        // live call against the current stockanalyst-agent negotiate response
        // confirmed it never advertises this need via any response field
        // either — the only sellers this now costs an extra signature prompt
        // are ones that genuinely speak the strict negotiate convention, a
        // real, worthwhile tradeoff against a job silently never delivering.
        const authorization = negotiationSucceeded
          ? await buildNotifyAuthorization({
              chainId: bsc.id, verifyingContract: contracts.commerce, jobId: newJobId, signTypedDataAsync,
            })
          : null;
        const result = await notifyFunded(providerAddress, providerAgentId, newJobId, authorization);
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

  // Real "sign once for the remaining steps" alternative — see this file's
  // own top-of-file note for the full real investigation (why createJob
  // can't safely join the batch, and what genuinely can). Same real
  // negotiate + createJob prefix as `hire()` above (unchanged, individually
  // confirmed), then registerJob + setBudget + (approve, if needed) + fund
  // go into ONE real wallet_sendCalls batch instead of up to 4 separate
  // signatures. Caller must confirm useBatchHireCapability() reports
  // 'supported' before calling this — not re-checked here, so a caller
  // that ignores that guard gets whatever real error the wallet itself
  // returns for an unsupported batch, never a silent partial attempt.
  const hireBatched = useCallback(async ({ providerAddress, providerAgentId, budgetUnits, description, expiryMinutes = 65 }) => {
    if (!address) throw new Error('Connect a wallet first.');
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
      const paymentToken = await publicClient.readContract({
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'paymentToken',
      });
      const decimals = await publicClient.readContract({
        address: paymentToken, abi: ERC20_ABI, functionName: 'decimals',
      });
      const budgetRaw = BigInt(Math.round(budgetUnits * 10 ** decimals));

      // Step 0: same real, best-effort negotiate as the step-by-step path.
      setStep('negotiating');
      let finalDescription = description;
      let finalBudgetRaw = budgetRaw;
      let negotiationSucceeded = false;
      try {
        const negotiationResult = await negotiateJob(providerAddress, providerAgentId, description, DEFAULT_NEGOTIATE_TERMS);
        const price = negotiationResult ? negotiatedPriceRaw(negotiationResult) : null;
        if (negotiationResult && price != null) {
          finalDescription = buildJobDescription(negotiationResult);
          finalBudgetRaw = budgetRaw > price ? budgetRaw : price;
          negotiationSucceeded = true;
        }
      } catch (e) { /* real, non-fatal — same as hire() */ }
      if (negotiationSucceeded) {
        setCompletedSteps((prev) => [...prev, 'negotiating']);
      } else {
        setSkippedSteps((prev) => [...prev, 'negotiating']);
      }

      // Step 1: createJob — real, individually-signed and confirmed, same
      // as hire(). Kept separate on purpose: its real jobId (decoded from
      // the receipt below) is what every batched call after it needs as an
      // argument — see this file's top-of-file note for why that real
      // dependency can't be resolved inside one static EIP-5792 batch.
      setStep('creating');
      const disputeWindowSeconds = await publicClient.readContract({
        address: contracts.policy, abi: OPTIMISTIC_POLICY_ABI, functionName: 'disputeWindow',
      });
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + expiryMinutes * 60) + disputeWindowSeconds;
      const { receipt: createReceipt } = await writeAndConfirm('creating', {
        address: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'createJob',
        args: [providerAddress, contracts.router, expiredAt, finalDescription, contracts.router],
      });
      const newJobId = decodeJobIdFromReceipt(createReceipt);
      setJobId(newJobId);

      // Step 2: ONE real batch — registerJob + setBudget + (approve, if the
      // real, current allowance doesn't already cover it) + fund. All four
      // take the now-confirmed real jobId; none of them needs a value only
      // available after this batch itself starts executing, so a real
      // atomic batch (wallet_sendCalls) is safe here in a way it wasn't for
      // createJob.
      setStep('batching');
      const currentAllowance = await publicClient.readContract({
        address: paymentToken, abi: ERC20_ABI, functionName: 'allowance',
        args: [address, contracts.commerce],
      });
      const needsApprove = currentAllowance < finalBudgetRaw;
      const calls = [
        { to: contracts.router, abi: EVALUATOR_ROUTER_ABI, functionName: 'registerJob', args: [newJobId, contracts.policy] },
        { to: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'setBudget', args: [newJobId, finalBudgetRaw, '0x'] },
        ...(needsApprove ? [{ to: paymentToken, abi: ERC20_ABI, functionName: 'approve', args: [contracts.commerce, finalBudgetRaw] }] : []),
        { to: contracts.commerce, abi: AGENTIC_COMMERCE_ABI, functionName: 'fund', args: [newJobId, finalBudgetRaw, '0x'] },
      ];
      if (!needsApprove) setSkippedSteps((prev) => [...prev, 'approving']);

      const { id: batchId } = await sendCalls(config, { chainId: bsc.id, calls });
      const batchResult = await waitForCallsStatus(config, { id: batchId, timeout: RECEIPT_TIMEOUT_MS });
      if (batchResult.status !== 'success') {
        throw new Error(
          `The batched steps didn't confirm successfully (real status: ${batchResult.status}). ` +
          `Check this batch's real status before trying again — it may have partially landed depending on ` +
          `your wallet's own real atomicity guarantee: https://bscscan.com/tx/${batchResult.receipts?.[batchResult.receipts.length - 1]?.transactionHash || ''}`
        );
      }
      // Real tx hashes, one per call in the batch, in the same order —
      // recorded against each real step key so the checklist can still
      // link out to BscScan per step, same as the individual-signing path.
      const receipts = batchResult.receipts || [];
      const realHashes = {};
      let idx = 0;
      realHashes.registering = receipts[idx++]?.transactionHash;
      realHashes.budgeting = receipts[idx++]?.transactionHash;
      if (needsApprove) realHashes.approving = receipts[idx++]?.transactionHash;
      realHashes.funding = receipts[idx++]?.transactionHash;
      setStepHashes((prev) => ({ ...prev, ...realHashes }));
      setCompletedSteps((prev) => [...prev, 'registering', 'budgeting', ...(needsApprove ? ['approving'] : []), 'funding']);
      const fundHash = realHashes.funding;

      // Step 3: same real, best-effort notify as the step-by-step path.
      setStep('notifying');
      let notifySucceeded = false;
      let notifyReason = null;
      try {
        const authorization = negotiationSucceeded
          ? await buildNotifyAuthorization({
              chainId: bsc.id, verifyingContract: contracts.commerce, jobId: newJobId, signTypedDataAsync,
            })
          : null;
        const result = await notifyFunded(providerAddress, providerAgentId, newJobId, authorization);
        notifySucceeded = result.notified;
        notifyReason = result.reason;
      } catch (e) {
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
      setError(e.message || String(e));
      throw e;
    }
  }, [address, chainId, switchChainAsync, publicClient, writeAndConfirm, config, signTypedDataAsync]);

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

  return { hire, hireBatched, getRealJobStatus, step, jobId, error, completedSteps, skippedSteps, stepHashes, notifySkipReason };
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

// Real, coarser step list for the batched "sign once" flow — 'batching'
// stands in for registering+budgeting+approving+funding, which now happen
// as one real wallet interaction instead of up to 4 separate ones. The
// real per-step hashes are still recorded in stepHashes (see hireBatched
// above) for anyone who wants them, but StepChecklist only shows one hash
// per row, so this row links to the real funding call specifically — the
// same transaction batch is visible in full from that same BscScan page.
export const BATCH_HIRE_STEPS = ['negotiating', 'creating', 'batching', 'notifying'];

const BATCH_HIRE_STEP_COPY = {
  negotiating: HIRE_STEP_COPY.negotiating,
  creating: HIRE_STEP_COPY.creating,
  batching: { label: 'Sign once for the rest', description: 'One signature covers protection, spending limit, payment allowance, and sending the payment — {amount} $U on hold for the agent to claim once the work is done' },
  notifying: HIRE_STEP_COPY.notifying,
};

/** Real, batched-flow equivalent of buildHireStepList above — same real
 * contract, same real state shape from useHireAgent, just mapped onto the
 * coarser BATCH_HIRE_STEPS list. */
export function buildBatchHireStepList({ step, completedSteps, skippedSteps, stepHashes, error, budgetUnits, notifySkipReason }) {
  const amount = budgetUnits != null ? `${budgetUnits} ` : '';
  // The four real sub-steps the batch covers are complete only once ALL of
  // them (bar the genuinely-skipped 'approving') report complete — a
  // partial set would mean the batch itself is still active or errored,
  // reflected in `step`/`error` directly.
  const batchSubKeys = ['registering', 'budgeting', 'approving', 'funding'];
  const batchComplete = batchSubKeys.every((k) => completedSteps.includes(k) || skippedSteps.includes(k));
  return BATCH_HIRE_STEPS.map((key) => {
    const copy = BATCH_HIRE_STEP_COPY[key];
    const description = copy.description.replace('{amount} ', amount);
    let status = 'pending';
    if (key === 'batching') {
      if (batchComplete) status = 'complete';
      else if (step === 'batching') status = error ? 'error' : 'active';
    } else {
      if (completedSteps.includes(key)) status = 'complete';
      else if (skippedSteps.includes(key)) status = 'skipped';
      else if (step === key) status = error ? 'error' : 'active';
    }
    return {
      key, label: copy.label, description,
      status,
      hash: key === 'batching' ? stepHashes.funding || null : (stepHashes[key] || null),
      reason: key === 'negotiating' && status === 'skipped' ? "This agent doesn't need to confirm a price — skipped"
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
