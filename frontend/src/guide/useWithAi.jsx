// guide/useWithAi.jsx
//
// The guide's section for the /ai page. That page keeps the endpoint, the
// install line, the clients, the tools and one example; everything the page
// explained before it was made short lives here, as the same components
// (HowItWorksPage.jsx McpFront with its note, and McpDetails), so the words
// exist once.

import React from 'react';
import { McpFront, McpDetails } from '../HowItWorksPage';
import { Q, P } from './parts';

function Body() {
  return (
    <>
      <P>
        Tnega runs an MCP server: point your own assistant at it and it can read every measurement
        on this site, with the coverage behind each one, and prepare an order for you to sign. No
        key, no account, no sign-up.
      </P>

      <Q q="Which clients can connect?">
        <McpFront small flush />
      </Q>

      <Q q="The example on the Use with AI page">
        <p>
          The example shows real answers of the server, trimmed, with the time they were taken.
          tnega_prepare_buy takes a ticker, or one version&apos;s key (chain id and token address) to
          buy that version; the assistant reads the key from tnega_get&apos;s answer. The answer
          carries the chosen version, a LI.FI quote, an approval for the exact amount, Tnega&apos;s
          price check and a tnega.app/sign link. The link works for 10 minutes; nothing is signed or
          sent until you sign on that page in your own wallet.
        </p>
      </Q>

      <div className="py-3 space-y-4 text-[13px] leading-relaxed text-muted">
        <McpDetails />
      </div>
    </>
  );
}

export default {
  id: 'use-with-ai',
  title: 'Use with AI',
  summary: 'The MCP server: what it serves, how to add it to each client, and what a prepared order is.',
  Body,
};
