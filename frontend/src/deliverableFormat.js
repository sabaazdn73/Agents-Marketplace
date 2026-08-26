// deliverableFormat.js
//
// Turns a delivered JSON payload's real content field into a light, safe
// block structure for readable rendering. Not a full markdown-spec parser
// — no library pulled in for this, matching this project's existing
// hand-rolled-over-a-library choices elsewhere — just enough to handle
// what real agent output on this marketplace actually contains: headers,
// bold/italic, bullet/numbered lists, simple tables, horizontal rules, and
// paragraphs (confirmed against a real delivered payload — the explainer
// agent's job #56646 response.content used all of these). Anything it
// doesn't recognize renders as a plain paragraph, never dropped or erased.

/** Best-effort: find the one real, human-meaningful text field in a
 * delivered JSON payload. Different agents/SDKs shape their deliverable
 * differently, so this checks the real shape seen on this marketplace
 * (this SDK's own response.content) plus a few common fallbacks, in order.
 * Returns null if nothing string-shaped and non-empty is found — the
 * caller falls back to showing the raw JSON, never a blank screen. */
export function extractDeliverableText(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const candidates = [
    parsed?.response?.content,
    parsed?.content,
    parsed?.text,
    parsed?.message,
    typeof parsed?.result === 'string' ? parsed.result : null,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return null;
}

/** Splits one line/paragraph into plain/bold/italic runs — the two real
 * inline styles seen in real agent output (**bold**, *italic*), not a
 * full spec. */
function parseInline(s) {
  const parts = [];
  let rest = s;
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/;
  while (rest.length) {
    const m = rest.match(re);
    if (!m) { parts.push({ t: 'text', v: rest }); break; }
    if (m.index > 0) parts.push({ t: 'text', v: rest.slice(0, m.index) });
    if (m[2] !== undefined) parts.push({ t: 'bold', v: m[2] });
    else parts.push({ t: 'italic', v: m[3] });
    rest = rest.slice(m.index + m[0].length);
  }
  return parts;
}

/** Splits real delivered text into typed blocks (heading/list/table/hr/
 * paragraph), blank-line-separated — matching normal markdown block rules.
 * Pure data out (no JSX here); the caller renders it. */
export function parseLightMarkdown(text) {
  const raw = String(text).replace(/\r\n/g, '\n').trim();
  const blocks = raw.split(/\n{2,}/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    const headingMatch = lines.length === 1 && lines[0].match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      out.push({ type: 'heading', level: headingMatch[1].length, inline: parseInline(headingMatch[2]) });
      continue;
    }

    if (lines.length === 1 && /^(-{3,}|\*{3,})$/.test(lines[0])) {
      out.push({ type: 'hr' });
      continue;
    }

    const isTable = lines.length >= 2 && lines.every((l) => l.startsWith('|')) && /^\|?[\s:|-]+\|?$/.test(lines[1] || '');
    if (isTable) {
      const cells = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const header = cells(lines[0]);
      const rows = lines.slice(2).map(cells);
      out.push({ type: 'table', headerInline: header.map(parseInline), rows: rows.map((r) => r.map(parseInline)) });
      continue;
    }

    const bulletRe = /^([-*]|\d+\.)\s+(.*)$/;
    if (lines.every((l) => bulletRe.test(l))) {
      out.push({
        type: 'list',
        ordered: /^\d+\./.test(lines[0]),
        items: lines.map((l) => parseInline(l.match(bulletRe)[2])),
      });
      continue;
    }

    out.push({ type: 'paragraph', inline: parseInline(lines.join(' ')) });
  }
  return out;
}
