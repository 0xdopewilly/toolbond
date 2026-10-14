import type { Metadata } from "next";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, Code, DocTitle, H2, Table } from "@/components/docs/prose";
import { REPO } from "@/lib/deployments";

export const metadata: Metadata = { title: "Pinning and TBCM-1 · Docs" };

export default function Pinning() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Concepts"
        title="Pinning and TBCM-1"
        lede="A pin is the exact text an agent would read, reduced to hashes that every validator, guard and browser derives the same way: the ToolBond Canonical Manifest, version 1."
      />

      <H2>What gets fetched</H2>
      <p>
        Each validator speaks MCP&apos;s Streamable HTTP transport itself: <C>initialize</C>, the <C>Mcp-Session-Id</C> header when the server
        asks for one, <C>notifications/initialized</C>, then <C>tools/list</C> with pagination. Responses may be plain JSON, server-sent events or
        JSON-RPC batches. Limits keep a hostile server from exhausting validators: at most 3 pages, 24 tools and 64 KB.
      </p>

      <H2>The canonical form</H2>
      <Table
        head={["Rule", "Why"]}
        rows={[
          ["Drop the tool's own top-level _meta only", "Protocol metadata clients never show the model. Nested keys named _meta are data and stay in the hash."],
          ["Integral numbers become integers, exactly", "1.0 and 1 must hash the same in Python and JavaScript"],
          ["Keys sorted by Unicode code point, compact separators", "Key order on the wire is irrelevant"],
          ["No Unicode normalization, no escaping beyond JSON's minimum", "An invisible character must change the hash"],
          ["Unpaired surrogates are refused", "They have no UTF-8 form, so no two implementations could agree"],
        ]}
      />
      <Code lang="text" title="hashes">{`
tool_hash         = sha256_hex(utf8(canonical(tool without its top-level _meta)))
instructions_hash = sha256_hex(utf8(instructions))
root              = sha256_hex(utf8(canonical({"i": instructions_hash, "t": sorted(tool_hashes)})))
`}</Code>
      <p>
        The server&apos;s <C>instructions</C> from <C>initialize</C> are part of the root too: they reach the model on connect, so they are pinned
        and judged like tools.
      </p>
      <Callout kind="warn" title="Fixed by the audit">
        An earlier draft dropped <C>_meta</C> at every depth. A publisher could then hide a poisoned parameter description under{" "}
        <C>inputSchema.properties._meta</C> without changing the hash. TBCM-1 now strips only the tool&apos;s own top-level <C>_meta</C>, and the
        guard forwards exactly the hashed object.
      </Callout>

      <H2>Test vectors</H2>
      <p>
        <a href={`${REPO}/blob/main/tests/vectors/tbcm1.json`}>tests/vectors/tbcm1.json</a> holds tools captured from four real servers plus
        synthetic edge cases: key order, floats, control characters, tag characters, code-point key order and big integers. The Python reference
        and the TypeScript port in this site both pass all of them.
      </p>
      <Code lang="bash" title="check both implementations">{`
.venv/bin/python scripts/make_vectors.py                       # regenerate from the reference
node --experimental-strip-types apps/web/scripts/check-vectors.ts
`}</Code>

      <H2>From pin to verdict</H2>
      <p>
        <C>snapshot</C> stores the canonical text, per-tool hashes, the root and the red flags. The guard and this site compare live hashes against
        those pins; validators re-derive them on every <C>observe</C>. Nothing else is trusted.
      </p>

      <DocFooter slug="pinning" />
    </article>
  );
}
