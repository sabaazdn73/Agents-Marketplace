pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("6Nzn82QGVZTiU3iv26ZT9UKQFfyYyjyCoWqUZJ5LLrxP");

#[program]
pub mod tnega_receipt {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, attestor: Pubkey) -> Result<()> {
        initialize::initialize_config(ctx, attestor)
    }

    pub fn set_attestor(ctx: Context<SetAttestor>, attestor: Pubkey) -> Result<()> {
        set_attestor::update_attestor(ctx, attestor)
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        set_paused::update_paused(ctx, paused)
    }

    /// Writes a receipt. The transaction must carry, right before this
    /// instruction, the Ed25519 program's check of the buyer's signature over
    /// receipt_message(content_hash): no signature, no receipt.
    #[allow(clippy::too_many_arguments)]
    pub fn issue_receipt(
        ctx: Context<IssueReceipt>,
        content_hash: [u8; 32],
        chain_id: u64,
        tx_hash: [u8; 32],
        buyer: [u8; 32],
        quoted_cost_bps: u32,
        executed_cost_bps: u32,
        notional_usd_cents: u64,
        executed_at: i64,
        readings: Vec<Reading>,
    ) -> Result<()> {
        issue_receipt::write_receipt(
            ctx,
            content_hash,
            chain_id,
            tx_hash,
            buyer,
            quoted_cost_bps,
            executed_cost_bps,
            notional_usd_cents,
            executed_at,
            readings,
        )
    }

    pub fn revoke_receipt(ctx: Context<RevokeReceipt>) -> Result<()> {
        revoke_receipt::deactivate_receipt(ctx)
    }
}
