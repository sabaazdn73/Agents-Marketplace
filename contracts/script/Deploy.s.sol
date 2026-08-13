// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentAccessMarket} from "../src/AgentAccessMarket.sol";

/// @dev Real deployment script. Nothing token-related is hardcoded here:
///   - PLATFORM_FEE_WALLET : required, the platform fee recipient.
///   - ACCEPTED_ERC20S     : required, comma-separated ERC-20 addresses to accept
///                           (e.g. real USDT + the live $U read from the Altana
///                           SDK by the deploy wrapper). Native BNB is added
///                           automatically as the contract's NATIVE sentinel.
///   - AGENT_REGISTRY      : optional, defaults to BSC ERC-8004 registry.
///   - FEE_BPS             : optional, defaults to 250 (2.5%).
///
///  ACCEPTED_ERC20S=0x..,0x.. PLATFORM_FEE_WALLET=0x.. \
///    forge script script/Deploy.s.sol --rpc-url <url> --account <cast-wallet> --broadcast
contract Deploy is Script {
    address constant REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE; // == AgentAccessMarket.NATIVE

    function run() external returns (AgentAccessMarket market) {
        address feeWallet = vm.envAddress("PLATFORM_FEE_WALLET");
        address registry = vm.envOr("AGENT_REGISTRY", REGISTRY);
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(250)));
        address[] memory erc20s = vm.envAddress("ACCEPTED_ERC20S", ",");

        address[] memory tokens = new address[](erc20s.length + 1);
        tokens[0] = NATIVE; // native BNB
        for (uint256 i = 0; i < erc20s.length; i++) {
            tokens[i + 1] = erc20s[i];
        }

        vm.startBroadcast();
        market = new AgentAccessMarket(tokens, registry, feeWallet, feeBps);
        vm.stopBroadcast();

        console2.log("AgentAccessMarket deployed at:", address(market));
        console2.log("  registry :", registry);
        console2.log("  feeWallet:", feeWallet);
        console2.log("  feeBps   :", feeBps);
        for (uint256 i = 0; i < tokens.length; i++) {
            console2.log("  accepted token:", tokens[i]);
        }
    }
}
