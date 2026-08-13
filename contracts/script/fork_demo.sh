#!/usr/bin/env bash
# Real multi-token deployment + real purchase on a local Anvil fork of live BSC
# mainnet (the Practice Layer). Deploys the whitelist [NATIVE BNB, real USDT,
# live $U], proves all three are accepted, then runs a real native-BNB one-time
# purchase and reads the result on-chain. $U is read LIVE from the Altana SDK.
# Uses the well-known local anvil dev keys — local-only, not real-money keys.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"

BSC_RPC="${BSC_RPC:-https://bsc-dataseed.binance.org}"
L=http://localhost:8546
USDT=0x55d398326f99059fF775485246999027B3197955
NATIVE=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
ACC0_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ACC1_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
ACC1=0x70997970C51812dc3A010C7d01b50e0d17dc79C8   # buyer
FEE_WALLET="$(grep -oE '^PLATFORM_FEE_WALLET=.*' ../backend/.env | cut -d= -f2 | tr -d '[:space:]')"

echo "==> reading live \$U address from the Altana SDK"
pushd ../frontend >/dev/null
U=$(node --input-type=module -e "import('@altananetwork/sdk').then(m=>console.log(m.ERC8183_ADDRESSES[56].paymentToken))")
popd >/dev/null
echo "    \$U = $U"

echo "==> starting anvil fork of BSC mainnet"
pkill -f "anvil --fork-url" 2>/dev/null || true
sleep 1
anvil --fork-url "$BSC_RPC" --port 8546 --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null || true' EXIT
echo "    waiting for the fork to be ready…"
for i in $(seq 1 40); do cast block-number --rpc-url "$L" >/dev/null 2>&1 && break; sleep 1; done

echo "==> deploying with whitelist [NATIVE, USDT, \$U] (fee wallet from env, 2.5%)"
MARKET=$(PLATFORM_FEE_WALLET="$FEE_WALLET" ACCEPTED_ERC20S="$USDT,$U" \
  forge script script/Deploy.s.sol:Deploy --rpc-url "$L" --private-key "$ACC0_KEY" --broadcast 2>&1 \
  | grep -oE 'deployed at: 0x[0-9a-fA-F]{40}' | grep -oE '0x[0-9a-fA-F]{40}')
echo "    deployed at: $MARKET"

echo "==> whitelist check (all three must be accepted):"
echo "    NATIVE: $(cast call $MARKET 'acceptedTokens(address)(bool)' $NATIVE --rpc-url $L)"
echo "    USDT  : $(cast call $MARKET 'acceptedTokens(address)(bool)' $USDT --rpc-url $L)"
echo "    \$U    : $(cast call $MARKET 'acceptedTokens(address)(bool)' $U --rpc-url $L)"

CREATOR=$(cast call 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 "ownerOf(uint256)(address)" 1 --rpc-url "$L")
echo "==> creator ($CREATOR) lists agent #1 as ONE_TIME in native BNB @ 0.1 BNB"
cast rpc anvil_impersonateAccount "$CREATOR" --rpc-url "$L" >/dev/null
cast rpc anvil_setBalance "$CREATOR" 0xde0b6b3a7640000 --rpc-url "$L" >/dev/null
cast send "$MARKET" "list(uint256,uint8,address,uint256,uint64)" 1 1 "$NATIVE" 100000000000000000 0 \
  --from "$CREATOR" --unlocked --rpc-url "$L" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$CREATOR" --rpc-url "$L" >/dev/null

echo "==> buyer pays 0.1 BNB via msg.value (native path — no approve needed)"
cast rpc anvil_setBalance "$ACC1" 0x1bc16d674ec80000 --rpc-url "$L" >/dev/null # 2 BNB
cast send "$MARKET" "buyOneTime(uint256)" 1 --value 100000000000000000 --private-key "$ACC1_KEY" --rpc-url "$L" >/dev/null

echo "==> RESULTS (real on-chain reads):"
echo "    hasAccess(agent 1, buyer)         = $(cast call $MARKET 'hasAccess(uint256,address)(bool)' 1 $ACC1 --rpc-url $L)"
echo "    creatorBalance[NATIVE][creator]   = $(cast call $MARKET 'creatorBalance(address,address)(uint256)' $NATIVE $CREATOR --rpc-url $L)"
echo "    feesAccrued[NATIVE]               = $(cast call $MARKET 'feesAccrued(address)(uint256)' $NATIVE --rpc-url $L)"
echo "==> done (anvil fork will be torn down)"
