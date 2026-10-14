"""Build apps/web/data/snapshot.json: the registry state in the exact JSON shapes of the ToolBond
views (docs/CONTRACT_API.md), for the web app to show while contract reads are unavailable.

Server facts come from the live manifests (same TBCM-1 code as the validators) plus the outcomes
recorded in docs/DEPLOYMENTS.md, listed below. Regenerate after new on-chain activity.

Usage: .venv/bin/python scripts/snapshot_state.py
"""

import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))

import gl_mcp  # noqa: E402
import redflags  # noqa: E402
from toolbond_guard import http_post  # noqa: E402

CONTRACT = "0x299Cf258f16ACd91A80ACa23fA39695b7eF88F8A"
SPONSOR = "0xe258d2604aec1321ddd58f179001cc6a8c442930"
GEN = 10**18

# Outcomes on the deployed contract (docs/DEPLOYMENTS.md).
SERVERS = [
    ("https://mcp.deepwiki.com/mcp", "Answers questions about public GitHub repositories from their generated documentation.", "SAFE"),
    ("https://docs.mcp.cloudflare.com/mcp", "Searches Cloudflare's product documentation.", "SAFE"),
    ("https://gitmcp.io/modelcontextprotocol/python-sdk", "Fetches and searches the documentation and code of the MCP Python SDK repository.", "SAFE"),
    ("https://mcp.internetcourt.org/mcp", "Explains and installs the Internet Court skill for agent dispute resolution.", "SAFE"),
]
CHALLENGES = [
    {
        "cid": "c1", "url": "https://mcp.deepwiki.com/mcp", "tool": "", "kind": "DRIFT", "hunter": SPONSOR,
        "stake": str(GEN // 2), "stage": "SETTLED", "drift": "MATCH", "verdict": "", "attempts": 1,
        "payout": {"hunter": str(GEN // 2 - GEN // 10), "pool": "0", "publisher": str(GEN // 10)},
    }
]


def main() -> None:
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    servers, pins = {}, {}
    for url, purpose, verdict in SERVERS:
        manifest = gl_mcp.fetch_manifest(http_post, url)
        digest = gl_mcp.digest_manifest(manifest)
        sid = gl_mcp.sha256_hex(url)[:16]
        names = {t["name"] for t in digest["tools"]}
        host = url.split("/")[2]
        flags = {t["name"]: redflags.tool_flags(t, names, host) for t in manifest["tools"]}
        flags["__instructions__"] = redflags.instructions_flags(manifest["instructions"], names, host)
        tools = [dict(t, verdict=verdict, reason="", quote="") for t in digest["tools"]]
        servers[sid] = {
            "found": True, "sid": sid, "url": url, "publisher": SPONSOR, "tier": "REVIEWED", "status": "ACTIVE",
            "purpose": purpose, "caps": "network", "bond": "0", "root": digest["root"], "protocol": digest["protocol"],
            "instructions": digest["instructions"], "instructions_hash": digest["instructions_hash"],
            "instructions_verdict": {"verdict": verdict} if digest["instructions"] else {}, "flags": flags, "tools": tools,
            "reviewed": len(tools), "slashes": 0, "unreachable": 0, "contested": False, "open_challenges": 0,
            "last_attest": "MATCH", "created_at": now, "updated_at": now, "last_verified_at": now, "exit_at": 0,
        }
        pins[url] = {
            "known": True, "sid": sid, "url": url, "status": "ACTIVE", "tier": "REVIEWED", "root": digest["root"],
            "tools": {t["name"]: t["hash"] for t in digest["tools"]}, "verdicts": {t["name"]: verdict for t in digest["tools"]},
            "open_challenges": 0, "updated_at": now,
        }
    challenges = []
    for c in CHALLENGES:
        sid = gl_mcp.sha256_hex(c["url"])[:16]
        challenges.append({
            "found": True, "cid": c["cid"], "sid": sid, "tool": c["tool"], "kind": c["kind"], "hunter": c["hunter"],
            "stake": c["stake"], "stage": c["stage"], "drift": c["drift"], "observed_root": servers[sid]["root"],
            "changed": [], "changed_flags": {}, "instructions_changed": False, "verdict": c["verdict"], "offending": "",
            "quote": "", "reason": "", "attempts": c["attempts"], "filed_at": now, "updated_at": now, "payout": c["payout"],
        })
    snapshot = {
        "contract": CONTRACT,
        "snapshot_at": now,
        "servers": servers,
        "pins": pins,
        "challenges": challenges,
        "stats": {
            "servers": len(servers), "active": len(servers), "slashed": 0, "bonded": "0", "pool": "0",
            "challenges": len(challenges), "open_challenges": 0, "pins": len(servers), "checks": 3, "slashes": 0,
        },
    }
    out = ROOT / "apps/web/data/snapshot.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(servers)} servers, {len(challenges)} challenges")


if __name__ == "__main__":
    main()
