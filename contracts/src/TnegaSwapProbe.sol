// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Swap-output probe. Never deployed: it runs through eth_call with its runtime
/// injected by a state override, at a router's address so that a hook which
/// gates on the swap's sender sees what it sees for a real user.
///
/// Every quote runs the venue's own swap code at the requested block and
/// reverts from inside the callback before any token moves, so no balance or
/// approval is needed and nothing persists.
///
/// family 0: concentrated-liquidity pool with swap(address,bool,int256,uint160,bytes)
///           (Uniswap V3, PancakeSwap V3 and its forks, Aerodrome Slipstream,
///           Algebra V1.9 / Integral). Any callback name is caught by fallback(),
///           which accepts it only from the pool being quoted.
/// family 1: Uniswap V4. `target` is the PoolManager; `key` is the abi-encoded
///           PoolKey. Hooks and dynamic fees run as they would for a router.
/// family 2: PancakeSwap Infinity CL. `target` is the CLPoolManager; `key` is the
///           abi-encoded Infinity PoolKey (currency0, currency1, hooks, poolManager,
///           fee, parameters). Entered through Vault.lock -> lockAcquired.
///
/// Each quote also reads the pool's price before the swap (slot0 / globalState,
/// V4 extsload, Infinity getSlot0) in the same call, so the output and the mid
/// it is compared with come from one state. The swap's price limit is that
/// price moved by `limitSqrtBps` (20000 = the square-root price doubled or
/// halved, a 4x price move), which bounds the gas a thin pool can burn and
/// makes a partial fill visible: the paid-in amount is then below the amount
/// asked for.
contract TnegaSwapProbe {
    uint160 internal constant MIN_SQRT = 4295128740;
    uint160 internal constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;
    bytes4 internal constant TAG = 0xdeadbeef;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct InfinityKey {
        address currency0;
        address currency1;
        address hooks;
        address poolManager;
        uint24 fee;
        bytes32 parameters;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    struct Req {
        uint8 family;
        address target;
        bool zeroForOne;
        int256 amountSpecified; // > 0 exact input, < 0 exact output (V3 convention)
        bytes key;
    }

    struct Quote {
        bool ok;
        int256 amount0; // pool-side deltas, V3 sign convention: positive = paid into the pool
        int256 amount1;
        uint256 gasUsed; // gas spent in the venue call, whether it succeeded or not
        uint256 grant; // gas the venue call was given
        uint160 sqrtPriceX96; // pool price before the swap; 0 when it could not be read
        uint160 limitX96; // the price limit the swap ran with
        bytes err;
    }

    // Written before each venue call and read back in the callbacks.
    uint256 private _g;
    address private _mgr;
    address private _vault;
    address private _pool;

    function quote(Req calldata r, uint256 maxGrant, uint32 limitSqrtBps) public returns (Quote memory q) {
        q.sqrtPriceX96 = _price(r.family, r.target, r.key);
        q.limitX96 = _limit(q.sqrtPriceX96, r.zeroForOne, limitSqrtBps);
        uint256 grant = gasleft() * 60 / 64;
        if (grant > maxGrant) grant = maxGrant;
        q.grant = grant;
        if (grant < 100_000) {
            q.err = bytes("probe: gas exhausted before this quote");
            return q;
        }
        _g = grant;
        bytes memory ret;
        bool success;
        uint256 g0 = gasleft();
        if (r.family == 0) {
            _pool = r.target;
            (success, ret) = r.target.call{gas: grant}(
                abi.encodeWithSelector(
                    0x128acb08, // swap(address,bool,int256,uint160,bytes)
                    address(this), r.zeroForOne, r.amountSpecified, q.limitX96, bytes("")
                )
            );
        } else if (r.family == 1) {
            _mgr = r.target;
            (success, ret) = r.target.call{gas: grant}(
                abi.encodeWithSignature("unlock(bytes)", abi.encode(r.key, r.zeroForOne, r.amountSpecified, q.limitX96))
            );
        } else if (r.family == 2) {
            _mgr = r.target;
            (bool vs, bytes memory v) = r.target.staticcall(abi.encodeWithSignature("vault()"));
            if (!vs || v.length < 32) {
                q.err = bytes("probe: vault() did not answer");
                return q;
            }
            address vault = abi.decode(v, (address));
            _vault = vault;
            (success, ret) = vault.call{gas: grant}(
                abi.encodeWithSignature("lock(bytes)", abi.encode(r.key, r.zeroForOne, r.amountSpecified, q.limitX96))
            );
        } else {
            q.err = bytes("probe: unknown family");
            return q;
        }
        q.gasUsed = g0 - gasleft();
        _pool = address(0);
        // Success is impossible (the callback always reverts). Any revert that is
        // not our tagged payload is a real failure and is returned as is.
        if (!success && ret.length == 100 && bytes4(ret) == TAG) {
            (q.amount0, q.amount1, ) = abi.decode(_slice4(ret), (int256, int256, uint256));
            // Sign check: the side paid in must be positive and no more than asked
            // (exact input), and the side paid out must not be positive.
            int256 paid = r.zeroForOne ? q.amount0 : q.amount1;
            int256 got = r.zeroForOne ? q.amount1 : q.amount0;
            bool signs = paid > 0 && got <= 0;
            if (r.amountSpecified > 0 && paid > r.amountSpecified) signs = false;
            if (signs) {
                q.ok = true;
            } else {
                q.err = bytes("probe: sign check failed");
            }
        } else {
            q.err = ret;
        }
    }

    /// Many quotes in one eth_call.
    function quoteMany(Req[] calldata reqs, uint256 maxGrant, uint32 limitSqrtBps) external returns (Quote[] memory qs) {
        qs = new Quote[](reqs.length);
        for (uint256 i; i < reqs.length; ++i) {
            qs[i] = quote(reqs[i], maxGrant, limitSqrtBps);
        }
    }

    // --- pre-swap price, same call ------------------------------------------
    function _price(uint8 family, address target, bytes calldata key) internal view returns (uint160 p) {
        bool s;
        bytes memory r;
        if (family == 0) {
            (s, r) = target.staticcall(abi.encodeWithSelector(0x3850c7bd)); // slot0()
            if (!s || r.length < 32) {
                (s, r) = target.staticcall(abi.encodeWithSelector(0xe76c01e4)); // globalState() (Algebra)
            }
        } else if (family == 1) {
            // StateLibrary: pools mapping at slot 6; slot0 packs sqrtPriceX96 in the low 160 bits.
            bytes32 slot = keccak256(abi.encode(keccak256(key), uint256(6)));
            (s, r) = target.staticcall(abi.encodeWithSignature("extsload(bytes32)", slot));
        } else if (family == 2) {
            (s, r) = target.staticcall(abi.encodeWithSignature("getSlot0(bytes32)", keccak256(key)));
        }
        if (s && r.length >= 32) {
            uint256 w;
            assembly { w := mload(add(r, 32)) }
            p = uint160(w);
        }
    }

    function _limit(uint160 p, bool zeroForOne, uint32 limitSqrtBps) internal pure returns (uint160) {
        if (p == 0 || limitSqrtBps <= 10000) return zeroForOne ? MIN_SQRT : MAX_SQRT;
        uint256 l = zeroForOne ? (uint256(p) * 10000) / limitSqrtBps : (uint256(p) * limitSqrtBps) / 10000;
        if (l <= MIN_SQRT) return MIN_SQRT;
        if (l >= MAX_SQRT) return MAX_SQRT;
        return uint160(l);
    }

    // --- V4 ------------------------------------------------------------------
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == _mgr, "probe: unlock from non-target");
        (bytes memory keyEnc, bool zeroForOne, int256 amountSpecified, uint160 limit) =
            abi.decode(data, (bytes, bool, int256, uint160));
        PoolKey memory key = abi.decode(keyEnc, (PoolKey));
        // V4 sign convention: negative = exact input. Flip from the V3 convention used above.
        SwapParams memory p = SwapParams(zeroForOne, -amountSpecified, limit);
        uint256 g0 = gasleft();
        (bool ok, bytes memory ret) = msg.sender.call(
            abi.encodeWithSelector(
                0xf3cd914c, // swap((address,address,uint24,int24,address),(bool,int256,uint160),bytes)
                key, p, bytes("")
            )
        );
        uint256 g = g0 - gasleft();
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        int256 delta = abi.decode(ret, (int256));
        // BalanceDelta is caller-side (negative = owed to the pool). Report pool-side.
        _bail(-int256(int128(delta >> 128)), -int256(int128(delta)), g);
    }

    // --- PancakeSwap Infinity CL ---------------------------------------------
    function lockAcquired(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == _vault, "probe: lock from non-target");
        (bytes memory keyEnc, bool zeroForOne, int256 amountSpecified, uint160 limit) =
            abi.decode(data, (bytes, bool, int256, uint160));
        InfinityKey memory key = abi.decode(keyEnc, (InfinityKey));
        SwapParams memory p = SwapParams(zeroForOne, -amountSpecified, limit);
        uint256 g0 = gasleft();
        (bool ok, bytes memory ret) = _mgr.call(
            abi.encodeWithSelector(
                0xcd0cc1ce, // swap((address,address,address,address,uint24,bytes32),(bool,int256,uint160),bytes)
                key, p, bytes("")
            )
        );
        uint256 g = g0 - gasleft();
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        int256 delta = abi.decode(ret, (int256));
        _bail(-int256(int128(delta >> 128)), -int256(int128(delta)), g);
    }

    // --- V3-shaped callbacks: any name, same (int256,int256,bytes) layout -----
    fallback() external {
        // Only the pool being quoted may call back. Anything else calling this
        // address during a quote is refused, so a stray call can never be read
        // as a swap result.
        require(msg.sender == _pool && _pool != address(0), "probe: callback from non-target");
        uint256 g = _g - (gasleft() * 64) / 63;
        (int256 a0, int256 a1) = abi.decode(msg.data[4:68], (int256, int256));
        _bail(a0, a1, g);
    }

    function _bail(int256 a0, int256 a1, uint256 g) private pure {
        bytes memory out = abi.encodePacked(TAG, abi.encode(a0, a1, g));
        assembly { revert(add(out, 32), mload(out)) }
    }

    function _slice4(bytes memory b) private pure returns (bytes memory r) {
        r = new bytes(b.length - 4);
        for (uint256 i; i < r.length; ++i) r[i] = b[i + 4];
    }
}
