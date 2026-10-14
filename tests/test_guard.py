"""End-to-end tests for lib/toolbond_guard.py against the demo MCP server (needs node)."""

import json
import os
import pathlib
import queue
import shutil
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))

import gl_mcp  # noqa: E402
import toolbond_guard  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is needed for the demo server")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture(scope="module")
def demo():
    port = free_port()
    proc = subprocess.Popen(["node", str(ROOT / "apps/demo-mcp/server.js"), str(port)], stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    yield base
    proc.terminate()


def pins_for(url: str, status: str = "ACTIVE", verdict: str = "SAFE") -> dict:
    digest = gl_mcp.digest_manifest(gl_mcp.fetch_manifest(toolbond_guard.http_post, url))
    return {
        "known": True, "sid": "x", "url": url, "status": status, "tier": "BONDED", "root": digest["root"],
        "tools": {t["name"]: t["hash"] for t in digest["tools"]},
        "verdicts": {t["name"]: verdict for t in digest["tools"]}, "open_challenges": 0, "updated_at": "",
    }


class Session:
    """The guard as a subprocess, spoken to over newline-delimited JSON-RPC like an MCP client."""

    def __init__(self, url: str, pins_file: str, poll: float = 0, tmp: pathlib.Path = None):
        env = dict(os.environ, TOOLBOND_CACHE=str(tmp / "cache.json"))
        self.proc = subprocess.Popen(
            [sys.executable, str(ROOT / "lib/toolbond_guard.py"), url, "--pins-file", pins_file, "--poll", str(poll)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env,
        )
        self.lines = queue.Queue()
        threading.Thread(target=self._pump, daemon=True).start()
        self.next_id = 1

    def _pump(self):
        for line in self.proc.stdout:
            self.lines.put(json.loads(line))

    def request(self, method: str, params: dict = None) -> dict:
        request_id = self.next_id
        self.next_id += 1
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}) + "\n")
        self.proc.stdin.flush()
        while True:
            message = self.lines.get(timeout=30)
            if message.get("id") == request_id:
                return message

    def wait_notification(self, method: str, timeout: float) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                message = self.lines.get(timeout=max(0.05, deadline - time.time()))
            except queue.Empty:
                return False
            if message.get("method") == method:
                return True
        return False

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)


def names(reply: dict) -> list:
    return [tool["name"] for tool in reply["result"]["tools"]]


def test_evaluate_rules():
    live = [{"name": "a", "hash": "1"}, {"name": "b", "hash": "2"}, {"name": "c", "hash": "3"}]
    pins = {"known": True, "status": "ACTIVE", "tier": "REVIEWED", "tools": {"a": "1", "b": "X"}, "verdicts": {"a": "SAFE", "b": "SAFE"}}
    decided = {d["name"]: d for d in toolbond_guard.evaluate(live, pins)}
    assert decided["a"]["allowed"] and not decided["b"]["allowed"] and not decided["c"]["allowed"]
    assert decided["b"]["why"] == "tool changed since it was pinned"
    assert not toolbond_guard.evaluate(live, pins, bonded_only=True)[0]["allowed"]
    assert not toolbond_guard.evaluate(live, dict(pins, status="SLASHED"))[0]["allowed"]
    assert not toolbond_guard.evaluate(live, None)[0]["allowed"]


def test_pinned_tool_is_listed_and_callable(demo, tmp_path):
    url = demo + "/mcp/honest"
    pins = tmp_path / "pins.json"
    pins.write_text(json.dumps(pins_for(url)))
    session = Session(url, str(pins), tmp=tmp_path)
    try:
        assert session.request("initialize", {"protocolVersion": "2025-06-18"})["result"]["serverInfo"]["name"] == "toolbond-guard"
        assert names(session.request("tools/list")) == ["get_forecast", "toolbond_status"]
        reply = session.request("tools/call", {"name": "get_forecast", "arguments": {"city": "Lisbon"}})
        assert "DEMO forecast for Lisbon" in reply["result"]["content"][0]["text"]
    finally:
        session.close()


def test_poisoned_tool_is_hidden_and_refused(demo, tmp_path):
    pins = tmp_path / "pins.json"
    pins.write_text(json.dumps(pins_for(demo + "/mcp/honest")))  # pinned honest bytes, server now poisoned
    session = Session(demo + "/mcp/poisoned", str(pins), tmp=tmp_path)
    try:
        assert names(session.request("tools/list")) == ["toolbond_status"]
        reply = session.request("tools/call", {"name": "get_forecast", "arguments": {"city": "Lisbon"}})
        assert reply["result"]["isError"] is True
        assert "changed since it was pinned" in reply["result"]["content"][0]["text"]
        status = json.loads(session.request("tools/call", {"name": "toolbond_status"})["result"]["content"][0]["text"])
        assert status["tools"][0]["allowed"] is False and status["pins_from"] == "file"
    finally:
        session.close()


def test_slashed_server_blocks_everything(demo, tmp_path):
    url = demo + "/mcp/honest"
    pins = tmp_path / "pins.json"
    pins.write_text(json.dumps(pins_for(url, status="SLASHED")))
    session = Session(url, str(pins), tmp=tmp_path)
    try:
        assert names(session.request("tools/list")) == ["toolbond_status"]
    finally:
        session.close()


def test_rug_pull_mid_session_notifies_and_blocks(demo, tmp_path):
    at = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat().replace("+00:00", "Z")
    url = demo + "/mcp/rugpull?at=" + at
    pins = tmp_path / "pins.json"
    pins.write_text(json.dumps(pins_for(url)))  # pinned while still honest
    session = Session(url, str(pins), poll=0.5, tmp=tmp_path)
    try:
        assert names(session.request("tools/list")) == ["get_forecast", "toolbond_status"]
        assert session.wait_notification("notifications/tools/list_changed", timeout=8)
        assert names(session.request("tools/list")) == ["toolbond_status"]
        reply = session.request("tools/call", {"name": "get_forecast", "arguments": {"city": "Lisbon"}})
        assert reply["result"]["isError"] is True
    finally:
        session.close()


def test_no_pins_fails_closed(demo, tmp_path):
    session = Session(demo + "/mcp/honest", str(tmp_path / "missing.json"), tmp=tmp_path)
    try:
        assert names(session.request("tools/list")) == ["toolbond_status"]
    finally:
        session.close()


def test_guard_forwards_the_hashed_object_and_reserves_its_status_tool():
    live = [{"name": toolbond_guard.STATUS_TOOL, "hash": "h"}]
    pins = {"known": True, "status": "ACTIVE", "tier": "BONDED", "tools": {toolbond_guard.STATUS_TOOL: "h"},
            "verdicts": {toolbond_guard.STATUS_TOOL: "SAFE"}}
    decision = toolbond_guard.evaluate(live, pins)[0]
    assert not decision["allowed"] and "reserved" in decision["why"]


def test_old_snapshots_and_cache_entries_are_not_trusted(tmp_path, monkeypatch):
    monkeypatch.setattr(toolbond_guard, "CACHE_PATH", tmp_path / "cache.json")
    source = toolbond_guard.PinSource("https://example.com/mcp", cache_ttl=60)
    source._save_cache({"known": True, "status": "ACTIVE"})
    assert source._load_cache() == {"known": True, "status": "ACTIVE"}
    data = json.loads((tmp_path / "cache.json").read_text())
    data["https://example.com/mcp"]["saved_at"] -= 3600
    (tmp_path / "cache.json").write_text(json.dumps(data))
    assert source._load_cache() is None
    (tmp_path / "cache.json").write_text(json.dumps({"https://example.com/mcp": {"known": True}}))  # pre-0.2 format
    assert source._load_cache() is None
    assert toolbond_guard._iso_seconds("2026-10-14T08:00:00Z") > 1.7e9
