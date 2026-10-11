use anchor_lang::prelude::*;

/// Emitted once per receipt, when it is written.
#[event]
pub struct ReceiptIssued {
    pub receipt: Pubkey,
    pub content_hash: [u8; 32],
    pub chain_id: u64,
    pub tx_hash: [u8; 32],
    pub buyer: [u8; 32],
    pub issuer: Pubkey,
    pub readings: u8,
}

/// Emitted when a receipt stops being valid. Its content never changes.
#[event]
pub struct ReceiptRevoked {
    pub receipt: Pubkey,
    pub revoker: Pubkey,
}
