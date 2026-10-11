use anchor_lang::prelude::*;

use crate::{ReceiptConfig, ANCHOR_DISCRIMINATOR_LENGTH, CONFIG_SEED};

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Becomes the config's authority.
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = ANCHOR_DISCRIMINATOR_LENGTH + ReceiptConfig::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, ReceiptConfig>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<Initialize>, attestor: Pubkey) -> Result<()> {
    ctx.accounts.config.set_inner(ReceiptConfig {
        authority: ctx.accounts.authority.key(),
        attestor,
        paused: false,
        bump: ctx.bumps.config,
    });
    Ok(())
}
