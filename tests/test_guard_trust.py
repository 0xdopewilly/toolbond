"""Trust and freshness tests for the guard's approval sources (lib/toolbond_guard.py).

Default: approvals come only from the contract, read on every refresh; anything else is
opt-in and labelled. Covered: false ACTIVE answers, stale revocations, RPC outages, expired
caches, on-chain status changes, reconstructed snapshots, answers for the wrong server, the
collateral and ownership rules, and gen_call itself over HTTP against a fake RPC.
"""

import json
import pathlib
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "lib"))

import genlayer_read  # noqa: E402
import gl_mcp  # noqa: E402
import toolbond_guard as tg  # noqa: E402

URL = "https://weather.example.com/mcp"
CONTRACT = "0x" + "ab" * 20
TOOL = {"name": "get_forecast", "description": "Get the weather.", "inputSchema": {"type": "object", "properties": {}}}
TOOL_HASH = gl_mcp.sha256_hex(gl_mcp.canonical(gl_mcp.tool_object(TOOL)))


def pins(status="ACTIVE", assurance="BONDED", url=URL, owner=False, **extra) -> dict:
    return dict({
        "known": True, "url": url, "sid": "s1", "status": status, "tier": "BONDED", "assurance": assurance,
        "bond": "10000000000000000000", "min_bond": "10000000000000000000", "owner_verified": owner,
        "tools": {"get_forecast": TOOL_HASH}, "verdicts": {"get_forecast": "SAFE"}, "contract_version": "3",
    }, **extra)


class Chain:
    """A stand-in for the contract read: an answer, or an outage."""

    def __init__(self, answer):
        self.answer, self.down, self.reads = answer, False, 0

    def __call__(self):
        self.reads += 1
        if self.down:
            raise genlayer_read.ReadError("rpc unreachable: connection refused")
        return json.dumps(self.answer)


class Relay:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def __call__(self, url):
        self.calls.append(url)
        return self.answer


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(tg, "CACHE_PATH", tmp_path / "cache.json")
    monkeypatch.setattr(tg.gl_mcp, "fetch_manifest", lambda post, url: {"protocol": "2025-06-18", "instructions": "", "tools": [TOOL]})


def guard(chain=None, relay=None, **kwargs) -> tg.Guard:
    flags = {k: kwargs.pop(k) for k in ("bonded_only", "owner_only") if k in kwargs}
    source = tg.PinSource(URL, contract=CONTRACT, reader=chain, relay="https://relay.example/api/pins" if relay else "",
                          relay_get=relay, **kwargs)
    return tg.Guard(URL, source, poll=0, **flags)


def allowed(g: tg.Guard) -> bool:
    g.refresh()
    return "get_forecast" in g.allowed_names


def test_contract_read_is_the_default_and_is_labelled_verified():
    chain = Chain(pins())
    g = guard(chain)
    assert allowed(g)
    report = g.status_report()
    assert report["approval"]["source"] == "contract" and report["approval"]["verified"] is True
    assert report["approval"]["contract"] == CONTRACT and report["assurance"] == "BONDED"
    assert "manifest integrity" in report["scope"]
    assert g.decisions[0]["approval_source"] == "contract"


def test_rpc_outage_fails_closed_by_default():
    chain = Chain(pins())
    g = guard(chain)
    assert allowed(g)
    chain.down = True
    assert not allowed(g)
    report = g.status_report()
    assert report["approval"]["source"] == "none" and "rpc unreachable" in report["approval"]["error"]


def test_a_false_active_from_a_relay_never_overrides_the_contract():
    chain = Chain(pins(status="SLASHED"))
    relay = Relay(pins(status="ACTIVE"))
    g = guard(chain, relay)
    assert not allowed(g)
    assert relay.calls == []  # the contract answered, so the relay was never asked
    assert g.decisions[0]["why"] == "server status is SLASHED"


def test_a_relay_is_opt_in_and_labelled_unverified():
    chain = Chain(pins())
    chain.down = True
    assert not allowed(guard(chain))  # no relay configured: blocked
    relay = Relay(pins())
    g = guard(chain, relay)
    assert allowed(g)  # the operator chose to trust this relay
    approval = g.status_report()["approval"]
    assert approval["source"] == "trusted-relay" and approval["verified"] is False
    assert "not verified against the contract" in approval["trust"]
    assert g.decisions[0]["approval_source"] == "trusted-relay"


def test_reconstructed_snapshots_are_refused_unless_accepted_and_fresh():
    chain = Chain(pins())
    chain.down = True
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    old = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3 * 86400))
    fresh = Relay(pins(source="snapshot", as_of=now))
    g = guard(chain, fresh)
    assert not allowed(g)
    assert "reconstructed snapshot; refused" in g.status_report()["approval"]["error"]
    g = guard(chain, fresh, accept_snapshot_hours=24)
    assert allowed(g) and g.status_report()["approval"]["source"] == "relay-snapshot"
    assert g.status_report()["approval"]["verified"] is False
    assert not allowed(guard(chain, Relay(pins(source="snapshot", as_of=old)), accept_snapshot_hours=24))
    assert not allowed(guard(chain, Relay(pins(authoritative=False, as_of="")), accept_snapshot_hours=24))


def test_answers_for_another_server_are_refused():
    assert not allowed(guard(Chain(pins(url="https://other.example.com/mcp"))))
    chain = Chain(pins())
    chain.down = True
    assert not allowed(guard(chain, Relay(pins(url="https://other.example.com/mcp"))))


def test_stale_revocations_and_expired_caches():
    chain = Chain(pins())
    g = guard(chain, cache_minutes=10)
    assert allowed(g)  # read and cached
    chain.answer = pins(status="SLASHED")  # revoked on chain...
    chain.down = True  # ...while the RPC is unreachable
    assert allowed(g)  # the opt-in cache cannot see the revocation: the documented trade-off
    assert g.status_report()["approval"]["source"] == "contract-cache"
    chain.down = False
    assert not allowed(g)  # the next successful read applies it at once
    # without the opt-in, an outage blocks instead of serving the stale approval
    chain = Chain(pins())
    g = guard(chain)
    assert allowed(g)
    chain.answer, chain.down = pins(status="SLASHED"), True
    assert not allowed(g)


def test_an_expired_cache_is_not_used(monkeypatch):
    chain = Chain(pins())
    g = guard(chain, cache_minutes=1)
    assert allowed(g)
    chain.down = True
    real_time = time.time
    monkeypatch.setattr(tg.time, "time", lambda: real_time() + 120)
    assert not allowed(g)


def test_a_cache_from_another_contract_is_not_used():
    chain = Chain(pins())
    assert allowed(guard(chain, cache_minutes=10))
    data = json.loads(tg.CACHE_PATH.read_text())
    data[URL]["contract"] = "0x" + "cd" * 20
    tg.CACHE_PATH.write_text(json.dumps(data))
    chain.down = True
    assert not allowed(guard(chain, cache_minutes=10))


def test_on_chain_status_changes_apply_on_the_next_refresh():
    chain = Chain(pins())
    g = guard(chain)
    assert allowed(g)
    for status in ("SLASHED", "PENDING_REVIEW", "EXITING", "REJECTED"):
        chain.answer = pins(status=status)
        assert g.refresh() is True  # the allowed set changed: the client is told to refresh
        assert "get_forecast" not in g.allowed_names
        chain.answer = pins()
        assert g.refresh() is True and "get_forecast" in g.allowed_names


def test_collateral_and_ownership_rules():
    assert allowed(guard(Chain(pins(assurance="UNDERCOLLATERALIZED"))))  # still pinned and SAFE
    g = guard(Chain(pins(assurance="UNDERCOLLATERALIZED")), bonded_only=True)
    assert not allowed(g) and "UNDERCOLLATERALIZED" in g.decisions[0]["why"]
    assert allowed(guard(Chain(pins()), bonded_only=True))
    legacy = pins()
    del legacy["assurance"]  # version 2 pins cannot prove their collateral
    assert not allowed(guard(Chain(legacy), bonded_only=True))
    assert not allowed(guard(Chain(pins(owner=False)), owner_only=True))
    assert allowed(guard(Chain(pins(owner=True)), owner_only=True))


def test_no_contract_configured_blocks():
    source = tg.PinSource(URL, contract="0x" + "00" * 20)
    loaded, origin = source.load()
    assert loaded is None and "no ToolBond contract" in origin["error"]


# ------------------------------------------------------------------- gen_call


def test_calldata_round_trip():
    value = {"": "get_pins", "args": ["https://x.example/mcp", 7, -3, True, False, None, [1, "a"], {"k": b"\x01"}]}
    assert genlayer_read.decode(genlayer_read.encode(value)) == value
    with pytest.raises(genlayer_read.ReadError):
        genlayer_read.decode(genlayer_read.encode("abc")[:-1])


class FakeRpc(BaseHTTPRequestHandler):
    answer = {}
    mode = "ok"

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        param = request["params"][0]
        raw = bytes.fromhex(param["data"][2:])
        # RLP list of [calldata, 0x00]: short list header, then a long or short string
        body = raw[1:] if raw[0] < 0xF8 else raw[1 + raw[0] - 0xF7:]
        if body[0] >= 0xB8:
            start = 1 + body[0] - 0xB7
            length = int.from_bytes(body[1:start], "big")
        else:
            start, length = 1, body[0] - 0x80
        message = genlayer_read.decode(body[start:start + length])
        FakeRpc.seen = (request["method"], param["to"], message)
        if FakeRpc.mode == "error":
            reply = {"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "Can't reconnect"}}
        elif FakeRpc.mode == "garbage":
            reply = {"jsonrpc": "2.0", "id": 1, "result": "0xzz"}
        else:
            reply = {"jsonrpc": "2.0", "id": 1, "result": genlayer_read.encode(json.dumps(FakeRpc.answer)).hex()}
        data = json.dumps(reply).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


@pytest.fixture
def rpc():
    server = HTTPServer(("127.0.0.1", 0), FakeRpc)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/api"
    server.shutdown()


def test_guard_reads_get_pins_over_gen_call(rpc):
    FakeRpc.answer, FakeRpc.mode = pins(), "ok"
    g = tg.Guard(URL, tg.PinSource(URL, rpc=rpc, contract=CONTRACT), poll=0)
    assert allowed(g)
    method, to, message = FakeRpc.seen
    assert method == "gen_call" and to == CONTRACT and message == {"": "get_pins", "args": [URL]}
    FakeRpc.mode = "error"
    assert not allowed(g) and "rpc error" in g.status_report()["approval"]["error"]
    FakeRpc.mode = "garbage"
    assert not allowed(g)
    FakeRpc.mode = "ok"
    assert allowed(g)


def test_unreachable_rpc_blocks(monkeypatch):
    g = tg.Guard(URL, tg.PinSource(URL, rpc="http://127.0.0.1:9/api", contract=CONTRACT), poll=0)
    assert not allowed(g)
    assert "rpc unreachable" in g.status_report()["approval"]["error"]
