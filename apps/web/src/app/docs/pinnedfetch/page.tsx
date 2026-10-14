import type { Metadata } from "next";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Code, DocTitle, H2, Table } from "@/components/docs/prose";
import { EXPLORER } from "@/lib/chain";
import { PINNEDFETCH_ADDRESS } from "@/lib/deployments";

export const metadata: Metadata = { title: "PinnedFetch and gl_mcp · Docs" };

export default function PinnedFetchDoc() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Reference"
        title="PinnedFetch and gl_mcp"
        lede="The two reusable pieces under ToolBond: a contract that pins what a remote MCP server says, and the MCP client any Intelligent Contract can inline."
      />

      <H2>PinnedFetch</H2>
      <p>
        A standalone primitive, live at{" "}
        <a href={`${EXPLORER}/address/${PINNEDFETCH_ADDRESS}`} className="mono">
          {PINNEDFETCH_ADDRESS.slice(0, 10)}…{PINNEDFETCH_ADDRESS.slice(-6)}
        </a>{" "}
        and published on its own at <a href="https://github.com/0xdopewilly/pinnedfetch">github.com/0xdopewilly/pinnedfetch</a>. No bonds and no
        judging: it records, by consensus, what a server served and whether that changed.
      </p>
      <Table
        head={["Method", "Kind", "What it does"]}
        rows={[
          [<C key="1">pin(url)</C>, "write", "Every validator fetches and must derive the identical root; stored as a new version"],
          [<C key="2">check(url)</C>, "write", "MATCH, DIFFERS (with verified changed tools), UNSTABLE or UNREACHABLE"],
          [<C key="3">verify_tool_at(url, version, name, hash)</C>, "view", "Was this exact tool in the version you approved?"],
          [<C key="4">verify_tool(url, name, hash)</C>, "view", "The same against the latest pin; anyone can pin a newer version"],
          [<C key="5">get_pin(url) · get_pin_version(url, v)</C>, "view", "Root, per-tool hashes, canonical text, pinner"],
          [<C key="6">get_last_check(url) · get_last_drift(url)</C>, "view", "The latest check, and the latest one that found a change (kept when later checks fail)"],
          [<C key="7">list_pins(offset, limit) · get_stats()</C>, "view", "Registry listing and counters"],
        ]}
      />

      <H2>gl_mcp</H2>
      <p>
        A dependency-free MCP client sized for GenVM&apos;s non-deterministic blocks. It handles the <C>initialize</C> handshake, the{" "}
        <C>Mcp-Session-Id</C> header, plain JSON, SSE and batch responses, and bounded pagination. Its errors carry stable prefixes,{" "}
        <C>[EXTERNAL]</C> and <C>[TRANSIENT]</C>, so validators can agree on a failure as well as on a success.
      </p>
      <Code lang="python" title="inside your contract">{`
# @@include gl_mcp      (scripts/bundle.py inlines lib/gl_mcp.py here)

def _post(url: str, body: str, headers: dict) -> tuple:
    try:
        response = gl.nondet.web.post(url, body=body, headers=headers)
    except Exception:
        raise McpError(ERR_TRANSIENT + " transport failure")
    return response.status, response.headers, response.body

def leader_fn() -> dict:
    return digest_manifest(fetch_manifest(_post, url))   # same bytes, same root, on every validator
`}</Code>
      <p>
        GenVM runs one file per contract, so modules are inlined. <C>scripts/bundle.py</C> refuses to build when two inlined modules define the same
        top-level name: the live network once rejected a deploy because a helper in one module silently replaced a helper in another.
      </p>

      <DocFooter slug="pinnedfetch" />
    </article>
  );
}
