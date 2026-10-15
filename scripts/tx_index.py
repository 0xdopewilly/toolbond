"""Index ToolBond transactions by server and challenge, from the chain itself.

The contract does not store transaction hashes, so the web app needs an index to link each
server and challenge to its transactions. This script takes hashes from the evidence logs
(docs/evidence/*.jsonl, any "hash" or "tx" field), fetches every transaction with
eth_getTransactionByHash, decodes its calldata (method and arguments), status, votes and
return value, and groups them. Nothing in the output comes from the logs except the hashes:
anyone can re-run it against the RPC and get the same index.

    python3 scripts/tx_index.py --contract 0x... [--out apps/web/data/txs.json] [--markdown docs/evidence/v3-transactions.md]
"""

import argparse
import base64
import hashlib
import json
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))

import genlayer_read  # noqa: E402

RPC = "https://studio-dev.genlayer.com/api"
EXPLORER = "https://explorer-studio-dev.genlayer.com"
SERVER_METHODS = ("snapshot", "review", "attest", "top_up", "request_exit", "finalize_exit")
CHALLENGE_METHODS = ("observe", "judge", "settle", "expire")


def rpc(method: str, params: list) -> dict:
    request = urllib.request.Request(
        RPC, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": "toolbond-tx-index"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())["result"]


def framed(b64: str):
    """A receipt result: one status byte (0 returned, 1 user error, 2 VM error), then calldata or text."""
    if not b64:
        return None
    raw = base64.b64decode(b64)
    if not raw:
        return None
    if raw[0] == 0:
        try:
            return {"ok": True, "value": genlayer_read.decode(raw[1:])}
        except Exception:
            return {"ok": True, "value": None}
    return {"ok": False, "error": raw[1:].decode("utf-8", "replace")}


def sid_of(url: str) -> str:
    return hashlib.sha256(url.strip().encode()).hexdigest()[:16]


def describe(tx_hash: str) -> dict:
    tx = rpc("eth_getTransactionByHash", [tx_hash])
    message = genlayer_read.decode(base64.b64decode(tx["data"]["calldata"]))
    data = tx.get("consensus_data") or {}
    leader = data.get("leader_receipt")
    leader = leader[0] if isinstance(leader, list) and leader else (leader or {})
    returned = framed(leader.get("result", ""))
    value = returned.get("value") if returned and returned.get("ok") else None
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            pass
    return {
        "hash": tx_hash,
        "to": str(tx.get("to_address", "")).lower(),
        "from": str(tx.get("from_address", "")).lower(),
        "method": message.get("", "") if isinstance(message, dict) else "",
        "args": message.get("args", []) if isinstance(message, dict) else [],
        "value": str(tx.get("value") or tx.get("data", {}).get("user_value") or 0),
        "status": tx.get("status"),
        "execution": tx.get("txExecutionResultName"),
        "votes": list((data.get("votes") or {}).values()),
        "created_at": str(tx.get("created_at", ""))[:19] + "Z",
        "returned": value,
        "error": returned.get("error") if returned and not returned.get("ok") else None,
    }


def hashes_from_logs(paths: list) -> list:
    seen, ordered = set(), []
    for path in paths:
        for line in pathlib.Path(path).read_text().splitlines():
            try:
                record = json.loads(line)
            except ValueError:
                continue
            for key in ("hash", "tx"):
                value = record.get(key)
                if isinstance(value, str) and value.startswith("0x") and len(value) == 66 and value not in seen:
                    seen.add(value)
                    ordered.append(value)
    return ordered


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", required=True)
    parser.add_argument("--logs", nargs="*", default=sorted(str(p) for p in (ROOT / "docs/evidence").glob("*.jsonl")))
    parser.add_argument("--out", default=str(ROOT / "apps/web/data/txs.json"))
    parser.add_argument("--markdown", default="")
    args = parser.parse_args()
    contract = args.contract.lower()

    rows = [describe(h) for h in hashes_from_logs(args.logs)]
    rows = [r for r in rows if r["to"] == contract]
    rows.sort(key=lambda r: r["created_at"])
    servers, challenges, cid_sid = {}, {}, {}
    for row in rows:
        ref = {"step": row["method"], "hash": row["hash"], "votes": row["votes"], "created_at": row["created_at"],
               "status": row["status"], "execution": row["execution"]}
        if row["error"]:
            ref["error"] = row["error"][:200]
        method, call_args = row["method"], row["args"]
        if method in ("register", "sponsor_review") and call_args:
            servers.setdefault(sid_of(call_args[0]), []).append(ref)
        elif method == "challenge" and call_args:
            servers.setdefault(call_args[0], []).append(ref)
            cid = (row["returned"] or {}).get("cid") if isinstance(row["returned"], dict) else None
            if cid:
                cid_sid[cid] = call_args[0]
                challenges.setdefault(cid, []).append(ref)
        elif method in SERVER_METHODS and call_args:
            servers.setdefault(call_args[0], []).append(ref)
        elif method in CHALLENGE_METHODS and call_args:
            challenges.setdefault(call_args[0], []).append(ref)
    index = {"contract": args.contract, "rpc": RPC, "built_from": "eth_getTransactionByHash", "servers": servers,
             "challenges": challenges}
    pathlib.Path(args.out).write_text(json.dumps(index, indent=1) + "\n")
    print(f"indexed {len(rows)} transactions: {len(servers)} servers, {len(challenges)} challenges -> {args.out}")

    if args.markdown:
        lines = ["| Time (UTC) | From | Call | Status | Votes | Transaction |", "|---|---|---|---|---|---|"]
        for row in rows:
            call = row["method"] + "(" + ", ".join(json.dumps(a)[:48] for a in row["args"]) + ")"
            if row["value"] not in ("0", ""):
                call += f" + {int(row['value']) / 1e18:g} GEN"
            outcome = (row["status"] or "") + ("" if row["execution"] == "FINISHED_WITH_RETURN" else f", {row['execution']}")
            if row["error"]:
                outcome += ": " + row["error"].replace("|", "/")[:90]
            agree = sum(1 for v in row["votes"] if v == "agree")
            lines.append(f"| {row['created_at'][11:19]} | `{row['from'][:8]}…` | `{call}` | {outcome} | {agree} agree "
                         f"/ {len(row['votes'])} | [{row['hash'][:10]}…]({EXPLORER}/tx/{row['hash']}) |")
        pathlib.Path(args.markdown).write_text("\n".join(lines) + "\n")
        print("wrote", args.markdown)
    return 0


if __name__ == "__main__":
    sys.exit(main())
