use anchor_lang::prelude::*;

#[error_code]
pub enum ReceiptError {
    #[msg("Only the current attestor can issue receipts")]
    NotAttestor,
    #[msg("Only the config authority can do this")]
    NotAuthority,
    #[msg("Only the attestor or the authority can revoke a receipt")]
    NotAllowedToRevoke,
    #[msg("Issuing is paused; revoking still works")]
    IssuancePaused,
    #[msg("This receipt is already revoked")]
    AlreadyRevoked,
    #[msg("A cost in basis points cannot exceed 10000")]
    CostOutOfRange,
    #[msg("The instruction before issue_receipt must be the Ed25519 check of the buyer's signature")]
    MissingBuyerSignature,
    #[msg("The Ed25519 instruction must check exactly one signature, with its key, signature and message inside itself")]
    BadSignatureInstruction,
    #[msg("The signature was not made by the buyer")]
    SignatureNotByBuyer,
    #[msg("The buyer signed a different message: not this receipt's content hash")]
    SignatureNotForThisReceipt,
    #[msg("An EVM buyer signs with secp256k1, which this version does not check yet")]
    EvmBuyerNotSupported,
    #[msg("A receipt holds at most 8 readings")]
    TooManyReadings,
    #[msg("A reading is malformed: unknown state or source, a cost on an unfilled reading, or no time or size")]
    BadReading,
    #[msg("The execution time must be after 0 and not in the future")]
    BadExecutionTime,
}
