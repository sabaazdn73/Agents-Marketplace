use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[constant]
pub const RECEIPT_SEED: &[u8] = b"receipt";

pub const ANCHOR_DISCRIMINATOR_LENGTH: usize = 8;

/// A cost in basis points cannot exceed the whole notional.
pub const MAX_BPS: u32 = 10_000;

/// At most this many price readings per receipt (architecture page 4).
pub const MAX_READINGS: usize = 8;

/// The layout of a receipt written by this version of the program: 2 adds
/// the buyer's enforced signature, the execution time and the readings.
pub const RECEIPT_VERSION: u8 = 2;

/// Reading.state
pub const READING_FILLED: u8 = 0;
pub const READING_TOO_THIN: u8 = 1;
pub const READING_NO_ROUTE: u8 = 2;

/// Reading.source
pub const SOURCE_POOL_AT_BLOCK: u8 = 0;
pub const SOURCE_JUPITER_QUOTE: u8 = 1;

/// The text the buyer's wallet signs, before the content hash in lowercase hex.
pub const RECEIPT_MESSAGE_PREFIX: &[u8] = b"Tnega Receipt v1\ncontent_hash: ";
