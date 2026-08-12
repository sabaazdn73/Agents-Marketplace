#!/usr/bin/env bash
# Real deployment + real purchase flow on a local Anvil fork of live BSC mainnet
# (the same thing the Practice Layer is). Proves: deploy, list (real ownerOf),
# fund a buyer with real USDT via whale impersonation, one-time purchase, and a
# real on-chain access check. Uses the well-known local anvil dev keys — these
# are NOT real-money keys; they only exist on this throwaway local fork.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

BSC_RPC="${BSC_RPC:-https://bsc-rpc.publicnode.com}"
L=http://localhost:8546
USDT=0x55d398326f99059fF775485246999027B3197955
REGISTRY=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
WHALE=0xF977814e90dA44bFA03b6295A0616a897441aceC   # Binance hot wallet (huge USDT)
# Standard anvil dev accounts (public, local-only):
ACC0_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ACC0=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
ACC1_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
ACC1=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # buyer
FEE_WALLET="$(grep -oE '^PLATFORM_FEE_WALLET=.*' ../backend/.env | cut -d= -f2 | tr -d '[:space:]')"

echo "==> starting anvil fork of BSC mainnet"
pkill -f "anvil --fork-url" 2>/dev/null || true
sleep 1
anvil --fork-url "$BSC_RPC" --port 8546 --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
echo "    waiting for the fork to be ready…"
for i in $(seq 1 40); do cast block-number --rpc-url "$L" >/dev/null 2>&1 && break; sleep 1; done

echo "==> deploying AgentAccessMarket (feeWallet from PLATFORM_FEE_WALLET, fee 2.5%)"
MARKET=$(PLATFORM_FEE_WALLET="$FEE_WALLET" forge create src/AgentAccessMarket.sol:AgentAccessMarket \
  --rpc-url "$L" --private-key "$ACC0_KEY" --broadcast \
  --constructor-args "$USDT" "$REGISTRY" "$FEE_WALLET" 250 \
  | grep -oE 'Deployed to: 0x[0-9a-fA-F]{40}' | grep -oE '0x[0-9a-fA-F]{40}')
echo "    deployed at: $MARKET"

CREATOR=$(cast call "$REGISTRY" "ownerOf(uint256)(address)" 1 --rpc-url "$L")
echo "==> real owner of agent #1 (creator): $CREATOR"

echo "==> creator lists agent #1 as ONE_TIME @ 100 USDT (impersonated)"
cast rpc anvil_impersonateAccount "$CREATOR" --rpc-url "$L" >/dev/null
cast rpc anvil_setBalance "$CREATOR" 0xde0b6b3a7640000 --rpc-url "$L" >/dev/null # 1 BNB gas
cast send "$MARKET" "list(uint256,uint8,uint256,uint64)" 1 1 100000000000000000000 0 \
  --from "$CREATOR" --unlocked --rpc-url "$L" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$CREATOR" --rpc-url "$L" >/dev/null

echo "==> funding buyer with 200 real USDT via whale impersonation"
cast rpc anvil_impersonateAccount "$WHALE" --rpc-url "$L" >/dev/null
cast rpc anvil_setBalance "$WHALE" 0xde0b6b3a7640000 --rpc-url "$L" >/dev/null
cast send "$USDT" "transfer(address,uint256)(bool)" "$ACC1" 200000000000000000000 \
  --from "$WHALE" --unlocked --rpc-url "$L" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$WHALE" --rpc-url "$L" >/dev/null
echo "    buyer USDT balance: $(cast call $USDT 'balanceOf(address)(uint256)' $ACC1 --rpc-url $L)"

echo "==> buyer approves + buyOneTime"
cast send "$USDT" "approve(address,uint256)(bool)" "$MARKET" 100000000000000000000 \
  --private-key "$ACC1_KEY" --rpc-url "$L" >/dev/null
cast send "$MARKET" "buyOneTime(uint256)" 1 --private-key "$ACC1_KEY" --rpc-url "$L" >/dev/null

echo "==> RESULTS (real on-chain reads):"
echo "    hasAccess(agent 1, buyer)     = $(cast call $MARKET 'hasAccess(uint256,address)(bool)' 1 $ACC1 --rpc-url $L)"
echo "    creatorBalance(creator)       = $(cast call $MARKET 'creatorBalance(address)(uint256)' $CREATOR --rpc-url $L)"
echo "    feesAccrued()                 = $(cast call $MARKET 'feesAccrued()(uint256)' --rpc-url $L)"
echo "==> done (anvil fork will be torn down)"
