mod common;

use {
    common::{
        assert_custom_error, build_revoke_ix, build_set_attestor_ix, build_set_paused_ix, fund,
        issue, order, read_receipt, send, setup, ALREADY_REVOKED, NOT_ALLOWED_TO_REVOKE, ONE_SOL,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn the_attestor_can_revoke_and_the_content_stays_identical() {
    let mut ctx = setup();
    let o = order(1);
    issue(&mut ctx, &o);
    let before = read_receipt(&ctx.svm, &o.content_hash);

    let attestor = ctx.attestor.insecure_clone();
    let ix = build_revoke_ix(&attestor.pubkey(), &o.content_hash);
    send(&mut ctx.svm, &attestor, &[ix], &[]).expect("revoke");

    let after = read_receipt(&ctx.svm, &o.content_hash);
    assert!(!after.active);
    // Immutable: only `active` may differ.
    assert_eq!(after.content_hash, before.content_hash);
    assert_eq!(after.chain_id, before.chain_id);
    assert_eq!(after.tx_hash, before.tx_hash);
    assert_eq!(after.buyer, before.buyer);
    assert_eq!(after.quoted_cost_bps, before.quoted_cost_bps);
    assert_eq!(after.executed_cost_bps, before.executed_cost_bps);
    assert_eq!(after.notional_usd_cents, before.notional_usd_cents);
    assert_eq!(after.issued_at, before.issued_at);
    assert_eq!(after.issuer, before.issuer);
    assert_eq!(after.version, before.version);
    assert_eq!(after.executed_at, before.executed_at);
    assert_eq!(after.readings, before.readings);
}

#[test]
fn revoking_twice_fails() {
    let mut ctx = setup();
    let o = order(2);
    issue(&mut ctx, &o);

    let attestor = ctx.attestor.insecure_clone();
    let ix = build_revoke_ix(&attestor.pubkey(), &o.content_hash);
    send(&mut ctx.svm, &attestor, &[ix.clone()], &[]).expect("first revoke");
    assert_custom_error(send(&mut ctx.svm, &attestor, &[ix], &[]), ALREADY_REVOKED);
}

#[test]
fn a_stranger_cannot_revoke() {
    let mut ctx = setup();
    let o = order(3);
    issue(&mut ctx, &o);

    let stranger = Keypair::new();
    fund(&mut ctx.svm, &stranger.pubkey(), 10 * ONE_SOL);
    let ix = build_revoke_ix(&stranger.pubkey(), &o.content_hash);
    assert_custom_error(send(&mut ctx.svm, &stranger, &[ix], &[]), NOT_ALLOWED_TO_REVOKE);
    assert!(read_receipt(&ctx.svm, &o.content_hash).active);
}

#[test]
fn the_authority_can_revoke_too() {
    let mut ctx = setup();
    let o = order(4);
    issue(&mut ctx, &o);

    let authority = ctx.authority.insecure_clone();
    let ix = build_revoke_ix(&authority.pubkey(), &o.content_hash);
    send(&mut ctx.svm, &authority, &[ix], &[]).expect("authority revoke");
    assert!(!read_receipt(&ctx.svm, &o.content_hash).active);
}

#[test]
fn a_pause_never_blocks_a_revocation() {
    // The invariant carried over from AgentBudgetEscrow: pausing can stop
    // new issuance, but it can never stop someone undoing a bad receipt.
    let mut ctx = setup();
    let o = order(5);
    issue(&mut ctx, &o);

    let authority = ctx.authority.insecure_clone();
    let pause = build_set_paused_ix(&authority.pubkey(), true);
    send(&mut ctx.svm, &authority, &[pause], &[]).expect("pause");

    let attestor = ctx.attestor.insecure_clone();
    let ix = build_revoke_ix(&attestor.pubkey(), &o.content_hash);
    send(&mut ctx.svm, &attestor, &[ix], &[]).expect("revoke while paused");
    assert!(!read_receipt(&ctx.svm, &o.content_hash).active);
}

#[test]
fn a_replaced_attestor_can_no_longer_revoke_but_the_authority_still_can() {
    let mut ctx = setup();
    let o = order(6);
    issue(&mut ctx, &o);

    let authority = ctx.authority.insecure_clone();
    let old_attestor = ctx.attestor.insecure_clone();
    let new_attestor = Keypair::new();
    let rotate = build_set_attestor_ix(&authority.pubkey(), &new_attestor.pubkey());
    send(&mut ctx.svm, &authority, &[rotate], &[]).expect("rotate");

    // A leaked hot key is exactly the key that must stop working.
    let ix = build_revoke_ix(&old_attestor.pubkey(), &o.content_hash);
    assert_custom_error(send(&mut ctx.svm, &old_attestor, &[ix], &[]), NOT_ALLOWED_TO_REVOKE);

    let ix = build_revoke_ix(&authority.pubkey(), &o.content_hash);
    send(&mut ctx.svm, &authority, &[ix], &[]).expect("authority still revokes");
    assert!(!read_receipt(&ctx.svm, &o.content_hash).active);
}
