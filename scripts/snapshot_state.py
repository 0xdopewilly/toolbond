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
DEMO_URL = "https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=2026-10-14T08:14:00Z"
SERVERS = [
    {"url": DEMO_URL, "purpose": "Weather forecasts for a city.", "verdict": "SAFE", "tier": "BONDED", "bond": str(10 * GEN),
     "status": "ACTIVE", "pinned_from": "https://toolbond-demo-mcp.vercel.app/mcp/honest"},
    {"url": "https://mcp.deepwiki.com/mcp", "purpose": "Answers questions about public GitHub repositories from their generated documentation.", "verdict": "SAFE"},
    {"url": "https://docs.mcp.cloudflare.com/mcp", "purpose": "Searches Cloudflare's product documentation.", "verdict": "SAFE"},
    {"url": "https://gitmcp.io/modelcontextprotocol/python-sdk", "purpose": "Fetches and searches the documentation and code of the MCP Python SDK repository.", "verdict": "SAFE"},
    {"url": "https://mcp.internetcourt.org/mcp", "purpose": "Explains and installs the Internet Court skill for agent dispute resolution.", "verdict": "SAFE"},
]
POOL = "0"
CHECKS = 3
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
    for entry in SERVERS:
        url, purpose, verdict = entry["url"], entry["purpose"], entry["verdict"]
        tier, bond, status = entry.get("tier", "REVIEWED"), entry.get("bond", "0"), entry.get("status", "ACTIVE")
        # the pinned bytes: a rug-pull server is captured from its honest twin, which serves the same tools
        manifest = gl_mcp.fetch_manifest(http_post, entry.get("pinned_from", url))
        digest = gl_mcp.digest_manifest(manifest)
        sid = gl_mcp.sha256_hex(url)[:16]
        names = {t["name"] for t in digest["tools"]}
        host = url.split("/")[2]
        flags = {t["name"]: redflags.tool_flags(t, names, host) for t in manifest["tools"]}
        flags["__instructions__"] = redflags.instructions_flags(manifest["instructions"], names, host)
        overrides = entry.get("tool_verdicts", {})
        tools = [dict(t, verdict=overrides.get(t["name"], {}).get("verdict", verdict), reason=overrides.get(t["name"], {}).get("reason", ""),
                      quote=overrides.get(t["name"], {}).get("quote", "")) for t in digest["tools"]]
        servers[sid] = {
            "found": True, "sid": sid, "url": url, "publisher": SPONSOR, "tier": tier, "status": status,
            "purpose": purpose, "caps": "network", "bond": bond, "root": digest["root"], "protocol": digest["protocol"],
            "instructions": digest["instructions"], "instructions_hash": digest["instructions_hash"],
            "instructions_verdict": {"verdict": verdict} if digest["instructions"] else {}, "flags": flags, "tools": tools,
            "reviewed": len(tools), "slashes": entry.get("slashes", 0), "unreachable": 0, "contested": False, "open_challenges": 0,
            "last_attest": "MATCH", "created_at": now, "updated_at": now, "last_verified_at": now, "exit_at": 0,
        }
        pins[url] = {
            "known": True, "sid": sid, "url": url, "status": status, "tier": tier, "root": digest["root"],
            "tools": {t["name"]: t["hash"] for t in digest["tools"]}, "verdicts": {t["name"]: t["verdict"] for t in tools},
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
            "servers": len(servers), "active": sum(1 for v in servers.values() if v["status"] == "ACTIVE"),
            "slashed": sum(1 for v in servers.values() if v["status"] == "SLASHED"),
            "bonded": str(sum(int(v["bond"]) for v in servers.values())), "pool": POOL,
            "challenges": len(challenges), "open_challenges": 0, "pins": len(servers), "checks": CHECKS,
            "slashes": sum(v["slashes"] for v in servers.values()),
        },
    }
    out = ROOT / "apps/web/data/snapshot.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(servers)} servers, {len(challenges)} challenges")


if __name__ == "__main__":
    main()
