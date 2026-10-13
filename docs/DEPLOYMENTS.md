# Deployments

## Studio Next (chain 61997)

Explorer: https://explorer-studio-dev.genlayer.com

| Contract | Address | Deploy transaction | Runner |
|---|---|---|---|
| PinnedFetch | [`0x8dB0c1C6b08245e8986e3931D617aA1ca39238fA`](https://explorer-studio-dev.genlayer.com/address/0x8dB0c1C6b08245e8986e3931D617aA1ca39238fA) | `0x57a61f11398df681b4501f34567954c5fa0d21b6fb46e5a4651c60878bfcaf07` | `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng` |

### Live pins

| Server | Transaction | Result | Votes |
|---|---|---|---|
| `https://mcp.deepwiki.com/mcp` | `0x47a8a739cb249169801604e2e6e009ac9bf5d76563e61320c7c1dbc45c4d81f8` | ACCEPTED, FINISHED_WITH_RETURN | 3 agree, 2 idle after quorum |

Studio Next is a preview network and can be reset; redeploy with
`scripts/glw deploy contracts/pinned_fetch.py`.

### Known issue (2026-10-13)

Contract reads (`gen_call`) on Studio Next fail for every contract with
`Can't reconnect until invalid transaction is rolled back`. Writes, consensus and
schema calls work. Views are covered by the direct-mode tests until reads recover.

### Lesson recorded

GenVM concatenates every leading comment line of a contract into its runner
header. A generated-file comment placed on line 3 made the first deploy fail with
`invalid_contract runner malformed`, which `genvm-lint` does not detect.
`tests/test_contract_files.py` now guards the header.
