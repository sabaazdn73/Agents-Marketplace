// docsMarkdown.js
//
// A small, hand-rolled markdown parser for the /docs viewer, in the same
// spirit as deliverableFormat.js's parseLightMarkdown (no markdown library
// pulled in for this) but extended to cover what the real docs/*.md files
// actually use, which parseLightMarkdown doesn't: fenced code blocks
// (```lang ... ```, including ```mermaid, handled specially by the
// renderer), inline code, and links — all real, load-bearing syntax in
// these files (grepped and confirmed before writing this). Nested lists
// and blockquotes are NOT supported because a real check of every docs/
// file found neither pattern actually in use — no point building for
// syntax that isn't there.
//
// Unlike parseLightMarkdown (which splits on blank lines), this is a real
// line-by-line state machine, because a fenced code block can itself
// contain blank lines, which a blank-line block-splitter would misparse.

// GitHub/GitBook's real slug algorithm: lowercase, strip anything that
// isn't a word char/space/hyphen (no replacement), then map each
// individual space to a hyphen WITHOUT collapsing runs — two consecutive
// spaces (e.g. either side of a removed em-dash) really do produce a
// double hyphen. This has to match exactly, because the docs/*.md files
// already contain real hand-written anchor links (e.g.
// `limitations.md#altana-passkey-session-hiring--built-and-correct-...`)
// that depend on this exact behavior.
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

function stripInlineMarkdown(s) {
  return s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1');
}

// Splits inline text into { t: 'text'|'code'|'link'|'bold'|'italic', v, href? }
// segments. Code spans are matched first so `**not bold**` inside a code
// span isn't mistaken for real bold markup.
const INLINE_RE = /(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*\*(.+?)\*\*)|(\*(.+?)\*)/;
export function parseInline(s) {
  const parts = [];
  let rest = s;
  while (rest.length) {
    const m = rest.match(INLINE_RE);
    if (!m) {
      parts.push({ t: 'text', v: rest });
      break;
    }
    if (m.index > 0) parts.push({ t: 'text', v: rest.slice(0, m.index) });
    if (m[2] !== undefined) parts.push({ t: 'code', v: m[2] });
    else if (m[4] !== undefined) parts.push({ t: 'link', v: m[4], href: m[5] });
    else if (m[7] !== undefined) parts.push({ t: 'bold', v: m[7] });
    else if (m[9] !== undefined) parts.push({ t: 'italic', v: m[9] });
    rest = rest.slice(m.index + m[0].length);
  }
  return parts;
}

const BULLET_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

export function parseDocsMarkdown(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block: ```lang ... ``` (blank lines inside are real
    // content here, not block separators, which is the whole reason this
    // is a line-by-line parser rather than a blank-line splitter).
    const fenceMatch = line.match(/^```(\S*)\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence
      const content = codeLines.join('\n');
      blocks.push(lang === 'mermaid' ? { type: 'mermaid', content } : { type: 'code', lang, content });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const raw = headingMatch[2];
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        id: slugify(stripInlineMarkdown(raw)),
        inline: parseInline(raw),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Table: consecutive `|`-led lines, second line a separator row
    if (line.trim().startsWith('|')) {
      const tableLines = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        tableLines.push(lines[j].trim());
        j++;
      }
      if (tableLines.length >= 2 && /^\|?[\s:|-]+\|?$/.test(tableLines[1])) {
        const toCells = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
        const header = toCells(tableLines[0]).map(parseInline);
        const rows = tableLines.slice(2).map((l) => toCells(l).map(parseInline));
        blocks.push({ type: 'table', header, rows });
        i = j;
        continue;
      }
      // Not a real table (no separator row) — falls through to paragraph handling below.
    }

    // List: consecutive bullet/numbered lines
    if (BULLET_RE.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(parseInline(lines[i].match(BULLET_RE)[3]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph: consume consecutive plain lines up to the next special block
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^(-{3,}|\*{3,})\s*$/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith('|') &&
      !BULLET_RE.test(lines[i])
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', inline: parseInline(paraLines.join(' ')) });
    } else {
      i++; // safety valve — never loop forever on an unhandled line
    }
  }

  return blocks;
}
