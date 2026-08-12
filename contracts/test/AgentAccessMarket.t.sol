// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentAccessMarket} from "../src/AgentAccessMarket.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Runs against a REAL fork of BSC mainnet (forge test --fork-url ...):
///      real USDT as the payment token and the real ERC-8004 registry, so the
///      ownerOf() gate and SafeERC20 transfers exercise genuine mainnet state.
contract AgentAccessMarketForkTest is Test {
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955; // BSC-USD, 18 decimals
    address constant REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432; // ERC-8004 AgentIdentity

    AgentAccessMarket market;
    address feeWallet = makeAddr("feeWallet");
    address buyer = makeAddr("buyer");
    uint16 constant FEE_BPS = 250; // 2.5%

    uint256 constant AGENT_ONE_TIME = 1;
    uint256 constant AGENT_SUB = 2;
    address creatorOne; // real owner of token 1
    address creatorSub; // real owner of token 2

    function setUp() public {
        market = new AgentAccessMarket(USDT, REGISTRY, feeWallet, FEE_BPS);
        creatorOne = IERC721(REGISTRY).ownerOf(AGENT_ONE_TIME);
        creatorSub = IERC721(REGISTRY).ownerOf(AGENT_SUB);
        deal(USDT, buyer, 1_000e18); // fund the buyer with real USDT (storage-slot deal)
    }

    // ── Model 1: one-time license ──────────────────────────────────────────
    function test_OneTime_purchase_split_access_and_withdraw() public {
        uint256 price = 100e18;
        vm.prank(creatorOne);
        market.list(AGENT_ONE_TIME, AgentAccessMarket.Model.ONE_TIME, price, 0);

        assertFalse(market.hasAccess(AGENT_ONE_TIME, buyer), "no access pre-purchase");

        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), price);
        market.buyOneTime(AGENT_ONE_TIME);
        vm.stopPrank();

        // Real permanent access + correct fee split (2.5%).
        assertTrue(market.hasAccess(AGENT_ONE_TIME, buyer), "access after purchase");
        uint256 fee = (price * FEE_BPS) / 10_000;
        assertEq(market.creatorBalance(creatorOne), price - fee, "creator credited net");
        assertEq(market.feesAccrued(), fee, "platform fee accrued");

        // Pull-over-push withdrawals move the real USDT.
        uint256 beforeCreator = IERC20(USDT).balanceOf(creatorOne);
        vm.prank(creatorOne);
        market.withdrawCreatorBalance();
        assertEq(IERC20(USDT).balanceOf(creatorOne) - beforeCreator, price - fee, "creator withdrew net");
        assertEq(market.creatorBalance(creatorOne), 0, "creator balance zeroed");

        uint256 beforeFee = IERC20(USDT).balanceOf(feeWallet);
        vm.prank(feeWallet);
        market.withdrawFees();
        assertEq(IERC20(USDT).balanceOf(feeWallet) - beforeFee, fee, "fee wallet withdrew fee");
        assertEq(market.feesAccrued(), 0, "fees zeroed");
    }

    function test_OneTime_doubleBuy_reverts() public {
        vm.prank(creatorOne);
        market.list(AGENT_ONE_TIME, AgentAccessMarket.Model.ONE_TIME, 10e18, 0);
        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 100e18);
        market.buyOneTime(AGENT_ONE_TIME);
        vm.expectRevert(AgentAccessMarket.AlreadyOwned.selector);
        market.buyOneTime(AGENT_ONE_TIME);
        vm.stopPrank();
    }

    // ── Model 2: subscription ──────────────────────────────────────────────
    function test_Subscription_expiry_and_renewal() public {
        uint256 price = 10e18;
        uint64 period = 30 days;
        vm.prank(creatorSub);
        market.list(AGENT_SUB, AgentAccessMarket.Model.SUBSCRIPTION, price, period);

        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 1_000e18);

        // First period.
        market.subscribe(AGENT_SUB);
        uint64 firstExpiry = market.accessExpiry(AGENT_SUB, buyer);
        assertEq(firstExpiry, uint64(block.timestamp) + period, "expiry = now + period");
        assertTrue(market.hasAccess(AGENT_SUB, buyer), "access during period");

        // Renew EARLY -> extends from the existing expiry.
        vm.warp(block.timestamp + 10 days);
        market.subscribe(AGENT_SUB);
        assertEq(market.accessExpiry(AGENT_SUB, buyer), firstExpiry + period, "early renew extends");

        // Let it lapse -> access is false.
        vm.warp(market.accessExpiry(AGENT_SUB, buyer) + 1);
        assertFalse(market.hasAccess(AGENT_SUB, buyer), "expired");

        // Renew LATE -> restarts from now.
        market.subscribe(AGENT_SUB);
        assertEq(market.accessExpiry(AGENT_SUB, buyer), uint64(block.timestamp) + period, "late renew restarts");
        assertTrue(market.hasAccess(AGENT_SUB, buyer), "access after re-subscribe");
        vm.stopPrank();
    }

    // ── Authorization / scope ──────────────────────────────────────────────
    function test_list_byNonOwner_reverts() public {
        vm.prank(buyer); // buyer does not own agent 1
        vm.expectRevert(AgentAccessMarket.NotAgentOwner.selector);
        market.list(AGENT_ONE_TIME, AgentAccessMarket.Model.ONE_TIME, 1e18, 0);
    }

    function test_wrongModel_reverts() public {
        vm.prank(creatorOne);
        market.list(AGENT_ONE_TIME, AgentAccessMarket.Model.ONE_TIME, 1e18, 0);
        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 100e18);
        vm.expectRevert(AgentAccessMarket.WrongModel.selector);
        market.subscribe(AGENT_ONE_TIME); // it's a one-time listing
        vm.stopPrank();
    }

    function test_pausedListing_reverts() public {
        vm.startPrank(creatorOne);
        market.list(AGENT_ONE_TIME, AgentAccessMarket.Model.ONE_TIME, 1e18, 0);
        market.setListingActive(AGENT_ONE_TIME, false);
        vm.stopPrank();
        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 100e18);
        vm.expectRevert(AgentAccessMarket.ListingInactive.selector);
        market.buyOneTime(AGENT_ONE_TIME);
        vm.stopPrank();
    }

    // ── Admin limits ───────────────────────────────────────────────────────
    function test_setFeeBps_aboveCap_reverts() public {
        vm.expectRevert(AgentAccessMarket.FeeTooHigh.selector);
        market.setFeeBps(1001); // > MAX_FEE_BPS (1000)
    }

    function test_setFeeBps_byNonOwner_reverts() public {
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        market.setFeeBps(100);
    }

    function test_feeChange_isFutureOnly() public {
        // Buy at 2.5%, then raise the fee: the already-credited balance is untouched.
        vm.prank(creatorOne);
        market.list(AGENT_ONE_TIME, AgentAccessMarket.Model.ONE_TIME, 100e18, 0);
        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 100e18);
        market.buyOneTime(AGENT_ONE_TIME);
        vm.stopPrank();
        uint256 creditedBefore = market.creatorBalance(creatorOne);

        market.setFeeBps(1000); // 10% for the FUTURE
        assertEq(market.creatorBalance(creatorOne), creditedBefore, "past credit untouched by fee change");
    }
}
