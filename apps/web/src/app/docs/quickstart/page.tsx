import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, Code, DocTitle, H2, H3, Step, Steps } from "@/components/docs/prose";
import { REPO, SITE } from "@/lib/deployments";

export const metadata: Metadata = { title: "Quickstart · Docs" };

export default function Quickstart() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Getting started"
        title="Quickstart"
        lede="Put the guard in front of an MCP server in about two minutes. Tools that are not pinned and judged SAFE never reach your model."
      />

      <H2>Before you start</H2>
      <p>
        You need <a href="https://docs.astral.sh/uv/">uv</a> (it runs the guard with Python 3.10 or newer) and an MCP client such as Claude Code
        or Cursor. The guard has no other dependencies. It reads pins from this site&apos;s relay, which serves the contract&apos;s{" "}
        <C>get_pins</C> view.
      </p>

      <H2>Install the guard</H2>
      <Steps>
        <Step title="Pick a server">
          Any remote MCP server that speaks Streamable HTTP. To see the guard react, use the demo server, which turns malicious on a timer:{" "}
          <C>https://toolbond-demo-mcp.vercel.app/mcp/honest</C>.
        </Step>
        <Step title="Add it through the guard">
          <H3>Claude Code</H3>
          <Code lang="bash" title="terminal">{`
claude mcp add weather -- uvx --from git+${REPO} \\
    toolbond-guard https://mcp.deepwiki.com/mcp --pins-url ${SITE}/api/pins
`}</Code>
          <H3>Cursor</H3>
          <Code lang="json" title="~/.cursor/mcp.json">{`
{
  "mcpServers": {
    "deepwiki": {
      "command": "uvx",
      "args": ["--from", "git+${REPO}", "toolbond-guard",
               "https://mcp.deepwiki.com/mcp", "--pins-url", "${SITE}/api/pins"]
    }
  }
}
`}</Code>
        </Step>
        <Step title="Ask your agent what is allowed">
          The guard adds one tool of its own, <C>toolbond_status</C>. Ask your agent to call it: you get every upstream tool with its pinned and
          live hash, and the reason it is allowed or blocked.
        </Step>
      </Steps>

      <Callout kind="note" title="Try it without installing anything">
        The <Link href="/guard">Guard page</Link> runs the same rules in your browser against any server, right now: pick the rug-pulled demo to
        watch every tool get blocked.
      </Callout>

      <H2>What happens on every request</H2>
      <ol className="docs-list numbered">
        <li>The guard fetches the live manifest and hashes each tool with TBCM-1, the same code validators run.</li>
        <li>It loads the server&apos;s pins: status, tier, pinned hash and verdict per tool.</li>
        <li>
          It lists only tools whose live hash equals the pin and whose verdict is SAFE, on a server that is ACTIVE or STALE. Everything else is
          dropped, and the client is told to refresh when the set changes.
        </li>
        <li>Tool calls are checked again at call time, so a tool that changed between listing and calling is refused.</li>
      </ol>

      <H2>Next steps</H2>
      <p>
        Read <Link href="/docs/guard">The guard</Link> for every option, or <Link href="/docs/publish">publish your own server</Link> so the
        guard can allow it.
      </p>

      <DocFooter slug="quickstart" />
    </article>
  );
}
