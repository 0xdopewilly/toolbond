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
