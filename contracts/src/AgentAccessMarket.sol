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
 *         creator lists ACCESS to an ERC-8004 agent they own; buyers pay in one
 *         of a FIXED, owner-controlled whitelist of tokens. A third pricing
 *         model (x402 pay-per-call) settles off this contract and is not here.
 *
 *  Model 1 (ONE_TIME):     buyer pays a fixed price once -> permanent access.
 *  Model 2 (SUBSCRIPTION): buyer pays price-per-period    -> time-boxed access.
 *
 * MULTI-TOKEN, buyer's choice, NO swap: a creator can price the SAME agent in
 * several accepted tokens (one Offer per (agentId, token)); the BUYER chooses
 * which token to pay with via buyOneTime(agentId, token) / subscribe(...). There
 * is deliberately no swap logic, so we take on zero slippage/MEV risk — each
 * offer is a fixed price in one whitelisted token. Native BNB is the sentinel
 * address `NATIVE`, paid via msg.value in the payable purchase functions
 * (cheapest for the buyer — no wrap, no approve); ERC-20s are pulled via
 * SafeERC20. The whitelist (incl. NATIVE) is owner-controlled and go-forward.
 *
 * Access is a NON-TRANSFERABLE entitlement per (agentId, buyer), token-agnostic
 * once bought — the ERC-8004 identity token is never moved.
 *
 * Security posture (this handles real money):
 *  - Ownable2Step / ReentrancyGuard / SafeERC20.
 *  - Pull-over-push payouts, per token; balances zeroed before transfer (CEI).
 *  - Fee capped (MAX_FEE_BPS), future-only. feeWallet from env at deploy.
 *  - No admin function can touch a buyer's or creator's already-settled funds.
 *  - list() gated by the REAL ERC-8004 registry ownerOf().
 *  - No receive()/fallback: native BNB only enters through a priced purchase.
 */
contract AgentAccessMarket is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Model {
        NONE,
        ONE_TIME,
        SUBSCRIPTION
    }

    struct Offer {
        Model model;
        uint256 price; // ONE_TIME: full price; SUBSCRIPTION: price per period
        uint64 period; // SUBSCRIPTION only: seconds of access per payment
        bool active; // creator can pause/resume this token's offer
    }

    /// @notice Sentinel address representing native BNB in the token whitelist.
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint16 public constant MAX_FEE_BPS = 1000; // 10% ceiling
    uint64 internal constant PERMANENT = type(uint64).max;

    IERC721 public immutable agentRegistry;

    mapping(address token => bool accepted) public acceptedTokens;

    address public feeWallet;
    uint16 public feeBps;

    mapping(address token => uint256 amount) public feesAccrued;
    mapping(address token => mapping(address creator => uint256 balance)) public creatorBalance;

    /// @notice The payee for an agent's sales — the ERC-8004 owner who listed it.
    mapping(uint256 agentId => address creator) public agentCreator;
    /// @notice One price offer per (agentId, token). model==NONE means "no offer".
    mapping(uint256 agentId => mapping(address token => Offer)) public offers;
    /// @notice Access expiry per (agentId, buyer). block.timestamp < expiry == has access.
    mapping(uint256 agentId => mapping(address buyer => uint64 expiry)) public accessExpiry;

    event TokenAccepted(address indexed token, bool accepted);
    event OfferSet(uint256 indexed agentId, address indexed creator, address indexed token, Model model, uint256 price, uint64 period);
    event OfferActiveSet(uint256 indexed agentId, address indexed token, bool active);
    event Purchased(uint256 indexed agentId, address indexed buyer, address token, uint256 pricePaid, uint256 feeTaken, uint64 expiry);
    event CreatorWithdrawal(address indexed creator, address indexed token, uint256 amount);
    event FeesWithdrawn(address indexed to, address indexed token, uint256 amount);
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);
    event FeeWalletUpdated(address oldWallet, address newWallet);

    error NotAgentOwner();
    error InvalidModel();
    error ZeroPrice();
    error ZeroPeriod();
    error NoOffer();
    error WrongModel();
    error OfferInactive();
    error NotCreator();
    error AlreadyOwned();
    error NothingToWithdraw();
    error FeeTooHigh();
    error ZeroAddress();
    error TokenNotAccepted();
    error BadNativeValue();
    error UnexpectedNativeValue();
    error NativeTransferFailed();

    constructor(address[] memory tokens_, address agentRegistry_, address feeWallet_, uint16 feeBps_)
        Ownable(msg.sender)
    {
        if (agentRegistry_ == address(0) || feeWallet_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        agentRegistry = IERC721(agentRegistry_);
        feeWallet = feeWallet_;
        feeBps = feeBps_;
        for (uint256 i = 0; i < tokens_.length; i++) {
            if (tokens_[i] == address(0)) revert ZeroAddress();
            acceptedTokens[tokens_[i]] = true;
            emit TokenAccepted(tokens_[i], true);
        }
    }

    // ─────────────────────────────── Creator ────────────────────────────────

    /**
     * @notice Set (or update) the price of one accepted `token` for an agent you
     *         own. Call it once per token to offer the agent in multiple tokens.
     *         Gated by the real ERC-8004 registry ownerOf().
     */
    function list(uint256 agentId, address token, Model model, uint256 price, uint64 period) external {
        if (model != Model.ONE_TIME && model != Model.SUBSCRIPTION) revert InvalidModel();
        if (!acceptedTokens[token]) revert TokenNotAccepted();
        if (price == 0) revert ZeroPrice();
        if (model == Model.SUBSCRIPTION && period == 0) revert ZeroPeriod();
        if (agentRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();

        agentCreator[agentId] = msg.sender; // current owner is the payee
        offers[agentId][token] = Offer({model: model, price: price, period: period, active: true});
        emit OfferSet(agentId, msg.sender, token, model, price, period);
    }

    /// @notice Pause/resume one token's offer for an agent you listed.
    function setOfferActive(uint256 agentId, address token, bool active) external {
        if (agentCreator[agentId] != msg.sender) revert NotCreator();
        Offer storage o = offers[agentId][token];
        if (o.model == Model.NONE) revert NoOffer();
        o.active = active;
        emit OfferActiveSet(agentId, token, active);
    }

    // ──────────────────────────────── Buyer ─────────────────────────────────

    /// @notice Buy a permanent one-time license for `agentId`, paying in `token`
    ///         (send BNB as msg.value when token == NATIVE).
    function buyOneTime(uint256 agentId, address token) external payable nonReentrant {
        Offer storage o = offers[agentId][token];
        if (o.model == Model.NONE) revert NoOffer();
        if (o.model != Model.ONE_TIME) revert WrongModel();
        if (!o.active) revert OfferInactive();
        if (accessExpiry[agentId][msg.sender] == PERMANENT) revert AlreadyOwned();

        uint256 fee = _settle(token, agentCreator[agentId], o.price);
        accessExpiry[agentId][msg.sender] = PERMANENT;
        emit Purchased(agentId, msg.sender, token, o.price, fee, PERMANENT);
    }

    /// @notice Subscribe (or renew) access to `agentId`, paying in `token`.
    ///         Renewing before expiry extends; after expiry it restarts from now.
    function subscribe(uint256 agentId, address token) external payable nonReentrant {
        Offer storage o = offers[agentId][token];
        if (o.model == Model.NONE) revert NoOffer();
        if (o.model != Model.SUBSCRIPTION) revert WrongModel();
        if (!o.active) revert OfferInactive();

        uint256 fee = _settle(token, agentCreator[agentId], o.price);

        uint64 current = accessExpiry[agentId][msg.sender];
        uint64 base = current > block.timestamp ? current : uint64(block.timestamp);
        uint64 newExpiry = base + o.period; // 0.8.x checked arithmetic guards overflow
        accessExpiry[agentId][msg.sender] = newExpiry;
        emit Purchased(agentId, msg.sender, token, o.price, fee, newExpiry);
    }

    /**
     * @dev Take `stated` from the buyer in `token`, credit the creator's
     *      withdrawable balance + platform fee off the ACTUALLY-RECEIVED amount.
     *      Native: msg.value must equal stated exactly. ERC-20: no stray BNB,
     *      pulled via balance-delta (fee-on-transfer safe). Returns the fee.
     */
    function _settle(address token, address creator, uint256 stated) internal returns (uint256 fee) {
        uint256 received;
        if (token == NATIVE) {
            if (msg.value != stated) revert BadNativeValue();
            received = msg.value;
        } else {
            if (msg.value != 0) revert UnexpectedNativeValue();
            uint256 balBefore = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), stated);
            received = IERC20(token).balanceOf(address(this)) - balBefore;
        }

        fee = (received * feeBps) / 10_000;
        unchecked {
            creatorBalance[token][creator] += received - fee; // received >= fee (cap)
        }
        feesAccrued[token] += fee;
    }

    // ─────────────────────────────── Views ──────────────────────────────────

    function hasAccess(uint256 agentId, address buyer) external view returns (bool) {
        return block.timestamp < accessExpiry[agentId][buyer];
    }

    // ────────────────────────────── Payouts ─────────────────────────────────

    /// @notice Creator withdraws their accumulated earnings in `token`.
    function withdrawCreatorBalance(address token) external nonReentrant {
        uint256 amount = creatorBalance[token][msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        creatorBalance[token][msg.sender] = 0; // effects before interaction
        _payout(token, msg.sender, amount);
        emit CreatorWithdrawal(msg.sender, token, amount);
    }

    /// @notice Send accrued platform fees in `token` to the CURRENT feeWallet.
    function withdrawFees(address token) external nonReentrant {
        if (msg.sender != owner() && msg.sender != feeWallet) revert NotCreator();
        uint256 amount = feesAccrued[token];
        if (amount == 0) revert NothingToWithdraw();
        feesAccrued[token] = 0; // effects before interaction
        address to = feeWallet;
        _payout(token, to, amount);
        emit FeesWithdrawn(to, token, amount);
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    // ─────────────────────────────── Admin ──────────────────────────────────

    /// @notice Add/remove a payment token from the fixed whitelist. Removing one
    ///         stops NEW offers/purchases in it; already-settled balances stay.
    function setAcceptedToken(address token, bool accepted) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        acceptedTokens[token] = accepted;
        emit TokenAccepted(token, accepted);
    }

    /// @notice Update the platform fee. FUTURE purchases only.
    function setFeeBps(uint16 newBps) external onlyOwner {
        if (newBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeBpsUpdated(feeBps, newBps);
        feeBps = newBps;
    }

    /// @notice Update where platform fees are withdrawn to.
    function setFeeWallet(address newWallet) external onlyOwner {
        if (newWallet == address(0)) revert ZeroAddress();
        emit FeeWalletUpdated(feeWallet, newWallet);
        feeWallet = newWallet;
    }
}
