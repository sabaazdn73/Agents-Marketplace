mod common;

use {
    common::{
        assert_custom_error, build_issue_ixs, build_set_paused_ix, fund, issue, order, read_receipt,
        receipt_pda, send, setup, Order, COST_OUT_OF_RANGE, ISSUANCE_PAUSED, NOT_ATTESTOR, ONE_SOL,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn issue_writes_every_field_and_marks_the_receipt_active() {
    let mut ctx = setup();
    let o = order(7);
    issue(&mut ctx, &o);

    let r = read_receipt(&ctx.svm, &o.content_hash);
    assert_eq!(r.content_hash, o.content_hash);
    assert_eq!(r.chain_id, o.chain_id);
    assert_eq!(r.tx_hash, o.tx_hash);
    assert_eq!(r.buyer, o.buyer);
    assert_eq!(r.quoted_cost_bps, 30);
    assert_eq!(r.executed_cost_bps, 31);
    assert_eq!(r.notional_usd_cents, 100_000);
    assert_eq!(r.issuer, ctx.attestor.pubkey(), "the receipt records who signed it");
    assert!(r.active);
    assert_eq!(r.version, 2);
    assert_eq!(r.executed_at, o.executed_at);
    assert_eq!(r.readings, o.readings);
    let (_, bump) = receipt_pda(&o.content_hash);
    assert_eq!(r.bump, bump);
}

#[test]
fn only_the_attestor_can_issue() {
    let mut ctx = setup();
    let stranger = Keypair::new();
    fund(&mut ctx.svm, &stranger.pubkey(), 10 * ONE_SOL);

    let o = order(1);
    let ix = build_issue_ixs(&stranger.pubkey(), &o);
    assert_custom_error(send(&mut ctx.svm, &stranger, &ix, &[]), NOT_ATTESTOR);

    let (pda, _) = receipt_pda(&o.content_hash);
    assert!(ctx.svm.get_account(&pda).is_none(), "nothing may be written");
}

#[test]
fn the_authority_is_not_the_attestor() {
    // Two keys on purpose: governing is not the same power as attesting.
    let mut ctx = setup();
    let ix = build_issue_ixs(&ctx.authority.pubkey(), &order(2));
    let authority = ctx.authority.insecure_clone();
    assert_custom_error(send(&mut ctx.svm, &authority, &ix, &[]), NOT_ATTESTOR);
}

#[test]
fn a_second_receipt_for_the_same_hash_fails_and_leaves_the_first_untouched() {
    let mut ctx = setup();
    let first = order(3);
    issue(&mut ctx, &first);

    // Same content hash, different numbers: an attempt to rewrite history.
    let forged = Order { quoted_cost_bps: 1, executed_cost_bps: 1, notional_usd_cents: 1, ..first.clone() };
    let ix = build_issue_ixs(&ctx.attestor.pubkey(), &forged);
    let attestor = ctx.attestor.insecure_clone();
    assert!(send(&mut ctx.svm, &attestor, &ix, &[]).is_err(), "the address is already in use");

    let r = read_receipt(&ctx.svm, &first.content_hash);
    assert_eq!(r.quoted_cost_bps, 30);
    assert_eq!(r.executed_cost_bps, 31);
    assert_eq!(r.notional_usd_cents, 100_000);
}

#[test]
fn different_hashes_get_different_receipts() {
    let mut ctx = setup();
    issue(&mut ctx, &order(4));
    issue(&mut ctx, &order(5));
    assert_ne!(receipt_pda(&order(4).content_hash).0, receipt_pda(&order(5).content_hash).0);
    assert!(read_receipt(&ctx.svm, &order(4).content_hash).active);
    assert!(read_receipt(&ctx.svm, &order(5).content_hash).active);
}

#[test]
fn a_cost_of_exactly_10000_bps_is_accepted_and_10001_is_not() {
    // The boundary: `<=`, not `<`. Only these two tests can tell them apart.
    let mut ctx = setup();
    let attestor = ctx.attestor.insecure_clone();

    let at_cap = Order { quoted_cost_bps: 10_000, executed_cost_bps: 10_000, ..order(6) };
    issue(&mut ctx, &at_cap);
    assert_eq!(read_receipt(&ctx.svm, &at_cap.content_hash).executed_cost_bps, 10_000);

    let quoted_over = Order { quoted_cost_bps: 10_001, ..order(8) };
    let ix = build_issue_ixs(&attestor.pubkey(), &quoted_over);
    assert_custom_error(send(&mut ctx.svm, &attestor, &ix, &[]), COST_OUT_OF_RANGE);

    let executed_over = Order { executed_cost_bps: 10_001, ..order(9) };
    let ix = build_issue_ixs(&attestor.pubkey(), &executed_over);
    assert_custom_error(send(&mut ctx.svm, &attestor, &ix, &[]), COST_OUT_OF_RANGE);
}

#[test]
fn paused_blocks_issuing_and_unpausing_restores_it() {
    let mut ctx = setup();
    let authority = ctx.authority.insecure_clone();
    let attestor = ctx.attestor.insecure_clone();

    let pause = build_set_paused_ix(&authority.pubkey(), true);
    send(&mut ctx.svm, &authority, &[pause], &[]).expect("pause");

    let o = order(10);
    let ix = build_issue_ixs(&attestor.pubkey(), &o);
    assert_custom_error(send(&mut ctx.svm, &attestor, &ix, &[]), ISSUANCE_PAUSED);

    let unpause = build_set_paused_ix(&authority.pubkey(), false);
    send(&mut ctx.svm, &authority, &[unpause], &[]).expect("unpause");

    issue(&mut ctx, &o);
    assert!(read_receipt(&ctx.svm, &o.content_hash).active);
}
