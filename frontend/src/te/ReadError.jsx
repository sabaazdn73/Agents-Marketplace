// te/ReadError.jsx
//
// What a tokenized-equity page shows when its read fails: never a blank
// page or a heading with nothing under it. One wording for every page, in
// both apps. A read that never reached the API (offline, blocked, the API
// down) says so; one that reached it and got an error names the status and
// the API's own reason when it gave one. "Try again" reloads the page,
// which reads again.

import React from 'react';
import { Card } from '../ui/primitives';

export function readErrorText(error, what, body = null) {
  const m = /^HTTP (\d{3})$/.exec(error || '');
  const reason = body && typeof body.reason === 'string' ? ` (${body.reason})` : '';
  if (m) return `Tnega's data service answered with an error, HTTP ${m[1]}${reason}, so ${what} can't be shown right now.`;
  return `Couldn't reach Tnega's data service, so ${what} can't be shown right now. Check your connection, or try again in a moment.`;
}

export default function ReadError({ error, what, body = null, bare = false }) {
  if (!error) return null;
  const inner = (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] text-fg max-w-[70ch]">{readErrorText(error, what, body)}</p>
      <button type="button" onClick={() => window.location.reload()} className="h-8 px-3 rounded border border-line-strong text-[12px] font-semibold text-fg hover:bg-inset">Try again</button>
    </div>
  );
  return bare ? inner : <Card>{inner}</Card>;
}
