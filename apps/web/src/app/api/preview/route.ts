import { revealSegments } from "@/lib/format";
import { digestManifest, fetchManifest } from "@/lib/tbcm";

// GET /api/preview?url=… → the manifest validators will see, hashed with TBCM-1, before you bond.
// The same rules validators use (lib/redflags.reveal), applied to the tool's real characters:
// canonical text escapes non-ASCII, so testing it directly would miss smuggled tag characters.
function hasHidden(tool: Record<string, unknown>): boolean {
  return revealSegments(JSON.stringify(tool)).some((segment) => segment.hidden);
}

export async function GET(request: Request) {
  const url = (new URL(request.url).searchParams.get("url") ?? "").trim();
  if (!/^https:\/\/[^\s/:@]+\.[a-z]+(\/\S*)?$/i.test(url)) {
    return Response.json({ error: "use a public https:// URL without a port" }, { status: 400 });
  }
  try {
    const manifest = await fetchManifest(url);
    const digest = digestManifest(manifest);
    return Response.json({
      ok: true,
      url,
      protocol: digest.protocol,
      root: digest.root,
      instructions: digest.instructions,
      tools: digest.tools.map((tool) => ({
        name: tool.name,
        hash: tool.hash,
        canon: tool.canon,
        description: typeof tool.raw.description === "string" ? tool.raw.description : "",
        hidden: hasHidden(tool.raw),
      })),
    });
  } catch (error) {
    return Response.json({ ok: false, url, error: error instanceof Error ? error.message : String(error) }, { status: 200 });
  }
}
