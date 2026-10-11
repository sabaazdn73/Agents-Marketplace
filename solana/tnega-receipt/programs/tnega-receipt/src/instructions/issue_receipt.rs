use anchor_lang::prelude::*;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::{
    error::ReceiptError, events::ReceiptIssued, Reading, Receipt, ReceiptConfig,
    ANCHOR_DISCRIMINATOR_LENGTH, CONFIG_SEED, MAX_BPS, MAX_READINGS, READING_FILLED,
    READING_NO_ROUTE, RECEIPT_MESSAGE_PREFIX, RECEIPT_SEED, RECEIPT_VERSION, SOURCE_JUPITER_QUOTE,
};

#[derive(Accounts)]
#[instruction(content_hash: [u8; 32])]
pub struct IssueReceipt<'info> {
    /// Pays the receipt's rent and must be the config's attestor.
    #[account(
        mut,
        constraint = attestor.key() == config.attestor @ ReceiptError::NotAttestor,
    )]
    pub attestor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ReceiptConfig>,
    // The address is the content hash: one record can have one receipt, and a
    // second `init` for the same hash fails on its own.
    #[account(
        init,
        payer = attestor,
        space = ANCHOR_DISCRIMINATOR_LENGTH + Receipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, content_hash.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, Receipt>,
    /// The instructions sysvar: where the buyer's Ed25519 check is read from.
    /// CHECK: the address is the sysvar's; the loaders below check it again.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// The exact bytes the buyer's wallet signs: the prefix, then the content
/// hash in lowercase hex. The same text the receipt page shows.
pub fn receipt_message(content_hash: &[u8; 32]) -> Vec<u8> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut m = Vec::with_capacity(RECEIPT_MESSAGE_PREFIX.len() + 64);
    m.extend_from_slice(RECEIPT_MESSAGE_PREFIX);
    for b in content_hash {
        m.push(HEX[(b >> 4) as usize]);
        m.push(HEX[(b & 0x0f) as usize]);
    }
    m
}

/// The receipt is opt-in: it is written only if the instruction right before
/// this one is the Ed25519 program checking ONE signature, by the buyer, over
/// receipt_message(content_hash), with the key, signature and message all
/// inside that instruction. The runtime runs the Ed25519 check before any
/// instruction executes, so if the signature were wrong this transaction
/// would already have failed; here the program makes sure that check was
/// about this buyer and this receipt, and not some other signature.
fn require_buyer_signature(
    instructions: &AccountInfo,
    buyer: &[u8; 32],
    content_hash: &[u8; 32],
) -> Result<()> {
    // An EVM address is stored left-padded with 12 zero bytes; it signs with
    // secp256k1, which is the next step and not checked here.
    require!(buyer[..12] != [0u8; 12], ReceiptError::EvmBuyerNotSupported);

    let current = load_current_index_checked(instructions)? as usize;
    require!(current > 0, ReceiptError::MissingBuyerSignature);
    let ix = load_instruction_at_checked(current - 1, instructions)?;
    require!(
        ix.program_id == solana_sdk_ids::ed25519_program::ID,
        ReceiptError::MissingBuyerSignature
    );

    // [count u8][padding u8][offsets: 7 x u16][public key][signature][message]
    let d = &ix.data;
    require!(d.len() >= 16 && d[0] == 1, ReceiptError::BadSignatureInstruction);
    let at = |i: usize| u16::from_le_bytes([d[2 + i], d[3 + i]]);
    let (sig_off, sig_ix, pk_off, pk_ix, msg_off, msg_len, msg_ix) =
        (at(0), at(2), at(4), at(6), at(8), at(10), at(12));
    require!(
        sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX,
        ReceiptError::BadSignatureInstruction
    );
    let (sig_off, pk_off, msg_off, msg_len) =
        (sig_off as usize, pk_off as usize, msg_off as usize, msg_len as usize);
    require!(
        sig_off + 64 <= d.len() && pk_off + 32 <= d.len() && msg_off + msg_len <= d.len(),
        ReceiptError::BadSignatureInstruction
    );
    require!(&d[pk_off..pk_off + 32] == buyer.as_ref(), ReceiptError::SignatureNotByBuyer);
    require!(
        d[msg_off..msg_off + msg_len] == receipt_message(content_hash)[..],
        ReceiptError::SignatureNotForThisReceipt
    );
    Ok(())
}

fn check_reading(r: &Reading) -> Result<()> {
    require!(r.state <= READING_NO_ROUTE, ReceiptError::BadReading);
    require!(r.source <= SOURCE_JUPITER_QUOTE, ReceiptError::BadReading);
    require!(r.as_of > 0 && r.size_usd > 0, ReceiptError::BadReading);
    if r.state == READING_FILLED {
        require!(r.cost_bps <= MAX_BPS, ReceiptError::CostOutOfRange);
    } else {
        // No fill, no number: a zero would read as a price.
        require!(r.cost_bps == 0 && r.price_per_share_micros == 0, ReceiptError::BadReading);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn write_receipt(
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
    require!(!ctx.accounts.config.paused, ReceiptError::IssuancePaused);
    require!(
        quoted_cost_bps <= MAX_BPS && executed_cost_bps <= MAX_BPS,
        ReceiptError::CostOutOfRange
    );
    let now = Clock::get()?.unix_timestamp;
    require!(executed_at > 0 && executed_at <= now, ReceiptError::BadExecutionTime);
    require!(readings.len() <= MAX_READINGS, ReceiptError::TooManyReadings);
    for r in &readings {
        check_reading(r)?;
    }
    require_buyer_signature(&ctx.accounts.instructions.to_account_info(), &buyer, &content_hash)?;

    let issuer = ctx.accounts.attestor.key();
    let count = readings.len() as u8;
    ctx.accounts.receipt.set_inner(Receipt {
        content_hash,
        chain_id,
        tx_hash,
        buyer,
        quoted_cost_bps,
        executed_cost_bps,
        notional_usd_cents,
        issued_at: now,
        issuer,
        active: true,
        bump: ctx.bumps.receipt,
        version: RECEIPT_VERSION,
        executed_at,
        readings,
    });

    emit!(ReceiptIssued {
        receipt: ctx.accounts.receipt.key(),
        content_hash,
        chain_id,
        tx_hash,
        buyer,
        issuer,
        readings: count,
    });
    Ok(())
}
