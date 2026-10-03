// sign/solanaStatus.js
//
// What a wallet's refusal or the network's answer means, in words, and how a
// sent transaction's progress is read. Pure: no React, no @solana/web3.js.

/** A wallet's or the network's error, as a sentence for the page. Looks along
 *  the error's chain of causes, as the EVM page does (trade/evmExecute.js
 *  walletErrorText). */
export function solanaErrorText(e) {
  const parts = [];
  for (let x = e, depth = 0; x && depth < 10; x = x.cause || x.error, depth += 1) {
    parts.push(`${x.name || ''} ${x.message || ''} ${x.code ?? ''}`);
    if (Array.isArray(x.logs)) parts.push(x.logs.join(' '));
  }
  const t = parts.join(' | ');
  if (/user rejected|rejected the request|user denied|declined|User canceled|cancell?ed/i.test(t) || /\b4001\b/.test(t)) return 'You declined in the wallet. Nothing was sent.';
  if (/block ?height exceeded|blockhash not found|Blockhash expired|transaction.*expired/i.test(t)) return 'The transaction expired before it landed: its blockhash is too old. Nothing was spent. Get a new quote and sign again.';
  if (/0x1771|6001|SlippageToleranceExceeded/i.test(t)) return 'The price moved past the order’s slippage, so the swap was not made. Nothing was spent except the network fee. Get a new quote.';
  if (/Attempt to debit an account but found no record of a prior credit|insufficient lamports|insufficient funds for rent|InsufficientFundsForRent/i.test(t)) {
    return 'The wallet does not hold enough SOL for the network fee and the new token account. Add a little SOL (about 0.01) and get a new quote.';
  }
  if (/insufficient funds|custom program error: 0x1\b/i.test(t)) return 'The wallet does not hold enough of the token it is paying with. Nothing was sent.';
  if (/insufficient/i.test(t)) return 'The wallet does not hold enough for this swap (the token or SOL for fees). Nothing was sent.';
  if (/simulation failed|Transaction simulation/i.test(t)) return `The wallet’s simulation of the swap failed, so it was not sent: ${(e?.message || '').slice(0, 160)}`;
  if (/not connected|WalletNotConnected/i.test(t)) return 'The wallet is not connected. Connect it and try again.';
  if (/WalletSendTransactionError|WalletSignTransactionError/.test(t)) return `The wallet could not send the transaction: ${(e?.message || '').slice(0, 160) || 'no reason given'}.`;
  return e?.message ? String(e.message).slice(0, 200) : 'The wallet returned an error.';
}

/** Where a sent transaction stands, from getSignatureStatuses' entry (or
 *  null), the chain's block height and the transaction's last valid block
 *  height. state: 'processed' | 'confirmed' | 'finalized' | 'failed' |
 *  'expired' | 'pending'. 'expired' means the blockhash ran out and the
 *  signature is not on chain: nothing was spent. */
export function signatureOutcome(status, blockHeight, lastValidBlockHeight) {
  if (status && status.err) return { state: 'failed', err: status.err };
  if (status && status.confirmationStatus) return { state: status.confirmationStatus };
  if (lastValidBlockHeight != null && blockHeight != null && blockHeight > lastValidBlockHeight) return { state: 'expired' };
  return { state: 'pending' };
}

export const outcomeText = (o) => ({
  pending: 'Sent. Waiting for the network to see it.',
  processed: 'Seen by the network (processed). Waiting for confirmation.',
  confirmed: 'Confirmed.',
  finalized: 'Finalized.',
  failed: 'The transaction landed but failed on chain, so the swap did not happen. Only the network fee was spent.',
  expired: 'The transaction did not land before its blockhash expired, so it is not on chain and nothing was spent.',
}[o.state] || '');
