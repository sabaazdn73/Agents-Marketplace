#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::{
        types::{FailedTransactionMetadata, TransactionMetadata},
        LiteSVM,
    },
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    tnega_receipt::{receipt_message, Reading, Receipt, ReceiptConfig},
};

pub const CONFIG_SEED: &[u8] = b"config";
pub const RECEIPT_SEED: &[u8] = b"receipt";
pub const ONE_SOL: u64 = 1_000_000_000;

// Error codes, in the order error.rs declares them (Anchor starts at 6000).
pub const NOT_ATTESTOR: u32 = 6000;
pub const NOT_AUTHORITY: u32 = 6001;
pub const NOT_ALLOWED_TO_REVOKE: u32 = 6002;
pub const ISSUANCE_PAUSED: u32 = 6003;
pub const ALREADY_REVOKED: u32 = 6004;
pub const COST_OUT_OF_RANGE: u32 = 6005;
pub const MISSING_BUYER_SIGNATURE: u32 = 6006;
pub const BAD_SIGNATURE_INSTRUCTION: u32 = 6007;
pub const SIGNATURE_NOT_BY_BUYER: u32 = 6008;
pub const SIGNATURE_NOT_FOR_THIS_RECEIPT: u32 = 6009;
pub const EVM_BUYER_NOT_SUPPORTED: u32 = 6010;
pub const TOO_MANY_READINGS: u32 = 6011;
pub const BAD_READING: u32 = 6012;
pub const BAD_EXECUTION_TIME: u32 = 6013;

/// The svm's clock in every test (unix seconds): 2026-10-11 10:00 UTC.
pub const NOW: i64 = 1_791_712_800;

/// Everything a test needs: the svm, the governance key, the hot key.
pub struct Ctx {
    pub svm: LiteSVM,
    pub authority: Keypair,
    pub attestor: Keypair,
}

pub fn setup_svm() -> LiteSVM {
    let program_id = tnega_receipt::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../../target/deploy/tnega_receipt.so");
    svm.add_program(program_id, bytes).unwrap();
    // A real clock: the program refuses an execution time in the future.
    let mut clock = svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);
    svm
}

pub fn fund(svm: &mut LiteSVM, pubkey: &Pubkey, lamports: u64) {
    svm.airdrop(pubkey, lamports).unwrap();
}

/// A fresh svm with the config initialised: authority and attestor both funded.
pub fn setup() -> Ctx {
    let mut svm = setup_svm();
    let authority = Keypair::new();
    let attestor = Keypair::new();
    fund(&mut svm, &authority.pubkey(), 10 * ONE_SOL);
    fund(&mut svm, &attestor.pubkey(), 10 * ONE_SOL);
    let ix = build_initialize_ix(&authority.pubkey(), &attestor.pubkey());
    send(&mut svm, &authority, &[ix], &[]).expect("initialize should succeed");
    Ctx { svm, authority, attestor }
}

pub fn config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[CONFIG_SEED], &tnega_receipt::id())
}

pub fn receipt_pda(content_hash: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[RECEIPT_SEED, content_hash.as_ref()], &tnega_receipt::id())
}

pub fn build_initialize_ix(authority: &Pubkey, attestor: &Pubkey) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        tnega_receipt::id(),
        &tnega_receipt::instruction::Initialize { attestor: *attestor }.data(),
        tnega_receipt::accounts::Initialize {
            authority: *authority,
            config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn build_set_attestor_ix(authority: &Pubkey, attestor: &Pubkey) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        tnega_receipt::id(),
        &tnega_receipt::instruction::SetAttestor { attestor: *attestor }.data(),
        tnega_receipt::accounts::SetAttestor { authority: *authority, config }
            .to_account_metas(None),
    )
}

pub fn build_set_paused_ix(authority: &Pubkey, paused: bool) -> Instruction {
    let (config, _) = config_pda();
    Instruction::new_with_bytes(
        tnega_receipt::id(),
        &tnega_receipt::instruction::SetPaused { paused }.data(),
        tnega_receipt::accounts::SetPaused { authority: *authority, config }
            .to_account_metas(None),
    )
}

/// A receipt's inputs, with sensible defaults so a test states only what it
/// cares about. The buyer is a Solana key (its 32-byte seed is kept so the
/// test can sign as the buyer).
#[derive(Clone)]
pub struct Order {
    pub content_hash: [u8; 32],
    pub chain_id: u64,
    pub tx_hash: [u8; 32],
    pub buyer_seed: [u8; 32],
    pub buyer: [u8; 32],
    pub quoted_cost_bps: u32,
    pub executed_cost_bps: u32,
    pub notional_usd_cents: u64,
    pub executed_at: i64,
    pub readings: Vec<Reading>,
}

pub fn buyer_key(seed: &[u8; 32]) -> Keypair {
    Keypair::new_from_array(*seed)
}

pub fn reading(chain_id: u64, cost_bps: u32) -> Reading {
    Reading {
        chain_id,
        token_suffix: [chain_id as u8; 8],
        state: 0,
        cost_bps,
        price_per_share_micros: 336_954_016,
        size_usd: 1_000,
        as_of: NOW - 3_600,
        block: 85_610_380,
        source: if chain_id == 0 { 1 } else { 0 },
    }
}

pub fn order(tag: u8) -> Order {
    let buyer_seed = [tag.wrapping_add(100); 32];
    let buyer = buyer_key(&buyer_seed).pubkey().to_bytes();
    Order {
        content_hash: [tag; 32],
        chain_id: 0, // Solana
        tx_hash: [tag.wrapping_add(1); 32],
        buyer_seed,
        buyer,
        quoted_cost_bps: 30,
        executed_cost_bps: 31,
        notional_usd_cents: 100_000,
        executed_at: NOW - 60,
        readings: vec![reading(0, 9), reading(4663, 30), reading(8453, 30)],
    }
}

/// The Ed25519 program's instruction checking one signature, with the key,
/// signature and message inside the instruction (the layout web3.js's
/// Ed25519Program.createInstructionWithPublicKey writes).
pub fn ed25519_ix_raw(pubkey: &[u8; 32], signature: &[u8], message: &[u8]) -> Instruction {
    let pk_off: u16 = 16;
    let sig_off: u16 = pk_off + 32;
    let msg_off: u16 = sig_off + 64;
    let mut d = vec![1u8, 0u8];
    for v in [sig_off, u16::MAX, pk_off, u16::MAX, msg_off, message.len() as u16, u16::MAX] {
        d.extend_from_slice(&v.to_le_bytes());
    }
    d.extend_from_slice(pubkey);
    d.extend_from_slice(signature);
    d.extend_from_slice(message);
    Instruction::new_with_bytes(solana_sdk_ids::ed25519_program::ID, &d, vec![])
}

/// `signer` signs `message`, and the Ed25519 instruction checks it.
pub fn ed25519_ix(signer: &Keypair, message: &[u8]) -> Instruction {
    let sig = signer.sign_message(message);
    ed25519_ix_raw(&signer.pubkey().to_bytes(), sig.as_ref(), message)
}

/// issue_receipt alone, without the buyer's signature in front of it.
pub fn build_issue_ix(attestor: &Pubkey, o: &Order) -> Instruction {
    let (config, _) = config_pda();
    let (receipt, _) = receipt_pda(&o.content_hash);
    Instruction::new_with_bytes(
        tnega_receipt::id(),
        &tnega_receipt::instruction::IssueReceipt {
            content_hash: o.content_hash,
            chain_id: o.chain_id,
            tx_hash: o.tx_hash,
            buyer: o.buyer,
            quoted_cost_bps: o.quoted_cost_bps,
            executed_cost_bps: o.executed_cost_bps,
            notional_usd_cents: o.notional_usd_cents,
            executed_at: o.executed_at,
            readings: o.readings.clone(),
        }
        .data(),
        tnega_receipt::accounts::IssueReceipt {
            attestor: *attestor,
            config,
            receipt,
            instructions: solana_instructions_sysvar::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// The buyer's signature over this receipt, then issue_receipt: what the
/// attestor sends.
pub fn build_issue_ixs(attestor: &Pubkey, o: &Order) -> Vec<Instruction> {
    let buyer = buyer_key(&o.buyer_seed);
    vec![ed25519_ix(&buyer, &receipt_message(&o.content_hash)), build_issue_ix(attestor, o)]
}

pub fn build_revoke_ix(revoker: &Pubkey, content_hash: &[u8; 32]) -> Instruction {
    let (config, _) = config_pda();
    let (receipt, _) = receipt_pda(content_hash);
    Instruction::new_with_bytes(
        tnega_receipt::id(),
        &tnega_receipt::instruction::RevokeReceipt {}.data(),
        tnega_receipt::accounts::RevokeReceipt { revoker: *revoker, config, receipt }
            .to_account_metas(None),
    )
}

pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    instructions: &[Instruction],
    extra_signers: &[&Keypair],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    // Two sends in a row can be byte-identical; a new blockhash keeps them distinct.
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &blockhash);

    let mut signers: Vec<&Keypair> = Vec::with_capacity(1 + extra_signers.len());
    signers.push(payer);
    signers.extend_from_slice(extra_signers);

    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    svm.send_transaction(tx)
}

pub fn issue(ctx: &mut Ctx, o: &Order) {
    let ixs = build_issue_ixs(&ctx.attestor.pubkey(), o);
    send(&mut ctx.svm, &ctx.attestor.insecure_clone(), &ixs, &[]).expect("issue should succeed");
}

pub fn read_receipt(svm: &LiteSVM, content_hash: &[u8; 32]) -> Receipt {
    let (pda, _) = receipt_pda(content_hash);
    let acct = svm.get_account(&pda).expect("receipt account should exist");
    Receipt::try_deserialize(&mut acct.data.as_slice()).expect("receipt should deserialize")
}

pub fn read_config(svm: &LiteSVM) -> ReceiptConfig {
    let (pda, _) = config_pda();
    let acct = svm.get_account(&pda).expect("config account should exist");
    ReceiptConfig::try_deserialize(&mut acct.data.as_slice()).expect("config should deserialize")
}

/// Asserts the transaction failed with exactly this program error code, not
/// just "some error": a test that passes for the wrong reason proves nothing.
pub fn assert_custom_error<T>(res: Result<T, FailedTransactionMetadata>, code: u32) {
    match res {
        Ok(_) => panic!("expected Custom({code}) but the transaction succeeded"),
        Err(e) => {
            let got = format!("{:?}", e.err);
            assert!(
                got.contains(&format!("Custom({code})")),
                "expected Custom({code}), got {got}\nlogs: {:#?}",
                e.meta.logs
            );
        }
    }
}
