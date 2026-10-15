# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""ToolBond: bonded, hash-pinned MCP tool manifests, adjudicated by GenLayer validators.

A publisher bonds GEN behind the exact text of an MCP server's tools. Validators fetch
the live manifest themselves and must derive identical TBCM-1 hashes (snapshot), then
two independent model readings per validator decide SAFE / POISONED / UNCLEAR for each
batch of tools (review). Anyone can challenge: a CONTENT challenge says a pinned tool is
poisoned; a DRIFT challenge says the live manifest no longer matches the pin. Validators
re-fetch (observe), judge only content that every one of them verified, and the
contract settles the stakes and slashes the bond.

Consensus design, in one line per decision:
- snapshot: exact equality of the canonical digest and the code-computed red flags;
- observe: agree on a drift class; DIFFERS only with the same new root, so stored
  changed tools are verified content; UNSTABLE and UNPINNED only when each validator
  sees them itself; UNREACHABLE is a safe harbour;
- judge: agree on the verdict word only; UNCLEAR is a safe harbour; POISONED must quote
  text that code finds in the tool; hard red flags make SAFE impossible.

Version 3 invariants:
- collateral: a BONDED server advertises BONDED assurance only while its bond is at least
  MIN_BOND; below it the assurance reads UNDERCOLLATERALIZED, and the publisher must top_up
  before re-pinning or returning to ACTIVE;
- conservation: balance == bonded + pool + claimable_total + staked, readable in get_accounting;
- ownership: a registrant is only a registrant; owner_verified is true when the pinned server
  instructions carry "toolbond-owner:<publisher address>", which validators fetched themselves.
The interface is documented in docs/CONTRACT_API.md.
"""

import json
import typing
from dataclasses import dataclass

import genlayer as gl
from genlayer.storage import allow as allow_storage

# @@include gl_mcp
# @@include redflags
# @@include judge

ERR_EXPECTED = "[EXPECTED]"

CONTRACT_VERSION = "3"
GEN = 10**18
MIN_BOND = 10 * GEN
REVIEW_FEE = GEN // 5
CONTENT_STAKE = GEN
DRIFT_STAKE = GEN // 2
DRIFT_SPAM_FEE = GEN // 10
CHALLENGE_TTL = 72 * 3600
MAX_ATTEMPTS = 3
EXIT_DELAY = 7 * 86400
REVIEW_BATCH = 6
DRIFT_SAFE_REWARD_PCT = 5
DRIFT_UNPINNED_SLASH_PCT = 25
REJECT_FEE_PCT = 10

MAX_URL_CHARS = 200
MAX_PURPOSE_CHARS = 280
MAX_LIST = 50
ALLOWED_CAPS = ("none", "network", "filesystem", "credentials", "shell", "payments")
INSTRUCTIONS_KEY = "__instructions__"

TIER_BONDED = "BONDED"
TIER_REVIEWED = "REVIEWED"
ASSURANCE_UNDERCOLLATERALIZED = "UNDERCOLLATERALIZED"
OWNER_TAG = "toolbond-owner:"

ST_PENDING_SNAPSHOT = "PENDING_SNAPSHOT"
ST_PENDING_REVIEW = "PENDING_REVIEW"
ST_ACTIVE = "ACTIVE"
ST_STALE = "STALE"
ST_REJECTED = "REJECTED"
ST_SLASHED = "SLASHED"
ST_EXITING = "EXITING"
ST_EXITED = "EXITED"
REUSABLE_STATUSES = (ST_REJECTED, ST_EXITED)

KIND_CONTENT = "CONTENT"
KIND_DRIFT = "DRIFT"

STAGE_FILED = "FILED"
STAGE_OBSERVED = "OBSERVED"
STAGE_JUDGED = "JUDGED"
STAGE_SETTLED = "SETTLED"
STAGE_EXPIRED = "EXPIRED"

DRIFT_MATCH = "MATCH"
DRIFT_DIFFERS = "DIFFERS"
DRIFT_UNSTABLE = "UNSTABLE"
DRIFT_UNPINNED = "UNPINNED"
DRIFT_UNREACHABLE = "UNREACHABLE"
DRIFT_KNOWN = "KNOWN"
DRIFT_CLASSES = (DRIFT_MATCH, DRIFT_DIFFERS, DRIFT_UNSTABLE, DRIFT_UNPINNED, DRIFT_UNREACHABLE, DRIFT_KNOWN)

MAX_CHANGED_TOOLS = 4
MAX_REASON_STORE = 300
HOST_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789.-"
PRIVATE_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home", ".arpa")


# ---------------------------------------------------------------------------- helpers


def _fail(message: str) -> typing.NoReturn:
    raise gl.vm.UserError(ERR_EXPECTED + " " + message)


def _hex(address: typing.Any) -> str:
    return (address.as_hex if hasattr(address, "as_hex") else str(address)).lower()


def _sender() -> str:
    return _hex(gl.message.sender_address)


def _now() -> str:
    """The transaction's own ISO datetime, identical on every validator ("" if absent)."""
    try:
        value = getattr(gl.message, "datetime", None)
        return str(value) if value else ""
    except Exception:
        return ""


def _instant_seconds(iso: str) -> int:
    """Seconds since 1970 for an ISO-8601 UTC instant, integer arithmetic only (floats and the
    datetime module trap GenVM in deterministic mode). -1 when unreadable."""
    try:
        text = iso.strip()
        if text.endswith("Z"):
            text = text[:-1]
        elif text.endswith("+00:00"):
            text = text[:-6]
        date_part, _, time_part = text.partition("T")
        year, month, day = (int(x) for x in date_part.split("-"))
        parts = (time_part.split(":") + ["0", "0", "0"])[:3]
        hour, minute = int(parts[0] or "0"), int(parts[1] or "0")
        second = int(parts[2].split(".")[0] or "0")
        if not (1 <= month <= 12 and 1 <= day <= 31 and 0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 61):
            return -1
        y = year - (1 if month <= 2 else 0)
        era = (y if y >= 0 else y - 399) // 400
        yoe = y - era * 400
        doy = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
        doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
        return (era * 146097 + doe - 719468) * 86400 + hour * 3600 + minute * 60 + second
    except Exception:
        return -1


def _now_s() -> int:
    seconds = _instant_seconds(_now())
    return seconds if seconds > 0 else 0


def _sid(url: str) -> str:
    return sha256_hex(url)[:16]


def _host(url: str) -> str:
    """The authority of an https URL: everything up to the first / ? # or backslash."""
    rest = url[len("https://"):]
    end = len(rest)
    for separator in "/?#\\":
        index = rest.find(separator)
        if 0 <= index < end:
            end = index
    return rest[:end].lower()


def _url_problem(url: str) -> str:
    if len(url) > MAX_URL_CHARS:
        return "url is longer than " + str(MAX_URL_CHARS) + " characters"
    if not url.startswith("https://"):
        return "url must start with https://"
    if any(ch.isspace() for ch in url) or "\\" in url:
        return "url must not contain whitespace or backslashes"
    host = _host(url)
    if not host or any(ch not in HOST_CHARS for ch in host):
        return "url host must be a domain name without port, credentials or other symbols"
    labels = host.split(".")
    if len(labels) < 2 or not all(labels) or not labels[-1].isalpha():
        return "url host must be a public domain name"
    if host == "localhost" or host.endswith(PRIVATE_SUFFIXES):
        return "url host must be a public domain name"
    return ""


def _normalize_caps(caps: str) -> str:
    """Sorted, de-duplicated capability list, or "" when it contains an unknown capability."""
    items = sorted({part.strip().lower() for part in str(caps).split(",") if part.strip()})
    if not items or any(item not in ALLOWED_CAPS for item in items):
        return ""
    if "none" in items and len(items) > 1:
        return ""
    return ",".join(items)


def _is_address(text: str) -> bool:
    if len(text) != 42 or not text.startswith("0x"):
        return False
    return all(ch in "0123456789abcdef" for ch in text[2:])


def _owner_claim(instructions: str) -> str:
    """The address a server names as its ToolBond owner in its own instructions ("" when none).
    The instructions are part of the pinned root, so this is text every validator fetched."""
    text = str(instructions).lower()
    index = text.find(OWNER_TAG)
    if index < 0:
        return ""
    candidate = text[index + len(OWNER_TAG):].strip()[:42]
    return candidate if _is_address(candidate) else ""


def _dumps(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _error_text(err: typing.Any) -> str:
    for attr in ("data", "message"):
        value = getattr(err, attr, None)
        if isinstance(value, str) and value:
            return value
    return str(err)


def _same_failure(leaders_res: typing.Any, leader_fn: typing.Callable) -> bool:
    leader_msg = _error_text(leaders_res)
    try:
        leader_fn()
    except gl.vm.UserError as err:
        mine = _error_text(err)
        if mine.startswith(ERR_TRANSIENT) and leader_msg.startswith(ERR_TRANSIENT):
            return True
        return mine == leader_msg
    except Exception:
        return False
    return False


# --------------------------------------------------------------- non-deterministic blocks


def _genvm_post(url: str, body: str, headers: dict) -> tuple:
    try:
        response = gl.nondet.web.post(url, body=body, headers=headers)
    except Exception as exc:
        # validators agree on any [TRANSIENT] failure, so the detail is free to vary
        raise McpError(ERR_TRANSIENT + " transport failure: " + type(exc).__name__ + " " + str(exc)[:160])
    return response.status, response.headers, response.body


def _fetch(url: str) -> dict:
    """Live manifest, parsed (call only inside a nondet block)."""
    return fetch_manifest(lambda u, b, h: _genvm_post(u, b, h), url)


def _flags_for(manifest: dict, names: set, host: str, only: set) -> dict:
    flags = {}
    for tool in manifest["tools"]:
        if isinstance(tool, dict) and tool.get("name") in only:
            flags[tool["name"]] = tool_flags(tool, names, host)
    if INSTRUCTIONS_KEY in only:
        flags[INSTRUCTIONS_KEY] = instructions_flags(manifest["instructions"], names, host)
    return flags


def _reserved_name_check(digest: dict) -> None:
    if any(item["name"] == INSTRUCTIONS_KEY for item in digest["tools"]):
        raise McpError(ERR_EXTERNAL + " tool name " + INSTRUCTIONS_KEY + " is reserved")


def _snapshot_block(url: str, host: str) -> dict:
    try:
        manifest = _fetch(url)
        digest = digest_manifest(manifest)
        _reserved_name_check(digest)
        names = {item["name"] for item in digest["tools"]}
        flags = _flags_for(manifest, names, host, names | {INSTRUCTIONS_KEY})
        return {"digest": digest, "flags": flags}
    except McpError as err:
        raise gl.vm.UserError(str(err))
    except gl.vm.UserError:
        raise
    except Exception:
        raise gl.vm.UserError(ERR_EXTERNAL + " unreadable manifest")


def _observation(drift: str, root: str = "", reason: str = "") -> dict:
    return {
        "drift": drift,
        "root": root,
        "reason": reason[:MAX_REASON_STORE],
        "added": [],
        "removed": [],
        "modified": [],
        "changed": [],
        "flags": {},
        "overflow": 0,
        "instructions_changed": False,
        "instructions": "",
    }


def _content_failure(message: str) -> bool:
    """A failure after the server answered: it served something that is not a valid manifest.
    Network trouble and HTTP errors stay UNREACHABLE (nothing is known about the content)."""
    return message.startswith(ERR_EXTERNAL) and not message.startswith(ERR_EXTERNAL + " http ")


def _risk_order(names: set, flags: dict) -> list:
    """Changed tools, riskiest first: hard red flags, then soft flags, then the rest; by name within."""
    def rank(name: str) -> tuple:
        codes = flags.get(name, [])
        return (0 if has_hard_flag(codes) else (1 if codes else 2), name)

    return sorted(names, key=rank)


def _observe_block(url: str, host: str, pinned_root: str, pinned_hashes: dict, pinned_instructions_hash: str,
                   known_root: str, mode: str) -> dict:
    """Classify the live manifest against the pin. Never raises.

    content mode (DRIFT challenges): MATCH, KNOWN (the drift a settled challenge already
    penalised), DIFFERS with the verified changed tools, UNSTABLE (two different manifests
    in a row), UNPINNED (the server answered with something that is not a valid manifest),
    UNREACHABLE (network or HTTP failure). presence mode (attest): MATCH or DIFFERS only."""
    try:
        manifest = _fetch(url)
        first = digest_manifest(manifest)
        _reserved_name_check(first)
    except McpError as err:
        message = str(err)
        if _content_failure(message):
            return _observation(DRIFT_UNPINNED, reason=message)
        return _observation(DRIFT_UNREACHABLE, reason=message)
    except Exception:
        return _observation(DRIFT_UNPINNED, reason=ERR_EXTERNAL + " unreadable manifest")
    if first["root"] == pinned_root:
        return _observation(DRIFT_MATCH, root=first["root"])
    if mode == "presence":
        return _observation(DRIFT_DIFFERS, root=first["root"])
    if known_root and first["root"] == known_root:
        return _observation(DRIFT_KNOWN, root=first["root"])
    try:
        second = digest_manifest(_fetch(url))
    except McpError as err:
        message = str(err)
        if _content_failure(message):
            return _observation(DRIFT_UNSTABLE, reason="valid manifest, then an invalid one")
        return _observation(DRIFT_UNREACHABLE, reason=ERR_TRANSIENT + " second fetch failed")
    except Exception:
        return _observation(DRIFT_UNSTABLE, reason="valid manifest, then an unreadable one")
    if second["root"] != first["root"]:
        return _observation(DRIFT_UNSTABLE, reason="two different manifests in a row")
    diff = diff_tools(pinned_hashes, first["tools"])
    changed_names = set(diff["added"]) | set(diff["modified"])
    observed = _observation(DRIFT_DIFFERS, root=first["root"])
    observed["added"] = diff["added"]
    observed["removed"] = diff["removed"]
    observed["modified"] = diff["modified"]
    names = {item["name"] for item in first["tools"]}
    flag_names = set(changed_names)
    if first["instructions_hash"] != pinned_instructions_hash:
        observed["instructions_changed"] = True
        observed["instructions"] = first["instructions"]
        flag_names.add(INSTRUCTIONS_KEY)
    try:
        # code-computed flags for every changed tool, judged or not: a hard flag anywhere blocks SAFE
        observed["flags"] = _flags_for(manifest, names, host, flag_names)
    except Exception:
        observed["flags"] = {}
    ordered = _risk_order(changed_names, observed["flags"])
    keep = set(ordered[:MAX_CHANGED_TOOLS])
    observed["changed"] = [item for item in first["tools"] if item["name"] in keep]
    observed["overflow"] = max(0, len(ordered) - MAX_CHANGED_TOOLS)
    return observed


def _ask_json(prompt: str):
    """One model call in JSON mode; any failure reads as UNCLEAR downstream."""
    try:
        return gl.nondet.exec_prompt(prompt, response_format="json")
    except Exception:
        return None


def _judge_texts(purpose: str, caps: str, tools: list, flags: dict, hard: bool) -> dict:
    return judge_with(lambda prompt: _ask_json(prompt), purpose, caps, tools, flags, hard)


def _judge_block(purpose: str, caps: str, judged: list, flags: dict, force_hard: bool = False) -> dict:
    """Two readings per validator; agree on the verdict word only (UNCLEAR is a safe harbour).
    ``force_hard`` carries hard flags found on changed tools outside the judged batch."""
    tools = [{"name": item["name"], "text": reveal(item["canon"])} for item in judged]
    texts = {tool["name"]: tool["text"] for tool in tools}
    hard = force_hard or any(has_hard_flag(codes) for codes in flags.values())

    def leader_fn() -> dict:
        return _judge_texts(purpose, caps, tools, flags, hard)

    def validator_fn(leaders_res: typing.Any) -> bool:
        if not isinstance(leaders_res, gl.vm.Return):
            return False
        theirs = leaders_res.calldata
        if not leader_claim_valid(theirs, texts):
            return False
        if theirs["verdict"] == UNCLEAR:
            return True
        if hard and theirs["verdict"] == SAFE:
            return False
        return leader_fn()["verdict"] == theirs["verdict"]

    return gl.vm.run_nondet(leader_fn, validator_fn)


# ---------------------------------------------------------------------------- storage


@gl.evm.contract_interface
class _Wallet:
    """Empty EVM interface: a plain account, paid with emit_transfer at finalization."""

    class View:
        pass

    class Write:
        pass


@allow_storage
@dataclass
class Server:
    url: str
    publisher: str
    tier: str
    status: str
    purpose: str
    caps: str
    bond: gl.u256
    root: str
    protocol: str
    instructions: str
    instructions_hash: str
    tools_json: str  # [{"name", "hash", "canon"}] sorted by name
    flags_json: str  # {"<tool>" | "__instructions__": ["H1", ...]}
    verdicts_json: str  # {"<tool>" | "__instructions__": {"verdict", "reason", "quote"}}
    reviewed_upto: gl.u64
    open_challenges: gl.u64
    slashes: gl.u64
    unreachable: gl.u64
    contested: bool
    last_attest: str
    created_at: str
    updated_at: str
    last_verified_at: str
    exit_at: gl.u64
    drift_root: str  # live root of the last drift a settled challenge penalised ("" when none)
    owner_verified: bool  # the pinned instructions name the publisher as owner (OWNER_TAG)


@allow_storage
@dataclass
class Challenge:
    sid: str
    tool: str
    kind: str
    hunter: str
    stake: gl.u256
    stage: str
    drift: str
    observed_root: str
    changed_json: str  # verified changed tools [{"name", "hash", "canon"}]
    changed_flags_json: str
    observed_instructions: str
    verdict: str
    offending: str
    quote: str
    reason: str
    attempts: gl.u64
    filed_at: str
    filed_at_s: gl.u64
    updated_at: str
    payout_json: str
    overflow: gl.u64  # changed tools beyond the MAX_CHANGED_TOOLS that one ruling covers


class ToolBond(gl.contract.Contract):
    treasury: str
    servers: gl.storage.TreeMap[str, Server]
    server_ids: gl.storage.DynArray[str]
    challenges: gl.storage.TreeMap[str, Challenge]
    challenge_ids: gl.storage.DynArray[str]
    open_by_target: gl.storage.TreeMap[str, str]
    claimable: gl.storage.TreeMap[str, gl.u256]
    pool: gl.u256
    bonded: gl.u256
    claimable_total: gl.u256  # sum of every claimable balance
    staked: gl.u256  # stakes held by open challenges
    next_challenge: gl.u64
    pins_total: gl.u64
    checks_total: gl.u64
    slashes_total: gl.u64

    def __init__(self, treasury: str):
        candidate = str(treasury).strip().lower()
        self.treasury = candidate if _is_address(candidate) else _sender()
        self.pool = 0
        self.bonded = 0
        self.claimable_total = 0
        self.staked = 0
        self.next_challenge = 1
        self.pins_total = 0
        self.checks_total = 0
        self.slashes_total = 0

    # ------------------------------------------------------------ payable entry points

    @gl.public.write.payable
    def register(self, url: str, purpose: str, caps: str) -> typing.Any:
        """Bond GEN behind a server's manifest. Never raises: bad requests are refunded."""
        return self._open_server(url, purpose, caps, TIER_BONDED, MIN_BOND + REVIEW_FEE)

    @gl.public.write.payable
    def sponsor_review(self, url: str, purpose: str, caps: str) -> typing.Any:
        """Pay for a review of a third-party server: pinned and checked, never slashed."""
        return self._open_server(url, purpose, caps, TIER_REVIEWED, REVIEW_FEE)

    @gl.public.write.payable
    def challenge(self, sid: str, tool: str, kind: str) -> typing.Any:
        """Stake on a CONTENT claim (a pinned tool is poisoned) or a DRIFT claim (the live
        manifest no longer matches the pin). Never raises: bad requests are refunded."""
        sender, value = _sender(), int(gl.message.value)
        sid, tool, kind = str(sid).strip(), str(tool), str(kind).strip().upper()
        if sid not in self.servers:
            return self._refuse(sender, value, "unknown server")
        server = self.servers[sid]
        if server.status not in (ST_ACTIVE, ST_STALE, ST_EXITING):
            return self._refuse(sender, value, "server cannot be challenged while " + server.status)
        if kind == KIND_CONTENT:
            required = CONTENT_STAKE
            if tool not in {item["name"] for item in json.loads(server.tools_json)}:
                return self._refuse(sender, value, "tool is not pinned")
        elif kind == KIND_DRIFT:
            required = DRIFT_STAKE
            if tool != "":
                return self._refuse(sender, value, "a DRIFT challenge covers the whole manifest: tool must be empty")
        else:
            return self._refuse(sender, value, "kind must be CONTENT or DRIFT")
        target = sid + ":" + tool
        if target in self.open_by_target and self.open_by_target[target]:
            return self._refuse(sender, value, "a challenge on this target is already open")
        if value < required:
            return self._refuse(sender, value, "stake must be at least " + str(required) + " wei")
        if value > required:
            self._credit(sender, value - required)
        now = _now()
        cid = "c" + str(int(self.next_challenge))
        self.next_challenge = int(self.next_challenge) + 1
        self.challenges[cid] = Challenge(
            sid=sid, tool=tool, kind=kind, hunter=sender, stake=required, stage=STAGE_FILED, drift="",
            observed_root="", changed_json="[]", changed_flags_json="{}", observed_instructions="",
            verdict="", offending="", quote="", reason="", attempts=0, filed_at=now, filed_at_s=_now_s(),
            updated_at=now, payout_json="{}", overflow=0,
        )
        self.challenge_ids.append(cid)
        self.open_by_target[target] = cid
        self.staked = int(self.staked) + required
        server.open_challenges = int(server.open_challenges) + 1
        return {"ok": True, "cid": cid}

    @gl.public.write.payable
    def top_up(self, sid: str) -> typing.Any:
        """The publisher adds GEN to a BONDED server's bond, for example to restore the minimum
        after a drift settlement. Never raises: bad requests are refunded."""
        sender, value = _sender(), int(gl.message.value)
        sid = str(sid).strip()
        if sid not in self.servers:
            return self._refuse(sender, value, "unknown server")
        server = self.servers[sid]
        if server.tier != TIER_BONDED:
            return self._refuse(sender, value, "only BONDED servers hold a bond")
        if sender != server.publisher:
            return self._refuse(sender, value, "only the publisher can top up the bond")
        if server.status not in (ST_PENDING_SNAPSHOT, ST_PENDING_REVIEW, ST_ACTIVE, ST_STALE):
            return self._refuse(sender, value, "cannot top up while " + server.status)
        if value <= 0:
            return self._refuse(sender, value, "send the amount to add")
        server.bond = int(server.bond) + value
        self.bonded = int(self.bonded) + value
        server.updated_at = _now()
        return {"ok": True, "bond": str(int(server.bond)), "assurance": self._assurance(server)}

    # ------------------------------------------------------------------- pin and review

    @gl.public.write
    def snapshot(self, sid: str) -> None:
        """Validators fetch the live manifest and must derive the identical digest and flags."""
        server = self._server(sid)
        if server.status in (ST_ACTIVE, ST_STALE):
            # re-pinning: an announced update (ACTIVE) or a fix after drift (STALE)
            if (server.status == ST_ACTIVE or server.tier == TIER_BONDED) and _sender() != server.publisher:
                _fail("only the publisher can re-pin this server")
            if int(server.open_challenges) > 0:
                _fail("a challenge is open")
        elif server.status not in (ST_PENDING_SNAPSHOT, ST_PENDING_REVIEW):
            _fail("cannot snapshot a server while " + server.status)
        if server.tier == TIER_BONDED and int(server.bond) < MIN_BOND:
            # a drained bond cannot be re-pinned back into BONDED assurance
            _fail("bond is below the minimum of " + str(MIN_BOND) + " wei: top_up first")
        url, host = str(server.url), _host(str(server.url))

        def leader_fn() -> dict:
            return _snapshot_block(url, host)

        def validator_fn(leaders_res: typing.Any) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _same_failure(leaders_res, leader_fn)
            try:
                return leader_fn() == leaders_res.calldata
            except gl.vm.UserError:
                return False

        snap = gl.vm.run_nondet(leader_fn, validator_fn)
        digest, flags = snap["digest"], snap["flags"]
        server.root = str(digest["root"])
        server.protocol = str(digest["protocol"])
        server.instructions = str(digest["instructions"])
        server.instructions_hash = str(digest["instructions_hash"])
        server.tools_json = _dumps(digest["tools"])
        server.flags_json = _dumps(flags)
        verdicts = {item["name"]: {"verdict": "UNREVIEWED", "reason": "", "quote": ""} for item in digest["tools"]}
        if server.instructions:
            verdicts[INSTRUCTIONS_KEY] = {"verdict": "UNREVIEWED", "reason": "", "quote": ""}
        server.verdicts_json = _dumps(verdicts)
        server.reviewed_upto = 0
        server.contested = False
        server.drift_root = ""
        server.owner_verified = _owner_claim(server.instructions) == server.publisher
        server.status = ST_PENDING_REVIEW
        server.updated_at = _now()
        self.pins_total = int(self.pins_total) + 1

    @gl.public.write
    def review(self, sid: str) -> None:
        """Judge the next batch of pinned tools (server instructions go with the first batch)."""
        server = self._server(sid)
        if server.status != ST_PENDING_REVIEW:
            _fail("review needs a fresh snapshot (status is " + server.status + ")")
        if server.tier == TIER_BONDED and int(server.bond) < MIN_BOND:
            _fail("bond is below the minimum of " + str(MIN_BOND) + " wei: top_up first")
        tools = json.loads(server.tools_json)
        flags = json.loads(server.flags_json)
        start = int(server.reviewed_upto)
        batch = tools[start:start + REVIEW_BATCH]
        judged = [{"name": item["name"], "canon": item["canon"]} for item in batch]
        if start == 0 and server.instructions:
            judged.append({"name": INSTRUCTIONS_KEY, "canon": str(server.instructions)})
        verdicts = json.loads(server.verdicts_json)
        now = _now()
        if not judged:
            server.status = ST_ACTIVE
            server.last_verified_at = now
            server.updated_at = now
            return
        batch_flags = {item["name"]: list(flags.get(item["name"], [])) for item in judged}
        result = _judge_block(str(server.purpose), str(server.caps), judged, batch_flags)
        verdict = result["verdict"]
        if verdict == SAFE:
            for item in judged:
                verdicts[item["name"]] = {"verdict": SAFE, "reason": "", "quote": ""}
            server.reviewed_upto = start + len(batch)
            if int(server.reviewed_upto) >= len(tools):
                server.status = ST_ACTIVE
                server.last_verified_at = now
        elif verdict == POISONED:
            verdicts[result["tool"]] = {
                "verdict": POISONED, "reason": str(result["reason"])[:MAX_REASON_STORE], "quote": str(result["quote"])[:MAX_REASON_STORE],
            }
            bond = int(server.bond)
            fee = bond * REJECT_FEE_PCT // 100
            self._credit(self.treasury, fee)
            self._credit(server.publisher, bond - fee)
            self.bonded = int(self.bonded) - bond
            server.bond = 0
            server.status = ST_REJECTED
        else:
            for item in judged:
                verdicts[item["name"]] = {
                    "verdict": UNCLEAR, "reason": str(result["reason"])[:MAX_REASON_STORE], "quote": str(result["quote"])[:MAX_REASON_STORE],
                }
        server.verdicts_json = _dumps(verdicts)
        server.updated_at = now

    # ---------------------------------------------------------------------- challenges

    @gl.public.write
    def observe(self, cid: str, mode: str) -> None:
        """DRIFT challenges: validators re-fetch and agree on MATCH / KNOWN / DIFFERS / UNSTABLE /
        UNPINNED / UNREACHABLE. ``mode`` must be "content" (presence checks belong to attest)."""
        challenge = self._challenge(cid)
        if challenge.kind != KIND_DRIFT:
            _fail("observe applies to DRIFT challenges")
        if challenge.stage != STAGE_FILED:
            _fail("challenge was already observed")
        if str(mode).strip().lower() not in ("", "content"):
            _fail("observe compares content; presence checks are made with attest")
        server = self.servers[challenge.sid]
        seen = self._observe(server, "content")
        challenge.attempts = int(challenge.attempts) + 1
        challenge.drift = seen["drift"]
        challenge.observed_root = seen["root"]
        challenge.changed_json = _dumps(seen["changed"])
        challenge.changed_flags_json = _dumps(seen["flags"])
        challenge.observed_instructions = seen["instructions"]
        challenge.overflow = int(seen["overflow"])
        challenge.reason = seen["reason"]
        challenge.stage = STAGE_OBSERVED
        challenge.updated_at = _now()
        self.checks_total = int(self.checks_total) + 1

    @gl.public.write
    def judge(self, cid: str) -> None:
        """CONTENT: judge the pinned tool. DRIFT with DIFFERS: judge the verified changed tools."""
        challenge = self._challenge(cid)
        server = self.servers[challenge.sid]
        if challenge.kind == KIND_CONTENT:
            if challenge.stage != STAGE_FILED:
                _fail("challenge was already judged")
            matches = [item for item in json.loads(server.tools_json) if item["name"] == challenge.tool]
            if not matches:
                _fail("tool is no longer pinned")
            judged = [{"name": challenge.tool, "canon": matches[0]["canon"]}]
            flags = {challenge.tool: list(json.loads(server.flags_json).get(challenge.tool, []))}
        else:
            if challenge.stage != STAGE_OBSERVED or challenge.drift != DRIFT_DIFFERS:
                _fail("judge needs an observed DIFFERS drift")
            judged = [{"name": item["name"], "canon": item["canon"]} for item in json.loads(challenge.changed_json)]
            if challenge.observed_instructions:
                judged.append({"name": INSTRUCTIONS_KEY, "canon": str(challenge.observed_instructions)})
            stored_flags = json.loads(challenge.changed_flags_json)
            flags = {item["name"]: list(stored_flags.get(item["name"], [])) for item in judged}
        force_hard = challenge.kind == KIND_DRIFT and any(has_hard_flag(codes) for codes in json.loads(challenge.changed_flags_json).values())
        now = _now()
        if not judged:
            # only removals: nothing an agent could be told to do
            result = {"verdict": SAFE, "tool": "", "quote": "", "reason": "tools were only removed"}
        else:
            result = _judge_block(str(server.purpose), str(server.caps), judged, flags, force_hard)
        if result["verdict"] == SAFE and challenge.kind == KIND_DRIFT and int(challenge.overflow) > 0:
            # unjudged changed tools remain: one ruling cannot clear them
            result = {
                "verdict": UNCLEAR, "tool": "", "quote": "",
                "reason": str(int(challenge.overflow)) + " more changed tools than one ruling covers",
            }
        challenge.verdict = str(result["verdict"])
        challenge.offending = str(result["tool"]) if result["verdict"] == POISONED else ""
        challenge.quote = str(result["quote"])[:MAX_REASON_STORE]
        challenge.reason = str(result["reason"])[:MAX_REASON_STORE]
        challenge.attempts = int(challenge.attempts) + 1
        challenge.stage = STAGE_JUDGED
        challenge.updated_at = now

    @gl.public.write
    def settle(self, cid: str) -> None:
        """Apply the payout table in docs/CONTRACT_API.md."""
        challenge = self._challenge(cid)
        if challenge.stage in (STAGE_SETTLED, STAGE_EXPIRED):
            _fail("challenge is closed")
        server = self.servers[challenge.sid]
        stake = int(challenge.stake)
        payout = {"hunter": 0, "pool": 0, "publisher": 0}
        now = _now()
        if challenge.kind == KIND_CONTENT:
            if challenge.stage != STAGE_JUDGED:
                _fail("judge the challenge first")
            if challenge.verdict == POISONED:
                self._slash(server, int(server.bond), payout)
                payout["hunter"] += stake
                self._mark_slashed(server)
                self._mark_tool(server, challenge.tool, POISONED, challenge.reason, challenge.quote)
            elif challenge.verdict == SAFE:
                payout["publisher"] += stake
            else:
                payout["hunter"] += stake
                server.contested = True
        else:
            if challenge.stage == STAGE_FILED:
                _fail("observe the challenge first")
            drift = challenge.drift
            if drift in (DRIFT_MATCH, DRIFT_KNOWN):
                payout["hunter"] += stake - DRIFT_SPAM_FEE
                payout["publisher"] += DRIFT_SPAM_FEE
                if drift == DRIFT_MATCH:
                    server.last_verified_at = now
            elif drift == DRIFT_DIFFERS:
                if challenge.stage != STAGE_JUDGED:
                    _fail("judge the drift first")
                payout["hunter"] += stake
                if challenge.verdict == POISONED:
                    self._slash(server, int(server.bond), payout)
                    self._mark_slashed(server)
                else:
                    if challenge.verdict == SAFE:
                        reward = int(server.bond) * DRIFT_SAFE_REWARD_PCT // 100
                        server.bond = int(server.bond) - reward
                        self.bonded = int(self.bonded) - reward
                        payout["hunter"] += reward
                    self._demote(server, ST_STALE)
                    server.drift_root = challenge.observed_root
            elif drift == DRIFT_UNSTABLE:
                # a pinned manifest passed exact-equality consensus, so serving different
                # manifests in a row is a choice; it must not be cheaper than POISONED
                payout["hunter"] += stake
                self._slash(server, int(server.bond), payout)
                self._mark_slashed(server)
            elif drift == DRIFT_UNPINNED:
                payout["hunter"] += stake
                self._slash(server, int(server.bond) * DRIFT_UNPINNED_SLASH_PCT // 100, payout)
                self._demote(server, ST_STALE)
            else:
                payout["hunter"] += stake
                server.unreachable = int(server.unreachable) + 1
        self._credit(challenge.hunter, payout["hunter"])
        self._credit(server.publisher, payout["publisher"])
        self.pool = int(self.pool) + payout["pool"]
        self._close(challenge, server, STAGE_SETTLED, payout, now)

    @gl.public.write
    def expire(self, cid: str) -> None:
        """Refund a challenge that nobody carried through within CHALLENGE_TTL."""
        challenge = self._challenge(cid)
        if challenge.stage not in (STAGE_FILED, STAGE_OBSERVED):
            _fail("only an unjudged challenge can expire")
        now_s = _now_s()
        timed_out = now_s > 0 and int(challenge.filed_at_s) > 0 and now_s - int(challenge.filed_at_s) >= CHALLENGE_TTL
        if not timed_out and int(challenge.attempts) < MAX_ATTEMPTS:
            _fail("challenge has not expired yet")
        server = self.servers[challenge.sid]
        payout = {"hunter": int(challenge.stake), "pool": 0, "publisher": 0}
        if challenge.stage == STAGE_OBSERVED and challenge.drift in (DRIFT_MATCH, DRIFT_KNOWN):
            # waiting out the TTL must not dodge the fee that settling would have charged
            payout["hunter"] -= DRIFT_SPAM_FEE
            payout["publisher"] = DRIFT_SPAM_FEE
        self._credit(challenge.hunter, payout["hunter"])
        self._credit(server.publisher, payout["publisher"])
        self._close(challenge, server, STAGE_EXPIRED, payout, _now())

    # ------------------------------------------------------------- heartbeat and exit

    @gl.public.write
    def attest(self, sid: str) -> None:
        """Presence check without a challenge: records whether the live manifest still matches."""
        server = self._server(sid)
        if server.status not in (ST_ACTIVE, ST_STALE):
            _fail("attest applies to active or stale servers")
        seen = self._observe(server, "presence")
        now = _now()
        server.last_attest = str(seen["drift"])
        if seen["drift"] == DRIFT_MATCH:
            server.last_verified_at = now
            server.unreachable = 0
        elif seen["drift"] == DRIFT_UNREACHABLE:
            server.unreachable = int(server.unreachable) + 1
        server.updated_at = now
        self.checks_total = int(self.checks_total) + 1

    @gl.public.write
    def request_exit(self, sid: str) -> None:
        server = self._server(sid)
        if _sender() != server.publisher:
            _fail("only the publisher can exit")
        if server.status not in (ST_PENDING_SNAPSHOT, ST_PENDING_REVIEW, ST_ACTIVE, ST_STALE):
            _fail("cannot exit while " + server.status)
        now = _now()
        if server.tier == TIER_REVIEWED:
            if int(server.open_challenges) > 0:
                _fail("a challenge is still open")
            server.status = ST_EXITED
        else:
            server.status = ST_EXITING
            server.exit_at = _now_s() + EXIT_DELAY
        server.updated_at = now

    @gl.public.write
    def finalize_exit(self, sid: str) -> None:
        server = self._server(sid)
        if server.status != ST_EXITING:
            _fail("server is not exiting")
        now_s = _now_s()
        if now_s == 0 or now_s < int(server.exit_at):
            _fail("exit delay has not passed")
        if int(server.open_challenges) > 0:
            _fail("a challenge is still open")
        bond = int(server.bond)
        self._credit(server.publisher, bond)
        self.bonded = int(self.bonded) - bond
        server.bond = 0
        server.status = ST_EXITED
        server.updated_at = _now()

    @gl.public.write
    def withdraw(self) -> None:
        """Pull payment of the caller's claimable balance."""
        who = _sender()
        amount = int(self.claimable[who]) if who in self.claimable else 0
        if amount <= 0:
            _fail("nothing to withdraw")
        if amount > int(self.balance):
            _fail("contract balance too low")
        self.claimable[who] = 0
        self.claimable_total = int(self.claimable_total) - amount
        _Wallet(gl.message.sender_address).emit_transfer(value=amount)

    @gl.public.write
    def set_treasury(self, address: str) -> None:
        """The current treasury hands the role (and future review fees) to a new address."""
        if _sender() != self.treasury:
            _fail("only the treasury can move the treasury")
        candidate = str(address).strip().lower()
        if not _is_address(candidate):
            _fail("treasury must be a 0x-prefixed 20-byte address")
        self.treasury = candidate

    # --------------------------------------------------------------------------- views

    @gl.public.view
    def get_pins(self, url: str) -> str:
        clean = str(url).strip()
        sid = _sid(clean)
        if sid not in self.servers:
            return json.dumps({"known": False, "url": clean})
        server = self.servers[sid]
        tools = json.loads(server.tools_json) if server.tools_json else []
        verdicts = json.loads(server.verdicts_json) if server.verdicts_json else {}
        return _dumps(
            {
                "known": True,
                "sid": sid,
                "url": server.url,
                "status": server.status,
                "tier": server.tier,
                "assurance": self._assurance(server),
                "bond": str(int(server.bond)),
                "min_bond": str(MIN_BOND),
                "owner_verified": bool(server.owner_verified),
                "root": server.root,
                "tools": {item["name"]: item["hash"] for item in tools},
                "verdicts": {item["name"]: verdicts.get(item["name"], {}).get("verdict", "UNREVIEWED") for item in tools},
                "open_challenges": int(server.open_challenges),
                "drift_root": server.drift_root,
                "updated_at": server.updated_at,
                "contract_version": CONTRACT_VERSION,
            }
        )

    @gl.public.view
    def get_server(self, sid: str) -> str:
        sid = str(sid).strip()
        if sid not in self.servers:
            return json.dumps({"found": False, "sid": sid})
        return _dumps(self._server_full(sid))

    @gl.public.view
    def list_servers(self, offset: int, limit: int) -> str:
        start = max(0, int(offset))
        count = max(0, min(int(limit), MAX_LIST))
        total = len(self.server_ids)
        items = []
        for index in range(start, min(start + count, total)):
            sid = self.server_ids[index]
            server = self.servers[sid]
            tools = json.loads(server.tools_json) if server.tools_json else []
            items.append(
                {
                    "sid": sid, "url": server.url, "status": server.status, "tier": server.tier,
                    "assurance": self._assurance(server), "owner_verified": bool(server.owner_verified),
                    "bond": str(int(server.bond)), "tools": len(tools), "root": server.root,
                    "updated_at": server.updated_at, "last_verified_at": server.last_verified_at,
                }
            )
        return _dumps({"total": total, "offset": start, "items": items})

    @gl.public.view
    def get_challenge(self, cid: str) -> str:
        cid = str(cid).strip()
        if cid not in self.challenges:
            return json.dumps({"found": False, "cid": cid})
        return _dumps(self._challenge_full(cid))

    @gl.public.view
    def list_challenges(self, sid: str) -> str:
        sid = str(sid).strip()
        items = []
        index = len(self.challenge_ids) - 1
        while index >= 0 and len(items) < MAX_LIST:
            cid = self.challenge_ids[index]
            if not sid or self.challenges[cid].sid == sid:
                items.append(self._challenge_full(cid))
            index -= 1
        return _dumps({"items": items})

    @gl.public.view
    def get_stats(self) -> str:
        active = slashed = open_total = 0
        for index in range(len(self.server_ids)):
            server = self.servers[self.server_ids[index]]
            if server.status == ST_ACTIVE:
                active += 1
            elif server.status == ST_SLASHED:
                slashed += 1
            open_total += int(server.open_challenges)
        return _dumps(
            {
                "servers": len(self.server_ids), "active": active, "slashed": slashed,
                "bonded": str(int(self.bonded)), "pool": str(int(self.pool)),
                "challenges": len(self.challenge_ids), "open_challenges": open_total,
                "pins": int(self.pins_total), "checks": int(self.checks_total), "slashes": int(self.slashes_total),
            }
        )

    @gl.public.view
    def get_accounting(self) -> str:
        """Every wei the contract holds, by purpose. conserved is the invariant
        balance == bonded + pool + claimable_total + staked."""
        bonded, pool = int(self.bonded), int(self.pool)
        owed, staked = int(self.claimable_total), int(self.staked)
        bond_sum = 0
        for index in range(len(self.server_ids)):
            bond_sum += int(self.servers[self.server_ids[index]].bond)
        balance = int(self.balance)
        return _dumps(
            {
                "balance": str(balance), "bonded": str(bonded), "bond_sum": str(bond_sum), "pool": str(pool),
                "claimable_total": str(owed), "staked": str(staked), "held": str(bonded + pool + owed + staked),
                "conserved": balance == bonded + pool + owed + staked and bonded == bond_sum,
            }
        )

    @gl.public.view
    def get_claimable(self, address: str) -> str:
        who = str(address).strip().lower()
        return str(int(self.claimable[who])) if who in self.claimable else "0"

    @gl.public.view
    def get_constants(self) -> str:
        return _dumps(
            {
                "MIN_BOND": str(MIN_BOND), "REVIEW_FEE": str(REVIEW_FEE), "CONTENT_STAKE": str(CONTENT_STAKE),
                "DRIFT_STAKE": str(DRIFT_STAKE), "DRIFT_SPAM_FEE": str(DRIFT_SPAM_FEE),
                "CHALLENGE_TTL": CHALLENGE_TTL, "MAX_ATTEMPTS": MAX_ATTEMPTS, "EXIT_DELAY": EXIT_DELAY,
                "REVIEW_BATCH": REVIEW_BATCH, "MAX_CHANGED_TOOLS": MAX_CHANGED_TOOLS,
                "DRIFT_SAFE_REWARD_PCT": DRIFT_SAFE_REWARD_PCT, "DRIFT_UNPINNED_SLASH_PCT": DRIFT_UNPINNED_SLASH_PCT,
                "OWNER_TAG": OWNER_TAG, "VERSION": CONTRACT_VERSION, "treasury": self.treasury,
            }
        )

    # ------------------------------------------------------------------------- private

    def _open_server(self, url: str, purpose: str, caps: str, tier: str, required: int) -> dict:
        sender, value = _sender(), int(gl.message.value)
        clean = str(url).strip()
        problem = _url_problem(clean)
        purpose = str(purpose).strip()
        caps_norm = _normalize_caps(caps)
        if not problem and not (0 < len(purpose) <= MAX_PURPOSE_CHARS):
            problem = "purpose must be 1 to " + str(MAX_PURPOSE_CHARS) + " characters"
        if not problem and not caps_norm:
            problem = "caps must be a comma-separated subset of " + ",".join(ALLOWED_CAPS)
        if not problem and has_hard_flag(instructions_flags(purpose, set(), _host(clean))):
            # the purpose is publisher text that reaches the judge: it gets the same hard checks as tools
            problem = "purpose contains hidden characters or text aimed at the judge"
        sid = _sid(clean) if not problem else ""
        if not problem and sid in self.servers:
            existing = self.servers[sid]
            upgrade = tier == TIER_BONDED and existing.tier == TIER_REVIEWED and existing.status != ST_EXITING
            if existing.status not in REUSABLE_STATUSES and not upgrade:
                problem = "server is already registered"
            elif int(existing.open_challenges) > 0:
                problem = "a challenge on this server is still open"
        if not problem and value < required:
            problem = "send at least " + str(required) + " wei"
        if problem:
            return self._refuse(sender, value, problem)
        bond = value - REVIEW_FEE if tier == TIER_BONDED else 0
        if tier == TIER_REVIEWED and value > REVIEW_FEE:
            self._credit(sender, value - REVIEW_FEE)
        self._credit(self.treasury, REVIEW_FEE)
        now = _now()
        if sid not in self.servers:
            self.server_ids.append(sid)
        self.servers[sid] = Server(
            url=clean, publisher=sender, tier=tier, status=ST_PENDING_SNAPSHOT, purpose=purpose, caps=caps_norm,
            bond=bond, root="", protocol="", instructions="", instructions_hash="", tools_json="[]",
            flags_json="{}", verdicts_json="{}", reviewed_upto=0, open_challenges=0, slashes=0, unreachable=0,
            contested=False, last_attest="", created_at=now, updated_at=now, last_verified_at="", exit_at=0,
            drift_root="", owner_verified=False,
        )
        self.bonded = int(self.bonded) + bond
        return {"ok": True, "sid": sid}

    def _observe(self, server: Server, mode: str) -> dict:
        url, host = str(server.url), _host(str(server.url))
        pinned_root = str(server.root)
        pinned_hashes = {item["name"]: item["hash"] for item in json.loads(server.tools_json)}
        pinned_instructions_hash = str(server.instructions_hash)
        known_root = str(server.drift_root)

        def leader_fn() -> dict:
            return _observe_block(url, host, pinned_root, pinned_hashes, pinned_instructions_hash, known_root, mode)

        def validator_fn(leaders_res: typing.Any) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            theirs = leaders_res.calldata
            if not isinstance(theirs, dict) or theirs.get("drift") not in DRIFT_CLASSES:
                return False
            drift = theirs["drift"]
            if drift == DRIFT_UNREACHABLE:
                return True  # safe harbour: no slash, no pass (other fields are discarded)
            mine = leader_fn()
            if drift in (DRIFT_UNSTABLE, DRIFT_UNPINNED):
                return mine["drift"] == drift  # each validator must see it for itself
            if mode == "presence":
                return mine["drift"] == drift
            return mine == theirs  # MATCH, KNOWN, DIFFERS: identical observation, hence verified content

        seen = gl.vm.run_nondet(leader_fn, validator_fn)
        return self._clean_observation(seen)

    def _clean_observation(self, seen: dict) -> dict:
        """Keep only what consensus verified, capped. UNREACHABLE is accepted from any leader, and
        UNSTABLE / UNPINNED are checked by class only, so their other fields are not trusted."""
        drift = str(seen.get("drift", DRIFT_UNREACHABLE))
        clean = _observation(drift, reason=str(seen.get("reason", ""))[:MAX_REASON_STORE])
        if drift in (DRIFT_MATCH, DRIFT_KNOWN, DRIFT_DIFFERS):
            clean["root"] = str(seen.get("root", ""))[:64]
        if drift == DRIFT_DIFFERS:
            for key in ("added", "removed", "modified", "changed"):
                clean[key] = list(seen.get(key) or [])
            clean["flags"] = dict(seen.get("flags") or {})
            clean["overflow"] = int(seen.get("overflow") or 0)
            clean["instructions_changed"] = bool(seen.get("instructions_changed"))
            clean["instructions"] = str(seen.get("instructions") or "")
        return clean

    def _slash(self, server: Server, amount: int, payout: dict) -> None:
        amount = min(int(amount), int(server.bond))
        if amount <= 0:
            return
        hunter_share = amount // 2
        payout["hunter"] += hunter_share
        payout["pool"] += amount - hunter_share
        server.bond = int(server.bond) - amount
        self.bonded = int(self.bonded) - amount
        server.slashes = int(server.slashes) + 1
        self.slashes_total = int(self.slashes_total) + 1

    def _demote(self, server: Server, status: str) -> None:
        """Drift outcomes only move live servers: never revive SLASHED, EXITED or REJECTED."""
        if server.status in (ST_ACTIVE, ST_STALE):
            server.status = status

    def _mark_slashed(self, server: Server) -> None:
        if server.status not in (ST_EXITED, ST_REJECTED):
            server.status = ST_SLASHED

    def _mark_tool(self, server: Server, tool: str, verdict: str, reason: str, quote: str) -> None:
        verdicts = json.loads(server.verdicts_json)
        verdicts[tool] = {"verdict": verdict, "reason": reason, "quote": quote}
        server.verdicts_json = _dumps(verdicts)

    def _close(self, challenge: Challenge, server: Server, stage: str, payout: dict, now: str) -> None:
        challenge.stage = stage
        challenge.payout_json = _dumps({key: str(value) for key, value in payout.items()})
        challenge.updated_at = now
        target = challenge.sid + ":" + challenge.tool
        if target in self.open_by_target:
            self.open_by_target[target] = ""
        self.staked = int(self.staked) - int(challenge.stake)
        server.open_challenges = max(0, int(server.open_challenges) - 1)
        server.updated_at = now

    def _assurance(self, server: Server) -> str:
        """BONDED only while the bond meets the minimum; REVIEWED servers never held one."""
        if server.tier != TIER_BONDED:
            return str(server.tier)
        return TIER_BONDED if int(server.bond) >= MIN_BOND else ASSURANCE_UNDERCOLLATERALIZED

    def _credit(self, who: str, amount: int) -> None:
        if amount > 0:
            current = int(self.claimable[who]) if who in self.claimable else 0
            self.claimable[who] = current + amount
            self.claimable_total = int(self.claimable_total) + amount

    def _refuse(self, sender: str, value: int, problem: str) -> dict:
        self._credit(sender, value)
        return {"ok": False, "error": problem, "refunded": str(value)}

    def _server(self, sid: str) -> Server:
        sid = str(sid).strip()
        if sid not in self.servers:
            _fail("unknown server")
        return self.servers[sid]

    def _challenge(self, cid: str) -> Challenge:
        cid = str(cid).strip()
        if cid not in self.challenges:
            _fail("unknown challenge")
        return self.challenges[cid]

    def _server_full(self, sid: str) -> dict:
        server = self.servers[sid]
        tools = json.loads(server.tools_json) if server.tools_json else []
        verdicts = json.loads(server.verdicts_json) if server.verdicts_json else {}
        rows = []
        for item in tools:
            v = verdicts.get(item["name"], {})
            rows.append(
                {
                    "name": item["name"], "hash": item["hash"], "canon": item["canon"],
                    "verdict": v.get("verdict", "UNREVIEWED"), "reason": v.get("reason", ""), "quote": v.get("quote", ""),
                }
            )
        return {
            "found": True, "sid": sid, "url": server.url, "publisher": server.publisher, "tier": server.tier,
            "assurance": self._assurance(server), "min_bond": str(MIN_BOND), "owner_verified": bool(server.owner_verified),
            "status": server.status, "purpose": server.purpose, "caps": server.caps, "bond": str(int(server.bond)),
            "root": server.root, "protocol": server.protocol, "instructions": server.instructions,
            "instructions_hash": server.instructions_hash, "instructions_verdict": verdicts.get(INSTRUCTIONS_KEY, {}),
            "flags": json.loads(server.flags_json) if server.flags_json else {}, "tools": rows,
            "reviewed": int(server.reviewed_upto), "slashes": int(server.slashes), "unreachable": int(server.unreachable),
            "contested": bool(server.contested), "open_challenges": int(server.open_challenges),
            "last_attest": server.last_attest, "created_at": server.created_at, "updated_at": server.updated_at,
            "last_verified_at": server.last_verified_at, "exit_at": int(server.exit_at), "drift_root": server.drift_root,
        }

    def _challenge_full(self, cid: str) -> dict:
        c = self.challenges[cid]
        return {
            "found": True, "cid": cid, "sid": c.sid, "tool": c.tool, "kind": c.kind, "hunter": c.hunter,
            "stake": str(int(c.stake)), "stage": c.stage, "drift": c.drift, "observed_root": c.observed_root,
            "changed": json.loads(c.changed_json) if c.changed_json else [],
            "changed_flags": json.loads(c.changed_flags_json) if c.changed_flags_json else {},
            "instructions_changed": bool(c.observed_instructions), "verdict": c.verdict, "offending": c.offending,
            "quote": c.quote, "reason": c.reason, "attempts": int(c.attempts), "filed_at": c.filed_at,
            "updated_at": c.updated_at, "payout": json.loads(c.payout_json) if c.payout_json else {},
            "overflow": int(c.overflow),
        }
