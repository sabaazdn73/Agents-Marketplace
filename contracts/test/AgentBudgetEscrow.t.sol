// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentBudgetEscrow} from "../src/AgentBudgetEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Adversarial-first suite. This contract hands an agent unilateral
///      spend authority, which is a weaker trust model than the ERC-8183
///      escrow already in use, so the tests lead with the attacks rather
///      than the happy path.

// ───────────────────────────── Test doubles ─────────────────────────────

contract MockERC20 {
    string public name = "Mock";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) public virtual returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) public virtual returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

/// @dev Burns 10% on every transfer -- the case balanceOf-delta exists for.
contract FeeOnTransferToken is MockERC20 {
    function transfer(address to, uint256 a) public override returns (bool) {
        uint256 fee = a / 10;
        balanceOf[msg.sender] -= a; balanceOf[to] += a - fee; return true;
    }
    function transferFrom(address f, address t, uint256 a) public override returns (bool) {
        uint256 fee = a / 10;
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a - fee; return true;
    }
}

/// @dev Re-enters draw() from inside the token transfer that draw() makes.
contract ReentrantToken is MockERC20 {
    AgentBudgetEscrow public esc;
    uint256 public budgetId;
    bool public armed;
    bool public reentryReverted;

    function arm(AgentBudgetEscrow e, uint256 id) external { esc = e; budgetId = id; armed = true; }

    function transfer(address to, uint256 a) public override returns (bool) {
        if (armed) {
            armed = false;
            try esc.draw(budgetId, 1, bytes32(0)) { reentryReverted = false; }
            catch { reentryReverted = true; }
        }
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
}

/// @dev A native-BNB agent that re-enters draw() from its receive().
contract ReentrantAgent {
    AgentBudgetEscrow public esc;
    uint256 public budgetId;
    bool public armed;
    bool public reentryReverted;

    function arm(AgentBudgetEscrow e, uint256 id) external { esc = e; budgetId = id; armed = true; }
    function pull(uint256 amt) external { esc.draw(budgetId, amt, bytes32("go")); }

    receive() external payable {
        if (armed) {
            armed = false;
            try esc.draw(budgetId, 1 ether, bytes32(0)) { reentryReverted = false; }
            catch { reentryReverted = true; }
        }
    }
}

/// @dev Re-enters reclaim() from inside the payout it triggers.
contract ReentrantClient {
    AgentBudgetEscrow public esc;
    uint256 public budgetId;
    bool public armed;
    bool public reentryReverted;

    function arm(AgentBudgetEscrow e, uint256 id) external { esc = e; budgetId = id; armed = true; }
    function open(address agent, uint64 deadline) external payable returns (uint256) {
        return esc.openBudget{value: msg.value}(agent, esc.NATIVE(), msg.value, 0, deadline, 0);
    }
    function setEsc(AgentBudgetEscrow e) external { esc = e; }
    function doReclaim(uint256 id) external { esc.reclaim(id); }

    receive() external payable {
        if (armed) {
            armed = false;
            try esc.reclaim(budgetId) { reentryReverted = false; }
            catch { reentryReverted = true; }
        }
    }
}

// ──────────────────────────────── Tests ─────────────────────────────────

contract AgentBudgetEscrowTest is Test {
    AgentBudgetEscrow esc;
    MockERC20 tok;
    address NATIVE;

    address client = makeAddr("client");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");
    address feeWallet = makeAddr("feeWallet");
    uint16 constant FEE_BPS = 250; // 2.5%
    /// @dev Same value as a uint256. Fee maths in the tests must NOT be done
    ///      in uint16: `10 ether * FEE_BPS` promotes to the smaller operand
    ///      type and overflows with panic 0x11, which cost three false
    ///      failures that looked like contract bugs and were test bugs.
    uint256 constant FEE_BPS_U = 250;

    uint64 deadline;

    function setUp() public {
        tok = new MockERC20();
        address[] memory tokens = new address[](2);
        tokens[0] = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
        tokens[1] = address(tok);
        esc = new AgentBudgetEscrow(tokens, feeWallet, FEE_BPS);
        NATIVE = esc.NATIVE();
        deadline = uint64(block.timestamp + 7 days);

        tok.mint(client, 1_000 ether);
        vm.prank(client);
        tok.approve(address(esc), type(uint256).max);
        vm.deal(client, 1_000 ether);
    }

    function _open(uint256 amt, uint256 maxPerDraw, uint64 cooldown) internal returns (uint256 id) {
        vm.prank(client);
        id = esc.openBudget(agent, address(tok), amt, maxPerDraw, deadline, cooldown);
    }

    // ── Cap enforcement ──────────────────────────────────────────────────

    function test_draw_cannotExceedRemaining() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 60 ether, bytes32(0));
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.ExceedsRemaining.selector);
        esc.draw(id, 41 ether, bytes32(0));
    }

    function test_draw_exactlyDrainsAndThenReverts() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 100 ether, bytes32(0));
        assertEq(esc.drawableNow(id), 0, "nothing left");
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.ExceedsRemaining.selector);
        esc.draw(id, 1, bytes32(0));
    }

    function test_draw_respectsMaxPerDraw() public {
        uint256 id = _open(100 ether, 10 ether, 0);
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.ExceedsMaxPerDraw.selector);
        esc.draw(id, 10 ether + 1, bytes32(0));
        vm.prank(agent);
        esc.draw(id, 10 ether, bytes32(0)); // boundary allowed
    }

    function test_maxPerDraw_boundsTotalLossPerTransaction() public {
        // The point of maxPerDraw: a fully compromised agent still cannot
        // take the whole budget in one transaction.
        uint256 id = _open(100 ether, 5 ether, 0);
        vm.prank(agent);
        esc.draw(id, 5 ether, bytes32(0));
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.ExceedsMaxPerDraw.selector);
        esc.draw(id, 95 ether, bytes32(0));
    }

    // ── Cooldown ─────────────────────────────────────────────────────────

    function test_cooldown_blocksImmediateSecondDraw() public {
        uint256 id = _open(100 ether, 0, 1 hours);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(agent);
        esc.draw(id, 10 ether, bytes32(0));
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.CooldownActive.selector);
        esc.draw(id, 10 ether, bytes32(0));
        vm.warp(block.timestamp + 1 hours);
        vm.prank(agent);
        esc.draw(id, 10 ether, bytes32(0));
    }

    function test_cooldown_appliesBeforeTheFirstDrawToo() public {
        // lastDrawAt is seeded at creation deliberately; otherwise a cooldown
        // budget could be hit once instantly.
        uint256 id = _open(100 ether, 0, 1 hours);
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.CooldownActive.selector);
        esc.draw(id, 1 ether, bytes32(0));
    }

    // ── Deadline edges ───────────────────────────────────────────────────

    function test_draw_atExactDeadlineAllowed_afterItReverts() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.warp(deadline); // exactly at
        vm.prank(agent);
        esc.draw(id, 1 ether, bytes32(0));
        vm.warp(uint256(deadline) + 1); // one second past
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.PastDeadline.selector);
        esc.draw(id, 1 ether, bytes32(0));
    }

    function test_open_rejectsPastAndTooFarDeadlines() public {
        vm.prank(client);
        vm.expectRevert(AgentBudgetEscrow.DeadlineTooSoon.selector);
        esc.openBudget(agent, address(tok), 1 ether, 0, uint64(block.timestamp), 0);

        vm.prank(client);
        vm.expectRevert(AgentBudgetEscrow.DeadlineTooFar.selector);
        esc.openBudget(agent, address(tok), 1 ether, 0, uint64(block.timestamp + 366 days), 0);
    }

    function test_reclaimAfterDeadline_isNotEarly() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.warp(uint256(deadline) + 1);
        vm.expectEmit(true, true, false, true);
        emit AgentBudgetEscrow.BudgetReclaimed(id, client, 100 ether, false);
        vm.prank(client);
        esc.reclaim(id);
    }

    // ── Access control ───────────────────────────────────────────────────

    function test_draw_onlyAgent() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(stranger);
        vm.expectRevert(AgentBudgetEscrow.NotAgent.selector);
        esc.draw(id, 1 ether, bytes32(0));
        vm.prank(client); // even the client cannot draw
        vm.expectRevert(AgentBudgetEscrow.NotAgent.selector);
        esc.draw(id, 1 ether, bytes32(0));
    }

    function test_reclaim_onlyClient() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(stranger);
        vm.expectRevert(AgentBudgetEscrow.NotClient.selector);
        esc.reclaim(id);
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.NotClient.selector);
        esc.reclaim(id);
    }

    function test_close_byEitherParty_butNotStranger() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(stranger);
        vm.expectRevert(AgentBudgetEscrow.NotAgent.selector);
        esc.close(id);
        vm.prank(agent);
        esc.close(id);
    }

    function test_unknownBudgetId_reverts() public {
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.NoSuchBudget.selector);
        esc.draw(999, 1, bytes32(0));
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    function test_draw_afterClose_reverts() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.close(id);
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.NotOpen.selector);
        esc.draw(id, 1 ether, bytes32(0));
    }

    function test_draw_afterReclaim_reverts() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(client);
        esc.reclaim(id);
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.NotOpen.selector);
        esc.draw(id, 1 ether, bytes32(0));
    }

    function test_doubleReclaim_reverts() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(client);
        esc.reclaim(id);
        vm.prank(client);
        vm.expectRevert(AgentBudgetEscrow.NotOpen.selector);
        esc.reclaim(id);
    }

    function test_reclaimAfterClose_stillWorks() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32(0));
        vm.prank(agent);
        esc.close(id);
        uint256 before = tok.balanceOf(client);
        vm.prank(client);
        esc.reclaim(id);
        assertEq(tok.balanceOf(client) - before, 60 ether, "client gets the unspent remainder");
    }

    function test_revokeMidJob_strandsNothingUndrawn() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 30 ether, bytes32(0));
        vm.prank(client);
        esc.reclaim(id); // revoke while still open and before deadline
        // The agent keeps what it already drew, and can draw nothing more.
        assertEq(tok.balanceOf(agent), 30 ether - (30 ether * FEE_BPS_U) / 10_000);
        vm.prank(agent);
        vm.expectRevert(AgentBudgetEscrow.NotOpen.selector);
        esc.draw(id, 1, bytes32(0));
    }

    // ── Reentrancy ───────────────────────────────────────────────────────

    function test_reentrancy_onDraw_viaMaliciousToken() public {
        ReentrantToken rtok = new ReentrantToken();
        esc.setAcceptedToken(address(rtok), true);
        rtok.mint(client, 100 ether);
        vm.prank(client);
        rtok.approve(address(esc), type(uint256).max);
        vm.prank(client);
        uint256 id = esc.openBudget(agent, address(rtok), 100 ether, 0, deadline, 0);

        rtok.arm(esc, id);
        vm.prank(agent);
        esc.draw(id, 10 ether, bytes32(0));

        assertTrue(rtok.reentryReverted(), "nested draw must be blocked by the guard");
        AgentBudgetEscrow.Budget memory b = esc.getBudget(id);
        assertEq(b.spent, 10 ether, "exactly one draw accounted");
    }

    function test_reentrancy_onDraw_viaMaliciousAgent_native() public {
        ReentrantAgent ra = new ReentrantAgent();
        vm.prank(client);
        uint256 id = esc.openBudget{value: 100 ether}(address(ra), NATIVE, 100 ether, 0, deadline, 0);
        ra.arm(esc, id);
        ra.pull(10 ether);
        assertTrue(ra.reentryReverted(), "nested draw must be blocked by the guard");
        AgentBudgetEscrow.Budget memory b = esc.getBudget(id);
        assertEq(b.spent, 10 ether, "exactly one draw accounted");
    }

    function test_reentrancy_onReclaim_viaMaliciousClient_native() public {
        ReentrantClient rc = new ReentrantClient();
        rc.setEsc(esc);
        vm.deal(address(rc), 100 ether);
        uint256 id = rc.open{value: 100 ether}(agent, deadline);
        rc.arm(esc, id);
        rc.doReclaim(id);
        assertTrue(rc.reentryReverted(), "nested reclaim must be blocked");
        assertEq(address(esc).balance, 0, "no funds stranded or double-paid");
    }

    // ── Fee-on-transfer ──────────────────────────────────────────────────

    function test_feeOnTransfer_creditsWhatActuallyArrived() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        esc.setAcceptedToken(address(fot), true);
        fot.mint(client, 100 ether);
        vm.prank(client);
        fot.approve(address(esc), type(uint256).max);
        vm.prank(client);
        uint256 id = esc.openBudget(agent, address(fot), 100 ether, 0, deadline, 0);

        AgentBudgetEscrow.Budget memory b = esc.getBudget(id);
        assertEq(b.total, 90 ether, "budget is what arrived, not what was stated");
        // And the contract can actually honour the whole of it.
        vm.prank(agent);
        esc.draw(id, 90 ether, bytes32(0));
    }

    // ── Native vs ERC-20 plumbing ────────────────────────────────────────

    function test_native_fullCycle() public {
        vm.prank(client);
        uint256 id = esc.openBudget{value: 50 ether}(agent, NATIVE, 50 ether, 0, deadline, 0);
        uint256 agentBefore = agent.balance;
        vm.prank(agent);
        esc.draw(id, 10 ether, bytes32("gas"));
        uint256 fee = (10 ether * FEE_BPS_U) / 10_000;
        assertEq(agent.balance - agentBefore, 10 ether - fee);
        uint256 clientBefore = client.balance;
        vm.prank(client);
        esc.reclaim(id);
        assertEq(client.balance - clientBefore, 40 ether);
    }

    function test_native_valueMustMatchAmount() public {
        vm.prank(client);
        vm.expectRevert(AgentBudgetEscrow.BadNativeValue.selector);
        esc.openBudget{value: 1 ether}(agent, NATIVE, 2 ether, 0, deadline, 0);
    }

    function test_erc20_rejectsStrayNative() public {
        vm.prank(client);
        vm.expectRevert(AgentBudgetEscrow.UnexpectedNativeValue.selector);
        esc.openBudget{value: 1 ether}(agent, address(tok), 1 ether, 0, deadline, 0);
    }

    // ── Open-time validation ─────────────────────────────────────────────

    function test_open_rejectsBadInputs() public {
        vm.startPrank(client);
        vm.expectRevert(AgentBudgetEscrow.ZeroAddress.selector);
        esc.openBudget(address(0), address(tok), 1 ether, 0, deadline, 0);

        vm.expectRevert(AgentBudgetEscrow.AgentIsClient.selector);
        esc.openBudget(client, address(tok), 1 ether, 0, deadline, 0);

        vm.expectRevert(AgentBudgetEscrow.ZeroAmount.selector);
        esc.openBudget(agent, address(tok), 0, 0, deadline, 0);

        vm.expectRevert(AgentBudgetEscrow.TokenNotAccepted.selector);
        esc.openBudget(agent, address(0xBEEF), 1 ether, 0, deadline, 0);
        vm.stopPrank();
    }

    // ── Fees ─────────────────────────────────────────────────────────────

    function test_feesAccrueAndWithdraw_neverTouchBudgetFunds() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32(0));
        uint256 fee = (40 ether * FEE_BPS_U) / 10_000;
        assertEq(esc.feesAccrued(address(tok)), fee);

        esc.withdrawFees(address(tok));
        assertEq(tok.balanceOf(feeWallet), fee);

        // The client's remainder is still fully reclaimable afterwards.
        uint256 before = tok.balanceOf(client);
        vm.prank(client);
        esc.reclaim(id);
        assertEq(tok.balanceOf(client) - before, 60 ether);
    }

    function test_delistingTokenDoesNotTrapExistingBudget() public {
        uint256 id = _open(100 ether, 0, 0);
        esc.setAcceptedToken(address(tok), false);
        vm.prank(agent);
        esc.draw(id, 10 ether, bytes32(0)); // existing budget still works
        vm.prank(client);
        esc.reclaim(id);
    }

    // ── Pause: one-directional by design ─────────────────────────────────

    function test_pause_blocksNewBudgetsAndDraws() public {
        uint256 id = _open(100 ether, 0, 0);
        esc.pause();
        vm.prank(agent);
        vm.expectRevert(); // Pausable: EnforcedPause
        esc.draw(id, 1 ether, bytes32(0));
        vm.prank(client);
        vm.expectRevert();
        esc.openBudget(agent, address(tok), 1 ether, 0, deadline, 0);
    }

    function test_pause_canNEVERtrapClientFunds() public {
        // The whole point of the asymmetry: a paused contract must still let
        // every client recover their entire unspent remainder immediately.
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 25 ether, bytes32(0));
        esc.pause();

        uint256 before = tok.balanceOf(client);
        vm.prank(client);
        esc.reclaim(id); // must succeed while paused
        assertEq(tok.balanceOf(client) - before, 75 ether, "client exits fully while paused");
    }

    function test_pause_closeStillWorks() public {
        uint256 id = _open(100 ether, 0, 0);
        esc.pause();
        vm.prank(agent);
        esc.close(id); // must not be gated
    }

    function test_pause_onlyOwner_andUnpauseRestores() public {
        vm.prank(stranger);
        vm.expectRevert();
        esc.pause();
        uint256 id = _open(100 ether, 0, 0);
        esc.pause();
        esc.unpause();
        vm.prank(agent);
        esc.draw(id, 1 ether, bytes32(0)); // works again
    }

    // ── Fee admin: setFeeBps ─────────────────────────────────────────────
    //
    // Both fee setters had ZERO lines executed before this section existed.
    // They are the two owner functions that move real money: one changes
    // what the platform takes from every future draw, the other changes who
    // receives it. An untested setFeeWallet is the worse of the two -- it
    // redirects a balance that has already accrued.

    function test_setFeeBps_updatesStateAndEmitsOldAndNew() public {
        assertEq(esc.feeBps(), FEE_BPS, "starts at the constructor value");
        vm.expectEmit(false, false, false, true);
        emit AgentBudgetEscrow.FeeBpsUpdated(FEE_BPS, 500);
        esc.setFeeBps(500);
        assertEq(esc.feeBps(), 500);
    }

    function test_setFeeBps_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(); // Ownable: OwnableUnauthorizedAccount
        esc.setFeeBps(500);
        assertEq(esc.feeBps(), FEE_BPS, "unchanged after a rejected call");
    }

    /// @dev The ceiling is the only thing standing between a client and an
    ///      owner who sets the fee to 100%. Both sides of it are pinned.
    function test_setFeeBps_rejectsAboveCeiling_acceptsCeilingItself() public {
        // Read the ceiling BEFORE expectRevert: MAX_FEE_BPS() is itself an
        // external call, and inline it would consume the expectRevert and
        // let setFeeBps run unchecked.
        uint16 ceiling = esc.MAX_FEE_BPS();

        vm.expectRevert(AgentBudgetEscrow.FeeTooHigh.selector);
        esc.setFeeBps(ceiling + 1);
        assertEq(esc.feeBps(), FEE_BPS, "unchanged after a rejected call");

        esc.setFeeBps(ceiling); // exactly at the ceiling is allowed
        assertEq(esc.feeBps(), ceiling);
    }

    function test_setFeeBps_zeroMeansNoFee() public {
        esc.setFeeBps(0);
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32(0));
        assertEq(esc.feesAccrued(address(tok)), 0, "no fee taken at 0 bps");
        assertEq(tok.balanceOf(agent), 40 ether, "agent receives the gross amount");
    }

    /// @dev The natspec promises the new rate "applies to FUTURE draws only".
    ///      That is a claim about money already taken, so it is tested rather
    ///      than trusted: the first draw's fee must survive the rate change.
    function test_setFeeBps_appliesToFutureDrawsOnly() public {
        uint256 id = _open(100 ether, 0, 0);

        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32("before"));
        uint256 feeAtOldRate = (40 ether * FEE_BPS_U) / 10_000;
        assertEq(esc.feesAccrued(address(tok)), feeAtOldRate);

        esc.setFeeBps(1000); // 10%

        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32("after"));
        uint256 feeAtNewRate = (40 ether * 1000) / 10_000;

        assertEq(
            esc.feesAccrued(address(tok)),
            feeAtOldRate + feeAtNewRate,
            "the earlier draw is not retro-priced at the new rate"
        );
    }

    // ── Fee admin: setFeeWallet ──────────────────────────────────────────

    function test_setFeeWallet_updatesStateAndEmitsOldAndNew() public {
        address newWallet = makeAddr("newFeeWallet");
        assertEq(esc.feeWallet(), feeWallet, "starts at the constructor value");
        vm.expectEmit(true, true, false, true);
        emit AgentBudgetEscrow.FeeWalletUpdated(feeWallet, newWallet);
        esc.setFeeWallet(newWallet);
        assertEq(esc.feeWallet(), newWallet);
    }

    function test_setFeeWallet_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(); // Ownable: OwnableUnauthorizedAccount
        esc.setFeeWallet(stranger);
        assertEq(esc.feeWallet(), feeWallet, "unchanged after a rejected call");
    }

    /// @dev Zero here would send every future withdrawFees to address(0).
    ///      For the ERC20 path that is an unrecoverable burn.
    function test_setFeeWallet_rejectsZeroAddress() public {
        vm.expectRevert(AgentBudgetEscrow.ZeroAddress.selector);
        esc.setFeeWallet(address(0));
        assertEq(esc.feeWallet(), feeWallet, "unchanged after a rejected call");
    }

    /// @dev The consequence that makes this function worth testing at all:
    ///      withdrawFees reads feeWallet at CALL time, not at accrual time,
    ///      so fees earned under the old wallet are paid to the new one.
    ///      Not a bug -- but it is the behaviour, and it moves real money,
    ///      so it is pinned rather than left to be discovered in production.
    function test_setFeeWallet_redirectsAlreadyAccruedFees() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32(0));
        uint256 fee = (40 ether * FEE_BPS_U) / 10_000;
        assertEq(esc.feesAccrued(address(tok)), fee, "accrued while the old wallet was set");

        address newWallet = makeAddr("newFeeWallet");
        esc.setFeeWallet(newWallet);
        esc.withdrawFees(address(tok));

        assertEq(tok.balanceOf(newWallet), fee, "the new wallet receives the earlier fees");
        assertEq(tok.balanceOf(feeWallet), 0, "the old wallet receives nothing");
    }

    /// @dev withdrawFees authorises `owner() || feeWallet`, so changing the
    ///      wallet silently moves that permission too. Both directions.
    function test_setFeeWallet_movesWithdrawAuthorisation() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32(0));

        address newWallet = makeAddr("newFeeWallet");
        esc.setFeeWallet(newWallet);

        // The old wallet is now just a stranger to this function.
        vm.prank(feeWallet);
        vm.expectRevert(AgentBudgetEscrow.NotClient.selector);
        esc.withdrawFees(address(tok));

        // The new one can call it.
        vm.prank(newWallet);
        esc.withdrawFees(address(tok));
        assertEq(esc.feesAccrued(address(tok)), 0);
    }

    /// @dev Neither setter may touch client or agent money. A budget opened
    ///      before both changes must still pay out in full afterwards.
    function test_feeAdmin_neverTouchesBudgetFunds() public {
        uint256 id = _open(100 ether, 0, 0);
        vm.prank(agent);
        esc.draw(id, 40 ether, bytes32(0));

        esc.setFeeBps(1000);
        esc.setFeeWallet(makeAddr("newFeeWallet"));

        uint256 before = tok.balanceOf(client);
        vm.prank(client);
        esc.reclaim(id);
        assertEq(tok.balanceOf(client) - before, 60 ether, "client's remainder is untouched");
    }

    // ── Solvency invariant ───────────────────────────────────────────────

    function testFuzz_contractStaysSolvent(uint96 amt, uint96 d1, uint96 d2) public {
        amt = uint96(bound(amt, 1 ether, 500 ether));
        d1 = uint96(bound(d1, 1, amt));
        d2 = uint96(bound(d2, 1, amt));

        uint256 id = _open(amt, 0, 0);
        vm.prank(agent);
        esc.draw(id, d1, bytes32(0));
        if (d2 <= amt - d1) {
            vm.prank(agent);
            esc.draw(id, d2, bytes32(0));
        }
        AgentBudgetEscrow.Budget memory b = esc.getBudget(id);
        assertLe(b.spent, b.total, "spent can never exceed total");
        // Everything still owed -- the client's remainder plus unwithdrawn
        // fees -- must actually be held by the contract.
        assertGe(
            tok.balanceOf(address(esc)),
            (b.total - b.spent) + esc.feesAccrued(address(tok)),
            "contract must cover remainder + accrued fees"
        );
    }
}
