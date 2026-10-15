import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, Code, DocTitle, H2, Table } from "@/components/docs/prose";
import { REPO, SITE, TOOLBOND_ADDRESS } from "@/lib/deployments";

export const metadata: Metadata = { title: "The guard · Docs" };

export default function Guard() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Guides"
        title="The guard"
        lede="toolbond-guard is a local MCP proxy. Your client launches it instead of talking to the server, and it only ever shows the model tool text that validators pinned and judged SAFE, as read from the ToolBond contract itself."
      />

      <H2>What it protects, and what it does not</H2>
      <p>
        The guard protects <strong>manifest integrity</strong>: the exact tool text your model reads is the text validators fetched, pinned and
        judged. It does not inspect what a tool does when it is called, the data it returns, or the server&apos;s code. Pair it with the
        sandboxing and permissions your client already has.
      </p>

      <H2>The rules</H2>
      <p>A tool is allowed only when all of these hold. Anything else is dropped from the tool list and refused at call time.</p>
      <ol className="docs-list numbered">
        <li>The approval data was read from the ToolBond contract on this refresh (or came from a fallback you opted into, see below).</li>
        <li>The server is registered, and its status is ACTIVE or STALE (SLASHED, REJECTED, PENDING_*, EXITING and EXITED block every tool).</li>
        <li>
          With <C>--bonded-only</C>, its assurance is BONDED: a bond that still meets the 10 GEN minimum. An under-collateralized or merely
          reviewed server is blocked.
        </li>
        <li>
          With <C>--owner-verified-only</C>, the registrant proved they operate the server (<C>owner_verified</C>).
        </li>
        <li>The tool&apos;s live TBCM-1 hash equals its pinned hash, and its verdict is SAFE.</li>
      </ol>
      <p>
        The guard hands your client exactly the object that was hashed, so nothing reaches the model that the pin does not cover. An upstream tool
        named <C>toolbond_status</C> is refused: that name belongs to the guard&apos;s own status tool.
      </p>

      <H2>Install</H2>
      <Code lang="bash" title="Claude Code">{`
claude mcp add weather -- uvx --from git+${REPO} \\
    toolbond-guard https://weather.example.com/mcp
`}</Code>
      <p>
        That is the whole setup: the guard reads contract <C>{TOOLBOND_ADDRESS}</C> through the Studio Next RPC by default. For Cursor and other
        clients, use the same command in their MCP configuration; see the <Link href="/docs/quickstart">Quickstart</Link>.
      </p>

      <H2>Where approvals come from</H2>
      <p>
        On every refresh (each tool list, each call, and every <C>--poll</C> seconds) the guard calls the contract&apos;s <C>get_pins</C> view
        with <C>gen_call</C>. Nothing else is trusted unless you ask for it, and every decision records its source.
      </p>
      <Table
        head={["Source", "When it is used", "What you trust", "Default"]}
        rows={[
          ["contract", "Every refresh", "The RPC endpoint you point --rpc at to report contract state honestly", "on"],
          ["contract-cache", "The RPC is unreachable", "A contract read up to N minutes old: revocations made since are not seen", "off (--cache-minutes N)"],
          ["trusted-relay", "The contract read failed", "The relay operator; its answers are not verified against the contract", "off (--relay URL)"],
          ["relay-snapshot", "The relay can only offer a stored snapshot", "Stored view outputs, not current contract state", "refused (--accept-snapshot-hours N)"],
          ["operator-file", "--pins-file is given", "Whoever wrote the file; chain reads are skipped", "off"],
        ]}
      />
      <Callout kind="note" title="Fails closed">
        No verifiable approval, an unreachable server, an unreadable manifest, or an answer about a different URL: every tool is blocked. The
        guard never falls back to showing unverified text unless you configured that fallback, and even then it labels it.
      </Callout>
      <p>
        Revocations apply on the next refresh: when validators slash a server, the next contract read returns <C>SLASHED</C> and the guard drops
        its tools and tells the client to refresh its list. With the default settings, an RPC outage blocks tools instead of serving an approval
        that might have been revoked.
      </p>

      <H2>Options</H2>
      <Table
        head={["Option", "Default", "Meaning"]}
        rows={[
          [<C key="1">--rpc</C>, "Studio Next", "GenLayer JSON-RPC used for contract reads ($TOOLBOND_RPC)"],
          [<C key="2">--contract</C>, "ToolBond v3", "Contract address ($TOOLBOND_CONTRACT)"],
          [<C key="3">--relay</C>, "none", "Opt-in relay returning get_pins JSON for ?url=, asked only when the contract read fails. This site serves /api/pins."],
          [<C key="4">--accept-snapshot-hours</C>, "0", "Accept a relay's stored snapshot up to this age; 0 refuses snapshots"],
          [<C key="5">--cache-minutes</C>, "0", "Reuse the last contract read for this long during an RPC outage; 0 blocks instead"],
          [<C key="6">--pins-file</C>, "", "Operator-supplied pins instead of chain reads, for air-gapped setups and tests"],
          [<C key="7">--bonded-only</C>, "off", "Allow only servers whose bond meets the minimum"],
          [<C key="8">--owner-verified-only</C>, "off", "Allow only servers whose registrant proved they operate them"],
          [<C key="9">--poll</C>, "30", "Seconds between manifest and approval checks; changes trigger a tool-list refresh"],
        ]}
      />
      <Code lang="bash" title="A relay as an explicit fallback">{`
toolbond-guard https://weather.example.com/mcp --relay ${SITE}/api/pins --cache-minutes 5
`}</Code>

      <H2>The status tool</H2>
      <p>
        Ask your agent to call <C>toolbond_status</C>. It returns the server, the approval source with its trust statement and age, the
        server&apos;s assurance (BONDED, UNDERCOLLATERALIZED or REVIEWED), and every upstream tool with its live hash, pinned hash, verdict and the
        reason it is allowed or blocked.
      </p>
      <p>
        The trust model in full, with the failure cases it is tested against, is in{" "}
        <a href={`${REPO}/blob/main/docs/GUARD.md`}>docs/GUARD.md</a>.
      </p>

      <DocFooter slug="guard" />
    </article>
  );
}
