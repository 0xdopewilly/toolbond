"""Build apps/web/data/snapshot.json: a stored copy of the ToolBond contract's own view outputs.

Every value is what a contract view returned through gen_call at `snapshot_at` (list_servers,
get_server, list_challenges, get_stats, get_accounting, get_pins). Nothing is reconstructed. The
web app shows it only when live reads fail for a request, labelled as stored and not
authoritative, and the guard refuses it unless run with --accept-snapshot-hours.

Usage: python3 scripts/snapshot_state.py [--contract 0x...] [--rpc URL]
"""

import argparse
import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))

import genlayer_read  # noqa: E402
from toolbond_guard import DEFAULT_RPC  # noqa: E402

CONTRACT = "0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b"  # ToolBond v3 (earlier versions: docs/DEPLOYMENTS.md)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", default=CONTRACT)
    parser.add_argument("--rpc", default=DEFAULT_RPC)
    args = parser.parse_args()

    def view(method: str, *call_args):
        return json.loads(genlayer_read.read_view(args.rpc, args.contract, method, list(call_args)))

    listed = view("list_servers", 0, 50)
    servers = {item["sid"]: view("get_server", item["sid"]) for item in listed["items"]}
    snapshot = {
        "kind": "contract-reads",
        "contract": args.contract,
        "rpc": args.rpc,
        "snapshot_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "authoritative": False,
        "note": "Outputs of the contract's views, stored at snapshot_at. Current state may differ.",
        "servers": servers,
        "pins": {server["url"]: view("get_pins", server["url"]) for server in servers.values()},
        "challenges": view("list_challenges", "")["items"],
        "stats": view("get_stats"),
        "accounting": view("get_accounting"),
    }
    out = ROOT / "apps/web/data/snapshot.json"
    out.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(servers)} servers, {len(snapshot['challenges'])} challenges, "
          f"accounting conserved={snapshot['accounting']['conserved']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
