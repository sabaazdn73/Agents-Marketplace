// connectMarks.js
//
// The clients that can point at this project's MCP server, and the marks shown
// beside their names on the How It Works page. Data only; HowItWorksPage.jsx
// renders it.
//
// THE STANDARD, which is the one dataSources.js already holds every logo to
// ---------------------------------------------------------------------------
// 1. A client is listed only if its OWN documentation says it connects to a
//    REMOTE MCP server over HTTP. Supporting MCP is not enough: a client that
//    can only spawn a local process cannot reach this server, and listing it
//    would be wrong. Each entry carries the page that was read and the date.
// 2. A mark is the vendor's own asset from the vendor's own domain. Not a
//    favicon proxy, not an icon set, not a CDN aggregator. No build hash or
//    content hash in the path, because that URL changes on their next deploy.
// 3. Every asset below was pulled and inspected on 2026-09-17, not assumed:
//    HTTP status, the bytes through `file`, and the real dimensions. Three
//    candidate URLs returned 200 with an HTML error page in the body
//    (cursor.com/icon.png, cursor.com/favicon-32x32.png,
//    windsurf.com/apple-touch-icon.png), which is exactly the failure this
//    check exists to catch and the reason none of them is used here.
// 4. Mean luminance of the non-transparent pixels was measured for each mark
//    to decide dark-background legibility rather than eyeballing it. Where a
//    mark fails on one background, the vendor's own opposite-tone asset is
//    used as `markDark`; nothing here is recoloured, inverted or otherwise
//    altered, because altering a mark is exactly what trademark terms are
//    about.
// 5. Where a vendor's terms do not permit showing the mark, or no asset could
//    be verified, the client is listed BY NAME with no image. Being on this
//    list is a statement about what connects to the server, and that statement
//    does not depend on having a picture.
//
// WHAT IS DELIBERATELY ABSENT
// Warp: its MCP overview names Streamable HTTP, but its URL-server type is
// described as a server "that supports Server-Sent Events". This server
// answers GET with 405 and opens no stream, so a Warp connection might not
// work at all. Not listed until somebody connects one end to end.
// Claude on mobile: the custom-connectors article names the web app, Cowork
// and Desktop, and nothing extends it to mobile.

/** The extension's own icon, copied from extension/icons/tnega-128.png into
 *  public/ so it is served from this site at a fixed path. A file in public/
 *  is served verbatim by Vite with no content hash, which is the same rule the
 *  marks below are held to. 128x128 PNG with transparency. */
export const EXTENSION_MARK = '/extension-mark-128.png';

export const MCP_CLIENTS = [
  {
    name: 'Claude Code',
    // NO MARK, on purpose, and this is the one entry where the absence is a
    // decision rather than a gap. Both pages were read on 2026-09-17. The
    // trademark guidelines say the marks may be used "only in materials we
    // approve beforehand". The Claude Code legal page permits saying
    // accurately, in plain text, that a product runs Claude Code, and forbids
    // the names or logos in a way that suggests Anthropic endorses or is
    // partnered with the product, adding that any other use requires written
    // permission. A name in a list of clients is the permitted half of that;
    // the logo is the half that needs approval, so it is not shown.
    // https://www.anthropic.com/legal/trademark-guidelines
    // https://code.claude.com/docs/en/legal-and-compliance
    mark: null,
    support: 'Remote MCP over HTTP, the transport its own documentation recommends',
    howTo: 'claude mcp add --transport http tnega <the endpoint above>, or the same '
      + 'entry in .mcp.json. Read 2026-09-17 at code.claude.com/docs/en/mcp',
  },
  {
    name: 'Claude apps',
    mark: null,
    support: 'Custom connectors in the web app, Desktop and Cowork are remote MCP servers',
    howTo: 'Settings, then Connectors, then Add custom connector, and paste the endpoint. '
      + 'Read 2026-09-17 at support.claude.com. Not available on mobile.',
  },
  {
    name: 'OpenAI',
    // NO MARK for a different reason: every candidate asset on openai.com and
    // chatgpt.com answered 403 to a direct request on 2026-09-17, so no bytes
    // could be checked. An unverified image is not shown here on the strength
    // of it probably being right.
    mark: null,
    support: 'The Responses API and Agents SDK call remote MCP servers over Streamable HTTP',
    howTo: 'A tool block of {"type":"mcp","server_label":"tnega","server_url":"<the endpoint '
      + 'above>"}. In ChatGPT itself, developer mode adds an HTTPS server by URL. '
      + 'Read 2026-09-17 at developers.openai.com',
  },
  {
    name: 'Cursor',
    // cursor.com/apple-touch-icon.png: 200, real PNG, 180x180 RGBA, 7,047 B,
    // mean luminance 53 at 95% opaque, which is a dark tile carrying its own
    // shape and a light glyph, so it holds on both backgrounds. The root
    // favicon.ico is the same mark at 256x256 and 116 KB, which is sixteen
    // times the bytes for a 17px slot.
    mark: 'https://cursor.com/apple-touch-icon.png',
    support: 'Streamable HTTP, listed as one of its three transports',
    howTo: '{"mcpServers":{"tnega":{"url":"<the endpoint above>"}}} in ~/.cursor/mcp.json or '
      + '.cursor/mcp.json. Note the shape: a url, no type. Read 2026-09-17 at '
      + 'cursor.com/docs/context/mcp',
  },
  {
    name: 'VS Code',
    // code.visualstudio.com/apple-touch-icon.png: 200, PNG, 256x256 RGBA,
    // 13,468 B, luminance 120 at 55% opaque, the blue mark, legible on both.
    // Microsoft's brand page permits the icon in documentation and forbids
    // using it to promote your own product or to imply association, so it
    // appears here inside instructions for connecting, and nowhere else on
    // this site. https://code.visualstudio.com/brand
    mark: 'https://code.visualstudio.com/apple-touch-icon.png',
    support: 'MCP servers of type http, through Copilot Chat',
    howTo: '{"servers":{"tnega":{"type":"http","url":"<the endpoint above>"}}} in '
      + '.vscode/mcp.json. Note servers, not mcpServers. Read 2026-09-17 at '
      + 'code.visualstudio.com/docs/copilot/chat/mcp-servers',
  },
  {
    // Named for both, because the product is mid-rename and a reader knows it
    // by one name or the other. Checked 2026-09-17: windsurf.com answers 308
    // to devin.ai/desktop and docs.windsurf.com/windsurf/cascade/mcp answers
    // 308 to docs.devin.ai/desktop/cascade/mcp, whose text uses both names.
    name: 'Windsurf, now Devin Desktop',
    // windsurf.com/favicon.ico: 200, real ICO, one 48x48 image, 9,662 B,
    // luminance 214 at 100% opaque, a cream tile that holds its own shape on
    // both backgrounds. It still answers 200 with real bytes even though the
    // page at that host redirects, and it is the only asset of theirs that
    // does: every PNG path tried on windsurf.com returns an HTML page. An
    // .ico in an <img> is the case dataSources.js flagged as inconsistent
    // between browsers; if it fails to decode the name still renders, which
    // is the fallback in ClientMark. This is the one mark here whose host is
    // a redirect shell for a renamed product, so it is the first to re-check.
    mark: 'https://windsurf.com/favicon.ico',
    support: 'Streamable HTTP servers, in the Cascade agent',
    howTo: '{"mcpServers":{"tnega":{"serverUrl":"<the endpoint above>"}}} in '
      + '~/.codeium/windsurf/mcp_config.json. Note serverUrl, not url. The page documenting '
      + 'this says it applies to the Cascade agent, which is not the default agent in a new '
      + 'tab. Read 2026-09-17 at docs.devin.ai/desktop/cascade/mcp',
  },
  {
    name: 'Zed',
    // A vendor-published pair, declared by Zed itself with
    // prefers-color-scheme: favicon_black_32.png is luminance 0.9, invisible
    // on a dark background, and favicon_white_32.png is 255, invisible on a
    // light one. 927 B and 687 B, both 32x32 PNG. Zed's brand page asks that
    // nothing imply an official connection or endorsement, which a list of
    // clients that can connect does not. https://zed.dev/brand
    mark: 'https://zed.dev/favicon_black_32.png',
    markDark: 'https://zed.dev/favicon_white_32.png',
    support: 'Remote context servers by url, with the standard MCP OAuth prompt',
    howTo: '{"context_servers":{"tnega":{"url":"<the endpoint above>"}}} in settings.json. '
      + 'Note context_servers. Read 2026-09-17 at zed.dev/docs/ai/mcp',
  },
  {
    name: 'Cline',
    // Also a vendor-published pair, under /assets/branding/logos/. The names
    // describe the ink rather than the background: cline-icon-dark.svg is
    // filled #1C1C24 and belongs on a light background, cline-icon-white.svg
    // is filled white and belongs on a dark one. 3,458 B and 3,452 B.
    mark: 'https://cline.bot/assets/branding/logos/cline-icon-dark.svg',
    markDark: 'https://cline.bot/assets/branding/logos/cline-icon-white.svg',
    support: 'Remote servers of type streamableHttp',
    howTo: 'MCP Servers, then Remote Servers, then a name and the endpoint. In the settings '
      + 'file the type is streamableHttp. Read 2026-09-17 at docs.cline.bot',
  },
  {
    name: 'goose',
    // goose-docs.ai/img/favicon.ico: 200, served as an icon type but the bytes
    // are PNG, 40x40 RGBA, 2,906 B, luminance 197 at 71% opaque: a light disc
    // with a dark bird, which reads on both backgrounds without a second
    // asset. The domain is first-party by two independent checks on
    // 2026-09-17: block.github.io/goose redirects to it, and the GitHub
    // repository's own homepage field is goose-docs.ai.
    mark: 'https://goose-docs.ai/img/favicon.ico',
    support: 'Remote Extension over Streamable HTTP, a first-class extension type',
    howTo: 'goose configure, then Add Extension, then Remote Extension (Streamable HTTP), '
      + 'then paste the endpoint. Read 2026-09-17 at goose-docs.ai',
  },
  {
    name: 'JetBrains IDEs',
    // NO MARK, and this one is a linking rule rather than a display rule.
    // JetBrains' terms of use say you may not link directly to their logo
    // files, which is the pattern every other mark on this site uses, and
    // self-hosting a copy would break the rule this file opens with. So the
    // name stands alone. https://www.jetbrains.com/legal/docs/company/useterms
    mark: null,
    support: 'AI Assistant connects to an MCP server over Streamable HTTP',
    howTo: 'Settings, then Tools, then AI Assistant, then Model Context Protocol, and add '
      + '{"mcpServers":{"tnega":{"url":"<the endpoint above>"}}}. Documented for AI '
      + 'Assistant 2026.2; read 2026-09-17 at jetbrains.com/help/ai-assistant',
  },
];
