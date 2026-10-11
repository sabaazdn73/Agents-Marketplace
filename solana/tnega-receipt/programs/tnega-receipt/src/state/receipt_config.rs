use anchor_lang::prelude::*;

/// The one shared governance account, like TrustCycle's ProtocolConfig.
///
/// Two keys, on purpose: `authority` governs (rotates the attestor, pauses)
/// and can live on a hardware wallet; `attestor` is the hot key the server
/// signs receipts with. If the hot key leaks, the authority replaces it.
#[account]
#[derive(InitSpace)]
pub struct ReceiptConfig {
    pub authority: Pubkey,
    pub attestor: Pubkey,
    /// Blocks `issue_receipt` only. It can never block `revoke_receipt`.
    pub paused: bool,
    pub bump: u8,
}
