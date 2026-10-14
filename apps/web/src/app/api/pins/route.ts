import { loadPins } from "@/lib/data";

// Pin relay for toolbond-guard and the patrol bot: GET /api/pins?url=<server url>
// Returns the contract's get_pins JSON (or the labelled snapshot while reads are down).
export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return Response.json({ error: "pass ?url=<MCP server url>" }, { status: 400 });
  }
  const pins = await loadPins(url);
  return Response.json(pins, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
}
