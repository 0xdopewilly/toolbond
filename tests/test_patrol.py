"""Unit tests for bot/patrol.py with a fake chain and fake manifests."""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bot"))

import patrol  # noqa: E402

URL = "https://weather.example.com/mcp"


class FakeTx:
    def __init__(self, drift="DIFFERS", verdict="POISONED"):
        self.calls = []
        self.drift, self.verdict = drift, verdict

    def write(self, method, *args, value=""):
        self.calls.append((method, args, value))
        reply = {"ok": True, "hash": "0x" + str(len(self.calls)), "votes": ["agree"] * 3}
        if method == "challenge":
            reply["returned"] = {"ok": True, "value": {"ok": True, "cid": "c7"}}
        if method == "observe":
            reply["outputs"] = [{"ok": True, "value": {"drift": self.drift}}]
        if method == "judge":
            reply["outputs"] = [{"ok": True, "value": {"verdict": self.verdict}}]
        return reply


def pins(root="pinned", status="ACTIVE", open_challenges=0):
    return {"known": True, "status": status, "root": root, "open_challenges": open_challenges}


def make(tmp_path, roots, tx=None, pin=None):
    roots = list(roots)
    tx = tx or FakeTx()
    p = patrol.Patrol(tx, lambda url: pin if pin is not None else pins(), tmp_path / "state.json",
                      fetch=lambda url: {"root": roots.pop(0) if len(roots) > 1 else roots[0]})
    return p, tx


def test_match_attests_once_then_stays_quiet(tmp_path, capsys):
    p, tx = make(tmp_path, ["pinned"])
    p.check(URL)
    p.check(URL)
    assert [c[0] for c in tx.calls] == ["attest"]


def test_drift_runs_the_full_challenge_in_order(tmp_path):
    p, tx = make(tmp_path, ["changed", "changed"])
    p.check(URL)
    assert [c[0] for c in tx.calls] == ["challenge", "observe", "judge", "settle"]
    assert tx.calls[0] == ("challenge", (patrol.sid_of(URL), "", "DRIFT"), "0.5")
    assert tx.calls[1][1] == ("c7", "content")
    assert json.loads((tmp_path / "state.json").read_text())["challenges"] == {}


def test_match_after_challenge_skips_judging(tmp_path):
    p, tx = make(tmp_path, ["changed", "changed"], tx=FakeTx(drift="MATCH"))
    p.check(URL)
    assert [c[0] for c in tx.calls] == ["challenge", "observe", "settle"]


def test_open_challenge_on_chain_is_left_alone(tmp_path):
    p, tx = make(tmp_path, ["changed", "changed"], pin=pins(open_challenges=1))
    p.check(URL)
    assert tx.calls == []


def test_unwatched_status_is_skipped(tmp_path):
    p, tx = make(tmp_path, ["changed"], pin=pins(status="SLASHED"))
    p.check(URL)
    assert tx.calls == []


def test_resumes_from_state_without_refiling(tmp_path):
    (tmp_path / "state.json").write_text(json.dumps(
        {"challenges": {patrol.sid_of(URL): {"cid": "c3", "stage": "OBSERVED", "drift": "DIFFERS"}}, "attested": {}}))
    p, tx = make(tmp_path, ["changed"])
    p.check(URL)
    assert [c[0] for c in tx.calls] == ["judge", "settle"]
    assert tx.calls[0][1] == ("c3",)


def test_dry_run_sends_nothing():
    runner = patrol.TxRunner("0xabc", dry_run=True)
    reply = runner.write("challenge", "sid", "", "DRIFT", value="0.5")
    assert reply["dry_run"] and reply["command"] == ["0xabc", "challenge", "--value", "0.5", "sid", "", "DRIFT"]
