"""gl_mcp: a minimal MCP (Model Context Protocol) client for GenLayer Intelligent Contracts.

It performs the Streamable-HTTP handshake (``initialize``, optional
``Mcp-Session-Id``, ``notifications/initialized``) and a paginated ``tools/list``,
then canonicalizes the manifest so that every validator derives the same hashes
from the same bytes (ToolBond Canonical Manifest v1, "TBCM-1").

The HTTP transport is injected as ``post(url, body, headers) -> (status, headers, body)``,
so the same code runs inside a GenVM non-deterministic block (wrapping
``gl.nondet.web.post``) and in plain-Python tests.

Determinism notes:
- JSON from a server may contain floats. Parse and canonicalize it only inside a
  non-deterministic block; deterministic contract code should store and compare the
  resulting strings, never re-parse them.
- Errors carry a stable prefix so validators can compare failures:
  ``[EXTERNAL]`` (the server answered, but with an error) and ``[TRANSIENT]``
  (network trouble or a 5xx that may clear on retry).
"""

import hashlib
import json
import re

PROTOCOL_VERSION = "2025-06-18"
MAX_TOOLS = 24
MAX_PAGES = 3
MAX_MANIFEST_BYTES = 64_000
MAX_INSTRUCTIONS_CHARS = 4_000

ERR_EXTERNAL = "[EXTERNAL]"
ERR_TRANSIENT = "[TRANSIENT]"


class McpError(Exception):
    """A fetch failure whose message starts with a stable error-class prefix."""


def base_headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "User-Agent": "gl-mcp/0.1 (GenLayer Intelligent Contract)",
    }


def initialize_request(request_id: int) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "gl-mcp", "version": "0.1"},
        },
    }


def tools_list_request(request_id: int, cursor: str = "") -> dict:
    params = {"cursor": cursor} if cursor else {}
    return {"jsonrpc": "2.0", "id": request_id, "method": "tools/list", "params": params}


def _text(body) -> str:
    if body is None:
        return ""
    if isinstance(body, (bytes, bytearray, memoryview)):
        return bytes(body).decode("utf-8", "replace")
    return str(body)


def _sse_payloads(text: str) -> list:
    """The ``data:`` payload of every server-sent event, multi-line data joined per the SSE spec."""
    payloads, current = [], []
    # SSE ends lines with CRLF, LF or CR only. str.splitlines() would also split on U+2028,
    # NEL and friends, which JSON may carry unescaped inside strings.
    for line in re.split(r"\r\n|\r|\n", text):
        if line.startswith("data:"):
            current.append(line[5:].lstrip(" "))
        elif line == "" and current:
            payloads.append("\n".join(current))
            current = []
    if current:
        payloads.append("\n".join(current))
    return payloads


def parse_rpc(body, want_id: int) -> dict:
    """Return the JSON-RPC ``result`` for ``want_id`` from a JSON or SSE-framed body."""
    text = _text(body)
    stripped = text.lstrip()
    candidates = [stripped] if stripped.startswith("{") or stripped.startswith("[") else _sse_payloads(text)
    for raw in candidates:
        try:
            parsed = json.loads(raw)
        except ValueError:
            continue
        messages = parsed if isinstance(parsed, list) else [parsed]
        for message in messages:
            if not isinstance(message, dict) or str(message.get("id")) != str(want_id):
                continue
            if "error" in message:
                error = message.get("error")
                code = error.get("code") if isinstance(error, dict) else None
                raise McpError(f"{ERR_EXTERNAL} rpc error {code}")
            result = message.get("result")
            if not isinstance(result, dict):
                raise McpError(f"{ERR_EXTERNAL} malformed rpc result")
            return result
    raise McpError(f"{ERR_EXTERNAL} no rpc response for id {want_id}")


def _check_status(status: int) -> None:
    if status >= 500 or status in (408, 429):
        raise McpError(f"{ERR_TRANSIENT} http {status}")
    if status >= 400:
        raise McpError(f"{ERR_EXTERNAL} http {status}")


def _header(headers, name: str) -> str:
    for key, value in (headers or {}).items():
        if str(key).lower() == name:
            return _text(value).strip()
    return ""


def fetch_manifest(post, url: str) -> dict:
    """Fetch ``{"protocol", "instructions", "tools"}`` from a Streamable-HTTP MCP server.

    ``post(url, body: str, headers: dict) -> (status: int, headers: dict, body: bytes | str)``
    must raise ``McpError`` (or let any exception escape) on transport failure.
    """
    headers = base_headers()
    status, response_headers, body = post(url, json.dumps(initialize_request(1)), headers)
    _check_status(status)
    info = parse_rpc(body, 1)

    session_id = _header(response_headers, "mcp-session-id")
    if session_id:
        headers = dict(headers)
        headers["Mcp-Session-Id"] = session_id

    # Required by the MCP lifecycle; stateless servers ignore it, so failures are not fatal.
    try:
        post(url, json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}), headers)
    except Exception:
        pass

    tools, cursor = [], ""
    for page in range(MAX_PAGES):
        request_id = 2 + page
        status, _, body = post(url, json.dumps(tools_list_request(request_id, cursor)), headers)
        _check_status(status)
        result = parse_rpc(body, request_id)
        page_tools = result.get("tools")
        if not isinstance(page_tools, list):
            raise McpError(f"{ERR_EXTERNAL} tools/list returned no tool list")
        tools.extend(page_tools)
        if len(tools) > MAX_TOOLS:
            raise McpError(f"{ERR_EXTERNAL} manifest has more than {MAX_TOOLS} tools")
        cursor = result.get("nextCursor") or ""
        if not cursor:
            break
    else:
        if cursor:
            raise McpError(f"{ERR_EXTERNAL} manifest spans more than {MAX_PAGES} pages")

    instructions = info.get("instructions")
    return {
        "protocol": str(info.get("protocolVersion") or ""),
        "instructions": instructions if isinstance(instructions, str) else "",
        "tools": tools,
    }


def _normalize(value):
    if value is None or isinstance(value, bool) or isinstance(value, int):
        return value
    if isinstance(value, str):
        # a lone surrogate cannot be encoded as UTF-8, so every validator would fail to hash it
        if any(0xD800 <= ord(char) <= 0xDFFF for char in value):
            raise McpError(f"{ERR_EXTERNAL} invalid unicode in manifest")
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise McpError(f"{ERR_EXTERNAL} non-finite number in manifest")
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {_normalize(str(key)): _normalize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(item) for item in value]
    return str(value)


def canonical(value) -> str:
    """TBCM-1 encoding: integral floats become ints, sorted keys, compact, no Unicode
    normalization (hidden characters must change the hash). See ``tool_object`` for ``_meta``."""
    return json.dumps(_normalize(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def tool_object(tool: dict) -> dict:
    """The part of a tool definition that is hashed: everything except its own top-level
    ``_meta`` (protocol metadata that clients do not show the model). Nested keys named
    ``_meta`` are ordinary data and stay in."""
    return {key: value for key, value in tool.items() if key != "_meta"}


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def manifest_root(instructions_hash: str, tool_hashes: list) -> str:
    return sha256_hex(canonical({"i": instructions_hash, "t": sorted(tool_hashes)}))


def digest_manifest(manifest: dict) -> dict:
    """Canonicalize a fetched manifest into hashes plus canonical text, sorted by tool name."""
    tools, names, total = [], set(), 0
    for tool in manifest.get("tools") or []:
        if not isinstance(tool, dict) or not isinstance(tool.get("name"), str) or not tool["name"]:
            raise McpError(f"{ERR_EXTERNAL} tool without a name")
        name = tool["name"]
        if name in names:
            raise McpError(f"{ERR_EXTERNAL} duplicate tool name")
        names.add(name)
        text = canonical(tool_object(tool))
        total += len(text.encode("utf-8"))
        tools.append({"name": name, "hash": sha256_hex(text), "canon": text})
    instructions = manifest.get("instructions") or ""
    total += len(instructions.encode("utf-8"))
    if total > MAX_MANIFEST_BYTES:
        raise McpError(f"{ERR_EXTERNAL} manifest larger than {MAX_MANIFEST_BYTES} bytes")
    tools.sort(key=lambda item: item["name"])
    instructions_hash = sha256_hex(instructions)
    return {
        "protocol": manifest.get("protocol") or "",
        "root": manifest_root(instructions_hash, [item["hash"] for item in tools]),
        "instructions_hash": instructions_hash,
        "instructions": instructions[:MAX_INSTRUCTIONS_CHARS],
        "tools": tools,
    }


def diff_tools(pinned_hashes: dict, live_tools: list) -> dict:
    """Names added, removed or modified relative to ``pinned_hashes`` (name -> hash)."""
    live = {item["name"]: item["hash"] for item in live_tools}
    return {
        "added": sorted(name for name in live if name not in pinned_hashes),
        "removed": sorted(name for name in pinned_hashes if name not in live),
        "modified": sorted(name for name, h in live.items() if name in pinned_hashes and pinned_hashes[name] != h),
    }
