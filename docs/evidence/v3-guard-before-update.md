# Guard integration evidence (ToolBond v3)

Recorded 2026-10-15 11:49 UTC by `scripts/guard_evidence.py`, which runs `lib/toolbond_guard.py` as an MCP client would (initialize, tools/list, toolbond_status). Unless a scenario says otherwise, the guard used its defaults: approvals read from contract `0x7c0be3E1…f2A5b` with gen_call through `https://studio-dev.genlayer.com/api`, no cache, no relay.

## DeepWiki, sponsored review, default settings

`toolbond-guard https://mcp.deepwiki.com/mcp`

- Tools shown to the model: `ask_wiki_question`, `read_wiki_contents`, `read_wiki_structure`, `toolbond_status`
- Approval source: `contract` (verified: true); read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network)
- Assurance: `REVIEWED`
- `ask_wiki_question`: allowed (pinned and judged SAFE)
- `read_wiki_contents`: allowed (pinned and judged SAFE)
- `read_wiki_structure`: allowed (pinned and judged SAFE)

<details><summary>guard log (stderr)</summary>

```
[toolbond-guard] guarding https://mcp.deepwiki.com/mcp; approvals from contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b via https://studio-dev.genlayer.com/api
[toolbond-guard] approvals: contract (read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network))
```

</details>

## DeepWiki with --bonded-only (reviewed, no bond)

`toolbond-guard https://mcp.deepwiki.com/mcp --bonded-only`

- Tools shown to the model: `toolbond_status`
- Approval source: `contract` (verified: true); read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network)
- Assurance: `REVIEWED`
- `ask_wiki_question`: blocked (assurance is REVIEWED, not BONDED (--bonded-only))
- `read_wiki_contents`: blocked (assurance is REVIEWED, not BONDED (--bonded-only))
- `read_wiki_structure`: blocked (assurance is REVIEWED, not BONDED (--bonded-only))

<details><summary>guard log (stderr)</summary>

```
[toolbond-guard] guarding https://mcp.deepwiki.com/mcp; approvals from contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b via https://studio-dev.genlayer.com/api
[toolbond-guard] approvals: contract (read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network))
[toolbond-guard] blocked ask_wiki_question: assurance is REVIEWED, not BONDED (--bonded-only) (live 217e49111cb6)
[toolbond-guard] blocked read_wiki_contents: assurance is REVIEWED, not BONDED (--bonded-only) (live c12cb22490a9)
[toolbond-guard] blocked read_wiki_structure: assurance is REVIEWED, not BONDED (--bonded-only) (live a7cc1371fecf)
```

</details>

## Bonded server with an owner proof, --bonded-only --owner-verified-only

`toolbond-guard https://toolbond-demo-mcp.vercel.app/mcp/update?at=2026-10-15T12:00:00Z --bonded-only --owner-verified-only`

- Tools shown to the model: `get_forecast`, `toolbond_status`
- Approval source: `contract` (verified: true); read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network)
- Assurance: `BONDED`
- `get_forecast`: allowed (pinned and judged SAFE)

<details><summary>guard log (stderr)</summary>

```
[toolbond-guard] guarding https://toolbond-demo-mcp.vercel.app/mcp/update?at=2026-10-15T12:00:00Z; approvals from contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b via https://studio-dev.genlayer.com/api
[toolbond-guard] approvals: contract (read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network))
```

</details>

## The v3 rug pull, slashed on chain

`toolbond-guard https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=2026-10-15T11:40:00Z`

- Tools shown to the model: `toolbond_status`
- Approval source: `contract` (verified: true); read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network)
- Assurance: `UNDERCOLLATERALIZED`
- `get_forecast`: blocked (server status is SLASHED)

<details><summary>guard log (stderr)</summary>

```
[toolbond-guard] guarding https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=2026-10-15T11:40:00Z; approvals from contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b via https://studio-dev.genlayer.com/api
[toolbond-guard] approvals: contract (read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network))
[toolbond-guard] blocked get_forecast: server status is SLASHED (live 174e85b43130)
```

</details>

## An unregistered poisoned server

`toolbond-guard https://toolbond-demo-mcp.vercel.app/mcp/poisoned`

- Tools shown to the model: `toolbond_status`
- Approval source: `contract` (verified: true); read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network)
- Assurance: `NONE`
- `get_forecast`: blocked (server is not registered with ToolBond)

<details><summary>guard log (stderr)</summary>

```
[toolbond-guard] guarding https://toolbond-demo-mcp.vercel.app/mcp/poisoned; approvals from contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b via https://studio-dev.genlayer.com/api
[toolbond-guard] approvals: contract (read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint to report contract state (on Studio Next it is a hosted preview network))
[toolbond-guard] blocked get_forecast: server is not registered with ToolBond (live 174e85b43130)
```

</details>

## DeepWiki while the RPC is unreachable (fails closed)

`toolbond-guard https://mcp.deepwiki.com/mcp --rpc http://127.0.0.1:9/api`

- Tools shown to the model: `toolbond_status`
- Approval source: `none` (verified: false); no approval data could be verified, so every tool is blocked
- Assurance: `NONE`
- Errors: contract read failed: rpc unreachable: <urlopen error timed out>
- `ask_wiki_question`: blocked (server is not registered with ToolBond)
- `read_wiki_contents`: blocked (server is not registered with ToolBond)
- `read_wiki_structure`: blocked (server is not registered with ToolBond)

<details><summary>guard log (stderr)</summary>

```
[toolbond-guard] guarding https://mcp.deepwiki.com/mcp; approvals from contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b via http://127.0.0.1:9/api
[toolbond-guard] blocked ask_wiki_question: server is not registered with ToolBond (live 217e49111cb6)
[toolbond-guard] blocked read_wiki_contents: server is not registered with ToolBond (live c12cb22490a9)
[toolbond-guard] blocked read_wiki_structure: server is not registered with ToolBond (live a7cc1371fecf)
```

</details>

## DeepWiki while the RPC is unreachable, with the site as an opt-in relay

`toolbond-guard https://mcp.deepwiki.com/mcp --rpc http://127.0.0.1:9/api --relay https://toolbond.vercel.app/api/pins`

- Tools shown to the model: `ask_wiki_question`, `read_wiki_contents`, `read_wiki_structure`, `toolbond_status`
- Approval source: `trusted-relay` (verified: false); answered by a relay you configured, not verified against the contract; you trust its operator
- Assurance: `REVIEWED`
- `ask_wiki_question`: allowed (pinned and judged SAFE)
- `read_wiki_contents`: allowed (pinned and judged SAFE)
- `read_wiki_structure`: allowed (pinned and judged SAFE)

<details><summary>guard log (stderr)</summary>

```
[toolbond-guard] guarding https://mcp.deepwiki.com/mcp; approvals from contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b via http://127.0.0.1:9/api, trusted relay https://toolbond.vercel.app/api/pins as fallback
[toolbond-guard] approvals: trusted-relay (answered by a relay you configured, not verified against the contract; you trust its operator)
```

</details>

