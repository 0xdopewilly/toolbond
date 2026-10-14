# Deployments

## Studio Next (chain 61997)

Explorer: https://explorer-studio-dev.genlayer.com

| Contract | Address | Deploy transaction | Runner |
|---|---|---|---|
| PinnedFetch | [`0x8D4B7B2376069251E05f3aef7C3f1F433c2F040c`](https://explorer-studio-dev.genlayer.com/address/0x8D4B7B2376069251E05f3aef7C3f1F433c2F040c) | `0x97fa50cc33ae480d5ace2231c916867bba4f139be009e13ee7fcfd8ea918ae75` | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |

Deployed source: `contracts/pinned_fetch.py`, SHA-256
`440bafc7a086d898c71cf1b422cbb0bb6152fe24ae835e1f542129acecadd1a8`.
Check it with `sha256sum contracts/pinned_fetch.py`, or compare against
`npx genlayer code 0x8D4B7B2376069251E05f3aef7C3f1F433c2F040c`.

### Live calls

Each was accepted with 3 validators agreeing and 2 idle after quorum.

| Call | Server | Transaction | Result |
|---|---|---|---|
| `pin` | `https://mcp.deepwiki.com/mcp` | `0xc8d91b369b3cd69c9b80dad55803c50e5d93dac793cc03b560803c03fafe9450` | FINISHED_WITH_RETURN |
| `pin` | `https://docs.mcp.cloudflare.com/mcp` | `0x119c1d1a2c2d0e78477e750a1bbb5cba8c202513c3e8b14e25ce9e2ed3e47875` | FINISHED_WITH_RETURN |
| `pin` | `https://gitmcp.io/modelcontextprotocol/python-sdk` (needs the session header) | `0x68468858cabf2d4561f3b76d55ece18554aca9ee28f6083a0f71cd1a9ab3da0b` | FINISHED_WITH_RETURN |
| `pin` | `https://mcp.internetcourt.org/mcp` | `0x2b54658da315979d028651b4eb78e490b8308be54dd92804494272ec4029ac75` | FINISHED_WITH_RETURN |
| `check` | `https://mcp.deepwiki.com/mcp` | `0x515c74a8bea66cd53dddc98725501468711aee48e6087a9608f4568e0b241950` | drift `MATCH` |
| `check` | `https://mcp.internetcourt.org/mcp` | `0xa3f69811203cc1b67f1c49c15c5f84011c40863a789daac727e3a34ad0484ec9` | drift `MATCH` |

Studio Next is a preview network and can be reset; redeploy with
`scripts/glw deploy contracts/pinned_fetch.py`.

An earlier build was deployed at `0x8dB0c1C6b08245e8986e3931D617aA1ca39238fA`
with the same pins; it is superseded by the address above, which adds
classified errors for unreadable manifests.

## ToolBond on Studio Next (chain 61997)

| Contract | Address | Deploy transaction |
|---|---|---|
| ToolBond | [`0x299Cf258f16ACd91A80ACa23fA39695b7eF88F8A`](https://explorer-studio-dev.genlayer.com/address/0x299Cf258f16ACd91A80ACa23fA39695b7eF88F8A) | `0xabf4494b997536d49610a944f927d6d205f888b596d8e1ba42b0a9e9d00fc035` |

Deployed source `contracts/toolbond.py`, SHA-256
`7469a72ac2431ea2727e21c9cf0eb2b3e8f5445d66adba65e8d8a591f2a7e08c`. Treasury: the deployer
(`0xe258d2604aec1321ddd58f179001cc6a8c442930`), movable with `set_treasury`.

### Live reviews of real MCP servers

Each server was sponsored (`sponsor_review`), pinned by validator consensus (`snapshot`) and judged
(`review`, two model readings per validator). Run with `scripts/live_review.sh`.

| Server | Verdict | Votes | Notes |
|---|---|---|---|
| `https://mcp.deepwiki.com/mcp` | SAFE | 3 agree | instructions list ~25 private-mode tools; correctly not treated as poison |
| `https://docs.mcp.cloudflare.com/mcp` | SAFE | 3 agree | "ALWAYS read this guide before migrating" correctly treated as usage guidance |
| `https://mcp.internetcourt.org/mcp` | SAFE | 3 agree | names GenLayer and verdicts; no longer trips the judge-targeting flag |
| `https://gitmcp.io/modelcontextprotocol/python-sdk` | UNCLEAR, then SAFE on retry | 3 agree, 2 disagree | generic "fetch any URL" tool is borderline; UNCLEAR grants nothing and the review was simply re-run |

### What the live runs taught us

1. **Inlined modules share one namespace.** `lib/judge.py` had a `_header` that replaced
   `gl_mcp._header`, so the MCP client sent a multi-line prompt as `Mcp-Session-Id` and GenVM rejected
   it ("invalid header value"). The mock server in direct-mode tests never validates headers, so only
   the live network caught it. `scripts/bundle.py` now refuses to build on any top-level name collision.
2. **Judge calibration matters more than prompt cleverness.** The first prompt let "goes beyond the
   declared purpose" justify UNCLEAR, and DeepWiki's honest feature list split the two readings. An
   explicit decision procedure (only sentences instructing (a)-(d) count) made real servers SAFE.
3. **Brand words are not attacks.** The judge-targeting flag first matched the bare words "GenLayer"
   and "verdict", which a GenLayer-built court legitimately uses. It now matches phrases that address
   or instruct a reviewer.
4. **gltest 0.30rc2 vs the v0.3 SDK:** mocked LLM answers must be double-encoded JSON in direct tests,
   because the SDK expects JSON *text* from the host (see `tests/direct/test_toolbond.py`).

### Known issue (2026-10-13)

Contract reads (`gen_call`) on Studio Next fail for every contract with
`Can't reconnect until invalid transaction is rolled back`. Writes, consensus and
schema calls work. Views are covered by the direct-mode tests until reads recover,
and drift verdicts above were read from the leader's consensus output.

### Lesson recorded

GenVM concatenates every leading comment line of a contract into its runner
header. A generated-file comment placed on line 3 made the first deploy fail with
`invalid_contract runner malformed`, which `genvm-lint` does not detect.
`tests/test_contract_files.py` now guards the header.
