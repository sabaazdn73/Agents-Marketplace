# tnega-mcp

Adds [Tnega](https://www.tnega.app)'s MCP server to your client.

```
npx tnega-mcp
```

That is the whole install. No key, no account, no sign-up.

## What it does

Writes one config entry, by asking Claude Code's own CLI to write it. It starts
no server, installs no dependency, and runs nothing afterwards. Tnega's MCP
server is hosted and reached over HTTP, so there is nothing to run on your
machine. `bin/tnega-mcp.js` has no dependencies and is short enough to read
before you run it.

```
npx tnega-mcp --print         the config, to paste yourself
npx tnega-mcp --scope user    every project, not just this one
```

## What it connects you to

Six tools over measurements of on-chain agents and of Hyperliquid order
behaviour. Start with `tnega_catalogue`, which lists every dataset, the keys it
accepts, and its live coverage.

Every tool declares `readOnlyHint: true` and `destructiveHint: false`, so a
client that reads annotations can establish that before calling anything. The
server holds no key, signs nothing, and cannot spend or hire.

Every answer carries the coverage behind it. A measurement with nothing behind
it returns a stated reason rather than a zero, and the datasets carry their own
caveats: what a figure does not mean, and where it has been wrong before.
