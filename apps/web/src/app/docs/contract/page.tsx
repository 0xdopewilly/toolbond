import type { Metadata } from "next";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, Code, DocTitle, H2, H3, Table } from "@/components/docs/prose";
import { EXPLORER } from "@/lib/chain";
import { REPO, TOOLBOND_ADDRESS } from "@/lib/deployments";

export const metadata: Metadata = { title: "Contract API · Docs" };

export default function ContractApi() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Reference"
        title="Contract API"
        lede={
          <>
            ToolBond v3 on GenLayer Studio Next at{" "}
            <a href={`${EXPLORER}/address/${TOOLBOND_ADDRESS}`} className="mono">
              {TOOLBOND_ADDRESS.slice(0, 10)}…{TOOLBOND_ADDRESS.slice(-6)}
            </a>
            . The full specification lives in <a href={`${REPO}/blob/main/docs/CONTRACT_API.md`}>docs/CONTRACT_API.md</a>.
          </>
        }
      />

      <H2>Conventions</H2>
      <ul className="docs-list">
        <li>Amounts are integers in wei (18 decimals); views return them as decimal strings.</li>
        <li>
          <C>sid</C> is the first 16 hex characters of <C>sha256(utf8(url))</C>, so clients compute it locally. <C>cid</C> is <C>c1</C>,{" "}
          <C>c2</C>, …
        </li>
        <li>
          Payable methods never raise: a bad request credits the value to your claimable balance and returns <C>{"{ ok: false, error }"}</C>.
          Other writes revert with a prefixed message: <C>[EXPECTED]</C>, <C>[EXTERNAL]</C>, <C>[TRANSIENT]</C>.
        </li>
        <li>Every write on Studio Next needs explicit fees; estimate them first (the site and the scripts do this for you).</li>
      </ul>

      <H2>Write methods</H2>
      <Table
        head={["Method", "Value", "Who", "Effect"]}
        rows={[
          [<C key="1">register(url, purpose, caps)</C>, "≥ 10.2 GEN", "anyone", "New BONDED server; returns sid"],
          [<C key="2">sponsor_review(url, purpose, caps)</C>, "≥ 0.2 GEN", "anyone", "New REVIEWED server for a third-party URL"],
          [<C key="3">snapshot(sid)</C>, "", "anyone while pending; the publisher on ACTIVE or STALE", "Fetch consensus, store pins, check the owner proof → PENDING_REVIEW. A BONDED server needs its bond at the minimum"],
          [<C key="4">review(sid)</C>, "", "anyone", "Judge the next batch of 6 pinned tools; a BONDED server below the minimum is not reactivated"],
          [<C key="14">top_up(sid)</C>, "any amount", "publisher", "Add GEN to a BONDED server's bond, for example to restore the minimum after a drift settlement"],
          [<C key="5">challenge(sid, tool, kind)</C>, "the stake", "anyone", "CONTENT (1 GEN, tool named) or DRIFT (0.5 GEN, tool empty)"],
          [<C key="6">observe(cid, &quot;content&quot;)</C>, "", "anyone", "DRIFT only: validators classify the live manifest"],
          [<C key="7">judge(cid)</C>, "", "anyone", "CONTENT: the pinned tool; DRIFT with DIFFERS: the changed tools"],
          [<C key="8">settle(cid)</C>, "", "anyone", "Apply the payout table"],
          [<C key="9">expire(cid)</C>, "", "anyone", "FILED or OBSERVED after 72 h: refund"],
          [<C key="10">attest(sid)</C>, "", "anyone", "Presence check without a challenge"],
          [<C key="11">request_exit(sid)</C>, "", "publisher", "BONDED: 7-day delay; REVIEWED: immediate, no open challenge"],
          [<C key="12">finalize_exit(sid)</C>, "", "anyone", "After the delay, with no open challenge: bond becomes claimable"],
          [<C key="13">withdraw()</C>, "", "anyone", "Pay out your claimable balance"],
        ]}
      />

      <H2>Views</H2>
      <p>All views return JSON strings.</p>
      <H3>get_pins(url)</H3>
      <p>
        What the guard reads. <C>tier</C> is how the server was registered; <C>assurance</C> is what holds now: BONDED only while the bond
        meets the minimum, UNDERCOLLATERALIZED below it, REVIEWED for sponsored reviews. <C>owner_verified</C> is true when the pinned
        instructions contain <C>toolbond-owner:&lt;publisher&gt;</C>.
      </p>
      <Code lang="json" title="get_pins">{`
{"known": true, "sid": "a1b2c3d4e5f60718", "url": "https://…/mcp", "status": "ACTIVE", "tier": "BONDED",
 "assurance": "BONDED", "bond": "10000000000000000000", "min_bond": "10000000000000000000",
 "owner_verified": true, "root": "<64 hex>", "tools": {"get_forecast": "<64 hex>"},
 "verdicts": {"get_forecast": "SAFE"}, "open_challenges": 0, "drift_root": "",
 "updated_at": "2026-10-15T11:26:36Z", "contract_version": "3"}
`}</Code>
      <H3>Everything else</H3>
      <Table
        head={["View", "Returns"]}
        rows={[
          [<C key="1">get_server(sid)</C>, "Everything a server page needs, including each tool's canonical text, verdict, reason and quote"],
          [<C key="2">list_servers(offset, limit)</C>, "A page of servers, oldest first, limit ≤ 50"],
          [<C key="3">get_challenge(cid)</C>, "Stage, drift, verified changed tools and flags, verdict, quote, payout, overflow"],
          [<C key="4">list_challenges(sid)</C>, "Newest first; empty sid lists all (capped at 50)"],
          [<C key="5">get_stats()</C>, "Servers, active, slashed, bonded, pool, challenges, pins, checks, slashes"],
          [<C key="6">get_claimable(address)</C>, "Wei owed to an address"],
          [<C key="7">get_constants()</C>, "The constants below, the owner tag, the version and the treasury"],
          [<C key="8">get_accounting()</C>, "balance, bonded, pool, claimable_total, staked and conserved: whether balance equals the sum"],
        ]}
      />

      <H2>Constants</H2>
      <Table
        head={["Name", "Value"]}
        rows={[
          [<C key="1">MIN_BOND</C>, "10 GEN"],
          [<C key="2">REVIEW_FEE</C>, "0.2 GEN, to the treasury"],
          [<C key="3">CONTENT_STAKE</C>, "1 GEN"],
          [<C key="4">DRIFT_STAKE</C>, "0.5 GEN"],
          [<C key="5">DRIFT_SPAM_FEE</C>, "0.1 GEN"],
          [<C key="6">CHALLENGE_TTL</C>, "72 hours"],
          [<C key="7">EXIT_DELAY</C>, "7 days"],
          [<C key="8">REVIEW_BATCH</C>, "6 tools per review"],
          [<C key="9">MAX_CHANGED_TOOLS</C>, "4 changed tools per drift ruling"],
          [<C key="10">DRIFT_SAFE_REWARD_PCT</C>, "5% of the bond"],
          [<C key="11">DRIFT_UNPINNED_SLASH_PCT</C>, "25% of the bond"],
        ]}
      />

      <H2>Calling it from code</H2>
      <Code lang="ts" title="genlayer-js">{`
import { chains, createAccount, createClient } from "genlayer-js";

const client = createClient({ chain: chains.studioDevnet, account: createAccount(PRIVATE_KEY) });
const fees = await client.estimateTransactionFees();
const hash = await client.writeContract({
  address: "${TOOLBOND_ADDRESS}",
  functionName: "challenge",
  args: [sid, "", "DRIFT"],
  value: 500000000000000000n,           // 0.5 GEN
  fees: { distribution: fees.distribution, feeValue: fees.feeValue },
});
`}</Code>
      <Callout kind="note" title="Reading views">
        Views are read with <C>gen_call</C> (genlayer-js <C>readContract</C>, or <C>lib/genlayer_read.py</C> with the standard library). Each
        transaction&apos;s agreed output is also in its consensus data: decode <C>leader_receipt</C> from <C>eth_getTransactionByHash</C>, as{" "}
        <C>scripts/tx_index.py</C> does.
      </Callout>

      <DocFooter slug="contract" />
    </article>
  );
}
