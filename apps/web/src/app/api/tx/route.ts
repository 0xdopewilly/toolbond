import { txDetails } from "@/lib/rpc";

// GET /api/tx?hash=0x… → status, votes, decoded return value and agreed outputs.
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get("hash") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return Response.json({ error: "pass ?hash=0x<64 hex>" }, { status: 400 });
  }
  try {
    return Response.json(await txDetails(hash), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ hash, status: "PENDING", decided: false, error: String(error) }, { status: 200 });
  }
}
