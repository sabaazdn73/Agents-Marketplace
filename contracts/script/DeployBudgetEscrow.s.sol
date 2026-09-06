// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {AgentBudgetEscrow} from "../src/AgentBudgetEscrow.sol";

/// @dev Deployment for the drawable-budget funding model. Same env-driven
///      shape as script/Deploy.s.sol -- nothing token-related is hardcoded.
///
///   - PLATFORM_FEE_WALLET : required, the platform fee recipient.
///   - ACCEPTED_ERC20S     : required, comma-separated ERC-20 addresses.
///                           Native BNB is added automatically as NATIVE.
///   - FEE_BPS             : optional, defaults to 250 (2.5%).
///
/// TESTNET FIRST. This contract hands an agent unilateral spend authority,
/// which is a weaker trust model than the ERC-8183 escrow already in use, so
/// it goes to BSC testnet and gets a real exercised flow (open -> draw ->
/// draw -> revoke) before mainnet is even discussed.
///
///   ACCEPTED_ERC20S=0x.. PLATFORM_FEE_WALLET=0x.. \
///     forge script script/DeployBudgetEscrow.s.sol \
///       --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545 \
///       --account <cast-wallet> --broadcast --verify
///
/// Note there is deliberately no AGENT_REGISTRY here. Unlike
/// AgentAccessMarket, which gates list() on the real ERC-8004 ownerOf(),
/// a budget is a direct agreement between a client and an address they
/// chose -- it does not require the payee to hold a registry token, and
/// pretending otherwise would exclude exactly the "agent that must spend to
/// produce" case this exists for.
contract DeployBudgetEscrow is Script {
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function run() external returns (AgentBudgetEscrow escrow) {
        address feeWallet = vm.envAddress("PLATFORM_FEE_WALLET");
        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(250)));
        address[] memory erc20s = vm.envAddress("ACCEPTED_ERC20S", ",");

        address[] memory tokens = new address[](erc20s.length + 1);
        tokens[0] = NATIVE;
        for (uint256 i = 0; i < erc20s.length; i++) {
            tokens[i + 1] = erc20s[i];
        }

        vm.startBroadcast();
        escrow = new AgentBudgetEscrow(tokens, feeWallet, feeBps);
        vm.stopBroadcast();

        console2.log("AgentBudgetEscrow deployed at:", address(escrow));
        console2.log("  feeWallet:", feeWallet);
        console2.log("  feeBps   :", feeBps);
        for (uint256 i = 0; i < tokens.length; i++) {
            console2.log("  accepted token:", tokens[i]);
        }
    }
}
