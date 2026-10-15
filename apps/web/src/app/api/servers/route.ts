import { loadRegistry } from "@/lib/data";
import { assuranceOf } from "@/lib/assurance";

// GET /api/servers → the registry's servers in brief, for the command palette.
export const revalidate = 60;

export async function GET() {
  const registry = await loadRegistry();
  return Response.json({
    live: registry.live,
    servers: registry.servers.map((server) => ({
      sid: server.sid, url: server.url, status: server.status, tier: server.tier,
      assurance: assuranceOf(server), owner_verified: Boolean(server.owner_verified),
    })),
  });
}
