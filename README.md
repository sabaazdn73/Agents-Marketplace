# F2F Agents

An agent marketplace for BNB Smart Chain, built for BNB Chain's "Smart
Money Era" hackathon (Build the Era, Aug 5 – Sep 9 2026). Third project
in the F2F family, alongside F2F Cross-Border and OnChain Oversight.

## Status

Frontend: built (web + genuinely separate mobile), covers all 4 required
categories (Rebalancing, Grid Trading, Yield Optimisation, Health Factor
Monitoring) plus an Agent Advantage Report view for the TermiX track.

Backend: scaffolded, NOT yet verified against a live BSC testnet
connection. Every adapter function is stubbed with `NotImplementedError`
and a clear note on what needs live verification first, the same
verify-before-trusting discipline used throughout this project's other
work, not guessed-and-shipped code.

## Structure

```
frontend/
  AgentMarketplaceApp.web.jsx      desktop, dense grid + Advantage Report
  AgentMarketplaceApp.mobile.jsx   mobile, ticker-list pattern (not a shrunk grid)
  wagmiConfig.js                   wallet connection, BSC testnet + mainnet

backend/
  core/                            chain-agnostic logic, never touches an SDK directly
    categorize.py                  buckets agents into the 4 required categories
    advantage_report.py            validates the TermiX-required comparison report
  adapters/
    bsc.py                         the ONLY file that calls bnbagent-sdk
  requirements.txt
```

## Why core/ and adapters/ are split

If this ever expands to another chain, that chain gets its own
`adapters/<chain>.py`. `core/` doesn't change. Don't put chain-specific
calls anywhere outside `adapters/`.

## Security

Testnet only until explicitly stated otherwise. See the project's
separate security-rules document for the full policy (keys, mainnet
gating, review requirements before real funds are at risk).

## Next steps

1. Set up a dedicated testnet wallet for this project (not shared with
   any other project's wallet).
2. Get a BSC testnet RPC URL + tBNB from the faucet.
3. Build `debug_bnbagent_sdk.py`: verify the real `bnbagent-sdk` call
   shapes against that live connection before trusting `adapters/bsc.py`.
4. Register for an 8004scan Developer Hub API key (free Pro tier for
   hackathon participants) to pull real registered-agent data through
   `core/categorize.py`.
5. Fill the Agent Advantage Report with real task runs (not
   placeholders), `core/advantage_report.py` will tell you if it's
   complete enough to submit.
