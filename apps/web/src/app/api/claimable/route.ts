import { readRaw } from "@/lib/data";

// GET /api/claimable?address=0x… → {claimable: wei string} or {claimable: null} while reads are down.
export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return Response.json({ error: "pass ?address=0x…" }, { status: 400 });
  }
  try {
    // the view returns the wei amount as a JSON string; keep it a string so it never loses precision
    const raw = (await readRaw("get_claimable", [address])).replace(/"/g, "").trim();
    return Response.json({ claimable: /^\d+$/.test(raw) ? raw : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ claimable: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
