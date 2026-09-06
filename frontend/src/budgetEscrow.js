// budgetEscrow.js
//
// Client for AgentBudgetEscrow -- the SECOND funding model, opt-in and
// alongside ERC-8183 rather than replacing it.
//
// Deliberately a separate module from erc8183.js and useHireAgent.js. The
// ERC-8183 hire path is the working, heavily-debugged default and is not
// touched by any of this: budget mode is additive, and a user who never
// opts into it executes byte-identical code to before.
//
// Why the model exists, in one line: locked escrow cannot fund an agent
// that must SPEND to produce, because the money that would let it work is
// locked behind having already worked. See the contract's own header for
// the full reasoning and for why ERC-8183 structurally cannot do this.
//
// The address is configuration, not a constant, because the contract is
// deployed separately and deliberately has no address baked in here until
// it exists. `isBudgetEscrowConfigured()` is the honest gate -- every
// surface that offers budget mode must check it rather than rendering a
// hire button that would revert.

import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import { decodeEventLog } from 'viem';

/** BSC mainnet. Set VITE_BUDGET_ESCROW_ADDRESS once deployed. */
export const BUDGET_ESCROW_ADDRESS = import.meta.env.VITE_BUDGET_ESCROW_ADDRESS || '';

/** Native BNB sentinel -- must match the contract's own NATIVE constant. */
export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export function isBudgetEscrowConfigured() {
  return /^0x[a-fA-F0-9]{40}$/.test(BUDGET_ESCROW_ADDRESS);
}

/** Minimal ABI: only what this app calls, same discipline as erc8183.js. */
export const BUDGET_ESCROW_ABI = [
  {
    type: 'function', name: 'openBudget', stateMutability: 'payable',
    inputs: [
      { name: 'agent', type: 'address' }, { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }, { name: 'maxPerDraw', type: 'uint256' },
      { name: 'deadline', type: 'uint64' }, { name: 'cooldown', type: 'uint64' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function', name: 'reclaim', stateMutability: 'nonpayable',
    inputs: [{ name: 'budgetId', type: 'uint256' }], outputs: [],
  },
  {
    type: 'function', name: 'close', stateMutability: 'nonpayable',
    inputs: [{ name: 'budgetId', type: 'uint256' }], outputs: [],
  },
  {
    type: 'function', name: 'getBudget', stateMutability: 'view',
    inputs: [{ name: 'budgetId', type: 'uint256' }],
    outputs: [{
      type: 'tuple',
      components: [
        { name: 'client', type: 'address' }, { name: 'agent', type: 'address' },
        { name: 'token', type: 'address' }, { name: 'total', type: 'uint256' },
        { name: 'spent', type: 'uint256' }, { name: 'maxPerDraw', type: 'uint256' },
        { name: 'deadline', type: 'uint64' }, { name: 'cooldown', type: 'uint64' },
        { name: 'lastDrawAt', type: 'uint64' }, { name: 'status', type: 'uint8' },
      ],
    }],
  },
  {
    type: 'function', name: 'drawableNow', stateMutability: 'view',
    inputs: [{ name: 'budgetId', type: 'uint256' }], outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  {
    type: 'event', name: 'Drawn',
    inputs: [
      { name: 'budgetId', type: 'uint256', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256' }, { name: 'fee', type: 'uint256' },
      { name: 'spent', type: 'uint256' }, { name: 'remaining', type: 'uint256' },
      { name: 'memo', type: 'bytes32' },
    ],
  },
  {
    type: 'event', name: 'BudgetOpened',
    inputs: [
      { name: 'budgetId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'agent', type: 'address', indexed: true },
      { name: 'token', type: 'address' }, { name: 'total', type: 'uint256' },
      { name: 'maxPerDraw', type: 'uint256' }, { name: 'deadline', type: 'uint64' },
      { name: 'cooldown', type: 'uint64' },
    ],
  },
  {
    type: 'event', name: 'BudgetReclaimed',
    inputs: [
      { name: 'budgetId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256' }, { name: 'early', type: 'bool' },
    ],
  },
];

export const BUDGET_STATUS = ['NONE', 'OPEN', 'CLOSED', 'RECLAIMED'];

/** Reads one budget's real on-chain state. Never optimistic: every caller
 *  re-reads after a write rather than assuming the write's intent. */
export function useBudgetRead(budgetId) {
  const publicClient = usePublicClient();
  const [state, setState] = useState({ loading: false, budget: null, drawable: null, error: null });

  const refresh = useCallback(async () => {
    if (!isBudgetEscrowConfigured() || budgetId == null || !publicClient) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const common = { address: BUDGET_ESCROW_ADDRESS, abi: BUDGET_ESCROW_ABI };
      const [budget, drawable] = await Promise.all([
        publicClient.readContract({ ...common, functionName: 'getBudget', args: [BigInt(budgetId)] }),
        publicClient.readContract({ ...common, functionName: 'drawableNow', args: [BigInt(budgetId)] }),
      ]);
      setState({ loading: false, budget, drawable, error: null });
    } catch (e) {
      setState({ loading: false, budget: null, drawable: null, error: e.shortMessage || e.message });
    }
  }, [budgetId, publicClient]);

  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, refresh };
}

/** The live spend view.
 *
 * This is the capability ERC-8183 structurally cannot provide: its escrow
 * emits PaymentReleased exactly once, for the full amount, so there is no
 * stream to watch. Here every draw emits Drawn, so a buyer can see the
 * money move as it is spent instead of waiting for a delivery.
 *
 * Historic draws are fetched once and new ones are appended from a live
 * watch, so the view is complete rather than only showing what happened
 * after the page opened. */
export function useDrawFeed(budgetId, { fromBlock } = {}) {
  const publicClient = usePublicClient();
  const [draws, setDraws] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isBudgetEscrowConfigured() || budgetId == null || !publicClient) return undefined;
    let cancelled = false;
    const common = { address: BUDGET_ESCROW_ADDRESS, abi: BUDGET_ESCROW_ABI };
    const drawnEvent = BUDGET_ESCROW_ABI.find((e) => e.type === 'event' && e.name === 'Drawn');

    publicClient
      .getLogs({
        ...common, event: drawnEvent,
        args: { budgetId: BigInt(budgetId) },
        fromBlock: fromBlock ?? 'earliest', toBlock: 'latest',
      })
      .then((logs) => { if (!cancelled) setDraws(logs.map((l) => l.args)); })
      .catch((e) => { if (!cancelled) setError(e.shortMessage || e.message); });

    const unwatch = publicClient.watchContractEvent({
      ...common, eventName: 'Drawn', args: { budgetId: BigInt(budgetId) },
      onLogs: (logs) => {
        if (cancelled) return;
        // Deduped on the log's own identity: a chain reorg or an overlapping
        // watch window can deliver the same draw twice, and showing one spend
        // as two would misrepresent how much of the budget is gone.
        setDraws((prev) => {
          const seen = new Set(prev.map((d) => `${d.spent}-${d.amount}`));
          const fresh = logs.map((l) => l.args).filter((a) => !seen.has(`${a.spent}-${a.amount}`));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
      },
    });

    return () => { cancelled = true; unwatch?.(); };
  }, [budgetId, publicClient, fromBlock]);

  return { draws, error };
}

/** Writes: open and reclaim. Both re-read on-chain state afterwards rather
 *  than reporting success from the transaction alone. */
export function useBudgetActions() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [pending, setPending] = useState(null);

  const openBudget = useCallback(async ({ agent, token, amount, maxPerDraw, deadline, cooldown }) => {
    if (!isBudgetEscrowConfigured()) throw new Error('Budget escrow is not deployed yet.');
    setPending('open');
    try {
      const isNative = token.toLowerCase() === NATIVE_SENTINEL.toLowerCase();
      const hash = await writeContractAsync({
        address: BUDGET_ESCROW_ADDRESS, abi: BUDGET_ESCROW_ABI, functionName: 'openBudget',
        args: [agent, token, amount, maxPerDraw, BigInt(deadline), BigInt(cooldown)],
        value: isNative ? amount : 0n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // The budget id is READ from the BudgetOpened event in this
      // transaction's own receipt. It is deliberately not inferred from
      // budgetCounter, and not assumed to be "the previous id plus one":
      // another client opening a budget in the same block would make that
      // guess point at someone else's budget, which is the kind of mistake
      // that shows a buyer the wrong balance and the wrong revoke button.
      const opened = BUDGET_ESCROW_ABI.find((e) => e.type === 'event' && e.name === 'BudgetOpened');
      let budgetId = null;
      for (const log of receipt.logs || []) {
        if ((log.address || '').toLowerCase() !== BUDGET_ESCROW_ADDRESS.toLowerCase()) continue;
        try {
          const parsed = decodeEventLog({ abi: [opened], data: log.data, topics: log.topics });
          if (parsed.eventName === 'BudgetOpened') { budgetId = parsed.args.budgetId; break; }
        } catch { /* not this event; keep looking */ }
      }
      return { hash, budgetId };
    } finally { setPending(null); }
  }, [writeContractAsync, publicClient]);

  const reclaim = useCallback(async (budgetId) => {
    if (!isBudgetEscrowConfigured()) throw new Error('Budget escrow is not deployed yet.');
    setPending('reclaim');
    try {
      const hash = await writeContractAsync({
        address: BUDGET_ESCROW_ADDRESS, abi: BUDGET_ESCROW_ABI,
        functionName: 'reclaim', args: [BigInt(budgetId)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      return hash;
    } finally { setPending(null); }
  }, [writeContractAsync, publicClient]);

  return { openBudget, reclaim, pending, connected: !!address };
}


/** Whether budget mode can honestly be offered for one agent.
 *
 * Deliberately asks the backend per agent rather than deciding locally
 * from "is the contract deployed". Deploying the escrow made the contract
 * live while leaving every registered agent unable to call draw() -- so a
 * contract-only check would have put a fund button in front of buyers for
 * budgets that nothing could ever draw from. The buyer's money was
 * recoverable, but they would have paid gas to discover a dead end.
 *
 * Defaults to UNAVAILABLE while loading and on error. An offer that might
 * be a dead end should not appear until it is known not to be. */
export function useBudgetModeStatus(ownerAddress) {
  const [state, setState] = useState({ loading: true, available: false, reason: '', agents: [] });

  useEffect(() => {
    let cancelled = false;
    if (!isBudgetEscrowConfigured()) {
      setState({ loading: false, available: false, agents: [],
                 reason: "Budget mode isn't deployed in this environment yet." });
      return undefined;
    }
    const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
    const q = ownerAddress ? `?owner=${encodeURIComponent(ownerAddress)}` : '';
    fetch(`${base}/api/budget-mode/status${q}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setState({ loading: false, available: !!d.available, reason: d.reason || '', agents: d.agents || [] }); })
      .catch(() => { if (!cancelled) setState({ loading: false, available: false, agents: [],
                       reason: "Couldn't check whether this agent supports budgets." }); });
    return () => { cancelled = true; };
  }, [ownerAddress]);

  return state;
}
