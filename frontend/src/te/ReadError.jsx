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
  // The four cases apiRetry.js ends in, each named: no answer at all, an
  // answer too slow to finish, an error status, or no connection.
  const stall = /^no answer within (\d+) s, twice$/.exec(error || '');
  if (stall) return `Tnega's data service took the request but didn't start answering within ${stall[1]} seconds, twice, so ${what} can't be shown right now. Try again in a moment.`;
  const slow = /^answer not finished within (\d+) s$/.exec(error || '');
  if (slow) return `Tnega's data service started answering, but the answer didn't finish arriving within ${slow[1]} seconds (a slow connection can cause this), so ${what} can't be shown right now. Try again in a moment.`;
  return `Couldn't reach Tnega's data service (the connection failed, after retries), so ${what} can't be shown right now. Check your connection, or try again in a moment.`;
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
