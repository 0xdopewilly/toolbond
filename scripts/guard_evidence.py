"""Run the real toolbond-guard CLI against live servers and record what it does.

Each scenario starts lib/toolbond_guard.py as a subprocess, speaks MCP to it over stdio like a
client would (initialize, tools/list, toolbond_status), and records the allowed tools and the
approval source. Output: a Markdown report for docs/evidence.

    python3 scripts/guard_evidence.py --out docs/evidence/v3-guard.md
"""

import argparse
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
GUARD = ROOT / "lib/toolbond_guard.py"
SITE = "https://toolbond.vercel.app"
DEAD_RPC = "http://127.0.0.1:9/api"

SCENARIOS = [
    ("DeepWiki, sponsored review, default settings", "https://mcp.deepwiki.com/mcp", []),
    ("DeepWiki with --bonded-only (reviewed, no bond)", "https://mcp.deepwiki.com/mcp", ["--bonded-only"]),
    ("Bonded server with an owner proof, --bonded-only --owner-verified-only",
     "https://toolbond-demo-mcp.vercel.app/mcp/update?at=2026-10-15T12:00:00Z", ["--bonded-only", "--owner-verified-only"]),
    ("The v3 rug pull, slashed on chain", "https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=2026-10-15T11:40:00Z", []),
    ("An unregistered poisoned server", "https://toolbond-demo-mcp.vercel.app/mcp/poisoned", []),
    ("DeepWiki while the RPC is unreachable (fails closed)", "https://mcp.deepwiki.com/mcp", ["--rpc", DEAD_RPC]),
    ("DeepWiki while the RPC is unreachable, with the site as an opt-in relay", "https://mcp.deepwiki.com/mcp",
     ["--rpc", DEAD_RPC, "--relay", SITE + "/api/pins"]),
]


def run(url: str, extra: list) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ, TOOLBOND_CACHE=str(pathlib.Path(tmp) / "cache.json"))
        proc = subprocess.Popen([sys.executable, str(GUARD), url, "--poll", "0", *extra], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        requests = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "toolbond_status", "arguments": {}}},
        ]
        out, err = proc.communicate("\n".join(json.dumps(r) for r in requests) + "\n", timeout=180)
    replies = {m["id"]: m for m in (json.loads(line) for line in out.splitlines() if line.strip()) if "id" in m}
    listed = [t["name"] for t in replies[2]["result"]["tools"]]
    status = json.loads(replies[3]["result"]["content"][0]["text"])
    return {"listed": listed, "status": status, "log": [line for line in err.splitlines() if line.strip()]}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(ROOT / "docs/evidence/v3-guard.md"))
    args = parser.parse_args()
    lines = [
        "# Guard integration evidence (ToolBond v3)",
        "",
        f"Recorded {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} by `scripts/guard_evidence.py`, which runs "
        "`lib/toolbond_guard.py` as an MCP client would (initialize, tools/list, toolbond_status). Unless a scenario says "
        "otherwise, the guard used its defaults: approvals read from contract `0x7c0be3E1…f2A5b` with gen_call through "
        "`https://studio-dev.genlayer.com/api`, no cache, no relay.",
        "",
    ]
    for title, url, extra in SCENARIOS:
        result = run(url, extra)
        status = result["status"]
        approval = status["approval"]
        lines += [f"## {title}", "", f"`toolbond-guard {url}{' ' + ' '.join(extra) if extra else ''}`", ""]
        lines += [f"- Tools shown to the model: {', '.join('`' + n + '`' for n in result['listed'])}",
                  f"- Approval source: `{approval['source']}` (verified: {str(approval['verified']).lower()}); {approval['trust']}",
                  f"- Assurance: `{status['assurance']}`"]
        if approval.get("error"):
            lines.append(f"- Errors: {approval['error']}")
        for tool in status["tools"]:
            lines.append(f"- `{tool['name']}`: {'allowed' if tool['allowed'] else 'blocked'} ({tool['why']})")
        lines += ["", "<details><summary>guard log (stderr)</summary>", "", "```"] + result["log"][:12] + ["```", "", "</details>", ""]
        print(title, "->", result["listed"], approval["source"])
    pathlib.Path(args.out).write_text("\n".join(lines) + "\n")
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
