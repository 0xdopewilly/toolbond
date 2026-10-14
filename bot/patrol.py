"""ToolBond patrol bot: catch MCP manifests that drift from their pins and settle it on-chain.

For each registered server it fetches the live manifest off-chain (the same TBCM-1 code the
validators run) and compares the root with the pin. On a confirmed mismatch it files a DRIFT
challenge with its own stake and drives it to the end: observe -> judge (when DIFFERS) ->
settle. When the manifest still matches, it sends an `attest` heartbeat at most every few
hours per server. Every step is persisted, so a restart resumes instead of resubmitting.

    python bot/patrol.py --contract 0x... --pins-file pins.json --once
    python bot/patrol.py --contract 0x... --pins-url https://toolbond.example/api/pins --servers servers.txt

Writes go through scripts/tx.mjs (genlayer-js: fees, signing, receipts). Output is one JSON
event per line on stdout, suitable for showing as a live log.
"""

import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))

import gl_mcp  # noqa: E402
from toolbond_guard import http_post  # noqa: E402

DRIFT_STAKE_GEN = "0.5"
WATCHED_STATUSES = ("ACTIVE", "STALE")


def emit(event: str, **fields) -> None:
    record = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "event": event}
    record.update(fields)
    print(json.dumps(record, ensure_ascii=False), flush=True)


def sid_of(url: str) -> str:
    return gl_mcp.sha256_hex(url.strip())[:16]


def live_root(url: str, fetch=None) -> str:
    fetch = fetch or (lambda u: gl_mcp.digest_manifest(gl_mcp.fetch_manifest(http_post, u)))
    return fetch(url)["root"]


class TxRunner:
    """Runs scripts/tx.mjs and returns its parsed JSON line."""

    def __init__(self, contract: str, dry_run: bool = False):
        self.contract = contract
        self.dry_run = dry_run

    def write(self, method: str, *args: str, value: str = "") -> dict:
        command = ["node", str(ROOT / "scripts/tx.mjs"), "write", self.contract, method]
        if value:
            command += ["--value", value]
        command += list(args)
        if self.dry_run:
            return {"ok": True, "dry_run": True, "command": command[3:]}
        done = subprocess.run(command, capture_output=True, text=True, timeout=1800)
        lines = [line for line in done.stdout.splitlines() + done.stderr.splitlines() if line.startswith("{")]
        try:
            return json.loads(lines[-1])
        except (IndexError, ValueError):
            return {"ok": False, "error": (done.stderr or done.stdout)[-300:]}


def returned_value(reply: dict):
    returned = reply.get("returned") or {}
    return returned.get("value") if returned.get("ok") else None


def agreed_output(reply: dict):
    outputs = [o.get("value") for o in reply.get("outputs") or [] if o and o.get("ok")]
    return outputs[-1] if outputs else None


class Patrol:
    def __init__(self, tx: TxRunner, pins_source, state_path: pathlib.Path, attest_hours: float = 6.0, fetch=None):
        self.tx = tx
        self.pins_source = pins_source
        self.state_path = state_path
        self.attest_seconds = attest_hours * 3600
        self.fetch = fetch
        self.state = self._load_state()

    def _load_state(self) -> dict:
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            return {"challenges": {}, "attested": {}}

    def _save_state(self) -> None:
        self.state_path.write_text(json.dumps(self.state, indent=1), encoding="utf-8")

    def check(self, url: str) -> None:
        pins = self.pins_source(url)
        sid = sid_of(url)
        if not pins or not pins.get("known"):
            emit("skip", url=url, reason="not registered")
            return
        if pins.get("status") not in WATCHED_STATUSES:
            emit("skip", url=url, sid=sid, reason="status " + str(pins.get("status")))
            return
        open_cid = self.state["challenges"].get(sid)
        if open_cid:
            self.drive(sid, url, open_cid)
            return
        try:
            first = live_root(url, self.fetch)
        except Exception as error:
            emit("unreachable", url=url, sid=sid, error=str(error)[:160])
            return
        if first == pins.get("root"):
            self.maybe_attest(sid, url)
            return
        try:
            second = live_root(url, self.fetch)
        except Exception as error:
            emit("unreachable", url=url, sid=sid, error=str(error)[:160])
            return
        emit("drift_detected", url=url, sid=sid, pinned=pins.get("root"), live=first, unstable=second != first)
        if int(pins.get("open_challenges") or 0) > 0:
            emit("skip", url=url, sid=sid, reason="a challenge is already open on-chain")
            return
        reply = self.tx.write("challenge", sid, "", "DRIFT", value=DRIFT_STAKE_GEN)
        value = returned_value(reply) or {}
        if not reply.get("ok") or not value.get("ok"):
            emit("challenge_failed", url=url, sid=sid, reply=reply)
            return
        cid = value["cid"]
        emit("challenge_filed", url=url, sid=sid, cid=cid, tx=reply.get("hash"))
        self.state["challenges"][sid] = {"cid": cid, "stage": "FILED"}
        self._save_state()
        self.drive(sid, url, self.state["challenges"][sid])

    def drive(self, sid: str, url: str, record: dict) -> None:
        cid = record["cid"]
        if record["stage"] == "FILED":
            reply = self.tx.write("observe", cid, "content")
            if not reply.get("ok"):
                emit("observe_failed", sid=sid, cid=cid, reply=reply)
                return
            drift = (agreed_output(reply) or {}).get("drift", "")
            record.update(stage="OBSERVED", drift=drift)
            self._save_state()
            emit("observed", sid=sid, cid=cid, drift=drift, votes=reply.get("votes"), tx=reply.get("hash"))
        if record["stage"] == "OBSERVED" and record.get("drift") == "DIFFERS":
            reply = self.tx.write("judge", cid)
            if not reply.get("ok"):
                emit("judge_failed", sid=sid, cid=cid, reply=reply)
                return
            verdict = (agreed_output(reply) or {}).get("verdict", "")
            record.update(stage="JUDGED", verdict=verdict)
            self._save_state()
            emit("judged", sid=sid, cid=cid, verdict=verdict, votes=reply.get("votes"), tx=reply.get("hash"))
        reply = self.tx.write("settle", cid)
        if not reply.get("ok"):
            emit("settle_failed", sid=sid, cid=cid, reply=reply)
            return
        emit("settled", sid=sid, cid=cid, drift=record.get("drift"), verdict=record.get("verdict", ""), tx=reply.get("hash"))
        del self.state["challenges"][sid]
        self._save_state()

    def maybe_attest(self, sid: str, url: str) -> None:
        last = float(self.state["attested"].get(sid, 0))
        if time.time() - last < self.attest_seconds:
            emit("match", url=url, sid=sid)
            return
        reply = self.tx.write("attest", sid)
        emit("attested" if reply.get("ok") else "attest_failed", url=url, sid=sid, tx=reply.get("hash"))
        if reply.get("ok"):
            self.state["attested"][sid] = time.time()
            self._save_state()


def pins_loader(pins_url: str, pins_file: str):
    def load(url: str):
        if pins_url:
            try:
                query = urllib.parse.urlencode({"url": url})
                with urllib.request.urlopen(pins_url + ("&" if "?" in pins_url else "?") + query, timeout=15) as response:
                    return json.loads(response.read().decode("utf-8"))
            except Exception as error:
                emit("pins_unavailable", url=url, error=str(error)[:160])
        if pins_file:
            data = json.loads(pathlib.Path(pins_file).read_text(encoding="utf-8"))
            return data.get(url) if "known" not in data else data
        return None

    return load


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="toolbond-patrol")
    parser.add_argument("--contract", required=True, help="ToolBond contract address")
    parser.add_argument("--pins-url", default="", help="endpoint returning get_pins JSON for ?url=")
    parser.add_argument("--pins-file", default="", help="{server_url: get_pins} JSON")
    parser.add_argument("--servers", default="", help="file with one server URL per line (default: keys of --pins-file)")
    parser.add_argument("--interval", type=float, default=600, help="seconds between rounds")
    parser.add_argument("--once", action="store_true", help="run one round and exit")
    parser.add_argument("--dry-run", action="store_true", help="never send transactions")
    parser.add_argument("--attest-hours", type=float, default=6.0)
    parser.add_argument("--state", default=str(ROOT / ".patrol-state.json"))
    args = parser.parse_args(argv)

    if args.servers:
        urls = [line.strip() for line in pathlib.Path(args.servers).read_text().splitlines() if line.strip()]
    elif args.pins_file:
        urls = list(json.loads(pathlib.Path(args.pins_file).read_text(encoding="utf-8")).keys())
    else:
        parser.error("give --servers or --pins-file")
    patrol = Patrol(TxRunner(args.contract, args.dry_run), pins_loader(args.pins_url, args.pins_file), pathlib.Path(args.state),
                    attest_hours=args.attest_hours)
    while True:
        for url in urls:
            patrol.check(url)
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
