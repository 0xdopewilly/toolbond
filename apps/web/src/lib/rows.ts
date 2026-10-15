import type { Server } from "./types";

/** Just what a row needs, so the page does not ship every tool's full text to the browser. */
export type ServerRow = Pick<Server, "sid" | "url" | "purpose" | "status" | "tier" | "assurance" | "owner_verified" | "bond" | "root" | "last_verified_at"> & {
  tools: { name: string }[];
};

export function toRow(server: Server): ServerRow {
  return {
    sid: server.sid,
    url: server.url,
    purpose: server.purpose,
    status: server.status,
    tier: server.tier,
    assurance: server.assurance,
    owner_verified: server.owner_verified,
    bond: server.bond,
    root: server.root,
    last_verified_at: server.last_verified_at,
    tools: server.tools.map((tool) => ({ name: tool.name })),
  };
}
