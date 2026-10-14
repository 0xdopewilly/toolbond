// Registry reads: the ToolBond contract first, a labelled snapshot second.
//
// Studio Next contract reads (gen_call) can fail platform-wide; when they do, pages show the
// snapshot built by scripts/snapshot_state.py and say so, instead of failing.
import { chains, createClient } from "genlayer-js";
import snapshot from "../../data/snapshot.json";
import type { Challenge, Pins, Registry, Server, Stats } from "./types";

export const CONTRACT = process.env.TOOLBOND_ADDRESS || snapshot.contract;
const READ_TIMEOUT_MS = 8000;

async function view<T>(functionName: string, args: (string | number)[] = []): Promise<T> {
  const client = createClient({ chain: chains.studioDevnet });
  const read = client.readContract({ address: CONTRACT as `0x${string}`, functionName, args });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("read timed out")), READ_TIMEOUT_MS));
  const raw = await Promise.race([read, timeout]);
  return JSON.parse(String(raw)) as T;
}

function fromSnapshot(): Registry {
  return {
    live: false,
    as_of: snapshot.snapshot_at,
    contract: snapshot.contract,
    servers: Object.values(snapshot.servers) as unknown as Server[],
    challenges: snapshot.challenges as unknown as Challenge[],
    stats: snapshot.stats as Stats,
  };
}

export async function loadRegistry(): Promise<Registry> {
  try {
    const listed = await view<{ items: { sid: string }[] }>("list_servers", [0, 50]);
    const servers = await Promise.all(listed.items.map((item) => view<Server>("get_server", [item.sid])));
    const challenges = (await view<{ items: Challenge[] }>("list_challenges", [""])).items;
    const stats = await view<Stats>("get_stats");
    return { live: true, as_of: new Date().toISOString(), contract: CONTRACT, servers, challenges, stats };
  } catch {
    return fromSnapshot();
  }
}

export async function loadPins(url: string): Promise<Pins & { source: "contract" | "snapshot" }> {
  try {
    return { ...(await view<Pins>("get_pins", [url.trim()])), source: "contract" };
  } catch {
    const pins = (snapshot.pins as Record<string, Pins>)[url.trim()];
    return { ...(pins ?? { known: false, url: url.trim() }), source: "snapshot" };
  }
}
