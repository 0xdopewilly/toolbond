# Guard while the bond is under the minimum (ToolBond v3)

Recorded 2026-10-15 12:02 UTC, after challenge c2 settled the harmless update as SAFE (5% of the bond to the hunter) and before the publisher topped up. The server is STALE with assurance UNDERCOLLATERALIZED, and its live manifest is the revised one, which is not pinned yet.

## Default settings

`toolbond-guard https://toolbond-demo-mcp.vercel.app/mcp/update?at=2026-10-15T12:00:00Z `

- Tools shown to the model: `toolbond_status`
- Approval source: `contract`; assurance `UNDERCOLLATERALIZED`
- `get_forecast`: blocked (tool changed since it was pinned)

## --bonded-only

`toolbond-guard https://toolbond-demo-mcp.vercel.app/mcp/update?at=2026-10-15T12:00:00Z --bonded-only`

- Tools shown to the model: `toolbond_status`
- Approval source: `contract`; assurance `UNDERCOLLATERALIZED`
- `get_forecast`: blocked (assurance is UNDERCOLLATERALIZED, not BONDED (--bonded-only))

