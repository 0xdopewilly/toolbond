# Contract readbacks (ToolBond v3)

Read 2026-10-15 12:05:40 UTC with `gen_call` from `0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b` through `https://studio-dev.genlayer.com/api` (version 3, treasury `0xa09e3fb12ef1495a607835778bf1cc5a786a99eb`).

## get_accounting

| balance | bonded | pool | claimable_total | staked | held | conserved |
|---|---|---|---|---|---|---|
| 22.7 GEN | 10 GEN | 5 GEN | 7.7 GEN | 0 GEN | 22.7 GEN | **true** |

## get_pins, per server

| Server | Status | Tier | Assurance | Bond | Owner verified | Verdicts |
|---|---|---|---|---|---|---|
| `https://toolbond-demo-mcp.vercel.app/mcp/update?at=2026-10-15T12:00:00Z` | ACTIVE | BONDED | **BONDED** | 10 GEN | true | get_forecast: SAFE |
| `https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=2026-10-15T11:40:00Z` | SLASHED | BONDED | **UNDERCOLLATERALIZED** | 0 GEN | false | get_forecast: SAFE |
| `https://mcp.deepwiki.com/mcp` | ACTIVE | REVIEWED | **REVIEWED** | 0 GEN | false | ask_wiki_question: SAFE, read_wiki_contents: SAFE, read_wiki_structure: SAFE |
| `https://docs.mcp.cloudflare.com/mcp` | ACTIVE | REVIEWED | **REVIEWED** | 0 GEN | false | migrate_pages_to_workers_guide: SAFE, search_cloudflare_documentation: SAFE |
| `https://gitmcp.io/modelcontextprotocol/python-sdk` | ACTIVE | REVIEWED | **REVIEWED** | 0 GEN | false | fetch_generic_url_content: SAFE, fetch_python_sdk_documentation: SAFE, search_python_sdk_code: SAFE, search_python_sdk_documentation: SAFE |
| `https://mcp.internetcourt.org/mcp` | ACTIVE | REVIEWED | **REVIEWED** | 0 GEN | false | consult_internet_court: SAFE, get_internet_court_skill: SAFE, how_to_install: SAFE |

## Challenges

| cid | Server | Kind | Drift | Verdict | Hunter | Payout |
|---|---|---|---|---|---|---|
| c1 | `64117771723f65cd` | DRIFT | DIFFERS | POISONED | `0x8fb5c97a…` | hunter 5.5 GEN, pool 5 GEN |
| c2 | `b2a2cf33d3f78396` | DRIFT | DIFFERS | SAFE | `0x8fb5c97a…` | hunter 1 GEN |
