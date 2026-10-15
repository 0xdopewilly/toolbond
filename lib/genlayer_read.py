"""Read GenLayer contract views over JSON-RPC (gen_call) with the standard library only.

The guard uses this to read ToolBond's get_pins straight from the chain instead of trusting a
relay. Requests are GenLayer calldata ({"": method, "args": [...]}) wrapped in RLP, as
genlayer-py and genlayer-js send them; the result is calldata too.

Trust: a read is as honest as the RPC endpoint that answers it. Point --rpc at a node you
trust (or run your own); on Studio Next that is the hosted preview network.
"""

import json
import urllib.error
import urllib.request

ZERO_ADDRESS = "0x" + "00" * 20
_TYPE_SPECIAL, _TYPE_PINT, _TYPE_NINT, _TYPE_BYTES, _TYPE_STR, _TYPE_ARR, _TYPE_MAP = range(7)


class ReadError(Exception):
    """The view could not be read: network failure, RPC error or an undecodable result."""


# ---------------------------------------------------------------------------- calldata


def _uleb(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def encode(value) -> bytes:
    """GenLayer calldata for None, bools, ints, str, bytes, lists and str-keyed dicts."""
    if value is None:
        return bytes([_TYPE_SPECIAL])
    if value is True:
        return bytes([(2 << 3) | _TYPE_SPECIAL])
    if value is False:
        return bytes([(1 << 3) | _TYPE_SPECIAL])
    if isinstance(value, int):
        return _uleb((value << 3) | _TYPE_PINT) if value >= 0 else _uleb(((-value - 1) << 3) | _TYPE_NINT)
    if isinstance(value, bytes):
        return _uleb((len(value) << 3) | _TYPE_BYTES) + value
    if isinstance(value, str):
        raw = value.encode("utf-8")
        return _uleb((len(raw) << 3) | _TYPE_STR) + raw
    if isinstance(value, (list, tuple)):
        return _uleb((len(value) << 3) | _TYPE_ARR) + b"".join(encode(item) for item in value)
    if isinstance(value, dict):
        out = _uleb((len(value) << 3) | _TYPE_MAP)
        for key in sorted(value):
            raw = str(key).encode("utf-8")
            out += _uleb(len(raw)) + raw + encode(value[key])
        return out
    raise TypeError("cannot encode " + type(value).__name__)


def decode(data: bytes):
    """Inverse of encode (addresses come back as 0x-prefixed hex)."""
    value, end = _decode_at(data, 0)
    if end != len(data):
        raise ReadError("trailing bytes after calldata")
    return value


def _read_uleb(data: bytes, index: int) -> tuple:
    value = shift = 0
    while True:
        if index >= len(data):
            raise ReadError("truncated calldata")
        byte = data[index]
        index += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if not byte & 0x80:
            return value, index


def _decode_at(data: bytes, index: int) -> tuple:
    head, index = _read_uleb(data, index)
    kind, size = head & 7, head >> 3
    if kind == _TYPE_SPECIAL:
        if size in (0, 1, 2):
            return (None, False, True)[size], index
        if size == 3:
            return "0x" + data[index:index + 20].hex(), index + 20
        raise ReadError("unknown special value")
    if kind == _TYPE_PINT:
        return size, index
    if kind == _TYPE_NINT:
        return -size - 1, index
    if kind in (_TYPE_BYTES, _TYPE_STR):
        chunk = data[index:index + size]
        if len(chunk) != size:
            raise ReadError("truncated calldata")
        return (bytes(chunk) if kind == _TYPE_BYTES else chunk.decode("utf-8")), index + size
    if kind == _TYPE_ARR:
        items = []
        for _ in range(size):
            item, index = _decode_at(data, index)
            items.append(item)
        return items, index
    if kind == _TYPE_MAP:
        mapping = {}
        for _ in range(size):
            length, index = _read_uleb(data, index)
            key = data[index:index + length].decode("utf-8")
            index += length
            mapping[key], index = _decode_at(data, index)
        return mapping, index
    raise ReadError("unknown calldata type")


# --------------------------------------------------------------------------------- RLP


def _rlp_length(length: int, offset: int) -> bytes:
    if length < 56:
        return bytes([offset + length])
    raw = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([offset + 55 + len(raw)]) + raw


def rlp_bytes(item: bytes) -> bytes:
    if len(item) == 1 and item[0] < 0x80:
        return item
    return _rlp_length(len(item), 0x80) + item


def rlp_list(items: list) -> bytes:
    body = b"".join(rlp_bytes(item) for item in items)
    return _rlp_length(len(body), 0xC0) + body


# ------------------------------------------------------------------------------ gen_call


def call_data(method: str, args: list) -> str:
    message = {"": method, "args": list(args)} if args else {"": method}
    return "0x" + rlp_list([encode(message), b"\x00"]).hex()


def http_json(url: str, payload: dict, timeout: float = 20.0) -> dict:
    request = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "toolbond-guard"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise ReadError("rpc unreachable: " + str(error)[:160])


def read_view(rpc: str, contract: str, method: str, args: list, post=http_json):
    """Call a view on the latest state the RPC knows (accepted, not yet final) and decode it."""
    request = {
        "jsonrpc": "2.0", "id": 1, "method": "gen_call",
        "params": [{
            "type": "read", "to": contract, "from": ZERO_ADDRESS, "data": call_data(method, args),
            "transaction_hash_variant": "latest-nonfinal",
        }],
    }
    body = post(rpc, request)
    if not isinstance(body, dict):
        raise ReadError("rpc returned a non-object")
    if body.get("error"):
        raise ReadError("rpc error: " + str(body["error"])[:200])
    result = body.get("result")
    if not isinstance(result, str):
        raise ReadError("rpc returned no result")
    try:
        return decode(bytes.fromhex(result[2:] if result.startswith("0x") else result))
    except ValueError as error:
        raise ReadError("undecodable result: " + str(error)[:120])
