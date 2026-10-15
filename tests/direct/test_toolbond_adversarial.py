"""Adversarial direct-mode tests for the version 3 invariants of contracts/toolbond.py.

Collateral: a BONDED server advertises BONDED assurance only while its bond is at least
MIN_BOND, and cannot be re-pinned or reviewed back to ACTIVE below it. Conservation: after
every write, the value the contract holds (bonded + pool + claimable_total + staked) has
changed by exactly what was paid in or withdrawn, and bonded equals the sum of the
per-server bonds. Ownership: owner_verified needs the pinned instructions to name the
publisher.

Direct mode does not move value on payable calls, so the Books ledger plays the network: it
records every deposit and withdrawal and sets the contract's balance to match (vm.deal), which
lets withdraw run and get_accounting compare the held total with that balance.
"""

import json

import pytest

from test_toolbond import (  # noqa: F401  (fixtures and helpers shared with the main suite)
    CONTENT_STAKE, CONTRACT, DRIFT_STAKE, GEN, HONEST, MIN_BOND, POISON_TEXT, POISONED, REVIEW_FEE, SPAM_FEE,
    TREASURY, URL, URL_RE, at, bond, claimable, hexof, llm_says, paid, serve, serve_raw, server, sse,
)

FIXTURE_PAID = MIN_BOND + REVIEW_FEE  # what the bond fixture's registration paid in


def benign(k: int) -> dict:
    """A harmless variant of the honest tool: a different forecast horizon per k."""
    return dict(HONEST, description=HONEST["description"].replace("24 hours", str(24 + k) + " hours"))


def serve_with(vm, tools, instructions: str):
    init = {
        "protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
        "serverInfo": {"name": "demo", "version": "1"}, "instructions": instructions,
    }
    body = sse({"jsonrpc": "2.0", "id": 1, "result": init}) + sse({"jsonrpc": "2.0", "id": 2, "result": {"tools": tools}})
    vm.mock_web(URL_RE, {"method": "POST", "response": {"status": 200, "headers": {}, "body": body.encode()}})


def pins(contract) -> dict:
    return json.loads(contract.get_pins(URL))


class Books:
    """The value the contract should hold: every deposit in, every withdrawal out."""

    def __init__(self, contract, vm, start: int = 0):
        self.contract, self.vm, self.expected = contract, vm, start
        self.address = vm._contract_address
        vm.deal(self.address, start)
        self.check()

    def pay(self, vm, value, fn, *args):
        self.vm.deal(self.address, self.expected + value)  # the network credits the value first
        result = paid(vm, value, fn, *args)  # payable methods never raise: refusals are credited
        self.expected += value
        self.check()
        return result

    def withdraw(self, vm, who):
        vm.sender = who
        amount = claimable(self.contract, hexof(who))
        self.contract.withdraw()
        self.expected -= amount
        self.vm.deal(self.address, self.expected)  # the transfer leaves at finalization
        self.check()

    def check(self) -> dict:
        books = json.loads(self.contract.get_accounting())
        held = int(books["bonded"]) + int(books["pool"]) + int(books["claimable_total"]) + int(books["staked"])
        assert int(books["held"]) == held == self.expected, (books, self.expected)
        assert books["bonded"] == books["bond_sum"], books
        assert books["balance"] == str(self.expected) and books["conserved"] is True, books
        return books


def benign_drift(vm, books, sid, k: int, hunter) -> dict:
    """File, observe, judge SAFE and settle one benign change. Returns the settled challenge."""
    contract = books.contract
    vm.sender = hunter
    cid = books.pay(vm, DRIFT_STAKE, contract.challenge, sid, "", "DRIFT")["cid"]
    serve(vm, [benign(k)])
    contract.observe(cid, "content")
    if json.loads(contract.get_challenge(cid))["drift"] == "DIFFERS":
        llm_says(vm, "SAFE")
        contract.judge(cid)
    contract.settle(cid)
    vm.clear_mocks()
    books.check()
    return json.loads(contract.get_challenge(cid))


def repin(vm, books, sid, tools, publisher):
    vm.sender = publisher
    serve(vm, tools)
    books.contract.snapshot(sid)
    llm_says(vm, "SAFE")
    books.contract.review(sid)
    vm.clear_mocks()
    books.check()


# ------------------------------------------------------------------- collateral


def test_a_benign_drift_below_the_minimum_drops_bonded_assurance(direct_vm, bond, direct_bob):
    contract, sid = bond
    books = Books(contract, direct_vm, FIXTURE_PAID)
    assert pins(contract)["assurance"] == "BONDED"
    settled = benign_drift(direct_vm, books, sid, 1, direct_bob)
    assert settled["verdict"] == "SAFE"
    view = pins(contract)
    assert view["status"] == "STALE"
    assert view["tier"] == "BONDED"  # the registration tier is history
    assert view["assurance"] == "UNDERCOLLATERALIZED"  # what clients act on
    assert view["bond"] == str(MIN_BOND * 95 // 100) and view["min_bond"] == str(MIN_BOND)
    assert json.loads(contract.list_servers(0, 10))["items"][0]["assurance"] == "UNDERCOLLATERALIZED"
    assert json.loads(contract.get_server(sid))["assurance"] == "UNDERCOLLATERALIZED"


def test_re_pinning_a_drained_bond_needs_a_top_up(direct_vm, bond, direct_alice, direct_bob):
    contract, sid = bond
    books = Books(contract, direct_vm, FIXTURE_PAID)
    benign_drift(direct_vm, books, sid, 1, direct_bob)
    direct_vm.sender = direct_alice
    serve(direct_vm, [benign(1)])
    with pytest.raises(Exception, match="top_up first"):
        contract.snapshot(sid)
    assert pins(contract)["status"] == "STALE"
    # a partial top-up is not enough
    assert books.pay(direct_vm, MIN_BOND // 100, contract.top_up, sid)["assurance"] == "UNDERCOLLATERALIZED"
    with pytest.raises(Exception, match="top_up first"):
        contract.snapshot(sid)
    restored = books.pay(direct_vm, MIN_BOND * 4 // 100, contract.top_up, sid)
    assert restored["ok"] and restored["assurance"] == "BONDED" and restored["bond"] == str(MIN_BOND)
    repin(direct_vm, books, sid, [benign(1)], direct_alice)
    view = pins(contract)
    assert view["status"] == "ACTIVE" and view["assurance"] == "BONDED"


def test_no_challenge_can_drain_a_bond_under_review(direct_vm, bond, direct_alice, direct_bob):
    """The review gate's precondition: once a snapshot is taken, the bond cannot shrink before
    review promotes the server, because challenges need ACTIVE, STALE or EXITING."""
    contract, sid = bond
    books = Books(contract, direct_vm, FIXTURE_PAID)
    direct_vm.sender = direct_alice
    serve(direct_vm, [benign(5)])
    contract.snapshot(sid)  # an announced update while the bond is whole
    direct_vm.clear_mocks()
    assert pins(contract)["status"] == "PENDING_REVIEW"
    direct_vm.sender = direct_bob
    for kind, tool, stake in (("DRIFT", "", DRIFT_STAKE), ("CONTENT", "get_forecast", CONTENT_STAKE)):
        refused = books.pay(direct_vm, stake, contract.challenge, sid, tool, kind)
        assert refused["ok"] is False and "PENDING_REVIEW" in refused["error"]
    assert pins(contract)["bond"] == str(MIN_BOND)


def test_top_up_refusals_are_refunded(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT, TREASURY)
    books = Books(contract, direct_vm)
    direct_vm.sender = direct_alice
    bonded = books.pay(direct_vm, MIN_BOND + REVIEW_FEE, contract.register, URL, "Weather forecasts for a city.", "network")["sid"]
    reviewed = books.pay(direct_vm, REVIEW_FEE, contract.sponsor_review, "https://docs.example.org/mcp", "Docs search.", "network")["sid"]
    direct_vm.sender = direct_bob
    outside = books.pay(direct_vm, GEN, contract.top_up, bonded)
    assert outside["ok"] is False and "publisher" in outside["error"]
    direct_vm.sender = direct_alice
    assert "only BONDED" in books.pay(direct_vm, GEN, contract.top_up, reviewed)["error"]
    assert "unknown" in books.pay(direct_vm, GEN, contract.top_up, "nope")["error"]
    assert "amount" in books.pay(direct_vm, 0, contract.top_up, bonded)["error"]
    contract.request_exit(bonded)
    assert "EXITING" in books.pay(direct_vm, GEN, contract.top_up, bonded)["error"]
    assert claimable(contract, hexof(direct_bob)) == GEN
    assert claimable(contract, hexof(direct_alice)) == 3 * GEN
    assert server(contract, bonded)["bond"] == str(MIN_BOND)


def test_repeated_benign_drift_depletes_but_never_restores_assurance(direct_vm, bond, direct_alice, direct_bob):
    contract, sid = bond
    books = Books(contract, direct_vm, FIXTURE_PAID)
    expected = MIN_BOND
    for k in range(1, 9):
        settled = benign_drift(direct_vm, books, sid, k, direct_bob)
        assert settled["drift"] == "DIFFERS" and settled["verdict"] == "SAFE"
        expected -= expected * 5 // 100
        view = pins(contract)
        assert view["bond"] == str(expected)
        assert view["status"] == "STALE" and view["assurance"] == "UNDERCOLLATERALIZED"
    # the same change again is KNOWN: penalised once, never twice
    again = benign_drift(direct_vm, books, sid, 8, direct_bob)
    assert again["drift"] == "KNOWN" and pins(contract)["bond"] == str(expected)
    # nobody brings it back to ACTIVE without restoring the full minimum
    direct_vm.sender = direct_alice
    serve(direct_vm, [benign(8)])
    with pytest.raises(Exception, match="top_up first"):
        contract.snapshot(sid)


def test_drift_rewards_cannot_overdraw_the_bond(direct_vm, bond, direct_bob):
    contract, sid = bond
    books = Books(contract, direct_vm, FIXTURE_PAID)
    for k in range(1, 40):
        benign_drift(direct_vm, books, sid, k, direct_bob)
    bond_left = int(pins(contract)["bond"])
    assert 0 < bond_left < MIN_BOND // 5
    assert books.check()["staked"] == "0"


def test_a_colluding_publisher_and_hunter_gain_nothing(direct_vm, bond, direct_alice, direct_bob):
    """Alice publishes, Bob hunts for her. Whatever they do, the coalition never ends with more
    than it put in, the drained bond reads UNDERCOLLATERALIZED at once, and getting BONDED
    assurance back costs exactly what was drained."""
    contract, sid = bond
    books = Books(contract, direct_vm, FIXTURE_PAID)
    alice, bob = hexof(direct_alice), hexof(direct_bob)
    for k in range(1, 4):
        benign_drift(direct_vm, books, sid, k, direct_bob)
    # re-filing the change already penalised is KNOWN: it only moves the spam fee from Bob to Alice
    known = benign_drift(direct_vm, books, sid, 3, direct_bob)
    assert known["drift"] == "KNOWN"
    drained = MIN_BOND - int(pins(contract)["bond"])
    assert drained > 0 and pins(contract)["assurance"] == "UNDERCOLLATERALIZED"
    # restoring assurance costs exactly the drained amount
    direct_vm.sender = direct_alice
    assert books.pay(direct_vm, drained - 1, contract.top_up, sid)["assurance"] == "UNDERCOLLATERALIZED"
    assert books.pay(direct_vm, 1, contract.top_up, sid)["assurance"] == "BONDED"
    holdings = claimable(contract, alice) + claimable(contract, bob) + int(pins(contract)["bond"])
    # everything the coalition paid in, minus the review fee the treasury kept: nothing was created
    assert holdings == books.expected - REVIEW_FEE
    assert books.check()["pool"] == "0"


def test_a_poisoned_change_after_a_top_up_still_costs_the_whole_bond(direct_vm, bond, direct_alice, direct_bob):
    contract, sid = bond
    books = Books(contract, direct_vm, FIXTURE_PAID)
    benign_drift(direct_vm, books, sid, 1, direct_bob)
    direct_vm.sender = direct_alice
    books.pay(direct_vm, 2 * MIN_BOND, contract.top_up, sid)
    repin(direct_vm, books, sid, [benign(1)], direct_alice)
    full = int(pins(contract)["bond"])
    direct_vm.sender = direct_bob
    cid = books.pay(direct_vm, DRIFT_STAKE, contract.challenge, sid, "", "DRIFT")["cid"]
    serve(direct_vm, [POISONED])
    contract.observe(cid, "content")
    llm_says(direct_vm, "POISONED", "get_forecast", POISON_TEXT)
    contract.judge(cid)
    contract.settle(cid)
    view = pins(contract)
    assert view["status"] == "SLASHED" and view["bond"] == "0" and view["assurance"] == "UNDERCOLLATERALIZED"
    assert int(books.check()["pool"]) == full - full // 2


# ----------------------------------------------------------------- conservation


def test_every_payout_row_conserves_value(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT, TREASURY)
    books = Books(contract, direct_vm)
    direct_vm.sender = direct_alice
    books.pay(direct_vm, MIN_BOND, contract.register, URL, "Weather forecasts for a city.", "network")  # refused
    sid = books.pay(direct_vm, MIN_BOND + REVIEW_FEE + GEN, contract.register, URL, "Weather forecasts for a city.", "network")["sid"]
    repin(direct_vm, books, sid, [HONEST], direct_alice)
    direct_vm.sender = direct_bob
    # CONTENT ruled SAFE: the stake goes to the publisher; the excess is refunded
    cid = books.pay(direct_vm, CONTENT_STAKE + 7, contract.challenge, sid, "get_forecast", "CONTENT")["cid"]
    assert books.check()["staked"] == str(CONTENT_STAKE)
    llm_says(direct_vm, "SAFE")
    contract.judge(cid)
    contract.settle(cid)
    direct_vm.clear_mocks()
    books.check()
    # CONTENT ruled UNCLEAR: refunded, server marked contested
    cid = books.pay(direct_vm, CONTENT_STAKE, contract.challenge, sid, "get_forecast", "CONTENT")["cid"]
    llm_says(direct_vm, "UNCLEAR")
    contract.judge(cid)
    contract.settle(cid)
    direct_vm.clear_mocks()
    books.check()
    # DRIFT MATCH: the spam fee goes to the publisher
    cid = books.pay(direct_vm, DRIFT_STAKE, contract.challenge, sid, "", "DRIFT")["cid"]
    serve(direct_vm, [HONEST])
    contract.observe(cid, "content")
    contract.settle(cid)
    direct_vm.clear_mocks()
    books.check()
    # UNREACHABLE: the stake is refunded
    cid = books.pay(direct_vm, DRIFT_STAKE, contract.challenge, sid, "", "DRIFT")["cid"]
    serve(direct_vm, [HONEST], status=503)
    contract.observe(cid, "content")
    contract.settle(cid)
    direct_vm.clear_mocks()
    books.check()
    # UNPINNED: a quarter of the bond, half of it to the pool
    cid = books.pay(direct_vm, DRIFT_STAKE, contract.challenge, sid, "", "DRIFT")["cid"]
    serve_raw(direct_vm, "not a manifest")
    contract.observe(cid, "content")
    contract.settle(cid)
    direct_vm.clear_mocks()
    assert int(books.check()["pool"]) > 0
    # an unjudged challenge that expires
    cid = books.pay(direct_vm, DRIFT_STAKE, contract.challenge, sid, "", "DRIFT")["cid"]
    at(direct_vm, "2030-01-01T00:00:00Z")
    contract.expire(cid)
    books.check()
    # withdrawals leave exactly what they take
    for who in (direct_bob, direct_alice):
        books.withdraw(direct_vm, who)
    # topping up and exiting returns the remaining bond to the publisher
    direct_vm.sender = direct_alice
    books.pay(direct_vm, MIN_BOND, contract.top_up, sid)
    contract.request_exit(sid)
    at(direct_vm, "2031-01-01T00:00:00Z")
    contract.finalize_exit(sid)
    final = books.check()
    assert final["bonded"] == "0" and final["staked"] == "0"


def test_rejection_and_sponsored_reviews_conserve_value(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy(CONTRACT, TREASURY)
    books = Books(contract, direct_vm)
    direct_vm.sender = direct_alice
    sid = books.pay(direct_vm, MIN_BOND + REVIEW_FEE, contract.register, URL, "Weather forecasts", "network")["sid"]
    serve(direct_vm, [POISONED])
    contract.snapshot(sid)
    llm_says(direct_vm, "POISONED", "get_forecast", POISON_TEXT)
    contract.review(sid)
    direct_vm.clear_mocks()
    assert server(contract, sid)["status"] == "REJECTED"
    books.check()
    books.pay(direct_vm, REVIEW_FEE + GEN, contract.sponsor_review, "https://docs.example.org/mcp", "Docs search.", "network")
    books.withdraw(direct_vm, direct_alice)


# -------------------------------------------------------------------- ownership


def test_owner_proof_must_name_the_publisher(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT, TREASURY)
    direct_vm.sender = direct_alice
    sid = paid(direct_vm, MIN_BOND + REVIEW_FEE, contract.register, URL, "Weather forecasts for a city.", "network")["sid"]
    assert pins(contract)["owner_verified"] is False
    alice, bob = hexof(direct_alice), hexof(direct_bob)
    for instructions, expected in [
        ("Weather tools.", False),
        ("Weather tools. toolbond-owner:" + bob, False),  # somebody else's address
        ("Weather tools. toolbond-owner:" + alice[:-1], False),  # malformed
        ("Weather tools.\nToolBond-Owner: 0x" + alice[2:].upper(), True),  # case and spacing do not matter
    ]:
        direct_vm.sender = direct_alice
        serve_with(direct_vm, [HONEST], instructions)
        contract.snapshot(sid)
        direct_vm.clear_mocks()
        assert pins(contract)["owner_verified"] is expected, instructions
    llm_says(direct_vm, "SAFE")
    contract.review(sid)
    assert pins(contract)["owner_verified"] is True and pins(contract)["status"] == "ACTIVE"


def test_a_new_registrant_does_not_inherit_owner_verification(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy(CONTRACT, TREASURY)
    books = Books(contract, direct_vm)
    direct_vm.sender = direct_alice
    sid = books.pay(direct_vm, REVIEW_FEE, contract.sponsor_review, URL, "Weather forecasts for a city.", "network")["sid"]
    serve_with(direct_vm, [HONEST], "toolbond-owner:" + hexof(direct_alice))
    contract.snapshot(sid)
    direct_vm.clear_mocks()
    assert pins(contract)["owner_verified"] is True and pins(contract)["assurance"] == "REVIEWED"
    # bob bonds the same URL: the bond replaces the sponsored review, and alice's proof does not name him
    direct_vm.sender = direct_bob
    assert books.pay(direct_vm, MIN_BOND + REVIEW_FEE, contract.register, URL, "Weather forecasts for a city.", "network")["ok"]
    assert pins(contract)["owner_verified"] is False
    serve_with(direct_vm, [HONEST], "toolbond-owner:" + hexof(direct_alice))
    contract.snapshot(sid)
    assert pins(contract)["owner_verified"] is False
