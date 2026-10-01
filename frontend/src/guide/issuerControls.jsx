// guide/issuerControls.jsx: the Issuer controls page (/issuer-controls) and
// the controls card on each stock page. The powers' own words come from
// controls/model.js POWERS, the same text the page's (i) shows.

import React from 'react';
import { Q, Terms } from './parts';
import { POWERS } from '../controls/model';

function Body() {
  return (
    <>
      <Q q="What each power means for you">
        <p>A tokenized stock is a token an issuer controls through its contract. The powers below decide what can happen to your tokens without your signature. For each programme Tnega reads the contract on chain: whether the power exists, who holds it (one key, a multisig and how many of its signers must agree, a timelock and its delay) and the block or slot of the read.</p>
      </Q>
      <Terms items={POWERS.map((p) => [`${p.label}: ${p.ask}`, p.means])} />
      <Q q="Why who holds a power matters">
        <p>Who holds a power decides how quickly it can be used. One key can act alone; a multisig needs the stated number of its signers to agree; a timelock makes a change wait for its delay, which gives holders time to see it coming. These are readings of what the contracts allow, not a rating and not a recommendation.</p>
      </Q>
      <Q q="Reading the page">
        <p>Pick a token to see its own controls at the top, with its programme marked in the table. A programme is one issuer on one chain family; search and filter the table by issuer and chain. Each cell gives what the contract allows and who holds it; &ldquo;Show details&rdquo; opens what the contract does, the upgrade path, any simulation (an eth_call, nothing broadcast) and the evidence: the address, the block or slot, and the method of each read.</p>
        <p>On a stock page, the same card shows the chosen version&apos;s controls, with mint and allowlist as well, and links to its row here.</p>
      </Q>
      <Terms items={[
        ['Single key (inferred)', 'The holder address has no code. No code does not prove it is one person.'],
        ['Not established', 'Tnega’s reads did not settle it. It does not mean the power is absent.'],
        ['Source classes', 'Chain reads are Tnega’s own; who may hold is the issuer’s words, quoted with a link and the day it was read, not a chain read. The (i) under the table names the classes and the scope of this read.'],
        ['As of', 'The day the controls were read and assembled.'],
      ]} />
    </>
  );
}

export default {
  id: 'issuer-controls',
  title: 'Issuer controls',
  summary: 'Pause, freeze, burn or seize, upgrade and who may hold: what each means and how it is read.',
  Body,
};
