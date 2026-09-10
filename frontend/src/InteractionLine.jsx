// InteractionLine.jsx
//
// Renders the "how you actually use this agent" sentence. Same component on
// the card and on the agent's own page, so the two cannot say different
// things about the same agent.
//
// Renders nothing at all when there is no sentence. An agent with no answer
// should show no line rather than a placeholder, because an empty box where
// an explanation belongs reads worse than silence.

import React from 'react';
import { Info } from 'lucide-react';
import { interactionCopy } from './interactionCopy';

export default function InteractionLine({
  interaction, className = '', showDetail = true, deliveredCount = 0,
}) {
  // deliveredCount is passed where the caller knows it. A completed on-chain
  // job outranks the endpoint probe behind `interaction`; see interactionCopy.
  const copy = interactionCopy(interaction, { deliveredCount });
  if (!copy) return null;
  return (
    <div className={`flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-400 ${className}`}>
      <Info size={12} className="shrink-0 mt-0.5 opacity-60" />
      <span>
        {copy.line}
        {showDetail && copy.detail && (
          <span className="block opacity-80 mt-0.5">{copy.detail}</span>
        )}
      </span>
    </div>
  );
}
