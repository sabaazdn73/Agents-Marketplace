mod common;

use {
    common::{
        assert_custom_error, build_issue_ixs, build_set_attestor_ix, build_set_paused_ix, fund,
        issue, order, read_config, read_receipt, send, setup, NOT_ATTESTOR, NOT_AUTHORITY, ONE_SOL,
    },
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn only_the_authority_can_pause() {
    let mut ctx = setup();
    let attestor = ctx.attestor.insecure_clone();

    // The hot key has no governing power.
    let ix = build_set_paused_ix(&attestor.pubkey(), true);
    assert_custom_error(send(&mut ctx.svm, &attestor, &[ix], &[]), NOT_AUTHORITY);
    assert!(!read_config(&ctx.svm).paused);
}

#[test]
fn only_the_authority_can_replace_the_attestor() {
    let mut ctx = setup();
    let stranger = Keypair::new();
    fund(&mut ctx.svm, &stranger.pubkey(), 10 * ONE_SOL);

    let ix = build_set_attestor_ix(&stranger.pubkey(), &stranger.pubkey());
    assert_custom_error(send(&mut ctx.svm, &stranger, &[ix], &[]), NOT_AUTHORITY);
    assert_eq!(read_config(&ctx.svm).attestor, ctx.attestor.pubkey());
}

#[test]
fn after_rotation_the_new_key_issues_and_the_old_key_cannot() {
    let mut ctx = setup();
    let authority = ctx.authority.insecure_clone();
    let old_attestor = ctx.attestor.insecure_clone();
    let new_attestor = Keypair::new();
    fund(&mut ctx.svm, &new_attestor.pubkey(), 10 * ONE_SOL);

    // Receipt issued before the rotation stays valid afterwards.
    let before = order(1);
    issue(&mut ctx, &before);

    let rotate = build_set_attestor_ix(&authority.pubkey(), &new_attestor.pubkey());
    send(&mut ctx.svm, &authority, &[rotate], &[]).expect("rotate");
    assert_eq!(read_config(&ctx.svm).attestor, new_attestor.pubkey());

    let ix = build_issue_ixs(&old_attestor.pubkey(), &order(2));
    assert_custom_error(send(&mut ctx.svm, &old_attestor, &ix, &[]), NOT_ATTESTOR);

    let after = order(3);
    let ix = build_issue_ixs(&new_attestor.pubkey(), &after);
    send(&mut ctx.svm, &new_attestor, &ix, &[]).expect("new key issues");

    assert!(read_receipt(&ctx.svm, &before.content_hash).active, "old receipts survive rotation");
    assert_eq!(read_receipt(&ctx.svm, &before.content_hash).issuer, old_attestor.pubkey());
    assert_eq!(read_receipt(&ctx.svm, &after.content_hash).issuer, new_attestor.pubkey());
}
