// Browser-side GenLayer helpers: fee-estimated writes from either wallet kind, and tracking.
import { chains, createAccount, createClient } from "genlayer-js";
import type { Hex } from "viem";
import { EXPLORER } from "./chain";
import { TOOLBOND_ADDRESS } from "./deployments";

export { EXPLORER };
export const CONTRACT = (process.env.NEXT_PUBLIC_TOOLBOND_ADDRESS || TOOLBOND_ADDRESS) as `0x${string}`;

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Who signs: the built-in test wallet's local key, or a browser wallet through its provider. */
export type Signer = { kind: "local"; key: Hex } | { kind: "provider"; address: `0x${string}`; provider: Eip1193 };

function clientFor(signer: Signer) {
  if (signer.kind === "local") {
    return createClient({ chain: chains.studioDevnet, account: createAccount(signer.key) });
  }
  return createClient({ chain: chains.studioDevnet, account: signer.address, provider: signer.provider as never });
}

export function toWei(gen: string): bigint {
  const [whole, fraction = ""] = gen.trim().split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18) || "0");
}

/** Estimate fees and send one ToolBond write. Returns the GenLayer transaction hash. */
export async function sendWrite(
  signer: Signer,
  method: string,
  args: (string | number)[],
  valueGen = "0",
): Promise<`0x${string}`> {
  const client = clientFor(signer);
  const estimate = await client.estimateTransactionFees();
  return client.writeContract({
    address: CONTRACT,
    functionName: method,
    args,
    value: toWei(valueGen),
    fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
}

export interface TxInfo {
  hash: string;
  status: string;
  execution: string;
  decided: boolean;
  success: boolean;
  votes: string[];
  returned: { ok: boolean; value?: unknown; error?: string } | null;
  outputs: ({ ok: boolean; value?: unknown; error?: string } | null)[];
}

/** Poll /api/tx until validators decide. Calls onUpdate with every intermediate state. */
export async function trackTx(hash: string, onUpdate: (info: TxInfo) => void, timeoutMs = 600_000): Promise<TxInfo> {
  const started = Date.now();
  let last: TxInfo | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`/api/tx?hash=${hash}`, { cache: "no-store" });
      const info = (await response.json()) as TxInfo;
      if (!last || info.status !== last.status || info.votes.length !== last.votes.length) onUpdate(info);
      last = info;
      if (info.decided) return info;
    } catch {
      // keep polling through transient errors
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Timed out waiting for validators");
}

export async function requestTestGen(address: string): Promise<string> {
  const response = await fetch("/api/faucet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const body = (await response.json()) as { ok?: boolean; hash?: string; error?: string };
  if (!response.ok || !body.ok) throw new Error(body.error || "Faucet unavailable");
  return body.hash ?? "";
}

export function sidOf(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(url.trim());
  return crypto.subtle.digest("SHA-256", bytes).then((digest) =>
    Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16),
  );
}

/** Human message for a wallet or RPC error, including the common EIP-1193 codes. */
export function walletError(error: unknown): string {
  const record = (error ?? {}) as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } };
  const code = record.code ?? record.cause?.code;
  if (code === 4001) return "You rejected the request in your wallet.";
  if (code === -32002) return "Your wallet already has a request open. Check the extension.";
  if (code === 4902) return "Your wallet does not know GenLayer Studio Next yet. Approve adding the network.";
  const text = record.shortMessage || record.message || String(error);
  return text.length > 220 ? text.slice(0, 220) + "…" : text;
}
