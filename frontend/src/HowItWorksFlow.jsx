// HowItWorksFlow.jsx
//
// The step-by-step flow under each way of using this project.
//
// WHY A COMPONENT AND NOT A PICTURE
// A flowchart drawn as an image is unreadable on a phone, unselectable, and
// invisible to anything that is not a pair of eyes. This is a numbered list
// with a connector drawn in CSS, so it reflows at 390px, the text can be
// copied, and a screen reader gets an ordered list in the right order.
//
// HOW IT BEHAVES AT 390
// The steps stack in one column at every width; they never sit side by side.
// A flowchart that reads left to right on a desktop and wraps into an
// ambiguous grid on a phone is the first thing to break, so this does not have
// a second layout to break into. The connector is a vertical line between the
// step markers, which is the same shape at any width.
//
// WHAT A STEP MAY CONTAIN
// A title, a line of detail, and optionally one command to copy. Nothing that
// needs a legend. If a step needs a caveat, the caveat belongs in the section's
// prose rather than inside the sequence, because a numbered step is an
// instruction and a caveat is not.

import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

function CopyLine({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
      .catch(() => {});
  };
  return (
    <div className="relative mt-1.5 rounded border border-line bg-inset pr-8">
      {/* The copy button lives in a gutter OUTSIDE the scroll box, not on top
          of it. It was absolutely positioned over a `pre` whose `pr-*` padding
          sits at the end of the scrollable content, so at rest the button
          covered the middle of a long line: the endpoint rendered as
          "…onrender." [button] "/m" on a phone. The gutter is on the wrapper,
          so nothing can scroll under it at any width. */}
      <pre className="overflow-x-auto px-2.5 py-2 text-[11px] leading-relaxed text-fg font-mono whitespace-pre">
{text}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy ${label || 'the command'}`}
        title={copied ? 'Copied' : `Copy ${label || 'the command'}`}
        className="absolute top-1.5 right-1.5 p-1 rounded border border-line bg-surface text-muted hover:text-fg transition-colors"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

/**
 * @param {{steps: Array<{title: string, body?: string, command?: string,
 *          commandLabel?: string}>, compact?: boolean}} props
 */
export default function HowItWorksFlow({ steps, compact = false }) {
  return (
    <ol className="relative mt-1">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
            {/* The connector. Drawn behind the marker and stopped on the last
                step, so the sequence ends rather than trailing into nothing. */}
            {!last && (
              <span
                aria-hidden="true"
                className="absolute left-[11px] top-6 bottom-0 w-px bg-line-strong"
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 shrink-0 w-[23px] h-[23px] rounded-full border flex items-center justify-center font-bold ${
                compact ? 'text-[10px]' : 'text-[11px]'
              } border-accent/40 bg-accent-soft text-accent`}
            >
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`font-semibold text-fg ${compact ? 'text-[12px]' : 'text-[13px]'}`}>
                {s.title}
              </div>
              {s.body && (
                <div className={`${compact ? 'text-[11px]' : 'text-[12px]'} leading-relaxed text-muted mt-0.5`}>
                  {s.body}
                </div>
              )}
              {s.command && <CopyLine text={s.command} label={s.commandLabel} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
