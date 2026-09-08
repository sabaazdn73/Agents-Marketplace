// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AgentBudgetEscrow
 * @notice A SECOND funding model for hiring an agent, alongside ERC-8183
 *         escrow rather than replacing it.
 *
 * WHY THIS EXISTS
 * ---------------
 * ERC-8183 locks the full amount until delivery. That is correct for an
 * agent whose work is computational or informational. It cannot work for an
 * agent that must SPEND to produce -- buying an API call, paying gas,
 * acquiring an asset -- because the money that would let it work is locked
 * behind having already worked.
 *
 * This was confirmed against the verified ERC-8183 mainnet source rather
 * than assumed from names: the whole contract moves `job.budget` in exactly
 * five places, always in full; `complete()` takes no amount; the Job struct
 * has no spent/drawn accumulator at all; and `setBudget` reverts unless the
 * job is still Open, which makes it a price-negotiation call, not an
 * allowance. Partial release is not restricted there -- it is structurally
 * absent. So it had to be a separate contract.
 *
 * THE TRUST INVERSION -- READ THIS BEFORE USING IT
 * -----------------------------------------------
 * Locked escrow protects the BUYER: funds move only on delivery. A drawable
 * budget hands the agent unilateral spend authority up to a cap, and the cap
 * becomes the buyer's only structural protection. This is a genuinely weaker
 * position than ERC-8183, deliberately traded for a capability ERC-8183
 * cannot offer. It is not a strictly better escrow and must never be
 * presented as one.
 *
 * Because the cap alone is thin, four further limits are enforced ON-CHAIN
 * rather than in a UI that an agent never sees:
 *   1. maxPerDraw -- a ceiling on any SINGLE draw, so a compromised agent
 *      cannot take the whole budget in one transaction.
 *   2. cooldown   -- minimum seconds between draws, which bounds the rate of
 *      loss and leaves a human time to notice and revoke.
 *   3. revoke     -- the client can take back the unspent remainder AT ANY
 *      TIME, not only after the deadline.
 *   4. deadline   -- draws stop at a time the client chose up front.
 *
 * Revoke cuts both ways, and that is intended: the client can stop a job
 * mid-flight, stranding an agent that has already spent its own resources.
 * A draw and a revoke in the same block are a race and whichever
 * lands first wins. That symmetry is the point -- each side can walk away,
 * neither can be silently drained.
 *
 * THE LIVE SPEND VIEW
 * -------------------
 * `Drawn` carries the amount, the running total and a caller-supplied memo,
 * and is emitted once per draw. That event stream is what makes a live
 * "watch the agent spend" view possible. ERC-8183 emits `PaymentReleased`
 * exactly once, for the full amount, so no such view can be built on it at
 * all -- this is a capability difference, not a UI choice.
 *
 * REUSED, PROVEN PATTERNS (see AgentAccessMarket.sol, live on BSC mainnet)
 * -----------------------------------------------------------------------
 *  - Ownable2Step / ReentrancyGuard / SafeERC20.
 *  - Owner-controlled accepted-token allowlist, incl. the NATIVE sentinel.
 *  - balanceOf-delta on inbound transfers, so a fee-on-transfer token funds
 *    the budget with what genuinely ARRIVED, never the stated amount.
 *  - Platform fees accrue and are withdrawn pull-style, never pushed.
 *  - No receive()/fallback: native value only enters through openBudget.
 *
 * ONE DELIBERATE DEPARTURE: draw() PUSHES.
 * Every payout in AgentAccessMarket is pull-based, which is the safer
 * pattern. It cannot be here -- the agent needs the funds DURING the job, so
 * making it withdraw them separately defeats the entire purpose of the
 * model. The push is made safe with nonReentrant plus strict
 * checks-effects-interactions: `spent` and `lastDrawAt` are written BEFORE
 * the transfer, so a re-entering token or agent contract re-enters a state
 * that already accounts for the draw it is trying to repeat.
 */
contract AgentBudgetEscrow is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum Status {
        NONE, // never opened -- distinguishes "no such budget" from a one
        OPEN,      // agent may draw
        CLOSED,    // agent finished; no more draws, client may still reclaim
        RECLAIMED  // client took the remainder; terminal
    }

    struct Budget {
        address client;
        address agent;
        address token;
        uint256 total;       // what actually ARRIVED, not what was stated
        uint256 spent;       // gross drawn, fee included
        uint256 maxPerDraw;
        uint64 deadline;
        uint64 cooldown;
        uint64 lastDrawAt;
        Status status;
    }

    /// @notice Sentinel for native BNB, identical to AgentAccessMarket's.
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint16 public constant MAX_FEE_BPS = 1000; // 10% ceiling, same as the sibling contract
    uint64 public constant MAX_DURATION = 365 days;

    mapping(address token => bool accepted) public acceptedTokens;

    address public feeWallet;
    uint16 public feeBps;

    mapping(address token => uint256 amount) public feesAccrued;

    uint256 public budgetCounter;
    mapping(uint256 budgetId => Budget) internal _budgets;

    event TokenAccepted(address indexed token, bool accepted);
    event BudgetOpened(
        uint256 indexed budgetId,
        address indexed client,
        address indexed agent,
        address token,
        uint256 total,
        uint256 maxPerDraw,
        uint64 deadline,
        uint64 cooldown
    );
    /// @dev The live-spend-view event. `spent` is the running total AFTER
    ///      this draw, so a consumer never has to accumulate it itself.
    event Drawn(
        uint256 indexed budgetId,
        address indexed agent,
        uint256 amount,
        uint256 fee,
        uint256 spent,
        uint256 remaining,
        bytes32 memo
    );
    event BudgetClosed(uint256 indexed budgetId, address indexed closedBy);
    event BudgetReclaimed(uint256 indexed budgetId, address indexed client, uint256 amount, bool early);
    event FeesWithdrawn(address indexed to, address indexed token, uint256 amount);
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);
    event FeeWalletUpdated(address indexed oldWallet, address indexed newWallet);

    error ZeroAddress();
    error ZeroAmount();
    error TokenNotAccepted();
    error BadNativeValue();
    error UnexpectedNativeValue();
    error NativeTransferFailed();
    error FeeTooHigh();
    error NoSuchBudget();
    error NotClient();
    error NotAgent();
    error NotOpen();
    error PastDeadline();
    error DeadlineTooSoon();
    error DeadlineTooFar();
    error ExceedsRemaining();
    error ExceedsMaxPerDraw();
    error CooldownActive();
    error NothingToWithdraw();
    error AgentIsClient();

    constructor(address[] memory tokens_, address feeWallet_, uint16 feeBps_) Ownable(msg.sender) {
        if (feeWallet_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        feeWallet = feeWallet_;
        feeBps = feeBps_;
        for (uint256 i = 0; i < tokens_.length; i++) {
            if (tokens_[i] == address(0)) revert ZeroAddress();
            acceptedTokens[tokens_[i]] = true;
            emit TokenAccepted(tokens_[i], true);
        }
    }

    // ─────────────────────────────── Client ─────────────────────────────────

    /**
     * @notice Fund a spending budget an agent can draw against.
     * @param agent      Who may draw. Cannot be the client -- a self-funded
     *                   budget has no counterparty and is only ever a mistake
     * or an attempt to make wash activity look real.
     * @param token      Must be on the allowlist. Send BNB as msg.value when
     *                   token == NATIVE.
     * @param amount     Stated deposit. For a fee-on-transfer token the budget
     *                   is credited with what ACTUALLY arrived, which may be
     *                   less -- deliberately, so the contract never promises
     *                   more than it holds.
     * @param maxPerDraw Ceiling on any single draw. 0 means "no per-draw
     *                   limit", which is allowed but is the weakest setting
     *                   and the UI should say so.
     * @param deadline   Absolute timestamp after which draws stop.
     * @param cooldown   Minimum seconds between draws. 0 means no cooldown.
     */
    function openBudget(
        address agent,
        address token,
        uint256 amount,
        uint256 maxPerDraw,
        uint64 deadline,
        uint64 cooldown
    ) external payable nonReentrant whenNotPaused returns (uint256 budgetId) {
        if (agent == address(0)) revert ZeroAddress();
        if (agent == msg.sender) revert AgentIsClient();
        if (!acceptedTokens[token]) revert TokenNotAccepted();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlineTooSoon();
        if (deadline > block.timestamp + MAX_DURATION) revert DeadlineTooFar();

        uint256 received = _pullIn(token, amount);
        if (received == 0) revert ZeroAmount();

        budgetId = ++budgetCounter;
        _budgets[budgetId] = Budget({
            client: msg.sender,
            agent: agent,
            token: token,
            total: received,
            spent: 0,
            maxPerDraw: maxPerDraw,
            deadline: deadline,
            cooldown: cooldown,
            // Seeds the cooldown from creation rather than 0, so a cooldown
            // is honoured before the FIRST draw too. Leaving it at 0 would
            // have let an agent drain one maxPerDraw instantly regardless of
            // the cooldown the client chose.
            lastDrawAt: uint64(block.timestamp),
            status: Status.OPEN
        });

        emit BudgetOpened(budgetId, msg.sender, agent, token, received, maxPerDraw, deadline, cooldown);
    }

    /**
     * @notice Client takes back everything not yet drawn. Callable AT ANY
     *         TIME -- this is both the "revoke" and the "reclaim after
     *         deadline" path, because both are the same movement of money and
     *         splitting them would only add surface area.
     *
     *         Deliberately available while the job is still running: it is
     *         the client's only counter to the agent's spend authority. The
     *         `early` flag in the event records which case this was, so a
     *         revoked-mid-job budget is distinguishable on-chain from one
     *         that simply ran to its deadline.
     */
    function reclaim(uint256 budgetId) external nonReentrant {
        Budget storage b = _budgets[budgetId];
        if (b.status == Status.NONE) revert NoSuchBudget();
        if (msg.sender != b.client) revert NotClient();
        if (b.status == Status.RECLAIMED) revert NotOpen();

        uint256 remaining = b.total - b.spent;
        if (remaining == 0) revert NothingToWithdraw();

        bool early = b.status == Status.OPEN && block.timestamp <= b.deadline;

        // Effects before interaction: mark the whole budget spent and
        // terminal, so a re-entering token cannot reclaim twice.
        b.spent = b.total;
        b.status = Status.RECLAIMED;

        _payout(b.token, b.client, remaining);
        emit BudgetReclaimed(budgetId, b.client, remaining, early);
    }

    // ──────────────────────────────── Agent ─────────────────────────────────

    /**
     * @notice Agent draws against the budget to fund its work.
     * @param amount Gross draw, inclusive of the platform fee. The agent
     *               receives amount - fee.
     * @param memo   Free-form 32-byte tag (e.g. a hash of what it was spent
     *               on). Recorded in the event only; never interpreted here.
     *
     * Fee is charged PER DRAW rather than at open, so an unused budget costs
     * the client nothing but gas and nobody pays a fee on capability they did
     * not consume.
     */
    function draw(uint256 budgetId, uint256 amount, bytes32 memo) external nonReentrant whenNotPaused {
        Budget storage b = _budgets[budgetId];
        if (b.status == Status.NONE) revert NoSuchBudget();
        if (msg.sender != b.agent) revert NotAgent();
        if (b.status != Status.OPEN) revert NotOpen();
        if (block.timestamp > b.deadline) revert PastDeadline();
        if (amount == 0) revert ZeroAmount();
        if (b.maxPerDraw != 0 && amount > b.maxPerDraw) revert ExceedsMaxPerDraw();
        if (amount > b.total - b.spent) revert ExceedsRemaining();
        if (b.cooldown != 0 && block.timestamp < uint256(b.lastDrawAt) + b.cooldown) revert CooldownActive();

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 net = amount - fee; // fee <= amount because feeBps <= 10_000

        // Effects strictly before the interaction below. A malicious token or
        // a re-entering agent contract therefore re-enters a state that has
        // already accounted for this draw, so the remaining/cooldown checks
        // above are evaluated against post-draw values on the nested call.
        b.spent += amount;
        b.lastDrawAt = uint64(block.timestamp);
        feesAccrued[b.token] += fee;

        if (net > 0) _payout(b.token, b.agent, net);

        emit Drawn(budgetId, b.agent, amount, fee, b.spent, b.total - b.spent, memo);
    }

    /// @notice Agent (or client) signals the work is finished. Stops further
    ///         draws while leaving the remainder reclaimable by the client.
    function close(uint256 budgetId) external {
        Budget storage b = _budgets[budgetId];
        if (b.status == Status.NONE) revert NoSuchBudget();
        if (b.status != Status.OPEN) revert NotOpen();
        if (msg.sender != b.agent && msg.sender != b.client) revert NotAgent();
        b.status = Status.CLOSED;
        emit BudgetClosed(budgetId, msg.sender);
    }

    // ─────────────────────────────── Views ──────────────────────────────────

    function getBudget(uint256 budgetId) external view returns (Budget memory) {
        Budget memory b = _budgets[budgetId];
        if (b.status == Status.NONE) revert NoSuchBudget();
        return b;
    }

    /// @notice What the agent could draw right now, accounting for every
    ///         limit at once. 0 when closed, expired, cooling down or empty.
    function drawableNow(uint256 budgetId) external view returns (uint256) {
        Budget memory b = _budgets[budgetId];
        if (b.status != Status.OPEN) return 0;
        if (block.timestamp > b.deadline) return 0;
        if (b.cooldown != 0 && block.timestamp < uint256(b.lastDrawAt) + b.cooldown) return 0;
        uint256 remaining = b.total - b.spent;
        if (b.maxPerDraw != 0 && b.maxPerDraw < remaining) return b.maxPerDraw;
        return remaining;
    }

    // ────────────────────────────── Internals ───────────────────────────────

    /// @dev Native must match msg.value exactly; ERC-20 is measured by
    ///      balance delta so a fee-on-transfer token credits what arrived.
    function _pullIn(address token, uint256 stated) internal returns (uint256 received) {
        if (token == NATIVE) {
            if (msg.value != stated) revert BadNativeValue();
            received = msg.value;
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue();
            uint256 balBefore = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), stated);
            received = IERC20(token).balanceOf(address(this)) - balBefore;
        }
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ────────────────────────────── Payouts ─────────────────────────────────

    function withdrawFees(address token) external nonReentrant {
        if (msg.sender != owner() && msg.sender != feeWallet) revert NotClient();
        uint256 amount = feesAccrued[token];
        if (amount == 0) revert NothingToWithdraw();
        feesAccrued[token] = 0; // effects before interaction
        address to = feeWallet;
        _payout(token, to, amount);
        emit FeesWithdrawn(to, token, amount);
    }

    // ─────────────────────────────── Admin ──────────────────────────────────

    /// @notice Add/remove a token. Removing one blocks NEW budgets in it and
    ///         never touches an existing budget's funds -- an agent can still
    ///         draw, and a client can still reclaim, in a de-listed token.
    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        acceptedTokens[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    /// @notice Update the platform fee. Applies to FUTURE draws only.
    function setFeeBps(uint16 newBps) external onlyOwner {
        if (newBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeBpsUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    /**
     * @notice Emergency stop for NEW activity only.
     *
     * Deliberately one-directional, and this asymmetry is the whole point:
     * pausing blocks openBudget and draw, and can NEVER block reclaim or
     * close. So the owner can stop money going IN and stop an agent drawing
     * OUT, but has no power at all to trap a client's funds -- a paused
     * contract still lets every client recover their entire unspent
     * remainder, immediately.
     *
     * This exists because the contract is non-upgradeable and unaudited. It
     * is a centralisation trade: the owner can freeze an agent's draws
     * mid-job, which is a power the agent must accept to use this model.
     * Stated plainly rather than buried -- it is the price of having any
     * response at all to a bug found after money is in.
     */
    function pause() external onlyOwner { _pause(); }

    function unpause() external onlyOwner { _unpause(); }

    function setFeeWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        emit FeeWalletUpdated(feeWallet, newWallet);
        feeWallet = newWallet;
    }
}
