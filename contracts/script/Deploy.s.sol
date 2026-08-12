// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentAccessMarket} from "../src/AgentAccessMarket.sol";

/// @dev Real deployment script. The platform fee wallet is read from the
///      PLATFORM_FEE_WALLET env var — never hardcoded. Payment token, registry
///      and fee bps have BSC-mainnet defaults but are env-overridable.
///
///  forge script script/Deploy.s.sol --rpc-url <url> --private-key <key> --broadcast
contract Deploy is Script {
    // BSC mainnet defaults.
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external returns (AgentAccessMarket market) {
        address feeWallet = vm.envAddress("PLATFORM_FEE_WALLET"); // required, from env
        address token = vm.envOr("PAYMENT_TOKEN", USDT);
        address registry = vm.envOr("AGENT_REGISTRY", REGISTRY);
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(250))); // default 2.5%

        vm.startBroadcast();
        market = new AgentAccessMarket(token, registry, feeWallet, feeBps);
        vm.stopBroadcast();

        console2.log("AgentAccessMarket deployed at:", address(market));
        console2.log("  paymentToken:", token);
        console2.log("  registry    :", registry);
        console2.log("  feeWallet   :", feeWallet);
        console2.log("  feeBps      :", feeBps);
    }
}
