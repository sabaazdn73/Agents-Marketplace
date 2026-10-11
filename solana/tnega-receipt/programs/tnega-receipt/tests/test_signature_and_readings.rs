mod common;

// Version 2: no buyer signature, no receipt; the readings and the execution
// time are stored and checked (architecture pages 3 to 5).

use {
    common::{
        assert_custom_error, build_issue_ix, build_issue_ixs, buyer_key, ed25519_ix, ed25519_ix_raw,
        issue, order, read_receipt, reading, receipt_pda, send, setup, Order, BAD_EXECUTION_TIME,
        BAD_READING, BAD_SIGNATURE_INSTRUCTION, COST_OUT_OF_RANGE, EVM_BUYER_NOT_SUPPORTED,
        MISSING_BUYER_SIGNATURE, NOW, SIGNATURE_NOT_BY_BUYER, SIGNATURE_NOT_FOR_THIS_RECEIPT,
        TOO_MANY_READINGS,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
    tnega_receipt::receipt_message,
};

fn nothing_written(ctx: &common::Ctx, o: &Order) {
    let (pda, _) = receipt_pda(&o.content_hash);
    assert!(ctx.svm.get_account(&pda).is_none(), "nothing may be written");
}

#[test]
fn the_message_is_the_prefix_and_the_hash_in_lowercase_hex() {
    let mut h = [0u8; 32];
    h[0] = 0xb0;
    h[31] = 0x07;
    let m = String::from_utf8(receipt_message(&h)).unwrap();
    assert_eq!(m, format!("Tnega Receipt v1\ncontent_hash: b0{}07", "00".repeat(30)));
}

#[test]
fn without_the_buyer_signature_nothing_is_written() {
    let mut ctx = setup();
    let o = order(20);
    let attestor = ctx.attestor.insecure_clone();
    let ix = build_issue_ix(&attestor.pubkey(), &o);
    assert_custom_error(send(&mut ctx.svm, &attestor, &[ix], &[]), MISSING_BUYER_SIGNATURE);
    nothing_written(&ctx, &o);
}

#[test]
fn the_signature_must_come_right_before_issue_receipt() {
    let mut ctx = setup();
    let o = order(21);
    let attestor = ctx.attestor.insecure_clone();
    let mut ixs = build_issue_ixs(&attestor.pubkey(), &o);
    ixs.reverse(); // issue_receipt first, the signature after it
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), MISSING_BUYER_SIGNATURE);
    nothing_written(&ctx, &o);
}

#[test]
fn a_signature_by_anyone_but_the_buyer_is_refused() {
    let mut ctx = setup();
    let o = order(22);
    let attestor = ctx.attestor.insecure_clone();
    let stranger = Keypair::new();
    let ixs = vec![ed25519_ix(&stranger, &receipt_message(&o.content_hash)), build_issue_ix(&attestor.pubkey(), &o)];
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), SIGNATURE_NOT_BY_BUYER);
    // Not even the attestor can sign for the buyer.
    let ixs = vec![ed25519_ix(&attestor, &receipt_message(&o.content_hash)), build_issue_ix(&attestor.pubkey(), &o)];
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), SIGNATURE_NOT_BY_BUYER);
    nothing_written(&ctx, &o);
}

#[test]
fn the_buyer_signing_another_receipt_does_not_count_for_this_one() {
    let mut ctx = setup();
    let o = order(23);
    let attestor = ctx.attestor.insecure_clone();
    let buyer = buyer_key(&o.buyer_seed);
    let other = receipt_message(&[0xEE; 32]);
    let ixs = vec![ed25519_ix(&buyer, &other), build_issue_ix(&attestor.pubkey(), &o)];
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), SIGNATURE_NOT_FOR_THIS_RECEIPT);
    // The bare hash, without the text around it, is a different message too.
    let ixs = vec![ed25519_ix(&buyer, &o.content_hash), build_issue_ix(&attestor.pubkey(), &o)];
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), SIGNATURE_NOT_FOR_THIS_RECEIPT);
    nothing_written(&ctx, &o);
}

#[test]
fn a_forged_signature_fails_in_the_ed25519_program_before_the_receipt_program_runs() {
    let mut ctx = setup();
    let o = order(24);
    let attestor = ctx.attestor.insecure_clone();
    // The buyer's key and this receipt's message, with 64 bytes nobody signed.
    let forged = ed25519_ix_raw(&o.buyer, &[7u8; 64], &receipt_message(&o.content_hash));
    let res = send(&mut ctx.svm, &attestor, &[forged, build_issue_ix(&attestor.pubkey(), &o)], &[]);
    let err = format!("{:?}", res.expect_err("a forged signature must fail").err);
    // Instruction 0 is the Ed25519 program (its InvalidSignature); the
    // receipt program, instruction 1, never ran.
    assert!(err.starts_with("InstructionError(0,"), "the Ed25519 program refuses it, not ours: {err}");
    nothing_written(&ctx, &o);
}

#[test]
fn an_ed25519_check_of_two_signatures_is_refused() {
    let mut ctx = setup();
    let o = order(25);
    let attestor = ctx.attestor.insecure_clone();
    let buyer = buyer_key(&o.buyer_seed);
    let msg = receipt_message(&o.content_hash);
    // Two valid signatures in one instruction: the Ed25519 program accepts it,
    // the receipt program wants exactly one.
    let (s1, s2) = (buyer.sign_message(&msg), attestor.sign_message(&msg));
    let mut d = vec![2u8, 0u8];
    let base: u16 = 2 + 14 * 2;
    let (pk1, sig1) = (base, base + 32);
    let (pk2, sig2) = (base + 96, base + 128);
    let m = base + 192;
    for (sig, pk) in [(sig1, pk1), (sig2, pk2)] {
        for v in [sig, u16::MAX, pk, u16::MAX, m, msg.len() as u16, u16::MAX] {
            d.extend_from_slice(&v.to_le_bytes());
        }
    }
    d.extend_from_slice(&buyer.pubkey().to_bytes());
    d.extend_from_slice(s1.as_ref());
    d.extend_from_slice(&attestor.pubkey().to_bytes());
    d.extend_from_slice(s2.as_ref());
    d.extend_from_slice(&msg);
    let two = anchor_lang::solana_program::instruction::Instruction::new_with_bytes(
        solana_sdk_ids::ed25519_program::ID,
        &d,
        vec![],
    );
    assert_custom_error(
        send(&mut ctx.svm, &attestor, &[two, build_issue_ix(&attestor.pubkey(), &o)], &[]),
        BAD_SIGNATURE_INSTRUCTION,
    );
    nothing_written(&ctx, &o);
}

#[test]
fn an_evm_buyer_is_refused_until_secp256k1_is_checked() {
    let mut ctx = setup();
    let mut o = order(26);
    let mut evm = [0u8; 32];
    evm[12..].copy_from_slice(&[0xAB; 20]);
    o.buyer = evm;
    let attestor = ctx.attestor.insecure_clone();
    let ixs = build_issue_ixs(&attestor.pubkey(), &o);
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), EVM_BUYER_NOT_SUPPORTED);
    nothing_written(&ctx, &o);
}

#[test]
fn version_execution_time_and_eight_readings_are_written_in_order() {
    let mut ctx = setup();
    let mut o = order(27);
    o.readings = (0..8u64).map(|i| reading(if i == 0 { 0 } else { 1000 + i }, 10 + i as u32)).collect();
    o.readings[7].state = 1; // too thin: no cost, no price
    o.readings[7].cost_bps = 0;
    o.readings[7].price_per_share_micros = 0;
    issue(&mut ctx, &o);

    let r = read_receipt(&ctx.svm, &o.content_hash);
    assert_eq!(r.version, 2);
    assert_eq!(r.executed_at, o.executed_at);
    assert_eq!(r.issued_at, NOW, "issued_at is the Solana clock, apart from executed_at");
    assert_eq!(r.readings, o.readings);
    assert_eq!(r.buyer, buyer_key(&o.buyer_seed).pubkey().to_bytes());
}

#[test]
fn more_than_eight_readings_are_refused() {
    let mut ctx = setup();
    let mut o = order(28);
    o.readings = (0..9u64).map(|i| reading(1000 + i, 10)).collect();
    let attestor = ctx.attestor.insecure_clone();
    let ixs = build_issue_ixs(&attestor.pubkey(), &o);
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), TOO_MANY_READINGS);
    nothing_written(&ctx, &o);
}

#[test]
fn a_reading_that_did_not_fill_carries_no_number() {
    let mut ctx = setup();
    let attestor = ctx.attestor.insecure_clone();

    let mut o = order(29);
    o.readings[1].state = 1;
    o.readings[1].price_per_share_micros = 0; // cost_bps left at 30: a zero would read as a price
    let ixs = build_issue_ixs(&attestor.pubkey(), &o);
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), BAD_READING);

    o.readings[1].cost_bps = 0;
    issue(&mut ctx, &o);
    assert_eq!(read_receipt(&ctx.svm, &o.content_hash).readings[1].state, 1);
}

#[test]
fn unknown_states_and_sources_and_empty_readings_are_refused() {
    let mut ctx = setup();
    let attestor = ctx.attestor.insecure_clone();
    for (tag, edit) in [
        (30u8, (|r: &mut tnega_receipt::Reading| r.state = 3) as fn(&mut tnega_receipt::Reading)),
        (31u8, |r: &mut tnega_receipt::Reading| r.source = 2),
        (32u8, |r: &mut tnega_receipt::Reading| r.as_of = 0),
        (33u8, |r: &mut tnega_receipt::Reading| r.size_usd = 0),
    ] {
        let mut o = order(tag);
        edit(&mut o.readings[0]);
        let ixs = build_issue_ixs(&attestor.pubkey(), &o);
        assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), BAD_READING);
    }
}

#[test]
fn a_filled_reading_over_10000_bps_is_refused() {
    let mut ctx = setup();
    let attestor = ctx.attestor.insecure_clone();
    let mut o = order(34);
    o.readings[2].cost_bps = 10_001;
    let ixs = build_issue_ixs(&attestor.pubkey(), &o);
    assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), COST_OUT_OF_RANGE);

    o.readings[2].cost_bps = 10_000;
    issue(&mut ctx, &o);
}

#[test]
fn an_execution_time_in_the_future_or_at_zero_is_refused() {
    let mut ctx = setup();
    let attestor = ctx.attestor.insecure_clone();
    for (tag, t) in [(35u8, NOW + 60), (36u8, 0)] {
        let o = Order { executed_at: t, ..order(tag) };
        let ixs = build_issue_ixs(&attestor.pubkey(), &o);
        assert_custom_error(send(&mut ctx.svm, &attestor, &ixs, &[]), BAD_EXECUTION_TIME);
    }
    // Exactly now is fine: the trade and the receipt can share a second.
    issue(&mut ctx, &Order { executed_at: NOW, ..order(37) });
}
