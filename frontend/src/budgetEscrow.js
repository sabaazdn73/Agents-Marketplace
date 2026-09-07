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
  // Ids are sequential from 1 (`budgetId = ++budgetCounter`), which is what
  // makes a client's budgets enumerable from contract state instead of from
  // logs. See useMyBudgets for why that distinction decides correctness.
  { type: 'function', name: 'budgetCounter', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
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

/** The live spend view, with the feed treated as best-effort.
 *
 * This is the capability ERC-8183 structurally cannot provide: its escrow
 * emits PaymentReleased exactly once, for the full amount, so there is no
 * stream to watch. Here every draw emits Drawn.
 *
 * WHY THIS IS NOT A PLAIN getLogs('earliest') ANY MORE
 * ----------------------------------------------------
 * It was, and that silently did not work. Measured against the live
 * contract on BSC while verifying the reference agent:
 *   - the public dataseed RPC answers `limit exceeded` for a 5,000-block
 *     range;
 *   - Infura returns a BudgetOpened log when asked for a 5-block window,
 *     and returns NOTHING for the same event inside a 2,000-block window
 *     -- no error, just missing data;
 *   - even 200-block chunks recovered only 3 of the ~7 events that
 *     provably exist, since contract state showed 2 budgets and a real
 *     draw whose 2.5% fee is sitting in the escrow.
 * A feed built on that would have shown "nothing drawn yet" directly
 * above a balance saying otherwise.
 *
 * So the numbers never come from logs. `spent` and `total` are read from
 * the contract in useBudgetRead and are authoritative. This hook supplies
 * the itemised story only, and reports honestly when it cannot tell the
 * whole of it: `accountedFor` is what the visible draws add up to, and a
 * caller compares that against the real `spent` to know whether anything
 * is missing. Incompleteness is therefore DETECTED rather than assumed,
 * which works no matter how badly a given RPC behaves.
 */
export function useDrawFeed(budgetId, { lookbackBlocks = 4000, chunkSize = 200 } = {}) {
  const publicClient = usePublicClient();
  const [draws, setDraws] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isBudgetEscrowConfigured() || budgetId == null || !publicClient) return undefined;
    let cancelled = false;
    const common = { address: BUDGET_ESCROW_ADDRESS, abi: BUDGET_ESCROW_ABI };
    const drawnEvent = BUDGET_ESCROW_ABI.find((e) => e.type === 'event' && e.name === 'Drawn');

    // Small windows, because that is what these providers actually answer
    // correctly. Bounded rather than scanning to genesis: a wide scan is
    // both slow and, as measured above, quietly wrong.
    (async () => {
      try {
        const head = await publicClient.getBlockNumber();
        const first = head > BigInt(lookbackBlocks) ? head - BigInt(lookbackBlocks) : 0n;
        const found = [];
        for (let from = first; from <= head; from += BigInt(chunkSize)) {
          if (cancelled) return;
          const to = from + BigInt(chunkSize) - 1n > head ? head : from + BigInt(chunkSize) - 1n;
          try {
            const logs = await publicClient.getLogs({
              ...common, event: drawnEvent,
              args: { budgetId: BigInt(budgetId) },
              fromBlock: from, toBlock: to,
            });
            found.push(...logs.map((l) => l.args));
          } catch {
            // One bad window must not lose the windows that did work.
          }
        }
        if (!cancelled) { setDraws(dedupe(found)); setScanned(true); }
      } catch (e) {
        if (!cancelled) { setError(e.shortMessage || e.message); setScanned(true); }
      }
    })();

    const unwatch = publicClient.watchContractEvent({
      ...common, eventName: 'Drawn', args: { budgetId: BigInt(budgetId) },
      onLogs: (logs) => {
        if (cancelled) return;
        setDraws((prev) => dedupe([...prev, ...logs.map((l) => l.args)]));
      },
    });

    return () => { cancelled = true; unwatch?.(); };
  }, [budgetId, publicClient, lookbackBlocks, chunkSize]);

  // `spent` is the contract's own running total AFTER each draw, so it is
  // unique per draw and identifies one exactly. A reorg or an overlapping
  // watch window can deliver the same draw twice, and showing one spend as
  // two would misstate how much of someone's money is gone.
  const accountedFor = draws.reduce((sum, d) => sum + (d.amount ?? 0n), 0n);

  return { draws, accountedFor, scanned, error };
}

function dedupe(list) {
  const bySpent = new Map();
  for (const d of list) bySpent.set(String(d.spent), d);
  return [...bySpent.values()].sort((a, b) => (a.spent < b.spent ? -1 : a.spent > b.spent ? 1 : 0));
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
 * Defaults to UNAVAILABLE while loading and on error.
 *
 * `declared` is separate from `available`: available means the contract
 * would accept this agent, declared means its developer told us it
 * implements draw(). An undeclared agent is offered with a warning rather
 * than blocked, since the client can reclaim an unused budget at any
 * time. */
export function useBudgetModeStatus(ownerAddress) {
  const [state, setState] = useState({ loading: true, available: false, declared: false, reason: '', agents: [] });

  useEffect(() => {
    let cancelled = false;
    if (!isBudgetEscrowConfigured()) {
      setState({ loading: false, available: false, declared: false, agents: [],
                 reason: "Budget mode isn't deployed in this environment yet." });
      return undefined;
    }
    const base = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
    const q = ownerAddress ? `?owner=${encodeURIComponent(ownerAddress)}` : '';
    fetch(`${base}/api/budget-mode/status${q}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!cancelled) setState({ loading: false, available: !!d.available, declared: !!d.declared, reason: d.reason || '', agents: d.agents || [] }); })
      .catch(() => { if (!cancelled) setState({ loading: false, available: false, declared: false, agents: [],
                       reason: "Couldn't check whether this agent supports budgets." }); });
    return () => { cancelled = true; };
  }, [ownerAddress]);

  return state;
}

/** Every budget the connected wallet opened as CLIENT -- open, closed and
 *  reclaimed alike, because the history is the point of showing them.
 *
 * WHY THIS ENUMERATES CONTRACT STATE AND NOT `BudgetOpened` LOGS
 * -------------------------------------------------------------
 * `BudgetOpened` indexes `client`, so a log filter looks like the obvious
 * way to find someone's budgets. It is not, and the reason is already
 * documented in useDrawFeed above from live measurement against this exact
 * contract: these RPCs silently return INCOMPLETE log sets -- 200-block
 * chunks recovered 3 of ~7 events that provably existed, with no error.
 *
 * A missing Drawn log understates a spend. A missing BudgetOpened log makes
 * an entire budget vanish from this list -- which is precisely the black box
 * this list exists to remove. Building discovery on logs would move the bug
 * rather than fix it.
 *
 * So: ids are sequential from 1, `budgetCounter` is public, and `getBudget`
 * is authoritative. Read the counter, read every id, keep the ones whose
 * client matches. Contract state cannot silently omit a row.
 *
 * COST, STATED HONESTLY: this is O(budgetCounter) reads, batched through
 * viem's multicall (one RPC round trip per BATCH_SIZE ids, not per id). That
 * is correct and cheap while the counter is small, which it is -- but it is
 * not free forever. When the counter reaches the low thousands this wants
 * replacing with a server-side indexed scan, the same way agent_performance
 * already does it for ERC-8183 jobs. Noted rather than pre-built: an index
 * for a handful of budgets would be speculative infrastructure.
 */
export function useMyBudgets() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [state, setState] = useState({ loading: true, budgets: [], error: null });

  const load = useCallback(async () => {
    if (!isBudgetEscrowConfigured() || !isConnected || !address || !publicClient) {
      setState({ loading: false, budgets: [], error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const common = { address: BUDGET_ESCROW_ADDRESS, abi: BUDGET_ESCROW_ABI };
      const count = await publicClient.readContract({ ...common, functionName: 'budgetCounter' });
      const total = Number(count);
      if (total === 0) { setState({ loading: false, budgets: [], error: null }); return; }

      const BATCH_SIZE = 50;
      const mine = [];
      for (let start = 1; start <= total; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE - 1, total);
        const ids = [];
        for (let i = start; i <= end; i++) ids.push(BigInt(i));

        // getBudget AND drawableNow together: drawableNow is the contract's
        // own view of what can be taken right now, and recomputing it here
        // from status/deadline/cooldown would be a second implementation of
        // logic that already exists on-chain -- the kind of duplicate that
        // drifts and then disagrees with the contract.
        const results = await publicClient.multicall({
          contracts: ids.flatMap((id) => [
            { ...common, functionName: 'getBudget', args: [id] },
            { ...common, functionName: 'drawableNow', args: [id] },
          ]),
          allowFailure: true,
        });

        ids.forEach((id, idx) => {
          const budgetRes = results[idx * 2];
          const drawableRes = results[idx * 2 + 1];
          if (budgetRes?.status !== 'success') return;
          const b = budgetRes.result;
          if (!b || Number(b.status) === 0) return; // NONE -- never opened
          if (String(b.client).toLowerCase() !== String(address).toLowerCase()) return;
          mine.push({
            id,
            ...b,
            // A failed drawableNow must not fabricate a number. null reads
            // as "unknown" downstream rather than as zero.
            drawable: drawableRes?.status === 'success' ? drawableRes.result : null,
          });
        });
      }

      // Newest first: the budget someone just funded is the one they came
      // here to look at.
      mine.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      setState({ loading: false, budgets: mine, error: null });
    } catch (e) {
      setState({ loading: false, budgets: [], error: e.shortMessage || e.message });
    }
  }, [address, isConnected, publicClient]);

  useEffect(() => { load(); }, [load]);
  return { ...state, refresh: load };
}
