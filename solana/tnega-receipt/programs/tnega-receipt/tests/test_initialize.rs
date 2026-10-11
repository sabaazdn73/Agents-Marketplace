mod common;

use {
    common::{build_initialize_ix, config_pda, fund, read_config, send, setup, setup_svm, ONE_SOL},
    solana_keypair::Keypair,
    solana_signer::Signer,
};

#[test]
fn initialize_stores_authority_attestor_and_starts_unpaused() {
    let ctx = setup();
    let cfg = read_config(&ctx.svm);

    assert_eq!(cfg.authority, ctx.authority.pubkey());
    assert_eq!(cfg.attestor, ctx.attestor.pubkey());
    assert!(!cfg.paused, "a new config must start unpaused");
    let (_, bump) = config_pda();
    assert_eq!(cfg.bump, bump, "the canonical bump is stored");
}

#[test]
fn initialize_twice_fails_and_keeps_the_first_authority() {
    let mut ctx = setup();

    let intruder = Keypair::new();
    fund(&mut ctx.svm, &intruder.pubkey(), 10 * ONE_SOL);
    let ix = build_initialize_ix(&intruder.pubkey(), &intruder.pubkey());
    let res = send(&mut ctx.svm, &intruder, &[ix], &[]);
    assert!(res.is_err(), "the config account already exists");

    let cfg = read_config(&ctx.svm);
    assert_eq!(cfg.authority, ctx.authority.pubkey(), "authority must not be taken over");
    assert_eq!(cfg.attestor, ctx.attestor.pubkey());
}

#[test]
fn a_bare_svm_has_no_config_until_initialised() {
    let svm = setup_svm();
    let (pda, _) = config_pda();
    assert!(svm.get_account(&pda).is_none());
}
