# Evidence for ToolBond v3

Everything here can be checked against the chain without trusting this repository.

| File | What it is | How to verify it |
|---|---|---|
| `v3-lifecycle.jsonl` | every write the maintainer sent during the v3 run, one JSON line each (label, signer, hash, status, votes, returned value) | look up each hash on the explorer, or rebuild `v3-transactions.md` with `scripts/tx_index.py` |
| `v3-patrol.jsonl` | the patrol bot's own log while it watched the six v3 servers, signed by a separate hunter address | the `tx` hashes resolve on chain to the hunter's challenge, observe, judge and settle calls |
| `v3-transactions.md` | every v3 transaction above, decoded from `eth_getTransactionByHash`: sender, method, arguments, value, status, votes | `python3 scripts/tx_index.py --contract 0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b --markdown /tmp/t.md` and compare |
| `v3-readbacks.md` | contract view outputs read with `gen_call` after the run: `get_accounting`, `get_pins`, `get_challenge` | `python3 scripts/readback.py` (same reads, current state) |
| `v3-guard-*.md` | the real guard CLI run as an MCP client against the live servers, with its approval source for each scenario | `python3 scripts/guard_evidence.py --out /tmp/g.md` |
| `v3-servers.txt` | the URLs the patrol bot watched | |

Accounts:

| Role | Address |
|---|---|
| Publisher and sponsor (dev account) | `0xe258d2604aec1321ddd58f179001cc6a8c442930` |
| Hunter (patrol bot) | `0x8fb5c97a1a90675caec56a12e1f20cebf7b68be7` |
| Treasury | `0xa09e3fb12ef1495a607835778bf1cc5a786a99eb` |

Limitations of the network, stated plainly:

- Studio Next is a hosted preview network that can be reset. Contract reads (`gen_call`) work
  during this run but were unavailable network-wide on 2026-10-13 and 14; when they fail, the site
  says so and the guard blocks by default.
- Studio Next limits `gen_call` to 20 reads per 10 seconds per contract. Under heavier load than
  that, reads fail and the guard fails closed (or uses the cache an operator opted into).
- A contract read is as honest as the RPC node that answers it; these readbacks used the public
  Studio Next endpoint.
