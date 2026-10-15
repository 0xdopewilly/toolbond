"""toolbond-guard: an MCP stdio proxy that only exposes tools whose exact bytes are pinned.

Claude Code, Cursor and other MCP clients launch it instead of talking to a remote server
directly:

    claude mcp add weather -- uvx --from git+https://github.com/0xdopewilly/toolbond \\
        toolbond-guard https://weather.example.com/mcp --pins-url https://toolbond.example/api/pins

On every tools/list (and on a poll timer) the guard fetches the live manifest, hashes each
tool with TBCM-1 (the same code GenLayer validators run, lib/gl_mcp.py) and shows only tools
that pass the client rules in docs/CONTRACT_API.md. A tool that changes upstream disappears
at once and the client is told to refresh; calls to it are refused. Logs go to stderr,
because stdout is the MCP channel. Standard library only.

Where approvals come from (docs/GUARD.md has the trust model):
- by default, only from the ToolBond contract, read with gen_call through --rpc on every
  refresh. If that read fails, every tool is blocked;
- --cache-minutes N lets the last contract read stand in for N minutes of RPC outage
  (revocations made meanwhile are not seen);
- --relay URL lets a relay you trust answer when the contract read fails. Its answers are
  labelled trusted-relay; reconstructed snapshots are refused unless --accept-snapshot-hours;
- --pins-file replaces chain reads with operator-supplied pins (offline use and tests).
"""

import argparse
import calendar
import json
import os
import pathlib
import sys
import threading
import time
import urllib.parse
import urllib.request

import genlayer_read
import gl_mcp

VERSION = "0.3.0"
ALLOWED_STATUSES = ("ACTIVE", "STALE")
STATUS_TOOL = "toolbond_status"
DEFAULT_RPC = "https://studio-dev.genlayer.com/api"
DEFAULT_CONTRACT = os.environ.get("TOOLBOND_CONTRACT", "") or "0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b"  # ToolBond v3
CACHE_PATH = pathlib.Path(os.environ.get("TOOLBOND_CACHE", str(pathlib.Path.home() / ".toolbond" / "pins-cache.json")))


def log(message: str) -> None:
    print("[toolbond-guard] " + message, file=sys.stderr, flush=True)


def http_post(url: str, body: str, headers: dict) -> tuple:
    request = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as error:
        return error.code, {}, error.read()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise gl_mcp.McpError(gl_mcp.ERR_TRANSIENT + " " + str(error)[:120])


def _iso_seconds(text: str) -> float:
    """Seconds since 1970 for an ISO-8601 UTC timestamp; 0 when unreadable (reads as ancient)."""
    try:
        return float(calendar.timegm(time.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")))
    except Exception:
        return 0.0


# ------------------------------------------------------------------------------- pins


TRUST = {
    "contract": "read from the ToolBond contract through the RPC endpoint on this refresh; you trust that endpoint "
                "to report contract state (on Studio Next it is a hosted preview network)",
    "contract-cache": "the last successful contract read, reused because the RPC is unreachable; revocations made "
                      "since it was read are not seen",
    "trusted-relay": "answered by a relay you configured, not verified against the contract; you trust its operator",
    "relay-snapshot": "a relay snapshot reconstructed from past transactions, not authoritative contract state",
    "operator-file": "pins supplied in a local file by whoever runs the guard, not verified against the contract",
    "none": "no approval data could be verified, so every tool is blocked",
}


def provenance(source: str, as_of: str = "", error: str = "", **extra) -> dict:
    age = None
    if as_of:
        seconds = _iso_seconds(as_of)
        age = int(time.time() - seconds) if seconds else None
    return dict({"source": source, "verified": source in ("contract", "contract-cache"), "trust": TRUST[source],
                 "as_of": as_of, "age_seconds": age, "error": error}, **extra)


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _http_get_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "toolbond-guard"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


class PinSource:
    """Approval data for one server in the get_pins JSON shape, with where it came from.

    load() -> (pins or None, provenance). Contract reads come first; the cache and the relay
    are opt-in fallbacks; a pins file replaces all of them. Nothing unverifiable is used
    unless the operator asked for it, and nothing is used for a different URL."""

    def __init__(self, server_url: str, rpc: str = DEFAULT_RPC, contract: str = DEFAULT_CONTRACT, relay: str = "",
                 pins_file: str = "", cache_minutes: float = 0.0, accept_snapshot_hours: float = 0.0,
                 reader=None, relay_get=None):
        self.server_url = server_url
        self.rpc, self.contract = rpc, contract
        self.relay, self.pins_file = relay, pins_file
        self.cache_seconds = max(0.0, cache_minutes * 60)
        self.snapshot_seconds = max(0.0, accept_snapshot_hours * 3600)
        self.reader = reader or (lambda: genlayer_read.read_view(self.rpc, self.contract, "get_pins", [self.server_url]))
        self.relay_get = relay_get or _http_get_json

    def load(self) -> tuple:
        if self.pins_file:
            return self._from_file()
        errors = []
        pins = self._from_contract(errors)
        if pins is not None:
            return pins, provenance("contract", _iso_now(), rpc=self.rpc, contract=self.contract)
        if self.cache_seconds:
            cached = self._load_cache()
            if cached is not None:
                pins, saved_at = cached
                return pins, provenance("contract-cache", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(saved_at)),
                                        "; ".join(errors), rpc=self.rpc, contract=self.contract)
        if self.relay:
            found = self._from_relay(errors)
            if found is not None:
                return found
        return None, provenance("none", error="; ".join(errors))

    def _matches(self, pins) -> bool:
        if not isinstance(pins, dict) or "known" not in pins:
            return False
        return not pins.get("known") or str(pins.get("url", "")).strip() == self.server_url

    def _contract_configured(self) -> bool:
        address = str(self.contract).lower()
        return (len(address) == 42 and address.startswith("0x") and all(ch in "0123456789abcdef" for ch in address[2:])
                and address != genlayer_read.ZERO_ADDRESS)

    def _from_contract(self, errors: list):
        if not self._contract_configured():
            errors.append("no ToolBond contract address configured")
            return None
        try:
            raw = self.reader()
            pins = json.loads(raw) if isinstance(raw, str) else raw
        except Exception as error:
            errors.append("contract read failed: " + str(error)[:160])
            return None
        if not self._matches(pins):
            errors.append("contract answered for a different server or in an unknown shape")
            return None
        self._save_cache(pins)
        return pins

    def _from_relay(self, errors: list):
        try:
            query = urllib.parse.urlencode({"url": self.server_url})
            pins = self.relay_get(self.relay + ("&" if "?" in self.relay else "?") + query)
        except Exception as error:
            errors.append("relay failed: " + str(error)[:160])
            return None
        if not self._matches(pins):
            errors.append("relay answered for a different server or in an unknown shape")
            return None
        as_of = str(pins.get("as_of") or "")
        if pins.get("source") == "snapshot" or pins.get("authoritative") is False:
            age = time.time() - _iso_seconds(as_of) if as_of else float("inf")
            if not self.snapshot_seconds:
                errors.append("relay served a reconstructed snapshot; refused (see --accept-snapshot-hours)")
                return None
            if age > self.snapshot_seconds:
                errors.append("relay snapshot is older than --accept-snapshot-hours")
                return None
            return pins, provenance("relay-snapshot", as_of, relay=self.relay)
        return pins, provenance("trusted-relay", as_of, relay=self.relay)

    def _from_file(self) -> tuple:
        try:
            data = json.loads(pathlib.Path(self.pins_file).read_text(encoding="utf-8"))
            pins = data.get(self.server_url, data) if isinstance(data, dict) and "known" not in data else data
            if self._matches(pins) or (isinstance(pins, dict) and "known" in pins and "url" not in pins):
                return pins, provenance("operator-file", file=self.pins_file)
        except Exception as error:
            return None, provenance("none", error="pins file failed: " + str(error)[:160])
        return None, provenance("none", error="pins file has no entry for this server")

    def _save_cache(self, pins: dict) -> None:
        if not self.cache_seconds:
            return
        try:
            CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = json.loads(CACHE_PATH.read_text(encoding="utf-8")) if CACHE_PATH.exists() else {}
            data[self.server_url] = {"pins": pins, "saved_at": time.time(), "contract": self.contract}
            CACHE_PATH.write_text(json.dumps(data, indent=1), encoding="utf-8")
        except Exception as error:
            log("could not write pin cache: " + str(error)[:120])

    def _load_cache(self):
        """-> (pins, saved_at) for a contract read younger than the cache window, else None."""
        try:
            entry = json.loads(CACHE_PATH.read_text(encoding="utf-8")).get(self.server_url)
        except Exception:
            return None
        if not isinstance(entry, dict) or "saved_at" not in entry or entry.get("contract") != self.contract:
            return None  # older formats, or reads from another contract, are not trusted
        if time.time() - float(entry["saved_at"]) > self.cache_seconds:
            log("cached contract read expired")
            return None
        return entry.get("pins"), float(entry["saved_at"])


def assurance_of(pins) -> str:
    """BONDED only when the contract says the bond meets the minimum (version 3 pins carry
    "assurance"); a BONDED tier without that field cannot prove its collateral."""
    if not isinstance(pins, dict):
        return "NONE"
    if pins.get("assurance"):
        return str(pins["assurance"])
    return "REVIEWED" if pins.get("tier") == "REVIEWED" else "UNVERIFIED_COLLATERAL"


def evaluate(live_tools: list, pins, bonded_only: bool = False, owner_only: bool = False) -> list:
    """Client rules from docs/CONTRACT_API.md -> one decision per live tool."""
    decisions = []
    for item in live_tools:
        name, live_hash = item["name"], item["hash"]
        decision = {"name": name, "live_hash": live_hash, "pinned_hash": "", "verdict": "", "allowed": False, "why": ""}
        if name == STATUS_TOOL:
            decision["why"] = "name is reserved by the guard"
        elif not pins or not pins.get("known"):
            decision["why"] = "server is not registered with ToolBond"
        elif pins.get("status") not in ALLOWED_STATUSES:
            decision["why"] = "server status is " + str(pins.get("status"))
        elif bonded_only and assurance_of(pins) != "BONDED":
            decision["why"] = "assurance is " + assurance_of(pins) + ", not BONDED (--bonded-only)"
        elif owner_only and pins.get("owner_verified") is not True:
            decision["why"] = "the registrant is not a verified owner of the server (--owner-verified-only)"
        else:
            decision["pinned_hash"] = str((pins.get("tools") or {}).get(name, ""))
            decision["verdict"] = str((pins.get("verdicts") or {}).get(name, ""))
            if not decision["pinned_hash"]:
                decision["why"] = "tool is not pinned"
            elif decision["pinned_hash"] != live_hash:
                decision["why"] = "tool changed since it was pinned"
            elif decision["verdict"] != "SAFE":
                decision["why"] = "verdict is " + (decision["verdict"] or "missing")
            else:
                decision["allowed"] = True
                decision["why"] = "pinned and judged SAFE"
        decisions.append(decision)
    return decisions


# ------------------------------------------------------------------------------ guard


class Guard:
    def __init__(self, server_url: str, pins: PinSource, bonded_only: bool = False, poll: float = 30.0, out=None,
                 owner_only: bool = False):
        self.server_url = server_url
        self.pins = pins
        self.bonded_only = bonded_only
        self.owner_only = owner_only
        self.poll = poll
        self.out = out or sys.stdout
        self.lock = threading.Lock()
        self.write_lock = threading.Lock()
        self.tools = {}  # name -> raw tool object, allowed only
        self.decisions = []
        self.pin_source = "none"
        self.provenance = provenance("none")
        self.assurance = "NONE"
        self.last_error = ""
        self.allowed_names = frozenset()

    def refresh(self) -> bool:
        """Re-fetch and re-evaluate. Returns True when the allowed set changed."""
        try:
            manifest = gl_mcp.fetch_manifest(http_post, self.server_url)
            digest = gl_mcp.digest_manifest(manifest)
        except Exception as error:
            with self.lock:
                self.last_error = str(error)[:200]
                changed = bool(self.allowed_names)
                self.tools, self.decisions, self.allowed_names = {}, [], frozenset()
            log("upstream unavailable, blocking every tool: " + self.last_error)
            return changed
        pins, origin = self.pins.load()
        decisions = evaluate(digest["tools"], pins, self.bonded_only, self.owner_only)
        for decision in decisions:
            decision["approval_source"] = origin["source"]
        # hand the client exactly the object that was hashed (no top-level _meta), so nothing
        # reaches the model that the pin does not cover
        hashed = {item["name"]: json.loads(item["canon"]) for item in digest["tools"]}
        allowed = frozenset(d["name"] for d in decisions if d["allowed"])
        with self.lock:
            changed = allowed != self.allowed_names
            self.tools = {name: hashed[name] for name in allowed if name in hashed}
            previous = self.pin_source
            self.decisions, self.pin_source, self.last_error, self.allowed_names = decisions, origin["source"], "", allowed
            self.provenance, self.assurance = origin, assurance_of(pins) if pins and pins.get("known") else "NONE"
        if origin["source"] != previous:
            note = "approvals: " + origin["source"] + " (" + origin["trust"] + ")"
            log(note + (": " + origin["error"] if origin.get("error") else ""))
        for decision in decisions:
            if not decision["allowed"]:
                log(f"blocked {decision['name']}: {decision['why']} (live {decision['live_hash'][:12]})")
        return changed

    def status_report(self) -> dict:
        with self.lock:
            return {
                "server": self.server_url,
                "guard_version": VERSION,
                "pins_from": self.pin_source,
                "approval": dict(self.provenance),
                "assurance": self.assurance,
                "scope": "manifest integrity: the exact tool text your model sees is the text validators pinned and "
                         "judged. It does not cover what a tool does when called.",
                "upstream_error": self.last_error,
                "tools": list(self.decisions),
            }

    # ------------------------------------------------------------------ MCP over stdio

    def send(self, message: dict) -> None:
        with self.write_lock:
            self.out.write(json.dumps(message, ensure_ascii=False) + "\n")
            self.out.flush()

    def handle(self, message: dict):
        method, request_id = message.get("method"), message.get("id")
        if request_id is None:
            return None  # notifications need no answer
        if method == "initialize":
            requested = (message.get("params") or {}).get("protocolVersion") or gl_mcp.PROTOCOL_VERSION
            return self._result(request_id, {
                "protocolVersion": requested,
                "capabilities": {"tools": {"listChanged": True}},
                "serverInfo": {"name": "toolbond-guard", "version": VERSION},
                "instructions": "Tools from " + self.server_url + " are shown only when their exact text is pinned "
                                "on ToolBond and judged SAFE by GenLayer validators. Call toolbond_status for details.",
            })
        if method == "ping":
            return self._result(request_id, {})
        if method == "tools/list":
            self.refresh()
            with self.lock:
                listed = [self.tools[name] for name in sorted(self.tools)]
            listed.append({
                "name": STATUS_TOOL,
                "description": "Show which upstream tools ToolBond allows or blocks, with pinned and live hashes.",
                "inputSchema": {"type": "object", "properties": {}},
            })
            return self._result(request_id, {"tools": listed})
        if method == "tools/call":
            params = message.get("params") or {}
            name = params.get("name")
            if name == STATUS_TOOL:
                return self._result(request_id, self._text(json.dumps(self.status_report(), indent=1)))
            self.refresh()  # re-check the bytes at call time
            with self.lock:
                allowed = name in self.tools
                why = next((d["why"] for d in self.decisions if d["name"] == name), "tool is not offered upstream")
            if not allowed:
                return self._result(request_id, self._text("ToolBond blocked " + str(name) + ": " + why, error=True))
            try:
                return self._result(request_id, self._call_upstream(name, params.get("arguments") or {}))
            except Exception as error:
                return self._result(request_id, self._text("upstream call failed: " + str(error)[:200], error=True))
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "method not found: " + str(method)}}

    def _call_upstream(self, name: str, arguments: dict) -> dict:
        headers = gl_mcp.base_headers()
        status, response_headers, body = http_post(self.server_url, json.dumps(gl_mcp.initialize_request(1)), headers)
        gl_mcp.parse_rpc(body, 1)
        session = {k.lower(): v for k, v in response_headers.items()}.get("mcp-session-id", "")
        if session:
            headers = dict(headers, **{"Mcp-Session-Id": session})
        http_post(self.server_url, json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}), headers)
        call = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
        status, _, body = http_post(self.server_url, json.dumps(call), headers)
        if status >= 400:
            raise gl_mcp.McpError(gl_mcp.ERR_EXTERNAL + " http " + str(status))
        return gl_mcp.parse_rpc(body, 2)

    @staticmethod
    def _text(text: str, error: bool = False) -> dict:
        return {"content": [{"type": "text", "text": text}], "isError": error}

    @staticmethod
    def _result(request_id, result: dict) -> dict:
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    def poll_forever(self, stop: threading.Event) -> None:
        while not stop.wait(self.poll):
            if self.refresh():
                log("allowed tools changed; notifying the client")
                self.send({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})

    def serve(self, stdin=None) -> None:
        stop = threading.Event()
        if self.poll > 0:
            threading.Thread(target=self.poll_forever, args=(stop,), daemon=True).start()
        try:
            for line in stdin or sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except ValueError:
                    self.send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
                    continue
                messages = message if isinstance(message, list) else [message]
                for item in messages:
                    reply = self.handle(item) if isinstance(item, dict) else None
                    if reply is not None:
                        self.send(reply)
        finally:
            stop.set()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="toolbond-guard", description=__doc__.split("\n\n")[0])
    parser.add_argument("server_url", help="remote MCP server (Streamable HTTP)")
    parser.add_argument("--rpc", default=os.environ.get("TOOLBOND_RPC", DEFAULT_RPC),
                        help="GenLayer JSON-RPC used to read the contract (default: Studio Next)")
    parser.add_argument("--contract", default=DEFAULT_CONTRACT, help="ToolBond contract address")
    parser.add_argument("--relay", "--pins-url", dest="relay", default=os.environ.get("TOOLBOND_RELAY", ""),
                        help="opt-in: a relay you trust, asked for get_pins JSON (?url=) only when the contract read fails")
    parser.add_argument("--accept-snapshot-hours", type=float, default=0.0,
                        help="opt-in: accept relay snapshots reconstructed from transactions up to this age (default 0: refuse)")
    parser.add_argument("--cache-minutes", type=float, default=0.0,
                        help="opt-in: reuse the last contract read for this long when the RPC is unreachable (default 0)")
    parser.add_argument("--pins-file", default="", help="operator-supplied get_pins JSON instead of chain reads")
    parser.add_argument("--bonded-only", action="store_true", help="allow only servers whose bond meets the minimum")
    parser.add_argument("--owner-verified-only", action="store_true",
                        help="allow only servers whose pinned instructions name the registrant as owner")
    parser.add_argument("--poll", type=float, default=30.0, help="seconds between manifest and approval checks (0 disables)")
    args = parser.parse_args(argv)
    url = args.server_url.strip()
    source = PinSource(url, rpc=args.rpc, contract=args.contract.strip(), relay=args.relay.strip(),
                       pins_file=args.pins_file, cache_minutes=args.cache_minutes,
                       accept_snapshot_hours=args.accept_snapshot_hours)
    guard = Guard(url, source, bonded_only=args.bonded_only, poll=args.poll, owner_only=args.owner_verified_only)
    log(f"guarding {guard.server_url}; approvals from contract {source.contract} via {source.rpc}"
        + (f", trusted relay {source.relay} as fallback" if source.relay else "")
        + (f", operator pins file {source.pins_file}" if source.pins_file else ""))
    guard.serve()
    return 0


if __name__ == "__main__":
    sys.exit(main())
