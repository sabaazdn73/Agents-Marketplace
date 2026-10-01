// guide/vaults.jsx
//
// The guide's Vaults section: what the list and a vault's page show, and
// how each figure is read. The text the pages carried before they were made
// short (vaults/VaultList.jsx, vaults/VaultDetail.jsx) is here.

import React from 'react';
import { Q, Terms, P } from './parts';

function Body() {
  return (
    <>
      <P>
        The vaults listed take a stablecoin deposit and are read on chain: who controls the money,
        what the vault holds and what it lends against. Tnega never holds funds; a deposit or a
        withdrawal happens on the vault&apos;s own venue, signed in your own wallet.
      </P>

      <Q q="Which vaults are listed?">
        <p>
          The listing rule is served with the list and shown, word for word, under
          &quot;Listing rule and exclusions&quot; at the foot of the Vaults page. Every vault account
          that was read and not listed is counted there by reason, and some are named.
        </p>
        <p>
          A venue appears under &quot;Venues with nothing listed&quot; when it was read and none of its
          vaults meets the rule; the reason is given under each. &quot;Read failed&quot; means the
          latest read of that venue did not complete; its earlier results are kept and marked stale.
        </p>
      </Q>

      <Q q="What do the figures on the list mean?">
        <Terms items={[
          ['Total value locked', 'The sum of the vaults shown, each dollar once: a vault that sits inside another listed vault is counted in that vault only. Tokens at 1 USD each, face value. Its (i) says how many figures were computed from chain reads and how many are as the vault records them.'],
          ['TVL, "chain"', 'Computed from the vault\'s positions read on chain, with the date it was computed.'],
          ['TVL, "vault record"', 'The vault\'s own recorded total, not recomputed, with the date the vault wrote it.'],
          ['Synthetic dollar', 'A vault whose deposit token is a synthetic dollar (USX among the vaults listed today) carries that label; it is still counted at face value.'],
          ['Stale', 'The figure is older than the rule served with it allows, or the latest chain read of the vault failed and the figures are from the previous read.'],
          ['Check ✓', 'The TVL computed from chain reconciles with the vault\'s own records.'],
          ['Check ⚠', 'The TVL is the vault\'s own record, is not reconciled, or is stale. The reason is in the hover.'],
          ['Check ?', 'A partial read: some positions could not be valued.'],
          ['Venue count and (i)', 'The number beside a venue is its vaults shown; the (i) holds the venue\'s own line, how many of its accounts were read and listed.'],
          ['30-day change, Age, 30-day line', 'Shown only once a vault carries the figure. None does yet: the collector keeps its latest read, not a history, so no column of dashes is drawn.'],
        ]} />
      </Q>

      <div id="vaults-detail" className="scroll-mt-24">
        <Q q="What does a vault's page show?">
          <Terms items={[
            ['TVL and its (i)', 'The figure, its source and date, and behind the (i) its basis, how it reconciles, the slot it was read at and any nesting note.'],
            ['Due diligence', 'Who controls the money (each admin key and what it can do), other admin keys, upgradeability, pause, lock-up, fees, what the vault holds, what it lends against, notes and audits. Each field names where it was read.'],
            ['What it lends against', 'Collateral names as each token\'s own metadata declares them; the tokens themselves are read on chain. A token is marked off-chain backed only where that was established.'],
            ['Holdings', 'The positions that hold something; the rest are named as "more with nothing held". For a Kamino vault, reserves are counted per market, since one market can hold two reserves.'],
            ['Your position', 'Not read here. Your wallet on the vault\'s venue shows it.'],
          ]} />
        </Q>
        <Q q="What happens on Deposit or Withdraw?">
          <p>
            A panel shows the lock-up, the fees and what the admins and manager can do, then a link
            to the venue. Nothing is built or signed on Tnega; the deposit or withdrawal happens on
            the venue, in your own wallet. Where the venue has no page for the vault, its address is
            given to find it in the venue&apos;s own app.
          </p>
        </Q>
      </div>
    </>
  );
}

export default {
  id: 'vaults',
  title: 'Vaults',
  summary: 'What a listed vault is, and how each figure on the list and a vault\'s page is read.',
  Body,
};
