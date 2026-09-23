#!/usr/bin/env node
//
// Adds Tnega's MCP server to whichever client you use.
//
// WHAT THIS DOES, AND THE SHORTER LIST OF WHAT IT DOES NOT
// It writes one entry into a config file, or asks your client's own CLI to
// write it. That is all. It starts no server, installs no dependency, runs
// nothing afterwards, and holds no key. Tnega's MCP server is hosted and
// reached over HTTP, so there is nothing to run locally, which is why this
// file is the whole package and has no dependencies: you can read it.
//
// The server it points at is read only. Every tool it exposes declares
// readOnlyHint true and destructiveHint false, so a client that checks
// annotations can see that before it calls anything, rather than taking the
// claim from a web page.
//
// WHY THE CLIENT'S OWN CLI, WHERE THERE IS ONE
// An earlier version of this project's docs told people to edit
// ~/.claude/mcp.json. That file does not exist and nothing reads it: Claude
// Code keeps servers in ~/.claude.json, written by its own CLI. Guessing at
// another program's config format is how that happened, so where a client
// ships a CLI this shells out to it and lets it own the format. Where one does
// not, this prints what to paste rather than writing to a path nobody here has
// confirmed.

"use strict";

const { spawnSync } = require("node:child_process");

const NAME = "tnega";
const URL = "https://agents-marketplace-q3k4.onrender.com/mcp";

const CONFIG_JSON = JSON.stringify(
  { mcpServers: { [NAME]: { type: "http", url: URL } } }, null, 2);

const args = process.argv.slice(2);
const has = (...f) => f.some((x) => args.includes(x));

function out(s) { process.stdout.write(s + "\n"); }

function usage() {
  out(`
  tnega-mcp   adds Tnega's MCP server to your client

    npx tnega-mcp                 add it to Claude Code
    npx tnega-mcp --scope user    add it for every project, not just this one
    npx tnega-mcp --print         print the config to paste yourself
    npx tnega-mcp --help

  It writes one config entry and nothing else: no server is started, no
  dependency is installed, nothing runs afterwards. The server is hosted,
  read only, and needs no key.
`);
}

function printConfig() {
  out("\n  Endpoint\n");
  out("    " + URL);
  out("\n  Config, for a client that reads mcpServers\n");
  out(CONFIG_JSON.split("\n").map((l) => "    " + l).join("\n"));
  out("\n  Claude Code has its own command for this:\n");
  out(`    claude mcp add --transport http ${NAME} ${URL}\n`);
  out("  Where that entry belongs differs per client, and this package only");
  out("  claims the one it has checked. Look up the path for yours rather than");
  out("  trusting a guess printed here.\n");
}

function addToClaude() {
  const probe = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (probe.error) {
    out("\n  The claude command is not on PATH, so there is nothing to ask.");
    out("  Install Claude Code, or add the server by hand:");
    printConfig();
    return 1;
  }

  // Already there? Say so and change nothing. Running an installer twice
  // should not be something you have to think about before running it once.
  //
  // 'mcp get <name>' rather than 'mcp list': list health-checks every server
  // configured, which is slow and is not the question, and matching a name
  // against its lines is a prefix test that would read tnega-staging as tnega
  // and then silently skip the install. get names one server, and its exit
  // code is 0 whether or not it exists, so the answer is in the text.
  const got = spawnSync("claude", ["mcp", "get", NAME], { encoding: "utf8" });
  const absent = /No MCP server named/i.test((got.stdout || "") + (got.stderr || ""));
  if (!absent && got.status === 0) {
    out(`\n  ${NAME} is already configured in Claude Code. Nothing changed.`);
    out(`  To point it somewhere else, remove it first: claude mcp remove ${NAME}\n`);
    return 0;
  }

  const scope = has("--scope", "-s")
    ? args[args.findIndex((a) => a === "--scope" || a === "-s") + 1]
    : null;
  const argv = ["mcp", "add", "--transport", "http"];
  if (scope) argv.push("--scope", scope);
  argv.push(NAME, URL);

  out(`\n  claude ${argv.join(" ")}\n`);
  const r = spawnSync("claude", argv, { stdio: "inherit" });
  if (r.status !== 0) {
    out("\n  That did not work. The config, if you would rather do it by hand:");
    printConfig();
    return r.status === null ? 1 : r.status;
  }

  out(`
  Added. Start a new session and ask for tnega_catalogue, which lists every
  measurement and what each one covers. Every answer carries the coverage
  behind it, and a measurement with nothing behind it says why rather than
  returning a zero.
`);
  return 0;
}

if (has("--help", "-h")) { usage(); process.exit(0); }
if (has("--print", "--config")) { printConfig(); process.exit(0); }
process.exit(addToClaude());
