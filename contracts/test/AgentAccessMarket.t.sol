// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentAccessMarket} from "../src/AgentAccessMarket.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Runs against a REAL fork of BSC mainnet: the real ERC-8004 registry +
///      the real whitelisted tokens (USDT, $U) and native BNB.
contract AgentAccessMarketForkTest is Test {
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant U = 0xcE24439F2D9C6a2289F741120FE202248B666666;
    address constant REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    AgentAccessMarket market;
    address NATIVE;
    address feeWallet = makeAddr("feeWallet");
    address buyer = makeAddr("buyer");
    uint16 constant FEE_BPS = 250;

    function setUp() public {
        address[] memory tokens = new address[](3);
        tokens[0] = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
        tokens[1] = USDT;
        tokens[2] = U;
        market = new AgentAccessMarket(tokens, REGISTRY, feeWallet, FEE_BPS);
        NATIVE = market.NATIVE();
    }

    // Binance hot wallet — holds >490M of both USDT and $U on live BSC. Used to
    // fund buyers with REAL tokens on the fork (robust for $U, whose proxy
    // balanceOf isn't a plain storage slot, so forge's `deal` is unreliable).
    address constant WHALE = 0xF977814e90dA44bFA03b6295A0616a897441aceC;

    function _owner(uint256 id) internal view returns (address) {
        return IERC721(REGISTRY).ownerOf(id);
    }

    function _fund(address token, address to, uint256 amount) internal {
        vm.prank(WHALE);
        IERC20(token).transfer(to, amount);
    }

    // ── ERC-20 one-time purchase + fee split + withdraw, parametrized ────────
    function _erc20OneTime(address token, uint256 agentId) internal {
        address creator = _owner(agentId);
        uint256 price = 100e18;
        vm.prank(creator);
        market.list(agentId, token, AgentAccessMarket.Model.ONE_TIME, price, 0);

        _fund(token, buyer, 1_000e18);
        vm.startPrank(buyer);
        IERC20(token).approve(address(market), price);
        market.buyOneTime(agentId, token);
        vm.stopPrank();

        assertTrue(market.hasAccess(agentId, buyer), "access after purchase");
        uint256 fee = (price * FEE_BPS) / 10_000;
        assertEq(market.creatorBalance(token, creator), price - fee, "creator net credited");
        assertEq(market.feesAccrued(token), fee, "platform fee accrued");

        uint256 beforeCreator = IERC20(token).balanceOf(creator);
        vm.prank(creator);
        market.withdrawCreatorBalance(token);
        assertEq(IERC20(token).balanceOf(creator) - beforeCreator, price - fee, "creator withdrew net");

        uint256 beforeFee = IERC20(token).balanceOf(feeWallet);
        vm.prank(feeWallet);
        market.withdrawFees(token);
        assertEq(IERC20(token).balanceOf(feeWallet) - beforeFee, fee, "fee wallet withdrew fee");
    }

    function test_USDT_oneTime() public {
        _erc20OneTime(USDT, 1);
    }

    function test_U_oneTime() public {
        _erc20OneTime(U, 2);
    }

    // ── Native BNB one-time purchase + fee split + withdraw ──────────────────
    function test_BNB_native_oneTime() public {
        uint256 agentId = 3;
        address creator = _owner(agentId);
        uint256 price = 1 ether;
        vm.prank(creator);
        market.list(agentId, NATIVE, AgentAccessMarket.Model.ONE_TIME, price, 0);

        vm.deal(buyer, 2 ether);
        vm.prank(buyer);
        market.buyOneTime{value: price}(agentId, NATIVE);

        assertTrue(market.hasAccess(agentId, buyer), "native access");
        uint256 fee = (price * FEE_BPS) / 10_000;
        assertEq(market.creatorBalance(NATIVE, creator), price - fee, "creator net (native)");
        assertEq(market.feesAccrued(NATIVE), fee, "fee accrued (native)");
        assertEq(address(market).balance, price, "contract holds BNB until withdrawal");

        uint256 beforeCreator = creator.balance;
        vm.prank(creator);
        market.withdrawCreatorBalance(NATIVE);
        assertEq(creator.balance - beforeCreator, price - fee, "creator withdrew native net");

        uint256 beforeFee = feeWallet.balance;
        vm.prank(feeWallet);
        market.withdrawFees(NATIVE);
        assertEq(feeWallet.balance - beforeFee, fee, "fee wallet withdrew native fee");
    }

    // ── Buyer picks among multiple token offers for the SAME agent ───────────
    function test_multiTokenOffers_buyerChoosesU() public {
        uint256 agentId = 4;
        address creator = _owner(agentId);
        uint256 priceUsdt = 50e18;
        uint256 priceU = 40e18;
        // creator prices the same agent in BOTH USDT and $U
        vm.startPrank(creator);
        market.list(agentId, USDT, AgentAccessMarket.Model.ONE_TIME, priceUsdt, 0);
        market.list(agentId, U, AgentAccessMarket.Model.ONE_TIME, priceU, 0);
        vm.stopPrank();

        // buyer chooses to pay in $U
        _fund(U, buyer, 1_000e18);
        vm.startPrank(buyer);
        IERC20(U).approve(address(market), priceU);
        market.buyOneTime(agentId, U);
        vm.stopPrank();

        uint256 feeU = (priceU * FEE_BPS) / 10_000;
        assertTrue(market.hasAccess(agentId, buyer), "access via chosen token");
        assertEq(market.creatorBalance(U, creator), priceU - feeU, "credited in $U");
        assertEq(market.creatorBalance(USDT, creator), 0, "USDT offer untouched");
    }

    // ── Native value guards ──────────────────────────────────────────────────
    function test_native_wrongValue_reverts() public {
        uint256 agentId = 3;
        vm.prank(_owner(agentId));
        market.list(agentId, NATIVE, AgentAccessMarket.Model.ONE_TIME, 1 ether, 0);
        vm.deal(buyer, 5 ether);
        vm.prank(buyer);
        vm.expectRevert(AgentAccessMarket.BadNativeValue.selector);
        market.buyOneTime{value: 0.5 ether}(agentId, NATIVE);
    }

    function test_erc20_withStrayNative_reverts() public {
        uint256 agentId = 1;
        vm.prank(_owner(agentId));
        market.list(agentId, USDT, AgentAccessMarket.Model.ONE_TIME, 100e18, 0);
        _fund(USDT, buyer, 1_000e18);
        vm.deal(buyer, 1 ether);
        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 100e18);
        vm.expectRevert(AgentAccessMarket.UnexpectedNativeValue.selector);
        market.buyOneTime{value: 1 wei}(agentId, USDT);
        vm.stopPrank();
    }

    // ── Whitelist enforcement ────────────────────────────────────────────────
    function test_list_unwhitelistedToken_reverts() public {
        address randomToken = makeAddr("randomToken");
        vm.prank(_owner(1));
        vm.expectRevert(AgentAccessMarket.TokenNotAccepted.selector);
        market.list(1, randomToken, AgentAccessMarket.Model.ONE_TIME, 1e18, 0);
    }

    function test_setAcceptedToken_ownerOnly_and_effective() public {
        address newTok = makeAddr("newTok");
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, buyer));
        market.setAcceptedToken(newTok, true);
        market.setAcceptedToken(newTok, true);
        assertTrue(market.acceptedTokens(newTok), "token whitelisted");
        // now whitelisted -> ownerOf gate applies (buyer isn't the owner)
        vm.prank(buyer);
        vm.expectRevert(AgentAccessMarket.NotAgentOwner.selector);
        market.list(1, newTok, AgentAccessMarket.Model.ONE_TIME, 1e18, 0);
    }

    function test_buy_tokenWithNoOffer_reverts() public {
        uint256 agentId = 1;
        vm.prank(_owner(agentId));
        market.list(agentId, USDT, AgentAccessMarket.Model.ONE_TIME, 100e18, 0);
        // no $U offer set for this agent -> buying in $U reverts
        _fund(U, buyer, 1_000e18);
        vm.startPrank(buyer);
        IERC20(U).approve(address(market), 100e18);
        vm.expectRevert(AgentAccessMarket.NoOffer.selector);
        market.buyOneTime(agentId, U);
        vm.stopPrank();
    }

    // ── Subscription (USDT) expiry + renewal ─────────────────────────────────
    function test_subscription_expiry_and_renewal() public {
        uint256 agentId = 2;
        address creator = _owner(agentId);
        uint256 price = 10e18;
        uint64 period = 30 days;
        vm.prank(creator);
        market.list(agentId, USDT, AgentAccessMarket.Model.SUBSCRIPTION, price, period);

        _fund(USDT, buyer, 1_000e18);
        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 1_000e18);

        market.subscribe(agentId, USDT);
        uint64 firstExpiry = market.accessExpiry(agentId, buyer);
        assertEq(firstExpiry, uint64(block.timestamp) + period, "expiry = now + period");

        vm.warp(block.timestamp + 10 days);
        market.subscribe(agentId, USDT);
        assertEq(market.accessExpiry(agentId, buyer), firstExpiry + period, "early renew extends");

        vm.warp(market.accessExpiry(agentId, buyer) + 1);
        assertFalse(market.hasAccess(agentId, buyer), "expired");
        market.subscribe(agentId, USDT);
        assertEq(market.accessExpiry(agentId, buyer), uint64(block.timestamp) + period, "late renew restarts");
        vm.stopPrank();
    }

    // ── Admin ────────────────────────────────────────────────────────────────
    function test_setFeeBps_aboveCap_reverts() public {
        vm.expectRevert(AgentAccessMarket.FeeTooHigh.selector);
        market.setFeeBps(1001);
    }

    function test_feeChange_isFutureOnly() public {
        vm.prank(_owner(1));
        market.list(1, USDT, AgentAccessMarket.Model.ONE_TIME, 100e18, 0);
        _fund(USDT, buyer, 1_000e18);
        vm.startPrank(buyer);
        IERC20(USDT).approve(address(market), 100e18);
        market.buyOneTime(1, USDT);
        vm.stopPrank();
        uint256 creditedBefore = market.creatorBalance(USDT, _owner(1));
        market.setFeeBps(1000);
        assertEq(market.creatorBalance(USDT, _owner(1)), creditedBefore, "past credit untouched");
    }
}
