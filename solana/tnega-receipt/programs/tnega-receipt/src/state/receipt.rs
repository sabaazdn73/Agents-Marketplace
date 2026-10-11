use anchor_lang::prelude::*;

/// One purchase, attested by Tnega and signed by the buyer. Everything except
/// `active` is immutable.
///
/// `content_hash` is the SHA-256 of the full order and execution record
/// (JSON, computed off chain and published). The fields below are the ones a
/// verifier wants to read without fetching that record. The program stores
/// them; it does not, and cannot, re-derive `content_hash` from them.
///
/// Version 2 (this layout) appends `version`, `executed_at` and `readings`
/// to version 1's fields, in version 1's order, and is only written after the
/// buyer's Ed25519 signature over the content hash was verified in the same
/// transaction (`issue_receipt`).
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub content_hash: [u8; 32],
    /// The chain the purchase happened on: an EVM chain id, or 0 for Solana.
    pub chain_id: u64,
    /// EVM transaction hash; for a Solana purchase, SHA-256 of its 64-byte
    /// signature.
    pub tx_hash: [u8; 32],
    /// The buyer's address, left-padded to 32 bytes (an EVM address is 20).
    pub buyer: [u8; 32],
    /// What Tnega showed the buyer as the cost, and what the execution cost,
    /// both in basis points against the venue's pre-trade mid.
    pub quoted_cost_bps: u32,
    pub executed_cost_bps: u32,
    /// Order size in US cents.
    pub notional_usd_cents: u64,
    /// When this receipt was written (Solana clock), not when the trade happened.
    pub issued_at: i64,
    /// The attestor key that signed this receipt.
    pub issuer: Pubkey,
    pub active: bool,
    pub bump: u8,
    /// RECEIPT_VERSION when written.
    pub version: u8,
    /// When the purchase happened on its own chain (unix seconds).
    pub executed_at: i64,
    /// The prices Tnega had read for the same stock on other versions and
    /// chains when the buyer signed, each with its own time and source.
    #[max_len(8)]
    pub readings: Vec<Reading>,
}

/// One price reading: what a buy of `size_usd` of one version cost when Tnega
/// measured it, and where the number came from.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, PartialEq, Eq, Debug)]
pub struct Reading {
    /// EVM chain id, or 0 for Solana.
    pub chain_id: u64,
    /// The last 8 bytes of the version's token (an EVM address, or a Solana
    /// mint's 32 bytes): enough to tell versions on one chain apart and to
    /// match the reading to the full key in the published record, while
    /// eight readings still fit one transaction with the buyer's signature.
    /// The last bytes, not the first: Coinbase's tokens all start 0xb2000000.
    pub token_suffix: [u8; 8],
    /// READING_FILLED, READING_TOO_THIN or READING_NO_ROUTE. A reading that
    /// did not fill carries no cost: never a zero that looks like a price.
    pub state: u8,
    /// Cost to fill `size_usd`, in basis points against the venue's own mid
    /// (0 unless filled).
    pub cost_bps: u32,
    /// All-in price per share, in micro-dollars; 0 where shares per token was
    /// not read (or not filled).
    pub price_per_share_micros: u64,
    /// The size measured, in dollars.
    pub size_usd: u32,
    /// When Tnega measured it (unix seconds).
    pub as_of: i64,
    /// The EVM block or Solana slot the measurement used.
    pub block: u64,
    /// SOURCE_POOL_AT_BLOCK (EVM, replayable at `block`) or
    /// SOURCE_JUPITER_QUOTE (Solana, a record of what Tnega read).
    pub source: u8,
}
