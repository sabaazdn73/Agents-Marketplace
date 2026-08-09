// erc8183.js
//
// The REAL ERC-8183 hire mechanism, called directly from the user's own
// connected wallet via wagmi, no backend signer involved. Every address
// and function signature below was extracted directly from the installed
// bnbagent-sdk Python package's own source (constants.py + abis/*.json),
// not guessed, not searched, the actual values the official SDK ships.

// ── Real, confirmed contract addresses ──
export const ERC8183_CONTRACTS = {
  97: {
    // BSC Testnet
    commerce: '0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de',
    router: '0xd7d36d66d2f1b608a0f943f722d27e3744f66f25',
    policy: '0x4f4678d4439fec812ac7674bb3efb4c8f5fb78a6',
  },
  56: {
    // BSC Mainnet
    commerce: '0xea4daa3100a767e86fded867729ae7446476eba6',
    router: '0x51895229e12f9876011789b04f8698af06ccd6da',
    policy: '0x9c01845705b3078aa2e8cff7520a6376fd766de5',
  },
};

// ── Real function signatures (minimal ABI, only what the hire flow uses) ──
// Extracted directly from bnbagent/abis/{AgenticCommerce,EvaluatorRouter,OptimisticPolicy,ERC20}.json

export const AGENTIC_COMMERCE_ABI = [
  { type: 'function', name: 'createJob', stateMutability: 'nonpayable',
    inputs: [
      { name: 'provider', type: 'address' },
      { name: 'evaluator', type: 'address' },
      { name: 'expiredAt', type: 'uint256' },
      { name: 'description', type: 'string' },
      { name: 'hook', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'setBudget', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [] },
  { type: 'function', name: 'fund', stateMutability: 'nonpayable',
    inputs: [
      { name: 'jobId', type: 'uint256' },
      { name: 'expectedBudget', type: 'uint256' },
      { name: 'optParams', type: 'bytes' },
    ],
    outputs: [] },
  { type: 'function', name: 'claimRefund', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'jobs', stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      { name: 'id', type: 'uint256' }, { name: 'client', type: 'address' },
      { name: 'provider', type: 'address' }, { name: 'evaluator', type: 'address' },
      { name: 'description', type: 'string' }, { name: 'budget', type: 'uint256' },
      { name: 'expiredAt', type: 'uint256' }, { name: 'status', type: 'uint8' },
      { name: 'hook', type: 'address' }, { name: 'submittedAt', type: 'uint256' },
      { name: 'deliverable', type: 'bytes32' },
    ] },
  { type: 'function', name: 'paymentToken', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }] },
];

export const EVALUATOR_ROUTER_ABI = [
  { type: 'function', name: 'registerJob', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'policy', type: 'address' }],
    outputs: [] },
  { type: 'function', name: 'settle', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: 'evidence', type: 'bytes' }],
    outputs: [] },
];

export const OPTIMISTIC_POLICY_ABI = [
  { type: 'function', name: 'dispute', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'voteReject', stateMutability: 'nonpayable',
    inputs: [{ name: 'jobId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'check', stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }, { name: '', type: 'bytes' }],
    outputs: [{ type: 'uint8' }, { type: 'bytes32' }] },
];

export const ERC20_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
];

// Confirmed via the SDK's JobStatus enum (bnbagent.erc8183.types.JobStatus)
export const JOB_STATUS = ['OPEN', 'FUNDED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'EXPIRED'];

export function getContracts(chainId) {
  const c = ERC8183_CONTRACTS[chainId];
  if (!c) throw new Error(`No ERC-8183 deployment known for chain ${chainId}, only 56 (mainnet) and 97 (testnet) are confirmed.`);
  return c;
}
