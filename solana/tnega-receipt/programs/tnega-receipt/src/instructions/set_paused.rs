use anchor_lang::prelude::*;

use crate::{error::ReceiptError, ReceiptConfig, CONFIG_SEED};

#[derive(Accounts)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ReceiptError::NotAuthority,
    )]
    pub config: Account<'info, ReceiptConfig>,
}

pub fn update_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}
