use anchor_lang::prelude::*;

use crate::{error::ReceiptError, ReceiptConfig, CONFIG_SEED};

#[derive(Accounts)]
pub struct SetAttestor<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ReceiptError::NotAuthority,
    )]
    pub config: Account<'info, ReceiptConfig>,
}

/// Replaces the hot key. Receipts the old key issued stay valid; the
/// authority can still revoke any of them.
pub fn update_attestor(ctx: Context<SetAttestor>, attestor: Pubkey) -> Result<()> {
    ctx.accounts.config.attestor = attestor;
    Ok(())
}
