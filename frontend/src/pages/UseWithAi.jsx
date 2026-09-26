// UseWithAi.jsx
//
// /ai. How to point your own assistant at this site's MCP server. The
// section is the one How It Works carried, the same components and the same
// words (HowItWorksPage.jsx McpFront and McpDetails), so the two cannot
// disagree about the endpoint or the install.
//
// This page does not use the "being built" sentence the other four do,
// because it would be false here: the server is live. What is not live is the
// part for stocks, ETFs and vaults, and the note says exactly that.

import React from 'react';
import { McpFront, McpDetails, MCP_TITLE, MCP_LINE } from '../HowItWorksPage';
import { PageFrame } from './PageFrame';

export default function UseWithAi({ layout = 'web' }) {
  const compact = layout === 'mobile';
  return (
    <PageFrame layout={layout} title="Use with AI">
      <section className="card p-4 md:p-6" aria-label="What the server covers today">
        <p className="text-title font-semibold text-fg">
          The stock, ETF and vault tools are being built and are not on the server yet.
        </p>
        <p className="text-body text-muted mt-1.5 max-w-2xl">
          What the server answers today is below: the agent measurements, through six read-only tools.
        </p>
      </section>

      <section className="card overflow-hidden" aria-labelledby="mcp-title">
        <div className="p-4 md:p-6">
          <div className="flex items-start gap-3">
            <span className="p-2 rounded bg-inset shrink-0">
              <img src="/mcp-mark.svg" alt="" width={18} height={18} className="object-contain" style={{ width: 18, height: 18 }} />
            </span>
            <div className="min-w-0">
              <h2 id="mcp-title" className="text-title font-bold text-fg">{MCP_TITLE}</h2>
              <p className="text-body text-muted mt-0.5">{MCP_LINE}</p>
            </div>
          </div>
          <div className="mt-3">
            <McpFront small={compact} flush />
          </div>
        </div>
        <div className="px-4 md:px-6 pb-5 pt-4 border-t border-line space-y-4 text-body leading-relaxed text-muted">
          <McpDetails compact={compact} />
        </div>
      </section>
    </PageFrame>
  );
}
