"""Authoritative readbacks: the ToolBond views that prove the v3 invariants, read with gen_call.

Prints Markdown with the accounting (and whether it reconciles with the contract's balance), every
server's pins with assurance and owner proof, and every challenge's outcome.

    python3 scripts/readback.py [--contract 0x...] > docs/evidence/v3-readbacks.md
"""

import argparse
import json
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))

import genlayer_read  # noqa: E402
from toolbond_guard import DEFAULT_CONTRACT, DEFAULT_RPC  # noqa: E402


def gen(wei: str) -> str:
    value = int(wei)
    return f"{value / 10**18:g} GEN"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", default=DEFAULT_CONTRACT)
    parser.add_argument("--rpc", default=DEFAULT_RPC)
    args = parser.parse_args()

    def view(method, *call_args):
        for attempt in range(4):
            time.sleep(2.5 * attempt + 0.6)  # Studio Next: 20 reads per 10 s per contract, 30 per minute per client
            try:
                return json.loads(genlayer_read.read_view(args.rpc, args.contract, method, list(call_args)))
            except genlayer_read.ReadError:
                if attempt == 3:
                    raise

    books = view("get_accounting")
    constants = view("get_constants")
    servers = view("list_servers", 0, 50)["items"]
    challenges = view("list_challenges", "")["items"]
    out = [
        "# Contract readbacks (ToolBond v3)",
        "",
        f"Read {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())} with `gen_call` from `{args.contract}` through "
        f"`{args.rpc}` (version {constants['VERSION']}, treasury `{constants['treasury']}`).",
        "",
        "## get_accounting",
        "",
        "| balance | bonded | pool | claimable_total | staked | held | conserved |",
        "|---|---|---|---|---|---|---|",
        f"| {gen(books['balance'])} | {gen(books['bonded'])} | {gen(books['pool'])} | {gen(books['claimable_total'])} | "
        f"{gen(books['staked'])} | {gen(books['held'])} | **{str(books['conserved']).lower()}** |",
        "",
        "## get_pins, per server",
        "",
        "| Server | Status | Tier | Assurance | Bond | Owner verified | Verdicts |",
        "|---|---|---|---|---|---|---|",
    ]
    for item in servers:
        pins = view("get_pins", item["url"])
        verdicts = ", ".join(f"{k}: {v}" for k, v in sorted(pins["verdicts"].items()))
        out.append(f"| `{item['url']}` | {pins['status']} | {pins['tier']} | **{pins['assurance']}** | {gen(pins['bond'])} | "
                   f"{str(pins['owner_verified']).lower()} | {verdicts} |")
    out += ["", "## Challenges", "", "| cid | Server | Kind | Drift | Verdict | Hunter | Payout |", "|---|---|---|---|---|---|---|"]
    for c in reversed(challenges):
        payout = ", ".join(f"{k} {gen(v)}" for k, v in c["payout"].items() if int(v))
        out.append(f"| {c['cid']} | `{c['sid']}` | {c['kind']} | {c['drift']} | {c['verdict']} | `{c['hunter'][:10]}…` | {payout} |")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
