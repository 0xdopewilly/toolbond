import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, Code, DocTitle, H2, Table } from "@/components/docs/prose";
import { REPO, SITE } from "@/lib/deployments";

export const metadata: Metadata = { title: "The guard · Docs" };

export default function Guard() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Guides"
        title="The guard"
        lede="toolbond-guard is a local MCP proxy. Your client launches it instead of talking to the server, and it only ever shows the model text that validators pinned and judged SAFE."
      />

      <H2>The rules</H2>
      <p>A tool is allowed only when all of these hold. Anything else is dropped from the tool list and refused at call time.</p>
      <ol className="docs-list numbered">
        <li>The server is registered with ToolBond.</li>
        <li>Its status is ACTIVE or STALE (SLASHED, REJECTED, EXITING and EXITED block every tool).</li>
        <li>With <C>--bonded-only</C>, its tier is BONDED.</li>
        <li>The tool&apos;s live TBCM-1 hash equals its pinned hash.</li>
        <li>The tool&apos;s verdict is SAFE.</li>
      </ol>
      <p>
        The guard hands your client exactly the object that was hashed, so nothing reaches the model that the pin does not cover. An upstream tool
        named <C>toolbond_status</C> is refused: that name belongs to the guard&apos;s own status tool.
      </p>

      <H2>Install</H2>
      <Code lang="bash" title="Claude Code">{`
claude mcp add weather -- uvx --from git+${REPO} \\
    toolbond-guard https://weather.example.com/mcp --pins-url ${SITE}/api/pins
`}</Code>
      <p>
        For Cursor and other clients, use the same command and arguments in their MCP configuration; see the <Link href="/docs/quickstart">Quickstart</Link>.
      </p>

      <H2>Options</H2>
      <Table
        head={["Option", "Default", "Meaning"]}
        rows={[
          [<C key="1">--pins-url</C>, "$TOOLBOND_PINS_URL", "Endpoint returning get_pins JSON for ?url=. This site serves /api/pins."],
          [<C key="2">--pins-file</C>, "", "Offline pins, for air-gapped setups and demos"],
          [<C key="3">--bonded-only</C>, "off", "Allow BONDED servers only"],
          [<C key="4">--poll</C>, "30", "Seconds between manifest checks; changes trigger a tool-list refresh in your client"],
          [<C key="5">--cache-hours</C>, "24", "How long cached pins may stand in for an unreachable registry"],
          [<C key="6">--snapshot-max-hours</C>, "168", "Oldest registry snapshot accepted while live contract reads are down"],
        ]}
      />

      <H2>Where pins come from</H2>
      <p>
        The guard tries the pins URL, then a pins file, then its cache. The relay answers from the contract; when Studio Next&apos;s contract reads
        are down it serves the published snapshot and says so with <C>source: &quot;snapshot&quot;</C> and its <C>as_of</C> time. The guard uses
        snapshot pins only while they are fresh and never caches them; cached contract pins expire after a day.
      </p>
      <Callout kind="note" title="Fails closed">
        No pins, an unreachable server, or an unreadable manifest: every tool is blocked. The guard never falls back to showing unverified text.
      </Callout>

      <H2>The status tool</H2>
      <p>
        Ask your agent to call <C>toolbond_status</C>. It returns the server, where the pins came from, and every upstream tool with its live hash,
        pinned hash, verdict and the reason it is allowed or blocked.
      </p>

      <DocFooter slug="guard" />
    </article>
  );
}
