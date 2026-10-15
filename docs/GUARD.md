# toolbond-guard: trust model

toolbond-guard (`lib/toolbond_guard.py`) is a local MCP proxy. It shows the model only the tools
whose exact canonical text (TBCM-1) is pinned on ToolBond and judged SAFE. This document says where
those approvals come from, what each source is trusted for, and how the guard behaves when a
source fails or lies.

## Scope

The guard protects **manifest integrity**: the tool text the model reads is the text validators
fetched, pinned and judged. It does not inspect what a tool does when called, what it returns, or
the server's code. It does not make a server's operator known either. A registrant is whoever paid
to register the URL; only `owner_verified` says the server itself names them (below).

## Approval sources

On every refresh (each `tools/list`, each `tools/call`, and every `--poll` seconds) the guard asks
for the server's `get_pins` JSON. Sources are tried in this order, and every decision records which
one answered (`approval_source`, and `approval` in `toolbond_status`).

| Source | Used when | Trust assumption | Default |
|---|---|---|---|
| `contract` | always tried first | the RPC endpoint (`--rpc`) reports contract state honestly. Studio Next is a hosted preview network; run your own node to remove this assumption | on |
| `contract-cache` | the contract read failed | the last successful contract read, at most N minutes old; revocations made since then are not seen | off, `--cache-minutes N` |
| `trusted-relay` | the contract read failed (and the cache was empty or off) | the relay operator. Its answer is not verified against the contract | off, `--relay URL` |
| `relay-snapshot` | the relay only has a stored snapshot (`source: "snapshot"` or `authoritative: false`) | stored view outputs from `as_of`, not current state | refused, `--accept-snapshot-hours N` |
| `operator-file` | `--pins-file` is given (chain reads are skipped) | whoever wrote the file | off |
| `none` | nothing above produced an answer for this URL | no tool is allowed | |

Contract reads use `gen_call` with GenLayer calldata (`lib/genlayer_read.py`, standard library
only): the guard sends `{"": "get_pins", "args": [url]}` to the configured contract and decodes the
result. An answer whose `url` differs from the guarded server is ignored, from any source.

## Allow rules

A tool is allowed only when the approval came from one of the sources above and:

1. the server is known, with status `ACTIVE` or `STALE`;
2. with `--bonded-only`, `assurance` is `BONDED` (a bond at or above the 10 GEN minimum right now).
   Version 2 pins carry no `assurance` field, so they cannot satisfy this flag;
3. with `--owner-verified-only`, `owner_verified` is true;
4. the tool's live TBCM-1 hash equals its pinned hash, and its verdict is `SAFE`;
5. its name is not `toolbond_status`, which the guard reserves for itself.

## Failure behaviour

| Situation | Default behaviour | Test (`tests/test_guard_trust.py`) |
|---|---|---|
| RPC unreachable or returns an error or garbage | every tool blocked; `approval.source` is `none` with the error | `test_rpc_outage_fails_closed_by_default`, `test_guard_reads_get_pins_over_gen_call`, `test_unreachable_rpc_blocks` |
| A relay says ACTIVE while the contract says SLASHED | the contract answer is used; the relay is not even asked | `test_a_false_active_from_a_relay_never_overrides_the_contract` |
| The contract read fails and a relay is configured | the relay answers, labelled `trusted-relay`, `verified: false` | `test_a_relay_is_opt_in_and_labelled_unverified` |
| A relay serves a stored snapshot | refused; accepted only with `--accept-snapshot-hours` and only while younger than that | `test_reconstructed_snapshots_are_refused_unless_accepted_and_fresh` |
| An answer is about another URL | refused | `test_answers_for_another_server_are_refused` |
| A server is revoked on chain during an RPC outage | blocked (no cache by default); with `--cache-minutes`, the cached approval stands until the cache expires or the next successful read | `test_stale_revocations_and_expired_caches` |
| The cache is older than its window, or came from another contract | not used | `test_an_expired_cache_is_not_used`, `test_a_cache_from_another_contract_is_not_used` |
| Status changes on chain (SLASHED, PENDING_REVIEW, EXITING, REJECTED) | applied on the next refresh; the client is told to refresh its tool list | `test_on_chain_status_changes_apply_on_the_next_refresh` |
| The bond falls below the minimum | still allowed by default (pinned and SAFE); blocked with `--bonded-only` | `test_collateral_and_ownership_rules` |
| The upstream manifest changes mid-session | the changed tool disappears at once and calls to it are refused | `tests/test_guard.py::test_rug_pull_mid_session_notifies_and_blocks` |

## Ownership

A registrant proves they operate a server by putting `toolbond-owner:<their address>` in the
server's MCP `instructions` (returned by `initialize`). Validators fetch the instructions when they
pin, so the proof is part of the hashed manifest, and the contract sets `owner_verified` only when
the address equals the publisher. A new registrant never inherits an earlier one's proof.

## The site's relay

`https://toolbond.vercel.app/api/pins?url=` returns the contract's `get_pins` read for that
request (`source: "contract"`, `authoritative: true`, with the RPC used). If the read fails it
returns the stored copy of the views (`source: "snapshot"`, `authoritative: false`). To a guard,
both are relay answers: it uses them only with `--relay`, and refuses the snapshot unless
`--accept-snapshot-hours` is set.
