# gl_mcp: call MCP servers from a GenLayer Intelligent Contract

`lib/gl_mcp.py` is a dependency-free MCP client sized for GenVM non-deterministic
blocks. It speaks the Streamable HTTP transport that remote MCP servers use and
turns a server's tool manifest into hashes that every validator derives
identically from the same bytes.

It handles:

- the `initialize` handshake, the `Mcp-Session-Id` header that some servers
  require (gitmcp, for example), and the `notifications/initialized` message;
- responses framed as plain JSON, SSE (`event:` / `data:` lines, including
  multi-line data) or JSON-RPC batches;
- `tools/list` pagination, bounded to 3 pages and 24 tools;
- TBCM-1 canonicalization and SHA-256 hashing of each tool and of the whole
  manifest;
- errors with stable prefixes, so validators can compare failures:
  `[EXTERNAL]` (the server answered with an error) and `[TRANSIENT]` (network
  trouble, 408, 429 or 5xx).

## Using it in your contract

GenVM's standard runner executes one file per contract, so inline the library.
Put `# @@include gl_mcp` in your contract source under `contracts/src/` and run
`python3 scripts/bundle.py`, or paste `lib/gl_mcp.py` below your imports.

Give it a transport that wraps `gl.nondet.web.post` and call it only inside a
non-deterministic block:

```python
def _post(url: str, body: str, headers: dict) -> tuple:
    try:
        response = gl.nondet.web.post(url, body=body, headers=headers)
    except Exception:
        raise McpError(ERR_TRANSIENT + " transport failure")
    return response.status, response.headers, response.body


@gl.public.write
def snapshot(self, url: str) -> None:
    def leader_fn() -> dict:
        try:
            manifest = fetch_manifest(lambda u, b, h: _post(u, b, h), url)
            return digest_manifest(manifest)
        except McpError as err:
            raise gl.vm.UserError(str(err))

    def validator_fn(leaders_res) -> bool:
        if not isinstance(leaders_res, gl.vm.Return):
            return False  # compare error classes here; see contracts/src/pinned_fetch.py
        try:
            return leader_fn() == leaders_res.calldata
        except gl.vm.UserError:
            return False

    digest = gl.vm.run_nondet(leader_fn, validator_fn)
    self.root = digest["root"]
```

Two GenVM rules matter here:

- Server JSON can contain floats, and floats trap in deterministic mode. Parse
  and canonicalize only inside the non-deterministic block, then store the
  resulting strings.
- Calling `_post` through a small lambda lets `genvm-lint` trace the
  `gl.nondet.web.post` call back to the consensus block (E010).

## API

| Function | Returns |
|---|---|
| `fetch_manifest(post, url)` | `{"protocol", "instructions", "tools"}` from the live server |
| `digest_manifest(manifest)` | `{"protocol", "root", "instructions_hash", "instructions", "tools": [{"name", "hash", "canon"}]}`, sorted by tool name |
| `canonical(value)` | TBCM-1 canonical JSON text |
| `sha256_hex(text)` | lowercase hex digest |
| `manifest_root(instructions_hash, tool_hashes)` | the manifest root |
| `diff_tools(pinned_hashes, live_tools)` | `{"added", "removed", "modified"}` tool names |
| `parse_rpc(body, want_id)` | the JSON-RPC `result` for one request id |

## TBCM-1 in one paragraph

For each tool object, drop `_meta`, write integral floats as integers, then
serialize with sorted keys, compact separators and `ensure_ascii=False`. Apply
no Unicode normalization, so invisible characters change the hash.
`tool_hash = sha256(canon(tool))`, and
`root = sha256(canon({"i": sha256(instructions), "t": sorted(tool_hashes)}))`.

## Tested against live servers

`tests/fixtures/` holds `initialize` and `tools/list` responses captured from
DeepWiki, Cloudflare Docs, gitmcp and Internet Court
(`scripts/capture_fixtures.py` refreshes them). `tests/test_gl_mcp.py` replays
them and pins their manifest roots, so any change to the canonical form is
caught. The same servers were pinned on Studio Next by validator consensus;
see [DEPLOYMENTS.md](DEPLOYMENTS.md).
