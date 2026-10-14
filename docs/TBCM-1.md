# TBCM-1: ToolBond Canonical Manifest, version 1

Validators (Python, inside GenVM) and clients such as `@toolbond/guard`
(TypeScript) must turn the same MCP tool object into the same bytes, or a pinned
tool will look modified. The reference implementation is `lib/gl_mcp.py`;
`tests/vectors/tbcm1.json` holds the vectors every implementation must pass
(regenerate them with `scripts/make_vectors.py`).

## Tool canonical form

Given a tool object parsed from a `tools/list` result:

1. Remove the tool object's own top-level `_meta` member (protocol metadata that
   clients do not show the model). A key named `_meta` anywhere else, for example a
   parameter inside `inputSchema`, is ordinary data and stays in the hash. Earlier
   drafts dropped `_meta` at every depth, which let a publisher hide a poisoned
   parameter description without changing the hash.
2. Numbers: a number with no fractional part is written as an integer, with every
   digit of its exact value (`1.0` → `1`, `-0.0` → `0`, `1e16` → `10000000000000000`,
   `1e300` → its exact 301-digit expansion). Other numbers use Python's `repr` of
   the IEEE-754 double: the shortest round-trip digits, in scientific notation when
   the decimal exponent is below −4 or at least 16, with a sign and at least two
   exponent digits (`1.5e-07`, `1e-05`, `0.0001`, `1.2345678901234568e-300`).
   Integers in the source text are exact (`12345678901234567890` stays exact), which
   needs a lossless JSON parser in JavaScript.
3. Serialize as JSON with object keys sorted by Unicode code point (not by UTF-16
   code unit), no whitespace (`,` and `:` separators), and strings written as-is
   except for `"` `\` and control characters below U+0020, which use `\"` `\\`
   `\b` `\f` `\n` `\r` `\t` or lowercase `\u00XX`. Do not escape `/`, U+007F,
   U+2028/U+2029 or any non-ASCII character. Apply no Unicode normalization.
   A string containing an unpaired UTF-16 surrogate has no UTF-8 encoding: the
   manifest is invalid and implementations must refuse it.
4. `tool_hash` = lowercase hex SHA-256 of the UTF-8 bytes of that text.

## Manifest root

`instructions` is the `instructions` string from the server's `initialize` result
(`""` when absent).

```
instructions_hash = sha256_hex(utf8(instructions))
root = sha256_hex(utf8(canon({"i": instructions_hash, "t": sorted(tool_hashes)})))
```

`sorted` is plain ascending order of the 64-character hex strings.

## Failure behaviour

An implementation that cannot reproduce a vector (for example, a JavaScript client
without a lossless parser meeting a 20-digit integer) must treat the tool as
unpinned. That blocks the tool, which is the safe direction.
