// Browser-side GenLayer helpers: wallet clients, fee-estimated writes and transaction tracking.
import { chains, createAccount, createClient, generatePrivateKey } from "genlayer-js";

export const CONTRACT = (process.env.NEXT_PUBLIC_TOOLBOND_ADDRESS ||
  "0x299Cf258f16ACd91A80ACa23fA39695b7eF88F8A") as `0x${string}`;
export const EXPLORER = "https://explorer-studio-dev.genlayer.com";
const BURNER_KEY = "toolbond.burner.v1";

export type WalletMode = "burner" | "injected";

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function injectedProvider(): Eip1193 | undefined {
  return (globalThis as unknown as { ethereum?: Eip1193 }).ethereum;
}

export function hasInjectedWallet(): boolean {
  return Boolean(injectedProvider());
}

export function burnerKey(): `0x${string}` {
  try {
    const stored = localStorage.getItem(BURNER_KEY);
    if (stored && /^0x[0-9a-f]{64}$/i.test(stored)) return stored as `0x${string}`;
    const fresh = generatePrivateKey();
    localStorage.setItem(BURNER_KEY, fresh);
    return fresh;
  } catch {
    return generatePrivateKey();
  }
}

export function burnerAddress(): string {
  return createAccount(burnerKey()).address;
}

export async function connectInjected(): Promise<string> {
  const provider = injectedProvider();
  if (!provider) throw new Error("No browser wallet found");
  const chain = chains.studioDevnet;
  const chainHex = "0x" + chain.id.toString(16);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainHex,
        chainName: "GenLayer Studio Next",
        nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: [EXPLORER],
      }],
    });
  }
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.length) throw new Error("The wallet returned no account");
  return accounts[0];
}

function clientFor(mode: WalletMode, address?: string) {
  if (mode === "injected") {
    return createClient({ chain: chains.studioDevnet, account: address as `0x${string}`, provider: injectedProvider() as never });
  }
  return createClient({ chain: chains.studioDevnet, account: createAccount(burnerKey()) });
}

export function toWei(gen: string): bigint {
  const [whole, fraction = ""] = gen.trim().split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18) || "0");
}

/** Estimate fees and send one ToolBond write. Returns the GenLayer transaction hash. */
export async function sendWrite(
  mode: WalletMode,
  address: string | undefined,
  method: string,
  args: (string | number)[],
  valueGen = "0",
): Promise<`0x${string}`> {
  const client = clientFor(mode, address);
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
