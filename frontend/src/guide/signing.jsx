// guide/signing.jsx
//
// The guide's section on the signing page (/sign/<id>). The page itself
// keeps everything about the order being signed on its face: the order, the
// amounts, the slippage, the fees, the exact approval and its spender, the
// quote and the price-check result, the expiry and who may hold the token.
// Only the background (how the quote is fetched, how the limit is set, what
// each ended state means) moved here.

import React from 'react';
import { Q, Terms, P } from './parts';

function Body() {
  return (
    <>
      <P>
        A signing link (tnega.app/sign/…) opens one order prepared outside the site, through
        Tnega&apos;s MCP server. Tnega prepared it; nothing is signed until you sign each
        transaction in your own wallet. Tnega never holds funds or keys.
      </P>

      <Q q="What happens, step by step?">
        <Terms items={[
          ['1. Connect', 'The order\'s own wallet. Only the wallet the order was prepared for can sign it there; connecting signs nothing.'],
          ['2. Chain', 'Your wallet is asked to switch to the order\'s chain when you approve or sign, or when you press Switch.'],
          ['3. Quote', 'A route and a price from LI.FI (li.quest), asked by your browser for the order\'s wallet, only when you press the button. It needs no wallet connected. The page counts its requests against LI.FI\'s limit per 2 hours.'],
          ['4. Approve', 'Only when the allowance to LI.FI\'s approval address is below the amount, and for exactly the amount; never an unlimited approval. After one approval the page reads the allowance again rather than asking for a second.'],
          ['5. Sign', 'LI.FI\'s transaction as quoted, passed to your wallet as LI.FI built it, only while the quote is under 60 seconds old. The hash, an explorer link and LI.FI\'s status follow.'],
        ]} />
      </Q>

      <Q q="What is different for an order on Solana?">
        <p>
          A Solana order is for a tokenized stock on Solana, paid or received in USDC. The quote and
          the transaction come from Jupiter (jup.ag), asked by your browser, and you connect a
          Solana wallet such as Phantom or Solflare instead of an EVM one. There is no approval step
          and no chain switch: the swap moves the tokens by your one signature.
        </p>
        <p>
          The quote has to pass the same price check against Tnega&apos;s measured price. Jupiter
          carries no price of its own to hold ours against, so there is one price check, not two.
          Before your wallet is asked, Tnega also reads the transaction Jupiter built: it must be
          signed by the order&apos;s wallet alone, call only Jupiter&apos;s swap, the compute budget and
          the creation of the wallet&apos;s own token accounts, and spend exactly the order&apos;s
          amount. A first purchase of a Token-2022 token such as an xStock creates the wallet&apos;s
          account for it, which holds a rent deposit of about 0.002 SOL that is yours to close.
          The signature and a Solscan link follow.
        </p>
      </Q>

      <Q q="What is checked before you can sign?">
        <p>
          The quote is refused if it does not match the order, if the minimum sits further below the
          estimate than the order&apos;s slippage, or if Tnega&apos;s own price check fails. Both
          tokens&apos; decimals are read on chain and held against the order&apos;s.
        </p>
        <p>
          The price check values LI.FI&apos;s minimum at Tnega&apos;s measured price and at LI.FI&apos;s
          own; the minimum has to pass at both. The limit is the smaller of 5% and the larger of 2%
          and three times the measured cost without gas. The two prices have to be within 5% of each
          other. A measurement over 30 minutes old is not used. The stablecoin is taken at $1.
        </p>
        <p>
          Who may hold the token is shown in the issuer&apos;s words, with a box to tick. It is
          shown, not enforced: Tnega does not check who you are.
        </p>
      </Q>

      <Q q="What do the ended states mean?">
        <Terms items={[
          ['Expired', 'A link works for 10 minutes from when the order was prepared; after that nothing can be signed from it.'],
          ['Not valid', 'The link did not pass Tnega\'s check: it may have been cut short or changed on the way.'],
          ['Marked as used', 'A transaction was reported for the link, so it is not offered again. Check your wallet\'s activity first; if nothing was sent, ask your assistant for a new order.'],
        ]} />
      </Q>
    </>
  );
}

export default {
  id: 'signing',
  title: 'Signing an order',
  summary: 'What the signing page checks, and what each step and state means.',
  Body,
};
