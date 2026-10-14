// Server-side helpers for Studio Next JSON-RPC: transaction details decoded from the consensus
// data itself, which keeps working while contract reads (gen_call) are down.
import { abi, chains } from "genlayer-js";

export const RPC = process.env.GENLAYER_RPC || chains.studioDevnet.rpcUrls.default.http[0];

export async function rpc<T>(method: string, params: unknown): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "rpc error");
  return body.result as T;
}

type Framed = { ok: true; value: unknown } | { ok: false; error: string } | null;

function toPlain(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Map) return Object.fromEntries([...value.entries()].map(([k, v]) => [String(k), toPlain(v)]));
  if (value instanceof Uint8Array) return "0x" + Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === "object") {
    const maybeAddress = value as { toString?: () => string; bytes?: unknown };
    if (maybeAddress.bytes instanceof Uint8Array) return "0x" + Buffer.from(maybeAddress.bytes).toString("hex");
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
  }
  return value;
}

/** One status byte (0 returned, 1 user error, 2 VM error) followed by calldata or text. */
function decodeFramed(b64?: string): Framed {
  if (!b64) return null;
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return null;
  if (bytes[0] === 0) {
    try {
      return { ok: true, value: toPlain(abi.calldata.decode(new Uint8Array(bytes.subarray(1)))) };
    } catch {
      return { ok: true, value: null };
    }
  }
  return { ok: false, error: bytes.subarray(1).toString("utf8") };
}

export interface TxDetails {
  hash: string;
  status: string;
  execution: string;
  decided: boolean;
  success: boolean;
  votes: string[];
  returned: Framed;
  outputs: Framed[];
}

const DECIDED = new Set(["ACCEPTED", "FINALIZED", "UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);

export async function txDetails(hash: string): Promise<TxDetails> {
  const tx = await rpc<Record<string, unknown>>("eth_getTransactionByHash", [hash]);
  const data = (tx?.consensus_data ?? {}) as Record<string, unknown>;
  const leader = Array.isArray(data.leader_receipt) ? data.leader_receipt[0] : data.leader_receipt;
  const receipt = (leader ?? {}) as Record<string, unknown>;
  const status = String(tx?.status_name ?? tx?.status ?? "PENDING");
  const execution = String(tx?.txExecutionResultName ?? "");
  const votes = data.votes && typeof data.votes === "object" ? Object.values(data.votes as Record<string, string>) : [];
  return {
    hash,
    status,
    execution,
    decided: DECIDED.has(status),
    success: (status === "ACCEPTED" || status === "FINALIZED") && execution === "FINISHED_WITH_RETURN",
    votes,
    returned: decodeFramed(receipt.result as string | undefined),
    outputs: Object.values((receipt.eq_outputs ?? {}) as Record<string, string>).map(decodeFramed),
  };
}
