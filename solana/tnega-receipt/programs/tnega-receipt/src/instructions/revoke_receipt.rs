use anchor_lang::prelude::*;

use crate::{
    error::ReceiptError, events::ReceiptRevoked, Receipt, ReceiptConfig, CONFIG_SEED, RECEIPT_SEED,
};

#[derive(Accounts)]
pub struct RevokeReceipt<'info> {
    /// The current attestor or the authority. Deliberately not checked
    /// against `config.paused`: a pause can never stop a revocation.
    #[account(
        constraint = revoker.key() == config.attestor || revoker.key() == config.authority
            @ ReceiptError::NotAllowedToRevoke,
    )]
    pub revoker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ReceiptConfig>,
    #[account(
        mut,
        seeds = [RECEIPT_SEED, receipt.content_hash.as_ref()],
        bump = receipt.bump,
    )]
    pub receipt: Account<'info, Receipt>,
}

pub fn deactivate_receipt(ctx: Context<RevokeReceipt>) -> Result<()> {
    require!(ctx.accounts.receipt.active, ReceiptError::AlreadyRevoked);
    ctx.accounts.receipt.active = false;

    emit!(ReceiptRevoked {
        receipt: ctx.accounts.receipt.key(),
        revoker: ctx.accounts.revoker.key(),
    });
    Ok(())
}
