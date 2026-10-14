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
"""

import argparse
import json
import os
import pathlib
import sys
import threading
import time
import urllib.parse
import urllib.request

import gl_mcp

VERSION = "0.2.0"
ALLOWED_STATUSES = ("ACTIVE", "STALE")
STATUS_TOOL = "toolbond_status"
CACHE_TTL_SECONDS = 24 * 3600
SNAPSHOT_MAX_AGE_SECONDS = 7 * 24 * 3600  # same as the contract's EXIT_DELAY
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
        return time.mktime(time.strptime(text[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except Exception:
        return 0.0


# ------------------------------------------------------------------------------- pins


class PinSource:
    """Pins in the get_pins JSON shape, from a URL, a file, or the last good cache."""

    def __init__(self, server_url: str, pins_url: str = "", pins_file: str = "",
                 cache_ttl: float = CACHE_TTL_SECONDS, snapshot_max_age: float = SNAPSHOT_MAX_AGE_SECONDS):
        self.server_url = server_url
        self.pins_url = pins_url
        self.pins_file = pins_file
        self.cache_ttl = cache_ttl
        self.snapshot_max_age = snapshot_max_age

    def load(self) -> tuple:
        """-> (pins dict or None, where it came from)."""
        if self.pins_url:
            try:
                query = urllib.parse.urlencode({"url": self.server_url})
                separator = "&" if "?" in self.pins_url else "?"
                with urllib.request.urlopen(self.pins_url + separator + query, timeout=15) as response:
                    pins = json.loads(response.read().decode("utf-8"))
                if isinstance(pins, dict) and "known" in pins:
                    if pins.get("source") == "snapshot":
                        # the relay could not read the contract and served a published snapshot:
                        # usable while fresh, never trusted (or cached) once it is old
                        age = time.time() - _iso_seconds(str(pins.get("as_of") or ""))
                        if age > self.snapshot_max_age:
                            log("registry snapshot is older than the allowed age; treating the server as unknown")
                            return {"known": False, "url": self.server_url}, "registry snapshot (expired)"
                        return pins, "registry snapshot"
                    self._save_cache(pins)
                    return pins, "registry"
            except Exception as error:  # fall through to file and cache
                log("pins url failed: " + str(error)[:160])
        if self.pins_file:
            try:
                data = json.loads(pathlib.Path(self.pins_file).read_text(encoding="utf-8"))
                pins = data.get(self.server_url, data) if isinstance(data, dict) and "known" not in data else data
                if isinstance(pins, dict) and "known" in pins:
                    return pins, "file"
            except Exception as error:
                log("pins file failed: " + str(error)[:160])
        cached = self._load_cache()
        if cached is not None:
            return cached, "cache"
        return None, "none"

    def _save_cache(self, pins: dict) -> None:
        try:
            CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = json.loads(CACHE_PATH.read_text(encoding="utf-8")) if CACHE_PATH.exists() else {}
            data[self.server_url] = {"pins": pins, "saved_at": time.time()}
            CACHE_PATH.write_text(json.dumps(data, indent=1), encoding="utf-8")
        except Exception as error:
            log("could not write pin cache: " + str(error)[:120])

    def _load_cache(self):
        try:
            entry = json.loads(CACHE_PATH.read_text(encoding="utf-8")).get(self.server_url)
        except Exception:
            return None
        # entries without a timestamp come from older versions: too old to trust
        if not isinstance(entry, dict) or "saved_at" not in entry:
            return None
        if time.time() - float(entry["saved_at"]) > self.cache_ttl:
            log("cached pins expired")
            return None
        return entry.get("pins")


def evaluate(live_tools: list, pins, bonded_only: bool = False) -> list:
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
        elif bonded_only and pins.get("tier") != "BONDED":
            decision["why"] = "server is not bonded (--bonded-only)"
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
    def __init__(self, server_url: str, pins: PinSource, bonded_only: bool = False, poll: float = 30.0, out=None):
        self.server_url = server_url
        self.pins = pins
        self.bonded_only = bonded_only
        self.poll = poll
        self.out = out or sys.stdout
        self.lock = threading.Lock()
        self.write_lock = threading.Lock()
        self.tools = {}  # name -> raw tool object, allowed only
        self.decisions = []
        self.pin_source = "none"
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
        pins, source = self.pins.load()
        decisions = evaluate(digest["tools"], pins, self.bonded_only)
        # hand the client exactly the object that was hashed (no top-level _meta), so nothing
        # reaches the model that the pin does not cover
        hashed = {item["name"]: json.loads(item["canon"]) for item in digest["tools"]}
        allowed = frozenset(d["name"] for d in decisions if d["allowed"])
        with self.lock:
            changed = allowed != self.allowed_names
            self.tools = {name: hashed[name] for name in allowed if name in hashed}
            self.decisions, self.pin_source, self.last_error, self.allowed_names = decisions, source, "", allowed
        for decision in decisions:
            if not decision["allowed"]:
                log(f"blocked {decision['name']}: {decision['why']} (live {decision['live_hash'][:12]})")
        return changed

    def status_report(self) -> dict:
        with self.lock:
            return {
                "server": self.server_url,
                "pins_from": self.pin_source,
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
    parser.add_argument("--pins-url", default=os.environ.get("TOOLBOND_PINS_URL", ""),
                        help="endpoint returning get_pins JSON for ?url=<server_url>")
    parser.add_argument("--pins-file", default="", help="get_pins JSON (or {server_url: get_pins}) for offline use")
    parser.add_argument("--bonded-only", action="store_true", help="allow BONDED servers only")
    parser.add_argument("--poll", type=float, default=30.0, help="seconds between manifest checks (0 disables)")
    parser.add_argument("--cache-hours", type=float, default=CACHE_TTL_SECONDS / 3600,
                        help="how long cached pins may stand in for an unreachable registry (default 24)")
    parser.add_argument("--snapshot-max-hours", type=float, default=SNAPSHOT_MAX_AGE_SECONDS / 3600,
                        help="oldest registry snapshot the guard accepts when live contract reads are down (default 168)")
    args = parser.parse_args(argv)
    source = PinSource(args.server_url.strip(), args.pins_url, args.pins_file,
                       cache_ttl=args.cache_hours * 3600, snapshot_max_age=args.snapshot_max_hours * 3600)
    guard = Guard(args.server_url.strip(), source, bonded_only=args.bonded_only, poll=args.poll)
    log(f"guarding {guard.server_url}")
    guard.serve()
    return 0


if __name__ == "__main__":
    sys.exit(main())
