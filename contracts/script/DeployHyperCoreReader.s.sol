// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {HyperCoreReader} from "../src/HyperCoreReader.sol";

/// @dev Deploys HyperCoreReader to HyperEVM, chain 999.
///
/// No constructor arguments and no owner. The contract holds no state, takes
/// no funds and has no privileged function, so there is nothing to configure
/// and nothing to hand over. That is deliberate: it reads, and a reader that
/// cannot be reconfigured cannot be reconfigured into something else.
///
/// MEASURED BEFORE WRITING THIS, against chain 999's own RPC rather than a
/// gas table: 803,945 gas for this exact creation bytecode. At the 0.1 gwei
/// base fee observed on 2026-09-17 that is 0.00008 HYPE, about seven tenths of
/// a cent at HYPE $82. Send more than that: the gas price floats, it read
/// 0.1386 gwei an hour earlier the same day, and being short mid-deploy is
/// more annoying than overfunding by a dollar.
///
/// The deploy fits a small block. Sampled block headers on 999 carry a
/// 3,000,000 gas limit at one-second spacing, with a 30,000,000 block once a
/// minute; 803,945 needs neither the larger block nor the opt-in that routes a
/// sender into it.
///
///   forge script script/DeployHyperCoreReader.s.sol \
///     --rpc-url https://rpc.hyperliquid.xyz/evm \
///     --account <cast-wallet> --broadcast --verify \
///     --etherscan-api-key $ETHERSCAN_API_KEY --chain 999
///
/// Verification goes through Etherscan V2, which lists chain 999 as HyperEVM
/// Mainnet with hyperevmscan.io as its explorer, and the key this project
/// already holds answers for that chain: a getsourcecode call against USD₮0
/// returned real source rather than a chain-unsupported rejection.
///
/// AFTER DEPLOY: put the address in HYPERCORE_READER_ADDRESS. Until that is
/// set, backend/core/hyperliquid/corestate.py serves
/// `withheld_reason: reader_not_deployed` rather than falling back to reading
/// the precompiles directly, so the panel cannot show a number that did not
/// come through the deployed contract.
contract DeployHyperCoreReader is Script {
    function run() external returns (HyperCoreReader reader) {
        vm.startBroadcast();
        reader = new HyperCoreReader();
        vm.stopBroadcast();

        console2.log("HyperCoreReader deployed at:", address(reader));
        console2.log("Set HYPERCORE_READER_ADDRESS to that address.");

        // Read something real in the same run, so the log carries proof the
        // precompiles answered through the contract rather than only that the
        // bytecode landed.
        uint64 height = reader.coreBlock();
        console2.log("HyperCore block height read through it:", height);
    }
}
