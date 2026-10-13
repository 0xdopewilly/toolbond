# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
"""PinnedFetch: consensus-pinned MCP tool manifests with drift detection.

Anyone can ask the validators to pin a remote MCP server. Every validator runs
the MCP handshake itself, canonicalizes the tool manifest and must derive the
identical result, so what gets stored is exactly what each of them saw.

Anyone can later ask for a drift check. Validators re-fetch the server and agree
on one class:

- MATCH: the live manifest has the pinned root.
- DIFFERS: every validator derived the same new root, so the changed tools that
  get stored are verified content, not the leader's word.
- UNSTABLE: the server answered with two different manifests in a row.
- UNREACHABLE: the server could not be read. Accepted from any leader because it
  changes no pin and never counts as a pass.

Other contracts and off-chain guards call ``verify_tool(url, name, hash)`` to
decide whether the exact bytes of a tool were pinned.
"""

import json
import typing
from dataclasses import dataclass

import genlayer as gl
from genlayer.storage import allow as allow_storage

# @@include gl_mcp

ERR_EXPECTED = "[EXPECTED]"

DRIFT_MATCH = "MATCH"
DRIFT_DIFFERS = "DIFFERS"
DRIFT_UNSTABLE = "UNSTABLE"
DRIFT_UNREACHABLE = "UNREACHABLE"

MAX_URL_CHARS = 200
MAX_CHANGED_TOOLS = 4
MAX_REASON_CHARS = 120
MAX_LIST = 50


def _fail(message: str) -> typing.NoReturn:
    raise gl.vm.UserError(ERR_EXPECTED + " " + message)


def _hex(address: typing.Any) -> str:
    return address.as_hex if hasattr(address, "as_hex") else str(address)


def _now() -> str:
    """The transaction's own ISO datetime, identical on every validator ("" if absent)."""
    try:
        value = getattr(gl.message, "datetime", None)
        return str(value) if value else ""
    except Exception:
        return ""


def _validate_url(url: str) -> str:
    url = str(url).strip()
    if len(url) > MAX_URL_CHARS:
        _fail("url is longer than " + str(MAX_URL_CHARS) + " characters")
    if not url.startswith("https://"):
        _fail("url must start with https://")
    if any(ch.isspace() for ch in url):
        _fail("url must not contain whitespace")
    host = url[len("https://"):].split("/", 1)[0].split("?", 1)[0]
    if not host or "@" in host or ":" in host:
        _fail("url host must be a domain without port or credentials")
    labels = host.split(".")
    if len(labels) < 2 or not all(labels) or not labels[-1].isalpha():
        _fail("url host must be a public domain name")
    return url


def _url_id(url: str) -> str:
    return sha256_hex(url)[:16]


def _error_text(err: typing.Any) -> str:
    """UserError carries its payload in ``.data`` on GenVM v0.3 and ``.message`` before."""
    for attr in ("data", "message"):
        value = getattr(err, attr, None)
        if isinstance(value, str) and value:
            return value
    return str(err)


def _same_failure(leaders_res: typing.Any, leader_fn: typing.Callable) -> bool:
    """Validator rule when the leader failed: agree only if I fail the same way."""
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


def _genvm_post(url: str, body: str, headers: dict) -> tuple:
    try:
        response = gl.nondet.web.post(url, body=body, headers=headers)
    except Exception:
        raise McpError(ERR_TRANSIENT + " transport failure")
    return response.status, response.headers, response.body


def _fetch_digest(url: str) -> dict:
    """Fetch and canonicalize; call only inside a nondet block."""
    return digest_manifest(fetch_manifest(lambda u, b, h: _genvm_post(u, b, h), url))


def _snapshot(url: str) -> dict:
    """Leader and validators both call this inside the nondet block."""
    try:
        return _fetch_digest(url)
    except McpError as err:
        raise gl.vm.UserError(str(err))
    except Exception:
        # e.g. pathologically nested JSON: classify it so validators can agree on the failure
        raise gl.vm.UserError(ERR_EXTERNAL + " unreadable manifest")


def _observation(drift: str, root: str = "", reason: str = "") -> dict:
    return {
        "drift": drift,
        "root": root,
        "reason": reason[:MAX_REASON_CHARS],
        "added": [],
        "removed": [],
        "modified": [],
        "changed": [],
        "instructions_changed": False,
        "instructions": "",
    }


def _observe(url: str, pinned_root: str, pinned_hashes: dict, pinned_instructions_hash: str) -> dict:
    """Classify the live manifest against the pin. Never raises: failures are UNREACHABLE."""
    try:
        first = _fetch_digest(url)
    except McpError as err:
        return _observation(DRIFT_UNREACHABLE, reason=str(err))
    except Exception:
        return _observation(DRIFT_UNREACHABLE, reason=ERR_EXTERNAL + " unreadable manifest")
    if first["root"] == pinned_root:
        return _observation(DRIFT_MATCH, root=first["root"])
    try:
        second = _fetch_digest(url)
    except McpError as err:
        return _observation(DRIFT_UNREACHABLE, reason=str(err))
    except Exception:
        return _observation(DRIFT_UNREACHABLE, reason=ERR_EXTERNAL + " unreadable manifest")
    if second["root"] != first["root"]:
        return _observation(DRIFT_UNSTABLE)
    diff = diff_tools(pinned_hashes, first["tools"])
    changed_names = set(diff["added"]) | set(diff["modified"])
    observed = _observation(DRIFT_DIFFERS, root=first["root"])
    observed["added"] = diff["added"]
    observed["removed"] = diff["removed"]
    observed["modified"] = diff["modified"]
    observed["changed"] = [tool for tool in first["tools"] if tool["name"] in changed_names][:MAX_CHANGED_TOOLS]
    if first["instructions_hash"] != pinned_instructions_hash:
        observed["instructions_changed"] = True
        observed["instructions"] = first["instructions"]
    return observed


@allow_storage
@dataclass
class PinVersion:
    url: str
    version: gl.u64
    root: str
    protocol: str
    instructions_hash: str
    instructions: str
    tools_json: str  # JSON list of {"name", "hash", "canon"} sorted by name
    pinner: str
    pinned_at: str


@allow_storage
@dataclass
class DriftCheck:
    version: gl.u64  # the pin version this check compared against
    drift: str
    root: str
    reason: str
    added_json: str
    removed_json: str
    modified_json: str
    changed_json: str  # verified canonical text of added or modified tools
    instructions_changed: bool
    instructions: str
    checker: str
    checked_at: str


class PinnedFetch(gl.contract.Contract):
    pins: gl.storage.TreeMap[str, PinVersion]  # f"{url_id}:{version}"
    latest_version: gl.storage.TreeMap[str, gl.u64]  # url_id -> latest version (1-based)
    last_check: gl.storage.TreeMap[str, DriftCheck]  # url_id -> latest drift check
    url_of: gl.storage.TreeMap[str, str]  # url_id -> url
    url_ids: gl.storage.DynArray[str]
    pins_total: gl.u64
    checks_total: gl.u64
    drifts_total: gl.u64

    def __init__(self):
        self.pins_total = 0
        self.checks_total = 0
        self.drifts_total = 0

    # ------------------------------------------------------------------ writes

    @gl.public.write
    def pin(self, url: str) -> None:
        """Pin the live manifest of ``url`` as a new version."""
        url = _validate_url(url)
        url_id = _url_id(url)

        def leader_fn() -> dict:
            return _snapshot(url)

        def validator_fn(leaders_res: typing.Any) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return _same_failure(leaders_res, leader_fn)
            try:
                mine = leader_fn()
            except gl.vm.UserError:
                return False
            return mine == leaders_res.calldata

        snap = gl.vm.run_nondet(leader_fn, validator_fn)

        version = int(self.latest_version[url_id]) + 1 if url_id in self.latest_version else 1
        self.pins[url_id + ":" + str(version)] = PinVersion(
            url=url,
            version=version,
            root=str(snap["root"]),
            protocol=str(snap["protocol"]),
            instructions_hash=str(snap["instructions_hash"]),
            instructions=str(snap["instructions"]),
            tools_json=json.dumps(snap["tools"], sort_keys=True, separators=(",", ":")),
            pinner=_hex(gl.message.sender_address),
            pinned_at=_now(),
        )
        if url_id not in self.url_of:
            self.url_of[url_id] = url
            self.url_ids.append(url_id)
        self.latest_version[url_id] = version
        self.pins_total = int(self.pins_total) + 1

    @gl.public.write
    def check(self, url: str) -> None:
        """Re-fetch ``url`` and record how the live manifest compares with its latest pin."""
        url = _validate_url(url)
        url_id = _url_id(url)
        if url_id not in self.latest_version:
            _fail("url is not pinned")
        version = int(self.latest_version[url_id])
        pin = self.pins[url_id + ":" + str(version)]
        # Copy everything the nondet block needs into plain locals: no storage inside it.
        pinned_root = str(pin.root)
        pinned_instructions_hash = str(pin.instructions_hash)
        pinned_hashes = {item["name"]: item["hash"] for item in json.loads(pin.tools_json)}

        def leader_fn() -> dict:
            return _observe(url, pinned_root, pinned_hashes, pinned_instructions_hash)

        def validator_fn(leaders_res: typing.Any) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False  # _observe never raises, so an error is not a valid observation
            theirs = leaders_res.calldata
            if not isinstance(theirs, dict):
                return False
            drift = theirs.get("drift")
            if drift == DRIFT_UNREACHABLE:
                return True  # safe harbour: records "unknown", never a pass
            mine = leader_fn()
            if drift == DRIFT_UNSTABLE:
                return mine["drift"] in (DRIFT_UNSTABLE, DRIFT_DIFFERS)
            if drift in (DRIFT_MATCH, DRIFT_DIFFERS):
                return mine == theirs  # DIFFERS: same new root, hence the same verified content
            return False

        seen = gl.vm.run_nondet(leader_fn, validator_fn)

        self.last_check[url_id] = DriftCheck(
            version=version,
            drift=str(seen["drift"]),
            root=str(seen["root"]),
            reason=str(seen["reason"])[:MAX_REASON_CHARS],
            added_json=json.dumps(seen["added"]),
            removed_json=json.dumps(seen["removed"]),
            modified_json=json.dumps(seen["modified"]),
            changed_json=json.dumps(seen["changed"], sort_keys=True, separators=(",", ":")),
            instructions_changed=bool(seen["instructions_changed"]),
            instructions=str(seen["instructions"]),
            checker=_hex(gl.message.sender_address),
            checked_at=_now(),
        )
        self.checks_total = int(self.checks_total) + 1
        if seen["drift"] in (DRIFT_DIFFERS, DRIFT_UNSTABLE):
            self.drifts_total = int(self.drifts_total) + 1

    # ------------------------------------------------------------------- views

    @gl.public.view
    def get_pin(self, url: str) -> str:
        """Latest pin of ``url`` as JSON: root, per-tool hashes and the last drift check."""
        url_id = _url_id(str(url).strip())
        if url_id not in self.latest_version:
            return json.dumps({"pinned": False, "url": str(url).strip()})
        pin = self.pins[url_id + ":" + str(int(self.latest_version[url_id]))]
        tools = json.loads(pin.tools_json)
        return json.dumps(
            {
                "pinned": True,
                "url": pin.url,
                "url_id": url_id,
                "version": int(pin.version),
                "root": pin.root,
                "protocol": pin.protocol,
                "instructions_hash": pin.instructions_hash,
                "pinner": pin.pinner,
                "pinned_at": pin.pinned_at,
                "tools": {item["name"]: item["hash"] for item in tools},
                "last_check": self._check_summary(url_id),
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_pin_version(self, url: str, version: int) -> str:
        """One pin version in full, including the canonical text of every tool."""
        url_id = _url_id(str(url).strip())
        key = url_id + ":" + str(int(version))
        if key not in self.pins:
            return json.dumps({"found": False})
        pin = self.pins[key]
        return json.dumps(
            {
                "found": True,
                "url": pin.url,
                "version": int(pin.version),
                "root": pin.root,
                "protocol": pin.protocol,
                "instructions_hash": pin.instructions_hash,
                "instructions": pin.instructions,
                "tools": json.loads(pin.tools_json),
                "pinner": pin.pinner,
                "pinned_at": pin.pinned_at,
            },
            sort_keys=True,
        )

    @gl.public.view
    def get_last_check(self, url: str) -> str:
        """The latest drift check of ``url`` in full, including verified changed tools."""
        url_id = _url_id(str(url).strip())
        if url_id not in self.last_check:
            return json.dumps({"checked": False})
        c = self.last_check[url_id]
        return json.dumps(
            {
                "checked": True,
                "version": int(c.version),
                "drift": c.drift,
                "root": c.root,
                "reason": c.reason,
                "added": json.loads(c.added_json),
                "removed": json.loads(c.removed_json),
                "modified": json.loads(c.modified_json),
                "changed": json.loads(c.changed_json),
                "instructions_changed": bool(c.instructions_changed),
                "instructions": c.instructions,
                "checker": c.checker,
                "checked_at": c.checked_at,
            },
            sort_keys=True,
        )

    @gl.public.view
    def verify_tool(self, url: str, name: str, tool_hash: str) -> bool:
        """True when ``tool_hash`` is the pinned hash of tool ``name`` in the latest pin of ``url``."""
        url_id = _url_id(str(url).strip())
        if url_id not in self.latest_version:
            return False
        pin = self.pins[url_id + ":" + str(int(self.latest_version[url_id]))]
        for item in json.loads(pin.tools_json):
            if item["name"] == name:
                return item["hash"] == str(tool_hash).strip().lower()
        return False

    @gl.public.view
    def list_pins(self, offset: int, limit: int) -> str:
        """A page of pinned servers, oldest first."""
        start = max(0, int(offset))
        count = max(0, min(int(limit), MAX_LIST))
        rows = []
        total = len(self.url_ids)
        for index in range(start, min(start + count, total)):
            url_id = self.url_ids[index]
            pin = self.pins[url_id + ":" + str(int(self.latest_version[url_id]))]
            check = self.last_check[url_id] if url_id in self.last_check else None
            rows.append(
                {
                    "url": pin.url,
                    "version": int(pin.version),
                    "root": pin.root,
                    "tools": len(json.loads(pin.tools_json)),
                    "pinned_at": pin.pinned_at,
                    "drift": check.drift if check is not None else "",
                    "checked_at": check.checked_at if check is not None else "",
                }
            )
        return json.dumps({"total": total, "offset": start, "items": rows}, sort_keys=True)

    @gl.public.view
    def get_stats(self) -> str:
        return json.dumps(
            {
                "servers": len(self.url_ids),
                "pins": int(self.pins_total),
                "checks": int(self.checks_total),
                "drifts": int(self.drifts_total),
            },
            sort_keys=True,
        )

    # ----------------------------------------------------------------- helpers

    def _check_summary(self, url_id: str) -> dict:
        if url_id not in self.last_check:
            return {}
        c = self.last_check[url_id]
        return {
            "version": int(c.version),
            "drift": c.drift,
            "root": c.root,
            "added": json.loads(c.added_json),
            "removed": json.loads(c.removed_json),
            "modified": json.loads(c.modified_json),
            "instructions_changed": bool(c.instructions_changed),
            "checked_at": c.checked_at,
        }
