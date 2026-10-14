import { revealSegments } from "@/lib/format";
import { publicHttpsUrl, rateLimited, UnsafeUrl } from "@/lib/safe-url";
import { digestManifest, fetchManifest } from "@/lib/tbcm";

// GET /api/preview?url=… → the manifest validators will see, hashed with TBCM-1, before you bond.
// The same rules validators use (lib/redflags.reveal), applied to the tool's real characters:
// canonical text escapes non-ASCII, so testing it directly would miss smuggled tag characters.
function hasHidden(tool: Record<string, unknown>): boolean {
  return revealSegments(JSON.stringify(tool)).some((segment) => segment.hidden);
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const visitor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited("preview:" + visitor)) {
    return Response.json({ ok: false, error: "Too many previews; try again in a minute." }, { status: 429 });
  }
  let url: string;
  try {
    url = (await publicHttpsUrl(raw)).toString();
    // keep the exact text the user typed when it parses to the same URL, so the sid matches the contract's
    if (new URL(raw.trim()).toString() === url) url = raw.trim();
  } catch (error) {
    const message = error instanceof UnsafeUrl ? error.message : "That URL cannot be previewed.";
    return Response.json({ ok: false, url: raw, error: message }, { status: 400 });
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
