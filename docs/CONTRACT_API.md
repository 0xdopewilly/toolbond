# ToolBond contract interface (v3)

The single source of truth shared by the contract (`contracts/src/toolbond.py`),
`@toolbond/guard`, the patrol bot and the web app. Change it here first.

## Network

| | |
|---|---|
| Network | GenLayer Studio Next, chain id `61997` (`0xf22d`) |
| RPC | `https://studio-dev.genlayer.com/api` |
| Explorer | `https://explorer-studio-dev.genlayer.com` |
| JS SDK | `genlayer-js@2.0.0-rc.1`, chain `studioDevnet` |
| Contract address | `0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b` (v3; earlier versions in docs/DEPLOYMENTS.md) |

Every write on Studio Next needs explicit fees: estimate them with
`estimateTransactionFees` (or the CLI's `genlayer estimate-fees --json`) and pass
`fees` plus `value`. A fee deposit of about 0.1 GEN per transaction is normal;
unused budget is refunded. Writes take tens of seconds when validators fetch the
web or call an LLM, so wait with `retries`/`interval` well above the SDK default.

## Units and identifiers

- Amounts are integers in wei (18 decimals). Views return them as decimal strings.
- `sid` (server id) = first 16 hex chars of `sha256(utf8(url))`, with `url` stripped of
  surrounding whitespace. Clients can compute it locally.
- `cid` (challenge id) = `"c"` + a sequence number (`"c1"`, `"c2"`, …).
- Tool hashes and roots are lowercase hex SHA-256 of TBCM-1 canonical text
  (see docs/TBCM-1.md).

## Constants

| Name | Value | Meaning |
|---|---|---|
| `MIN_BOND` | 10 GEN | smallest bond for a BONDED server, and the level below which it stops counting as bonded |
| `REVIEW_FEE` | 0.2 GEN | paid to the treasury on `register` and `sponsor_review` |
| `CONTENT_STAKE` | 1 GEN | stake for a CONTENT challenge |
| `DRIFT_STAKE` | 0.5 GEN | stake for a DRIFT challenge |
| `DRIFT_SPAM_FEE` | 0.1 GEN | kept from a DRIFT stake when the manifest still matches |
| `CHALLENGE_TTL` | 72 h | after this a challenge can be expired and refunded |
| `MAX_ATTEMPTS` | 3 | observe or judge attempts before a challenge can be expired |
| `EXIT_DELAY` | 7 days | between `request_exit` and `finalize_exit` |
| `REVIEW_BATCH` | 6 | tools judged per `review` call |
| `OWNER_TAG` | `toolbond-owner:` | prefix of the owner proof in a server's MCP instructions |

## Enumerations

| Field | Values |
|---|---|
| server `tier` | `BONDED`, `REVIEWED` (sponsored review, no bond, never slashed): how it was registered |
| server `assurance` | `BONDED` (bond ≥ `MIN_BOND` now), `UNDERCOLLATERALIZED` (a BONDED registration below it), `REVIEWED` |
| server `status` | `PENDING_SNAPSHOT`, `PENDING_REVIEW`, `ACTIVE`, `STALE`, `REJECTED`, `SLASHED`, `EXITING`, `EXITED` |
| tool `verdict` | `UNREVIEWED`, `SAFE`, `UNCLEAR`, `POISONED` |
| challenge `kind` | `CONTENT` (a pinned tool is poisoned), `DRIFT` (the live manifest no longer matches the pin) |
| challenge `stage` | `FILED`, `OBSERVED`, `JUDGED`, `SETTLED`, `EXPIRED` |
| challenge `drift` | `""`, `MATCH`, `KNOWN`, `DIFFERS`, `UNSTABLE`, `UNPINNED`, `UNREACHABLE` |
| challenge `verdict` | `""`, `SAFE`, `POISONED`, `UNCLEAR` |

## Server lifecycle

```
register / sponsor_review -> PENDING_SNAPSHOT
snapshot (validators fetch tools/list, identical root)  -> PENDING_REVIEW
review (LLM judge, batches of 6 tools):
    any POISONED            -> REJECTED   (10% of bond to treasury, rest claimable)
    all SAFE                -> ACTIVE
    otherwise (UNCLEAR)     -> stays PENDING_REVIEW (publisher fixes the server and re-runs snapshot)
challenge settled against the publisher -> SLASHED or STALE (see payouts; a settle never
    moves a server that is already SLASHED, EXITED or REJECTED)
snapshot by the publisher on ACTIVE (an announced update) or STALE -> PENDING_REVIEW
    (a BONDED server below MIN_BOND must top_up first: no re-pin, no review back to ACTIVE)
request_exit -> EXITING ; finalize_exit after EXIT_DELAY -> EXITED (bond claimable)
```

Collateral: drift settlements can take a bond below `MIN_BOND` (5% to the hunter for a benign
unannounced change, 25% for an unpinned manifest). The server is then `STALE` with assurance
`UNDERCOLLATERALIZED`: still pinned, but no longer counted as bonded by the registry or by guards
running `--bonded-only`. `top_up` restores it; after that the publisher can re-pin and validators
can review it back to `ACTIVE`. A colluding publisher and hunter gain nothing from this loop: every
wei the hunter receives leaves the bond, and restoring BONDED assurance costs exactly that amount.

Drift classes, as validators agree on them in `observe`:

| Class | Meaning | Validator rule |
|---|---|---|
| `MATCH` | the live manifest has the pinned root | identical observation |
| `KNOWN` | the live root is the drift an earlier settled challenge already penalised (`drift_root`) | identical observation |
| `DIFFERS` | the manifest changed, the same way twice in a row | identical observation, so the stored changed tools are verified content |
| `UNSTABLE` | two different manifests in a row | each validator must see `UNSTABLE` itself |
| `UNPINNED` | the server answered, but not with a valid manifest (bad JSON-RPC, invalid Unicode, reserved names, ...) | each validator must see `UNPINNED` itself |
| `UNREACHABLE` | network or HTTP failure | accepted from any leader; changes nothing but a counter |

Changed tools are judged riskiest first (hard red flags, then soft flags), at most
`MAX_CHANGED_TOOLS` (4) per ruling. Code-computed flags cover every changed tool, so a
hard flag anywhere makes SAFE impossible, and when more tools changed than one ruling
covers, a SAFE reading becomes `UNCLEAR`.

## Write methods

Payable methods never raise: on a bad request they credit the sent value to the
caller's claimable balance and return `{"ok": false, "error": "..."}`. Other writes
raise `UserError` with a prefixed message (`[EXPECTED]`, `[EXTERNAL]`,
`[TRANSIENT]`, `[LLM_ERROR]`), which rolls the transaction back.

| Method | Payable | Who | Effect |
|---|---|---|---|
| `register(url: str, purpose: str, caps: str) -> dict` | yes, ≥ `MIN_BOND + REVIEW_FEE` | anyone (becomes publisher) | new BONDED server; returns `{"ok", "sid"}` |
| `sponsor_review(url: str, purpose: str, caps: str) -> dict` | yes, ≥ `REVIEW_FEE` | anyone | new REVIEWED server for a third-party URL |
| `snapshot(sid: str) -> None` | no | anyone while `PENDING_*` or a STALE review; the publisher on ACTIVE/STALE | fetch consensus; stores pins; sets `owner_verified`; clears `drift_root`; status `PENDING_REVIEW`. A BONDED server below `MIN_BOND` is refused (`top_up first`) |
| `review(sid: str) -> None` | no | anyone | judges the next batch of unreviewed pinned tools; refuses a BONDED server below `MIN_BOND` |
| `top_up(sid: str) -> dict` | yes, any amount | publisher of a BONDED server in `PENDING_*`, `ACTIVE` or `STALE` | adds the value to the bond; returns `{"ok", "bond", "assurance"}` |
| `challenge(sid: str, tool: str, kind: str) -> dict` | yes, the stake | anyone (hunter) | `tool` is `""` for DRIFT; at most one open challenge per (sid, tool) |
| `observe(cid: str, mode: str) -> None` | no | anyone | DRIFT only; `mode` must be `content` (presence checks are `attest`) |
| `judge(cid: str) -> None` | no | anyone | CONTENT: judges the pinned tool; DRIFT with `DIFFERS`: judges the verified changed tools |
| `settle(cid: str) -> None` | no | anyone | applies the payout table |
| `expire(cid: str) -> None` | no | anyone | FILED or OBSERVED, after `CHALLENGE_TTL`; refunds the hunter (minus the spam fee after a MATCH or KNOWN observation) |
| `attest(sid: str) -> None` | no | anyone | presence check without a challenge; updates `last_verified_at` / `unreachable` |
| `request_exit(sid: str) -> None` | no | publisher | BONDED: badge drops, challenges stay allowed during the delay; REVIEWED: exits at once, only with no open challenge |
| `finalize_exit(sid: str) -> None` | no | anyone | after `EXIT_DELAY`, no open challenge: bond becomes claimable |
| `withdraw() -> None` | no | anyone | pays the caller's claimable balance |

`purpose` ≤ 280 chars, with no hard red flag (hidden characters or text aimed at
the judge), because it reaches the judge prompt. `caps` is a comma-separated subset of
`none,network,filesystem,credentials,shell,payments`. URLs must be `https://` on a
public domain name (no IP literals, ports, credentials or `#`/`?`/`\` tricks in the
host). A URL can be registered again after `REJECTED` or `EXITED`, and a BONDED
registration replaces a sponsored (REVIEWED) record, as long as no challenge is open.
A tool named `__instructions__` is reserved: a manifest that uses it cannot be pinned.

### Payouts (`settle`)

| Case | Outcome |
|---|---|
| CONTENT, `POISONED` | 100% of the bond slashed: 50% to the hunter, 50% to the protection pool; stake refunded; server `SLASHED` |
| CONTENT, `SAFE` | hunter's stake goes to the publisher |
| CONTENT, `UNCLEAR` | stake refunded; server marked contested |
| DRIFT, `MATCH` or `KNOWN` | stake refunded minus `DRIFT_SPAM_FEE` (to the publisher) |
| DRIFT, `DIFFERS` then `POISONED` | 100% slash split 50/50; server `SLASHED` |
| DRIFT, `DIFFERS` then `SAFE` | 5% of the bond to the hunter; server `STALE` until the publisher re-pins; the live root becomes `drift_root` |
| DRIFT, `DIFFERS` then `UNCLEAR` | stake refunded; server `STALE`; `drift_root` set |
| DRIFT, `UNSTABLE` | 100% slash split 50/50; server `SLASHED` (a pinned manifest passed exact-equality consensus, so serving different ones in a row is a choice) |
| DRIFT, `UNPINNED` | 25% of the bond slashed, split 50/50; server `STALE` |
| DRIFT, `UNREACHABLE` | stake refunded; `unreachable` counter + 1 |

REVIEWED servers have no bond: hunters get their stake back, and the server state
still changes, so guards react.

## Views (all return JSON strings)

`get_pins(url: str)`: what `@toolbond/guard` reads.

```json
{"known": true, "sid": "a1b2c3d4e5f60718", "url": "https://…/mcp", "status": "ACTIVE", "tier": "BONDED",
 "assurance": "BONDED", "bond": "10000000000000000000", "min_bond": "10000000000000000000",
 "owner_verified": true, "root": "<64 hex>", "tools": {"get_forecast": "<64 hex>"},
 "verdicts": {"get_forecast": "SAFE"}, "open_challenges": 0, "drift_root": "",
 "updated_at": "2026-10-15T11:26:36Z", "contract_version": "3"}
```

`assurance` is what clients should act on: `tier` records how the server was registered, while
`assurance` says whether a bond meeting the minimum stands behind it now. `owner_verified` is true
when the pinned instructions contain `toolbond-owner:<publisher address>`; a registrant without it
has not shown that they operate the server.

`drift_root` is the live root of the last drift a settled challenge penalised; a new
DRIFT challenge that finds that same root observes `KNOWN`. `get_server` returns it
too, and `get_challenge` adds `overflow`: changed tools beyond the ones the ruling judged.

`{"known": false, "url": …}` when the URL is not registered.

`get_server(sid: str)`: everything the server page needs.

```json
{"found": true, "sid": "…", "url": "…", "publisher": "0x…", "tier": "BONDED", "status": "ACTIVE",
 "purpose": "…", "caps": "network", "bond": "10000000000000000000", "root": "…", "protocol": "2025-06-18",
 "instructions": "…", "instructions_hash": "…", "flags": {"get_forecast": ["H2", "S3"]},
 "tools": [{"name": "get_forecast", "hash": "…", "canon": "{…}", "verdict": "SAFE", "reason": "…", "quote": ""}],
 "slashes": 0, "unreachable": 0, "created_at": "…", "updated_at": "…", "last_verified_at": "…", "exit_at": ""}
```

`list_servers(offset: int, limit: int)`: `{"total", "offset", "items": [{"sid", "url", "status", "tier", "assurance", "owner_verified", "bond",
"tools", "root", "updated_at", "last_verified_at"}]}`, oldest first, `limit` ≤ 50.

`get_challenge(cid: str)`: `{"found", "cid", "sid", "tool", "kind", "hunter", "stake", "stage", "drift",
"observed_root", "changed": [{"name", "hash", "canon"}], "verdict", "quote", "reason", "attempts",
"filed_at", "updated_at", "payout": {"hunter": "…", "pool": "…", "publisher": "…"}}`.

`list_challenges(sid: str)`: `{"items": [<challenge>…]}`, newest first. `sid = ""` lists all, newest first,
capped at 50.

`get_stats()`: `{"servers", "active", "slashed", "bonded" (wei string), "pool" (wei string), "challenges",
"open_challenges", "pins", "checks"}`.

`get_claimable(address: str)`: wei as a decimal string.

`get_constants()`: the constants table above, wei values as strings, plus `VERSION` and `treasury`.

`get_accounting()`: every wei the contract holds, by purpose.

```json
{"balance": "21700000000000000000", "bonded": "10000000000000000000", "bond_sum": "10000000000000000000",
 "pool": "5000000000000000000", "claimable_total": "6700000000000000000", "staked": "0",
 "held": "21700000000000000000", "conserved": true}
```

`conserved` is `balance == bonded + pool + claimable_total + staked` and `bonded == bond_sum`
(the per-server bonds). Every payable entry point, payout row and withdrawal keeps it true; the
adversarial direct-mode tests check it after each step.

## Client rules

- `@toolbond/guard` reads `get_pins` from the contract (gen_call) on every refresh and allows a
  tool only when `known` is true, `status` is `ACTIVE` or `STALE`, the tool's live TBCM-1 hash
  equals `tools[name]`, and `verdicts[name]` is `SAFE`. `SLASHED`, `REJECTED`, `EXITED` or unknown
  servers block every tool. With `--bonded-only` it also needs `assurance == "BONDED"`; with
  `--owner-verified-only`, `owner_verified`. Relays, caches and snapshots are opt-in fallbacks:
  see docs/GUARD.md.
- Success means status `ACCEPTED`/`FINALIZED` **and** execution result `FINISHED_WITH_RETURN`.
  Undetermined writes changed nothing: show it and offer a retry.
