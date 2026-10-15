// Registry reads: the ToolBond contract first; a snapshot only as a labelled, non-authoritative
// fallback, and only when it was taken from this same contract.
//
// Transaction hashes are not stored by the contract, so they come from data/txs.json, built
// by scripts/tx_index.py from the evidence logs, and are merged into whatever the contract says.
import { chains, createClient } from "genlayer-js";
import snapshot from "../../data/snapshot.json";
import txIndex from "../../data/txs.json";
import { TOOLBOND_ADDRESS } from "./deployments";
import type { Challenge, Pins, Registry, Server, Stats, TxRef } from "./types";

export const CONTRACT = process.env.TOOLBOND_ADDRESS || TOOLBOND_ADDRESS;
export const RPC_URL = chains.studioDevnet.rpcUrls.default.http[0];
const READ_TIMEOUT_MS = 8000;
const index = txIndex as { contract: string; servers: Record<string, TxRef[]>; challenges: Record<string, TxRef[]> };
const sameContract = (address: string) => address.toLowerCase() === CONTRACT.toLowerCase();

/** One contract view as the raw string it returns. */
export async function readRaw(functionName: string, args: (string | number)[] = []): Promise<string> {
  const client = createClient({ chain: chains.studioDevnet });
  const read = client.readContract({ address: CONTRACT as `0x${string}`, functionName, args });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("read timed out")), READ_TIMEOUT_MS));
  return String(await Promise.race([read, timeout]));
}

async function view<T>(functionName: string, args: (string | number)[] = []): Promise<T> {
  return JSON.parse(await readRaw(functionName, args)) as T;
}

function withTxs(registry: Omit<Registry, "servers" | "challenges"> & { servers: Server[]; challenges: Challenge[] }): Registry {
  const known = sameContract(index.contract);
  return {
    ...registry,
    servers: registry.servers.map((s) => ({ ...s, txs: s.txs ?? (known ? index.servers[s.sid] : undefined) })),
    challenges: registry.challenges.map((c) => ({ ...c, txs: c.txs ?? (known ? index.challenges[c.cid] : undefined) })),
  };
}

function fromSnapshot(): Registry {
  if (!sameContract(snapshot.contract)) {
    // a snapshot of another deployment is not this contract's state: show nothing rather than mislead
    return {
      live: false, as_of: "", contract: CONTRACT, servers: [], challenges: [],
      stats: { servers: 0, active: 0, slashed: 0, bonded: "0", pool: "0", challenges: 0, open_challenges: 0, pins: 0, checks: 0, slashes: 0 } as Stats,
    };
  }
  return withTxs({
    live: false,
    as_of: snapshot.snapshot_at,
    contract: snapshot.contract,
    servers: Object.values(snapshot.servers) as unknown as Server[],
    challenges: snapshot.challenges as unknown as Challenge[],
    stats: snapshot.stats as Stats,
  });
}

export async function loadRegistry(): Promise<Registry> {
  try {
    const listed = await view<{ items: { sid: string }[] }>("list_servers", [0, 50]);
    const servers = await Promise.all(listed.items.map((item) => view<Server>("get_server", [item.sid])));
    const challenges = (await view<{ items: Challenge[] }>("list_challenges", [""])).items;
    const stats = await view<Stats>("get_stats");
    return withTxs({ live: true, as_of: new Date().toISOString(), contract: CONTRACT, servers, challenges, stats });
  } catch {
    return fromSnapshot();
  }
}

export type RelayedPins = Pins & {
  source: "contract" | "snapshot";
  /** true only for a contract read made for this request */
  authoritative: boolean;
  contract: string;
  rpc?: string;
  as_of?: string;
  relay_note: string;
};

export async function loadPins(url: string): Promise<RelayedPins> {
  const clean = url.trim();
  try {
    return {
      ...(await view<Pins>("get_pins", [clean])),
      source: "contract",
      authoritative: true,
      contract: CONTRACT,
      rpc: RPC_URL,
      as_of: new Date().toISOString(),
      relay_note: "Read from the contract by this site for this request. To a guard this is still a relay: run toolbond-guard without --relay to read the chain yourself.",
    };
  } catch {
    const pins = sameContract(snapshot.contract) ? (snapshot.pins as Record<string, Pins>)[clean] : undefined;
    return {
      ...(pins ?? { known: false, url: clean }),
      source: "snapshot",
      authoritative: false,
      contract: CONTRACT,
      as_of: sameContract(snapshot.contract) ? snapshot.snapshot_at : "",
      relay_note: "Contract reads failed, so this is a stored snapshot, not current contract state. toolbond-guard refuses it unless run with --accept-snapshot-hours.",
    };
  }
}
