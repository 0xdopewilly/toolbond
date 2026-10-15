# Response to the steward review of ToolBond (submission 0a08983b)

Each request from the review, what changed, and where to check it. Contract:
[`0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b`](https://explorer-studio-dev.genlayer.com/address/0x7c0be3E1a8249DBF52aA4c4C34BC2044D18f2A5b)
(ToolBond v3, Studio Next), deployed from commit
[`b5bde68`](https://github.com/0xdopewilly/toolbond/commit/b5bde688380c3c79534b436b7932f8f286f0c9f2).

## 1. The BONDED collateral invariant

**Request:** an ACTIVE BONDED server must not keep advertising minimum-collateral assurance after its
bond falls below 10 GEN. Add top-up, downgrade or reactivation restrictions, test the adversarial
cases, and redeploy.

**What changed** (`contracts/src/toolbond.py`):

- Every view now reports `assurance`, separate from the registration `tier`. It is `BONDED` only
  while `bond >= MIN_BOND`, `UNDERCOLLATERALIZED` for a BONDED registration below it, and
  `REVIEWED` for sponsored reviews. `get_pins` also returns `bond` and `min_bond`.
- Downgrade: drift settlements that reduce a bond (5% benign, 25% unpinned) already move the
  server to `STALE`. Its assurance now reads `UNDERCOLLATERALIZED` at once, everywhere.
- Reactivation restriction: `snapshot` (re-pin) and `review` (promotion to ACTIVE) refuse a BONDED
  server below the minimum with `[EXPECTED] … top_up first`.
- Top-up: a new payable `top_up(sid)` lets the publisher restore the bond. Like every payable
  method, it never raises; bad requests are refunded.
- Accounting: `get_accounting()` returns balance, bonded, pool, claimable_total and staked, plus
  `conserved` (`balance == bonded + pool + claimable_total + staked` and
  `bonded == sum of per-server bonds`).

**Adversarial direct-mode tests** (`tests/direct/test_toolbond_adversarial.py`, 12 tests). A ledger
of every deposit and withdrawal is compared with the contract's books after every write:

| Case | Test |
|---|---|
| Benign drift below the minimum drops assurance | `test_a_benign_drift_below_the_minimum_drops_bonded_assurance` |
| Re-pinning a drained bond needs a full top-up (a partial one is refused) | `test_re_pinning_a_drained_bond_needs_a_top_up` |
| No challenge can drain a bond while it is under review | `test_no_challenge_can_drain_a_bond_under_review` |
| Top-up refusals (non-publisher, REVIEWED, unknown, zero, EXITING) are refunded | `test_top_up_refusals_are_refunded` |
| Eight repeated benign drifts: geometric depletion, a repeat is KNOWN, never reactivated | `test_repeated_benign_drift_depletes_but_never_restores_assurance` |
| 39 drifts cannot overdraw the bond | `test_drift_rewards_cannot_overdraw_the_bond` |
| A colluding publisher and hunter end with exactly what they paid in, minus the review fee; restoring assurance costs exactly the drained amount | `test_a_colluding_publisher_and_hunter_gain_nothing` |
| A poisoned change after a top-up still costs the whole bond | `test_a_poisoned_change_after_a_top_up_still_costs_the_whole_bond` |
| Every payout row (CONTENT SAFE/UNCLEAR, MATCH, UNREACHABLE, UNPINNED, expiry), withdrawals and exit conserve value | `test_every_payout_row_conserves_value` |
| Rejection and sponsored reviews conserve value | `test_rejection_and_sponsored_reviews_conserve_value` |

**On chain**, unattended where the review asked for it
([`docs/DEPLOYMENTS.md`](DEPLOYMENTS.md#a-harmless-update-the-collateral-invariant-and-a-top-up)):

1. A bonded server made a harmless update at 12:00 UTC.
2. The patrol bot, under a separate hunter account, filed a DRIFT challenge. Validators observed
   DIFFERS and judged SAFE, and settlement paid the hunter 5%, leaving the bond at 9.5 GEN and the
   server `STALE`, `UNDERCOLLATERALIZED`.
3. The publisher's re-pin was refused on chain
   ([`0x43e523f8…`](https://explorer-studio-dev.genlayer.com/tx/0x43e523f89e5453ea354ff5260bd28995e7b04cfac7381b3a17acbaea68a6b7c9):
   `bond is below the minimum … top_up first`).
4. `top_up` of 0.5 GEN restored `BONDED`, and the server was re-pinned and reviewed back to
   `ACTIVE`.

## 2. Guard authorization and freshness

**Request:** unauthenticated or outdated relay snapshots must not silently carry the same assurance
as current contract-verified approval. Fail closed by default, state the trust assumptions of any
fallback, and show behaviour under false ACTIVE answers, stale revocations, RPC outages, expired
caches and status changes.

**What changed** (`lib/toolbond_guard.py` 0.3, new `lib/genlayer_read.py`):

- By default the guard reads `get_pins` straight from the contract with `gen_call`, on every
  refresh (each list, each call, every poll). The client is standard library only (GenLayer
  calldata and RLP). No relay is configured.
- It fails closed. If the contract read fails, every tool is blocked. Answers about a different
  URL are ignored from any source.
- Fallbacks are opt-in and labelled: `--cache-minutes` (contract-cache), `--relay`
  (trusted-relay), `--accept-snapshot-hours` (relay-snapshot), `--pins-file` (operator-file).
  Every decision records its `approval_source`, and `toolbond_status` shows the source, whether it
  is verified, the trust statement and the age.
- The site's `/api/pins` says what it returns (`source: "contract"` with the RPC used, or
  `source: "snapshot"`, `authoritative: false`). The guard refuses its snapshots by default.
- The stored snapshot is now only the contract's own view outputs, stamped with when and where they
  were read (`scripts/snapshot_state.py`), never reconstructed state.
- `--bonded-only` now requires `assurance == "BONDED"`; version 2 pins without that field cannot
  satisfy it.

**Tests** (`tests/test_guard_trust.py`, 15 tests): contract-first labelling; RPC outage fails
closed; a relay's false ACTIVE never overrides a contract SLASHED; relays are opt-in and unverified;
snapshots refused unless accepted and fresh; wrong-URL answers refused; stale revocations with and
without the cache; expired and foreign caches; SLASHED, PENDING_REVIEW, EXITING and REJECTED
applied on the next refresh; collateral and ownership flags. There is also an end-to-end `gen_call`
round trip against a fake RPC over HTTP, including RPC errors and garbage.

**Live guard runs**: the real CLI, driven as an MCP client against v3
([`evidence/v3-guard-after-update.md`](evidence/v3-guard-after-update.md)):

- DeepWiki is allowed from a contract read, and blocked with `--bonded-only` (REVIEWED).
- The bonded, owner-verified server is allowed under `--bonded-only --owner-verified-only`.
- The slashed rug pull and an unregistered poisoned server are blocked.
- With the RPC unreachable, everything is blocked (`source: none`). With an opt-in relay, tools
  are allowed but labelled `trusted-relay`, `verified: false`.

The full trust model is in [`docs/GUARD.md`](GUARD.md).

## 3. The actual security guarantees

**Request:** distinguish bonded registrants from verified server owners, and sponsored REVIEWED
assessments from BONDED registrations. Describe manifest-integrity protection consistently,
not comprehensive MCP runtime security.

**What changed:**

- An owner proof. The contract sets `owner_verified` only when the pinned MCP instructions contain
  `toolbond-owner:<publisher address>`. Validators fetch those instructions themselves, so the
  proof is part of the hashed manifest. A new registrant never inherits a previous one's proof
  (`test_owner_proof_must_name_the_publisher`,
  `test_a_new_registrant_does_not_inherit_owner_verification`). Live: the v3 update server is
  `owner_verified: true`; the other servers are not.
- Labels everywhere:
  - Registry rows and server pages show Bonded, Under-collateralized or Reviewed with no bond, plus
    Owner verified or "Registrant, owner not verified", each with an explanation.
  - The guard adds `--owner-verified-only`.
  - The API exposes `assurance` and `owner_verified`.
- Scope wording: the README, the security model page, the guard docs, `docs/GUARD.md` and the
  guard's own `toolbond_status` (`scope`) all describe manifest integrity. Each says it does not
  cover tool behaviour at call time, server ownership without a proof, or reviewed servers' lack of
  stake, and names the RPC trust assumption.

## 4. Evidence

| Asked for | Where |
|---|---|
| Corrected deployed-source hash linked to the reviewed commit | `8010076531b4ed1af0c39ef096dc9435f5f7cd9f122c1895ad068237a07961f0` = `git show b5bde68:contracts/toolbond.py \| sha256sum` ([DEPLOYMENTS.md](DEPLOYMENTS.md)) |
| Finalized deployment | deploy tx [`0x4f0cd77a…`](https://explorer-studio-dev.genlayer.com/tx/0x4f0cd77a2d0e8f5ca2fd83fec6ead3b7b68ec0d8c92dbaf785942d1f90e551b3), status FINALIZED. All 38 v3 transactions are FINALIZED ([evidence/v3-transactions.md](evidence/v3-transactions.md)) |
| Representative lifecycle transactions | register, snapshot, review, sponsor_review, attest, challenge, observe, judge (SAFE and POISONED), settle, a refused re-pin, top_up, re-pin, review: [DEPLOYMENTS.md](DEPLOYMENTS.md) |
| Passing adversarial direct-mode tests | `scripts/glw test`: 134 passed (12 adversarial contract tests, 15 guard trust tests, plus the earlier suite); demo server 7 passed |
| Updated guard integration evidence | [evidence/v3-guard-before-update.md](evidence/v3-guard-before-update.md), [evidence/v3-guard-undercollateralized.md](evidence/v3-guard-undercollateralized.md), [evidence/v3-guard-after-update.md](evidence/v3-guard-after-update.md) |
| Authoritative state readbacks | contract reads work on Studio Next again. [evidence/v3-readbacks.md](evidence/v3-readbacks.md): `get_accounting` (22.7 GEN, `conserved: true`), `get_pins` per server, challenge outcomes. Reproduce with `python3 scripts/readback.py` |
| Independently verifiable execution, consensus and economics | `scripts/tx_index.py` rebuilds every transaction from `eth_getTransactionByHash` (sender, method, arguments, value, status, votes, return value). Nothing is taken from local logs except the hashes |

Known limits, stated in the docs:

- Studio Next is a hosted preview network that can be reset.
- `gen_call` is rate-limited (20 reads per 10 s per contract, about 30 per minute per client).
  Under heavier load the guard fails closed unless the operator opted into a cache or relay.
- A contract read is as honest as the RPC node that serves it.
