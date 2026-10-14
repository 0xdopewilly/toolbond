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
  changed tools are verified content; UNREACHABLE is a safe harbour;
- judge: agree on the verdict word only; UNCLEAR is a safe harbour; POISONED must quote
  text that code finds in the tool; hard red flags make SAFE impossible.
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
DRIFT_UNSTABLE_SLASH_PCT = 25
REJECT_FEE_PCT = 10

MAX_URL_CHARS = 200
MAX_PURPOSE_CHARS = 280
MAX_LIST = 50
ALLOWED_CAPS = ("none", "network", "filesystem", "credentials", "shell", "payments")
INSTRUCTIONS_KEY = "__instructions__"

TIER_BONDED = "BONDED"
TIER_REVIEWED = "REVIEWED"

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

MAX_CHANGED_TOOLS = 4
MAX_REASON_STORE = 300


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
    return url[len("https://"):].split("/", 1)[0].split("?", 1)[0].lower()


def _url_problem(url: str) -> str:
    if len(url) > MAX_URL_CHARS:
        return "url is longer than " + str(MAX_URL_CHARS) + " characters"
    if not url.startswith("https://"):
        return "url must start with https://"
    if any(ch.isspace() for ch in url):
        return "url must not contain whitespace"
    host = _host(url)
    if not host or "@" in host or ":" in host:
        return "url host must be a domain without port or credentials"
    labels = host.split(".")
    if len(labels) < 2 or not all(labels) or not labels[-1].isalpha():
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


def _snapshot_block(url: str, host: str) -> dict:
    try:
        manifest = _fetch(url)
        digest = digest_manifest(manifest)
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
        "instructions_changed": False,
        "instructions": "",
    }


def _observe_block(url: str, host: str, pinned_root: str, pinned_hashes: dict, pinned_instructions_hash: str, mode: str) -> dict:
    """Classify the live manifest against the pin. Never raises: failures are UNREACHABLE."""
    try:
        manifest = _fetch(url)
        first = digest_manifest(manifest)
    except McpError as err:
        return _observation(DRIFT_UNREACHABLE, reason=str(err))
    except Exception:
        return _observation(DRIFT_UNREACHABLE, reason=ERR_EXTERNAL + " unreadable manifest")
    if first["root"] == pinned_root:
        return _observation(DRIFT_MATCH, root=first["root"])
    if mode == "presence":
        return _observation(DRIFT_UNPINNED)
    try:
        second = digest_manifest(_fetch(url))
    except Exception:
        return _observation(DRIFT_UNREACHABLE, reason=ERR_TRANSIENT + " second fetch failed")
    if second["root"] != first["root"]:
        return _observation(DRIFT_UNSTABLE)
    diff = diff_tools(pinned_hashes, first["tools"])
    changed_names = set(diff["added"]) | set(diff["modified"])
    observed = _observation(DRIFT_DIFFERS, root=first["root"])
    observed["added"] = diff["added"]
    observed["removed"] = diff["removed"]
    observed["modified"] = diff["modified"]
    observed["changed"] = [item for item in first["tools"] if item["name"] in changed_names][:MAX_CHANGED_TOOLS]
    judged_names = {item["name"] for item in observed["changed"]}
    if first["instructions_hash"] != pinned_instructions_hash:
        observed["instructions_changed"] = True
        observed["instructions"] = first["instructions"]
        judged_names.add(INSTRUCTIONS_KEY)
    names = {item["name"] for item in first["tools"]}
    try:
        observed["flags"] = _flags_for(manifest, names, host, judged_names)
    except Exception:
        observed["flags"] = {}
    return observed


def _ask_json(prompt: str):
    """One model call in JSON mode; any failure reads as UNCLEAR downstream."""
    try:
        return gl.nondet.exec_prompt(prompt, response_format="json")
    except Exception:
        return None


def _judge_texts(purpose: str, caps: str, tools: list, flags: dict, hard: bool) -> dict:
    return judge_with(lambda prompt: _ask_json(prompt), purpose, caps, tools, flags, hard)


def _judge_block(purpose: str, caps: str, judged: list, flags: dict) -> dict:
    """Two readings per validator; agree on the verdict word only (UNCLEAR is a safe harbour)."""
    tools = [{"name": item["name"], "text": reveal(item["canon"])} for item in judged]
    texts = {tool["name"]: tool["text"] for tool in tools}
    hard = any(has_hard_flag(codes) for codes in flags.values())

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
    next_challenge: gl.u64
    pins_total: gl.u64
    checks_total: gl.u64
    slashes_total: gl.u64

    def __init__(self, treasury: str):
        candidate = str(treasury).strip().lower()
        self.treasury = candidate if _is_address(candidate) else _sender()
        self.pool = 0
        self.bonded = 0
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
            updated_at=now, payout_json="{}",
        )
        self.challenge_ids.append(cid)
        self.open_by_target[target] = cid
        server.open_challenges = int(server.open_challenges) + 1
        return {"ok": True, "cid": cid}

    # ------------------------------------------------------------------- pin and review

    @gl.public.write
    def snapshot(self, sid: str) -> None:
        """Validators fetch the live manifest and must derive the identical digest and flags."""
        server = self._server(sid)
        if server.status == ST_STALE:
            if server.tier == TIER_BONDED and _sender() != server.publisher:
                _fail("only the publisher can re-pin a stale server")
            if int(server.open_challenges) > 0:
                _fail("a challenge is open")
        elif server.status not in (ST_PENDING_SNAPSHOT, ST_PENDING_REVIEW):
            _fail("cannot snapshot a server while " + server.status)
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
        server.status = ST_PENDING_REVIEW
        server.updated_at = _now()
        self.pins_total = int(self.pins_total) + 1

    @gl.public.write
    def review(self, sid: str) -> None:
        """Judge the next batch of pinned tools (server instructions go with the first batch)."""
        server = self._server(sid)
        if server.status != ST_PENDING_REVIEW:
            _fail("review needs a fresh snapshot (status is " + server.status + ")")
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
            verdicts[result["tool"]] = {"verdict": POISONED, "reason": result["reason"], "quote": result["quote"]}
            bond = int(server.bond)
            fee = bond * REJECT_FEE_PCT // 100
            self._credit(self.treasury, fee)
            self._credit(server.publisher, bond - fee)
            self.bonded = int(self.bonded) - bond
            server.bond = 0
            server.status = ST_REJECTED
        else:
            for item in judged:
                verdicts[item["name"]] = {"verdict": UNCLEAR, "reason": result["reason"], "quote": result["quote"]}
        server.verdicts_json = _dumps(verdicts)
        server.updated_at = now

    # ---------------------------------------------------------------------- challenges

    @gl.public.write
    def observe(self, cid: str, mode: str) -> None:
        """DRIFT challenges: validators re-fetch and agree on MATCH / DIFFERS / UNSTABLE /
        UNPINNED (presence mode) / UNREACHABLE."""
        challenge = self._challenge(cid)
        if challenge.kind != KIND_DRIFT:
            _fail("observe applies to DRIFT challenges")
        if challenge.stage != STAGE_FILED:
            _fail("challenge was already observed")
        mode = str(mode).strip().lower()
        if mode not in ("content", "presence"):
            _fail("mode must be content or presence")
        server = self.servers[challenge.sid]
        seen = self._observe(server, mode)
        challenge.attempts = int(challenge.attempts) + 1
        challenge.drift = str(seen["drift"])
        challenge.observed_root = str(seen["root"])
        challenge.changed_json = _dumps(seen["changed"])
        challenge.changed_flags_json = _dumps(seen["flags"])
        challenge.observed_instructions = str(seen["instructions"])
        challenge.reason = str(seen["reason"])
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
        now = _now()
        if not judged:
            # only removals: nothing an agent could be told to do
            result = {"verdict": SAFE, "tool": "", "quote": "", "reason": "tools were only removed"}
        else:
            result = _judge_block(str(server.purpose), str(server.caps), judged, flags)
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
                server.status = ST_SLASHED
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
            if drift == DRIFT_MATCH:
                payout["hunter"] += stake - DRIFT_SPAM_FEE
                payout["publisher"] += DRIFT_SPAM_FEE
                server.last_verified_at = now
            elif drift == DRIFT_DIFFERS:
                if challenge.stage != STAGE_JUDGED:
                    _fail("judge the drift first")
                payout["hunter"] += stake
                if challenge.verdict == POISONED:
                    self._slash(server, int(server.bond), payout)
                    server.status = ST_SLASHED
                elif challenge.verdict == SAFE:
                    reward = int(server.bond) * DRIFT_SAFE_REWARD_PCT // 100
                    server.bond = int(server.bond) - reward
                    self.bonded = int(self.bonded) - reward
                    payout["hunter"] += reward
                    server.status = ST_STALE if server.status != ST_EXITING else ST_EXITING
                else:
                    server.status = ST_STALE if server.status != ST_EXITING else ST_EXITING
            elif drift in (DRIFT_UNSTABLE, DRIFT_UNPINNED):
                payout["hunter"] += stake
                self._slash(server, int(server.bond) * DRIFT_UNSTABLE_SLASH_PCT // 100, payout)
                server.status = ST_STALE if server.status != ST_EXITING else ST_EXITING
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
        self._credit(challenge.hunter, payout["hunter"])
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
                "root": server.root,
                "tools": {item["name"]: item["hash"] for item in tools},
                "verdicts": {item["name"]: verdicts.get(item["name"], {}).get("verdict", "UNREVIEWED") for item in tools},
                "open_challenges": int(server.open_challenges),
                "updated_at": server.updated_at,
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
                "REVIEW_BATCH": REVIEW_BATCH, "treasury": self.treasury,
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
        sid = _sid(clean) if not problem else ""
        if not problem and sid in self.servers and self.servers[sid].status not in REUSABLE_STATUSES:
            problem = "server is already registered"
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
        )
        self.bonded = int(self.bonded) + bond
        return {"ok": True, "sid": sid}

    def _observe(self, server: Server, mode: str) -> dict:
        url, host = str(server.url), _host(str(server.url))
        pinned_root = str(server.root)
        pinned_hashes = {item["name"]: item["hash"] for item in json.loads(server.tools_json)}
        pinned_instructions_hash = str(server.instructions_hash)

        def leader_fn() -> dict:
            return _observe_block(url, host, pinned_root, pinned_hashes, pinned_instructions_hash, mode)

        def validator_fn(leaders_res: typing.Any) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            theirs = leaders_res.calldata
            if not isinstance(theirs, dict):
                return False
            drift = theirs.get("drift")
            if drift == DRIFT_UNREACHABLE:
                return True  # safe harbour: no slash, no pass
            mine = leader_fn()
            if drift == DRIFT_UNSTABLE:
                return mine["drift"] in (DRIFT_UNSTABLE, DRIFT_DIFFERS)
            if drift == DRIFT_UNPINNED:
                return mine["drift"] not in (DRIFT_MATCH, DRIFT_UNREACHABLE)
            if drift in (DRIFT_MATCH, DRIFT_DIFFERS):
                return mine == theirs
            return False

        return gl.vm.run_nondet(leader_fn, validator_fn)

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
        server.open_challenges = max(0, int(server.open_challenges) - 1)
        server.updated_at = now

    def _credit(self, who: str, amount: int) -> None:
        if amount > 0:
            current = int(self.claimable[who]) if who in self.claimable else 0
            self.claimable[who] = current + amount

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
            "status": server.status, "purpose": server.purpose, "caps": server.caps, "bond": str(int(server.bond)),
            "root": server.root, "protocol": server.protocol, "instructions": server.instructions,
            "instructions_hash": server.instructions_hash, "instructions_verdict": verdicts.get(INSTRUCTIONS_KEY, {}),
            "flags": json.loads(server.flags_json) if server.flags_json else {}, "tools": rows,
            "reviewed": int(server.reviewed_upto), "slashes": int(server.slashes), "unreachable": int(server.unreachable),
            "contested": bool(server.contested), "open_challenges": int(server.open_challenges),
            "last_attest": server.last_attest, "created_at": server.created_at, "updated_at": server.updated_at,
            "last_verified_at": server.last_verified_at, "exit_at": int(server.exit_at),
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
        }
