// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * StockTokenMultiplier.t.sol
 *
 * Does a Robinhood Chain Stock Token's corporate-action multiplier break
 * AgentBudgetEscrow's `_pullIn` / `_payout` accounting?
 *
 * WHY THIS IS A LOCAL TEST AND NOT A TESTNET SCRIPT
 * -------------------------------------------------
 * The multiplier is moved by the token issuer, so a corporate action is not
 * something an outside account can trigger on Robinhood's testnet either.
 * Holding testnet Stock Tokens would show the escrow working at a multiplier
 * of 1.0 and nothing else, which is the case that was never in doubt. The
 * question is what happens WHEN the multiplier moves, so the token is mocked
 * here and the multiplier is moved directly.
 *
 * The mock is built to the ERC-8056 reference implementation rather than to
 * a guess. The two properties that matter, quoted from the spec:
 *
 *   "The standard ERC-20 functions (balanceOf, transfer, transferFrom, etc.)
 *    MUST continue to work with raw amounts."
 *
 *   "Multiplier Precision: The UI multiplier MUST use 18 decimal places
 *    (1e18 represents a multiplier of 1.0)."
 *
 * and from Robinhood's own Stock Token documentation:
 *
 *   "The multiplier scales the effective amount without changing raw balances
 *    or total supply -- balanceOf() and totalSupply() stay fixed. Stock
 *    tokens are not rebasing tokens."
 *
 * The escrow contract under test is the mainnet source, unmodified.
 */

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentBudgetEscrow} from "../src/AgentBudgetEscrow.sol";

/// @dev ERC-8056 Scaled UI Amount, modelled on the EIP's reference
///      implementation. Raw ledger is a plain ERC20; the multiplier is a
///      separate scalar that no ERC-20 function consults.
contract MockStockToken is ERC20 {
    uint256 private constant ONE = 1e18;
    uint256 private _uiMultiplier = ONE;

    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAt);

    constructor() ERC20("Mock NVDA", "NVDAx") {}

    function uiMultiplier() external view returns (uint256) {
        return _uiMultiplier;
    }

    /// @dev A corporate action. 2e18 is a 2-for-1 split, 5e17 a 1-for-2 reverse.
    function applyCorporateAction(uint256 newMultiplier) external {
        emit UIMultiplierUpdated(_uiMultiplier, newMultiplier, block.timestamp);
        _uiMultiplier = newMultiplier;
    }

    function toUIAmount(uint256 raw) external view returns (uint256) {
        return (raw * _uiMultiplier) / ONE;
    }

    function fromUIAmount(uint256 ui) external view returns (uint256) {
        return (ui * ONE) / _uiMultiplier;
    }

    function mint(address to, uint256 raw) external {
        _mint(to, raw);
    }
}

/// @dev A control: a token that DOES move balances underneath the escrow,
///      to prove this test is capable of failing.
///
///      The first version of this overrode `balanceOf` to report half. That
///      was not a rebasing token, it was a token whose reported balance
///      disagreed with its own ledger: OpenZeppelin's `_update` spends the
///      internal `_balances` mapping, which the override never touched, so
///      transfers of the full amount still succeeded and the control passed
///      when it should have failed. A down-rebase burns supply, so this one
///      burns, which is what actually moves the ledger.
contract MockRebasingToken is ERC20 {
    constructor() ERC20("Rebasing", "RBS") {}

    function mint(address to, uint256 raw) external {
        _mint(to, raw);
    }

    /// @dev Halves a holder's balance, as a negative rebase does.
    function rebaseDown(address holder) external {
        _burn(holder, balanceOf(holder) / 2);
    }
}

contract StockTokenMultiplierTest is Test {
    AgentBudgetEscrow escrow;
    MockStockToken stock;

    address owner = address(0xA11CE);
    address client = address(0xC11E7);
    address agent = address(0xA9E77);
    address feeWallet = address(0xFEE);

    uint256 constant AMOUNT = 100e18;

    function setUp() public {
        stock = new MockStockToken();
        address[] memory toks = new address[](1);
        toks[0] = address(stock);

        vm.prank(owner);
        escrow = new AgentBudgetEscrow(toks, feeWallet, 0);

        stock.mint(client, AMOUNT);
        vm.prank(client);
        stock.approve(address(escrow), type(uint256).max);
    }

    function _open() internal returns (uint256 id) {
        vm.prank(client);
        id = escrow.openBudget(
            agent, address(stock), AMOUNT, 0, uint64(block.timestamp + 7 days), 0
        );
    }

    // ── 1. The premise: does the multiplier touch the ERC-20 ledger at all ──
    function test_MultiplierDoesNotMoveRawBalances() public {
        uint256 before = stock.balanceOf(client);
        stock.applyCorporateAction(2e18); // 2-for-1 split
        assertEq(stock.balanceOf(client), before, "balanceOf moved on a split");
        assertEq(stock.totalSupply(), AMOUNT, "totalSupply moved on a split");
        // The UI view is what moves, and only the UI view.
        assertEq(stock.toUIAmount(before), before * 2, "uiAmount did not scale");
    }

    // ── 2. _pullIn across a multiplier change ───────────────────────────────
    function test_PullInCreditsRawAmount_SplitBefore() public {
        stock.applyCorporateAction(2e18);
        uint256 id = _open();
        AgentBudgetEscrow.Budget memory b = escrow.getBudget(id);
        assertEq(b.total, AMOUNT, "credited something other than what arrived");
        assertEq(stock.balanceOf(address(escrow)), AMOUNT, "escrow holds a different raw amount");
    }

    // ── 3. The case the question was actually about ─────────────────────────
    //      Deposit, then a corporate action lands mid-budget, then draw.
    function test_DrawAfterSplit_FullyDrainable() public {
        uint256 id = _open();
        stock.applyCorporateAction(2e18); // split lands mid-budget

        AgentBudgetEscrow.Budget memory b = escrow.getBudget(id);
        assertEq(b.total, AMOUNT, "stored total drifted after the split");
        assertEq(escrow.drawableNow(id), AMOUNT, "drawable drifted after the split");

        vm.prank(agent);
        escrow.draw(id, AMOUNT, bytes32("work"));

        assertEq(stock.balanceOf(agent), AMOUNT, "agent received the wrong raw amount");
        assertEq(stock.balanceOf(address(escrow)), 0, "escrow left holding dust");
    }

    // ── 4. The failure mode I predicted: reverse split starving a payout ────
    function test_DrawAfterReverseSplit_DoesNotRevert() public {
        uint256 id = _open();
        stock.applyCorporateAction(5e17); // 1-for-2 reverse split

        vm.prank(agent);
        escrow.draw(id, AMOUNT, bytes32("work")); // predicted to revert. It does not.

        assertEq(stock.balanceOf(agent), AMOUNT);
        assertEq(stock.balanceOf(address(escrow)), 0);
    }

    // ── 5. Partial draw, action, reclaim: the whole lifecycle ───────────────
    function test_FullLifecycleAcrossCorporateAction() public {
        uint256 id = _open();

        vm.prank(agent);
        escrow.draw(id, 40e18, bytes32("part"));

        stock.applyCorporateAction(3e18); // 3-for-1 mid-flight

        vm.prank(agent);
        escrow.draw(id, 10e18, bytes32("part2"));

        vm.prank(client);
        escrow.reclaim(id);

        assertEq(stock.balanceOf(agent), 50e18, "agent total wrong");
        assertEq(stock.balanceOf(client), 50e18, "client reclaim wrong");
        assertEq(stock.balanceOf(address(escrow)), 0, "value stranded in escrow");
        // Conservation: nothing minted, nothing burned, nothing stuck.
        assertEq(
            stock.balanceOf(agent) + stock.balanceOf(client) + stock.balanceOf(address(escrow)),
            AMOUNT,
            "raw units not conserved"
        );
    }

    // ── 6. Control: prove this test CAN detect drift ────────────────────────
    //      Same lifecycle against a token that really does move balances.
    function test_Control_RebasingTokenDoesBreak() public {
        MockRebasingToken reb = new MockRebasingToken();
        vm.prank(owner);
        escrow.setAcceptedToken(address(reb), true);

        reb.mint(client, AMOUNT);
        vm.prank(client);
        reb.approve(address(escrow), type(uint256).max);

        vm.prank(client);
        uint256 id = escrow.openBudget(
            agent, address(reb), AMOUNT, 0, uint64(block.timestamp + 7 days), 0
        );

        reb.rebaseDown(address(escrow)); // balances halve underneath the escrow

        AgentBudgetEscrow.Budget memory b = escrow.getBudget(id);
        assertEq(b.total, AMOUNT, "stored total is raw, as expected");
        assertLt(reb.balanceOf(address(escrow)), b.total, "control did not actually shrink");

        // The escrow still believes it owes the full amount, and cannot pay it.
        vm.prank(agent);
        vm.expectRevert();
        escrow.draw(id, AMOUNT, bytes32("work"));
    }
}
