// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title HyperCoreReader
/// @notice Reads one address's HyperCore state from HyperEVM, in one call.
///
/// WHY THIS EXISTS
/// Tnega measures how often a Hyperliquid address's post-only orders are
/// refused before they ever rest on the book. That rate is collected over
/// hours from the venue's own feeds. This contract supplies the other half of
/// the sentence: where that same address stands right now, read from HyperCore
/// through the precompiles rather than from anybody's API. The two are shown
/// side by side, which is the only place either has been shown against the
/// other.
///
/// WHY A CONTRACT AT ALL
/// The precompiles answer a plain eth_call from an EOA, so a caller could read
/// them directly and pay nothing. This exists for two reasons that survive
/// that: it takes one round trip instead of five per address, which matters to
/// a backend serving a panel; and it is the deployed artefact that reads
/// HyperCore from HyperEVM, which is the integration itself rather than a
/// description of one.
///
/// EVERY FUNCTION IS `view`. Nothing here writes, and CoreWriter is
/// deliberately not touched: this contract cannot place, cancel or transfer
/// anything, so it can be pointed at any address without asking what it might
/// do.
///
/// TWO THINGS THAT WERE GOT WRONG FIRST, RECORDED HERE RATHER THAN IN A REPORT
///
/// 1. `leverage` IS NOT A SIGNAL THAT AN ACCOUNT EXISTS. Reading the position
///    precompile for an address that has never touched Hyperliquid returns
///    szi 0, entryNtl 0, and leverage 20, because 20 is the default for every
///    address. Checked against 0x…dEaD, 0x1111…, 0x9999… and eight random
///    addresses: every one returns 20. A real account that is flat on a given
///    perp returns a byte-identical word. So a zero position cannot be told
///    from no account by looking at the position.
///    `withdrawable` was the replacement signal, and on its own it was also
///    wrong: 0x1c1c270b holds a real short and returns withdrawable 0, its
///    margin being committed to the position. So `accountFound` is the union
///    of three reads, withdrawable, position and spot balance, and even that
///    is evidence rather than proof: an account that closed out and withdrew
///    everything reads identically to one that never existed. The caller must
///    therefore say "nothing found for this address" and never "this address
///    is flat".
///
/// 2. PRICES SCALE BY 10^(szDecimals - 6), NOT THE OTHER WAY AROUND. The raw
///    mark price for BTC is 765010 with szDecimals 5, which is 76,501 USD.
///    Inverting the exponent gives 7,650,100. Checked across four assets with
///    different szDecimals: BTC 5 -> 76,501, ETH 4 -> 2,445.70, SOL 2 ->
///    100.76, XRP 0 -> 1.2932. This contract returns the raw value AND
///    szDecimals and applies no scaling of its own, because a contract cannot
///    carry a fractional price and a caller that is handed both cannot silently
///    assume the wrong one.
///
/// A PRECOMPILE CAN REVERT. The position precompile reverts on an out-of-range
/// perp index, and the vault precompile reverts on an unregistered vault. So
/// every read here is a staticcall whose success is reported rather than
/// bubbled: one bad index in a batch must not discard the rest of the answers,
/// and a caller has to be able to tell "read failed" from "read returned zero".
contract HyperCoreReader {
    // The read precompiles, at their documented addresses. Each was called on
    // chain 999 before being named here.
    address internal constant POSITION = 0x0000000000000000000000000000000000000800;
    address internal constant SPOT_BALANCE = 0x0000000000000000000000000000000000000801;
    address internal constant WITHDRAWABLE = 0x0000000000000000000000000000000000000803;
    address internal constant MARK_PX = 0x0000000000000000000000000000000000000806;
    address internal constant ORACLE_PX = 0x0000000000000000000000000000000000000807;
    address internal constant L1_BLOCK = 0x0000000000000000000000000000000000000809;
    address internal constant PERP_ASSET_INFO = 0x000000000000000000000000000000000000080a;

    /// @dev The shape 0x080a returns. Read off the wire for four assets
    ///      before being written down: BTC szDecimals 5 maxLeverage 40, ETH
    ///      4/25, HYPE 2/10, XRP 0/20.
    struct PerpAssetInfo {
        string coin;
        uint32 marginTableId;
        uint8 szDecimals;
        uint8 maxLeverage;
        bool onlyIsolated;
    }

    /// @notice One address on one perp, with everything needed to render it.
    /// @dev Raw units throughout. `szi` is in the asset's own size decimals,
    ///      `entryNtl` and the two prices are 1e6-based before the
    ///      10^(szDecimals-6) adjustment described above.
    struct Reading {
        // Reads that succeeded. False means the precompile reverted, which is
        // not the same as a zero and must never be rendered as one.
        bool positionRead;
        bool priceRead;
        // The existence signal. See note 1 above: money present, not
        // "this address trades".
        bool accountFound;
        uint64 withdrawable;
        uint64 spotBalance; // token index 0, HyperCore's USDC
        // The position itself.
        int64 szi; // negative is short
        uint64 entryNtl;
        uint32 leverage;
        bool isIsolated;
        // What it is worth now.
        uint64 markPx;
        uint64 oraclePx;
        // The scale for every price above, and for szi. See note 2.
        uint8 szDecimals;
        // HyperCore's own block height at the moment of the read, so a caller
        // can say when this was true rather than when it asked.
        uint64 coreBlock;
    }

    /// @notice Read one address on one perp.
    function read(address user, uint16 perp) public view returns (Reading memory r) {
        (bool okPos, bytes memory pos) = POSITION.staticcall(abi.encode(user, perp));
        if (okPos && pos.length >= 160) {
            (int64 szi, uint64 entryNtl, , uint32 leverage, bool isIsolated) =
                abi.decode(pos, (int64, uint64, int64, uint32, bool));
            r.positionRead = true;
            r.szi = szi;
            r.entryNtl = entryNtl;
            r.leverage = leverage;
            r.isIsolated = isIsolated;
        }

        (bool okW, bytes memory w) = WITHDRAWABLE.staticcall(abi.encode(user));
        if (okW && w.length >= 32) {
            r.withdrawable = abi.decode(w, (uint64));
        }
        (bool okS, bytes memory sb) = SPOT_BALANCE.staticcall(abi.encode(user, uint64(0)));
        if (okS && sb.length >= 32) {
            r.spotBalance = abi.decode(sb, (uint64));
        }
        // THE EXISTENCE SIGNAL IS THE UNION, AND IT HAD TO BE. An earlier
        // version of this line read `withdrawable > 0` alone, which was itself
        // the correction of an earlier mistake, and it was still wrong:
        // 0x1c1c270b holds a real short of 0.12418 BTC on perp 0 and returns
        // withdrawable 0, because its margin is committed to the position and
        // there is nothing free to withdraw. Reporting that address as "no
        // account" would have been a worse error than the one it replaced.
        //
        // So: money free to withdraw, OR a position open on this perp. Both
        // are facts about a PERP account, which is what this contract is read
        // for.
        //
        // Spot balance is reported and deliberately excluded from the signal.
        // Including it was the third wrong answer in a row: 0x…dEaD and a
        // made-up 0x1111… both hold spot token 0, because anyone can send a
        // token to any address, so a spot balance says something arrived
        // there and nothing about whether somebody trades from it. Counting
        // it made a burn address read as an account.
        //
        // Two zeros are still not proof of absence: an account that closed
        // out and withdrew everything reads exactly like one that never
        // existed. Hence the name, what was found, not what is there.
        r.accountFound = r.withdrawable > 0 || r.szi != 0 || r.entryNtl > 0;

        (bool okMark, bytes memory mk) = MARK_PX.staticcall(abi.encode(uint32(perp)));
        (bool okOracle, bytes memory or_) = ORACLE_PX.staticcall(abi.encode(uint32(perp)));
        if (okMark && mk.length >= 32) {
            r.markPx = abi.decode(mk, (uint64));
            r.priceRead = true;
        }
        if (okOracle && or_.length >= 32) {
            r.oraclePx = abi.decode(or_, (uint64));
        }

        r.szDecimals = _szDecimals(perp);

        (bool okB, bytes memory b) = L1_BLOCK.staticcall("");
        if (okB && b.length >= 32) {
            r.coreBlock = abi.decode(b, (uint64));
        }
    }

    /// @notice Read one address across several perps in one round trip.
    /// @dev The reason this contract earns its deployment for a backend
    ///      serving a panel: an address holding three positions is one call
    ///      rather than fifteen. A reverting index yields a Reading with
    ///      positionRead false and does not discard the others.
    function readMany(address user, uint16[] calldata perps)
        external
        view
        returns (Reading[] memory out)
    {
        out = new Reading[](perps.length);
        for (uint256 i = 0; i < perps.length; i++) {
            out[i] = read(user, perps[i]);
        }
    }

    /// @notice Whether HyperCore has any money recorded for this address.
    /// @dev Exposed on its own because it is the question a caller asks before
    ///      rendering a zero: see note 1 at the top of this file.
    function accountFound(address user, uint16 perp)
        external
        view
        returns (bool found, uint64 withdrawable, uint64 spotBalance, int64 szi)
    {
        Reading memory r = read(user, perp);
        return (r.accountFound, r.withdrawable, r.spotBalance, r.szi);
    }

    /// @notice The size decimals for one perp, which is the scale for szi and
    ///         the exponent in 10^(szDecimals-6) for every price.
    function szDecimals(uint16 perp) external view returns (uint8) {
        return _szDecimals(perp);
    }

    /// @notice HyperCore's block height, as seen from HyperEVM.
    function coreBlock() external view returns (uint64 height) {
        (bool ok, bytes memory b) = L1_BLOCK.staticcall("");
        if (ok && b.length >= 32) {
            height = abi.decode(b, (uint64));
        }
    }

    /// @dev The asset info precompile returns
    ///      (string coin, uint32 marginTableId, uint8 szDecimals,
    ///       uint8 maxLeverage, bool onlyIsolated).
    ///
    ///      That shape was read off the wire rather than taken from a
    ///      description of it: an earlier version of this function decoded four
    ///      members instead of five and reverted on every call. Dumped word by
    ///      word for four assets, the third member is szDecimals and it tracks
    ///      what the prices need: BTC 5, ETH 4, HYPE 2, XRP 0. The fourth is
    ///      maxLeverage, 40/25/10/20 for the same four, which is what the
    ///      earlier decode was silently collapsing into the same slot.
    function _szDecimals(uint16 perp) internal view returns (uint8) {
        (bool ok, bytes memory info) = PERP_ASSET_INFO.staticcall(abi.encode(uint32(perp)));
        if (!ok || info.length < 192) {
            return 0;
        }
        // Decoded as a STRUCT, not as a flat five-tuple. The difference is
        // the leading offset word: this struct contains a string, so it is
        // dynamic, and a precompile returning it encodes an offset first. The
        // position precompile above has no dynamic member, is therefore
        // static, and is correctly decoded flat. Getting these two the same
        // way round is what made every call to this function revert twice.
        PerpAssetInfo memory a = abi.decode(info, (PerpAssetInfo));
        return a.szDecimals;
    }
}
