// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title AgentAccessMarket
 * @notice On-chain settlement for the "Sell Your Agent" creator economy. A
 *         creator lists ACCESS to an ERC-8004 agent they own and sells it under
 *         one of two models; buyers pay in a fixed ERC-20 (e.g. $U). A third
 *         pricing model (x402 pay-per-call) settles off this contract entirely
 *         and is intentionally not represented here.
 *
 *  Model 1 (ONE_TIME):     buyer pays a fixed price once -> permanent access.
 *  Model 2 (SUBSCRIPTION): buyer pays price-per-period    -> time-boxed access.
 *
 * Access is a NON-TRANSFERABLE entitlement recorded as an expiry timestamp per
 * (agentId, buyer) — NOT the ERC-8004 identity token, which is never moved, so
 * the agent's on-chain identity continuity is preserved. We deliberately use a
 * plain mapping rather than an ERC-1155 license token: access should not be
 * resold or transferred out of the creator's control, and the only question the
 * system asks is "does this buyer have access, and until when?".
 *
 * Security posture (this handles real money):
 *  - Ownable2Step         single platform-admin role, fat-finger-safe transfer.
 *  - ReentrancyGuard      on every token-moving function.
 *  - SafeERC20            tolerant of non-standard (no-return) ERC-20s.
 *  - Pull-over-push        creators and the platform WITHDRAW their balances;
 *                          purchases never push tokens onward in the same tx.
 *  - Checks-effects-interactions everywhere (balances zeroed before transfer).
 *  - Fee is capped (MAX_FEE_BPS) and only ever applies to FUTURE purchases.
 *  - No admin function can touch a buyer's or creator's already-settled funds.
 *  - list() is gated by the REAL ERC-8004 registry ownerOf(), so only an
 *    agent's genuine owner can monetize it.
 */
contract AgentAccessMarket is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Model {
        NONE,
        ONE_TIME,
        SUBSCRIPTION
    }

    struct Listing {
        address creator; // the ERC-8004 owner who listed it (verified at list time)
        Model model;
        uint256 price; // ONE_TIME: full price; SUBSCRIPTION: price per period
        uint64 period; // SUBSCRIPTION only: seconds of access per payment
        bool active; // creator can pause/resume sales without losing the listing
    }

    /// @notice 10% hard ceiling — the owner can never set a fee above this.
    uint16 public constant MAX_FEE_BPS = 1000;
    /// @notice Sentinel expiry for a permanent (one-time) license.
    uint64 internal constant PERMANENT = type(uint64).max;

    /// @notice The single ERC-20 all purchases settle in (e.g. $U). Immutable.
    IERC20 public immutable paymentToken;
    /// @notice The real ERC-8004 identity registry; ownerOf() authorizes listing.
    IERC721 public immutable agentRegistry;

    /// @notice Where platform fees are withdrawn to. Owner-updatable, never zero.
    address public feeWallet;
    /// @notice Platform fee in basis points (<= MAX_FEE_BPS). Applies to future buys only.
    uint16 public feeBps;

    /// @notice Platform fees awaiting withdrawal to feeWallet (pull pattern).
    uint256 public feesAccrued;

    mapping(uint256 agentId => Listing) public listings;
    /// @notice Access expiry per (agentId, buyer). block.timestamp < expiry == has access.
    mapping(uint256 agentId => mapping(address buyer => uint64 expiry)) public accessExpiry;
    /// @notice Withdrawable creator earnings (pull pattern), in paymentToken units.
    mapping(address creator => uint256 balance) public creatorBalance;

    event Listed(uint256 indexed agentId, address indexed creator, Model model, uint256 price, uint64 period);
    event ListingActiveSet(uint256 indexed agentId, bool active);
    event Purchased(uint256 indexed agentId, address indexed buyer, uint256 pricePaid, uint256 feeTaken, uint64 expiry);
    event CreatorWithdrawal(address indexed creator, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);
    event FeeWalletUpdated(address oldWallet, address newWallet);

    error NotAgentOwner();
    error InvalidModel();
    error ZeroPrice();
    error ZeroPeriod();
    error NotListed();
    error WrongModel();
    error ListingInactive();
    error NotCreator();
    error AlreadyOwned();
    error NothingToWithdraw();
    error FeeTooHigh();
    error ZeroAddress();

    constructor(address paymentToken_, address agentRegistry_, address feeWallet_, uint16 feeBps_)
        Ownable(msg.sender)
    {
        if (paymentToken_ == address(0) || agentRegistry_ == address(0) || feeWallet_ == address(0)) {
            revert ZeroAddress();
        }
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        paymentToken = IERC20(paymentToken_);
        agentRegistry = IERC721(agentRegistry_);
        feeWallet = feeWallet_;
        feeBps = feeBps_;
    }

    // ─────────────────────────────── Creator ────────────────────────────────

    /**
     * @notice List access to an agent you own. Gated by the real ERC-8004
     *         registry: only the current on-chain owner of `agentId` may list it.
     */
    function list(uint256 agentId, Model model, uint256 price, uint64 period) external {
        if (model != Model.ONE_TIME && model != Model.SUBSCRIPTION) revert InvalidModel();
        if (price == 0) revert ZeroPrice();
        if (model == Model.SUBSCRIPTION && period == 0) revert ZeroPeriod();
        if (agentRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();

        listings[agentId] =
            Listing({creator: msg.sender, model: model, price: price, period: period, active: true});
        emit Listed(agentId, msg.sender, model, price, period);
    }

    /// @notice Pause or resume sales for a listing you created. Existing access is untouched.
    function setListingActive(uint256 agentId, bool active) external {
        Listing storage l = listings[agentId];
        if (l.model == Model.NONE) revert NotListed();
        if (l.creator != msg.sender) revert NotCreator();
        l.active = active;
        emit ListingActiveSet(agentId, active);
    }

    // ──────────────────────────────── Buyer ─────────────────────────────────

    /// @notice Buy a permanent one-time license for `agentId`.
    function buyOneTime(uint256 agentId) external nonReentrant {
        Listing storage l = listings[agentId];
        if (l.model == Model.NONE) revert NotListed();
        if (l.model != Model.ONE_TIME) revert WrongModel();
        if (!l.active) revert ListingInactive();
        if (accessExpiry[agentId][msg.sender] == PERMANENT) revert AlreadyOwned();

        uint256 fee = _settle(l.creator, l.price);
        accessExpiry[agentId][msg.sender] = PERMANENT;
        emit Purchased(agentId, msg.sender, l.price, fee, PERMANENT);
    }

    /// @notice Subscribe (or renew) access to `agentId` for one more period.
    ///         Renewing before expiry extends; after expiry it restarts from now.
    function subscribe(uint256 agentId) external nonReentrant {
        Listing storage l = listings[agentId];
        if (l.model == Model.NONE) revert NotListed();
        if (l.model != Model.SUBSCRIPTION) revert WrongModel();
        if (!l.active) revert ListingInactive();

        uint256 fee = _settle(l.creator, l.price);

        uint64 current = accessExpiry[agentId][msg.sender];
        uint64 base = current > block.timestamp ? current : uint64(block.timestamp);
        uint64 newExpiry = base + l.period; // 0.8.x checked arithmetic guards overflow
        accessExpiry[agentId][msg.sender] = newExpiry;
        emit Purchased(agentId, msg.sender, l.price, fee, newExpiry);
    }

    /**
     * @dev Pull `stated` from the buyer, credit the creator's withdrawable
     *      balance and the platform's fee accrual off the ACTUALLY-RECEIVED
     *      amount (balance-delta), so a fee-on-transfer token can't desync the
     *      books. Returns the fee taken. Effects only — no outbound transfer.
     */
    function _settle(address creator, uint256 stated) internal returns (uint256 fee) {
        uint256 balBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(msg.sender, address(this), stated);
        uint256 received = paymentToken.balanceOf(address(this)) - balBefore;

        fee = (received * feeBps) / 10_000;
        unchecked {
            // received >= fee by construction (feeBps <= 10_000 via MAX_FEE_BPS)
            creatorBalance[creator] += received - fee;
        }
        feesAccrued += fee;
    }

    // ─────────────────────────────── Views ──────────────────────────────────

    /// @notice True while the buyer's access has not expired.
    function hasAccess(uint256 agentId, address buyer) external view returns (bool) {
        return block.timestamp < accessExpiry[agentId][buyer];
    }

    // ────────────────────────────── Payouts ─────────────────────────────────

    /// @notice Creator withdraws their accumulated earnings (pull-over-push).
    function withdrawCreatorBalance() external nonReentrant {
        uint256 amount = creatorBalance[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        creatorBalance[msg.sender] = 0; // effects before interaction
        paymentToken.safeTransfer(msg.sender, amount);
        emit CreatorWithdrawal(msg.sender, amount);
    }

    /// @notice Send accrued platform fees to the CURRENT feeWallet. Callable by
    ///         the owner or the fee wallet itself; funds can only ever go to feeWallet.
    function withdrawFees() external nonReentrant {
        if (msg.sender != owner() && msg.sender != feeWallet) revert NotCreator();
        uint256 amount = feesAccrued;
        if (amount == 0) revert NothingToWithdraw();
        feesAccrued = 0; // effects before interaction
        address to = feeWallet;
        paymentToken.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    // ─────────────────────────────── Admin ──────────────────────────────────

    /// @notice Update the platform fee. Applies to FUTURE purchases only; never
    ///         retroactively touches already-credited creator or fee balances.
    function setFeeBps(uint16 newBps) external onlyOwner {
        if (newBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeBpsUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    /// @notice Update where platform fees are withdrawn to. Does not touch
    ///         creator balances or any buyer's settled purchase.
    function setFeeWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        emit FeeWalletUpdated(feeWallet, newWallet);
        feeWallet = newWallet;
    }
}
