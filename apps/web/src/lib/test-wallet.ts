// The built-in test wallet: a key kept in this browser, exposed to wagmi and RainbowKit as a
// regular connector so it sits in the same modal as MetaMask or Rabby. Writes made with it are
// signed locally by genlayer-js; the provider below only answers what wagmi and RainbowKit ask.
import type { Wallet } from "@rainbow-me/rainbowkit";
import { createWalletClient, http, numberToHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createConnector } from "wagmi";
import { STUDIO_NEXT_ID, STUDIO_RPC, studioNext } from "./chain";

export const TEST_WALLET_ID = "toolbond-test-wallet";
const KEY_STORAGE = "toolbond.burner.v1";
const CONNECTED_STORAGE = "toolbond.testwallet.connected";

export const TEST_WALLET_ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><rect width="22" height="22" fill="#111110"/>' +
      '<path d="M11 7.5v8M7.5 15.5h7" stroke="#f4f4f1" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M6 7.5h10" stroke="#f08a4b" stroke-width="1.8" stroke-linecap="round"/></svg>',
  );

/** The test wallet's private key, created on first use and kept in localStorage. */
export function testWalletKey(): Hex {
  try {
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored && /^0x[0-9a-f]{64}$/i.test(stored)) return stored as Hex;
    const fresh = generatePrivateKey();
    localStorage.setItem(KEY_STORAGE, fresh);
    return fresh;
  } catch {
    return generatePrivateKey();
  }
}

export function testWalletAddress(): Address {
  return privateKeyToAccount(testWalletKey()).address;
}

function remember(connected: boolean) {
  try {
    if (connected) localStorage.setItem(CONNECTED_STORAGE, "1");
    else localStorage.removeItem(CONNECTED_STORAGE);
  } catch {}
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(STUDIO_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || method + " failed");
  return body.result;
}

type RequestArgs = { method: string; params?: unknown[] };

function provider() {
  return {
    async request({ method, params = [] }: RequestArgs): Promise<unknown> {
      const account = privateKeyToAccount(testWalletKey());
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address];
        case "eth_chainId":
          return numberToHex(STUDIO_NEXT_ID);
        case "wallet_switchEthereumChain": {
          const target = Number((params[0] as { chainId?: string })?.chainId);
          if (target !== STUDIO_NEXT_ID) throw Object.assign(new Error("The test wallet only works on Studio Next"), { code: 4902 });
          return null;
        }
        case "personal_sign":
          return account.signMessage({ message: { raw: params[0] as Hex } });
        case "eth_sendTransaction": {
          const tx = params[0] as { to?: Address; data?: Hex; value?: Hex };
          const client = createWalletClient({ account, chain: studioNext, transport: http(STUDIO_RPC) });
          return client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, type: "legacy", gasPrice: 0n });
        }
        default:
          return rpc(method, params);
      }
    },
    on() {},
    removeListener() {},
  };
}

/** wagmi connector for the test wallet. */
export function testWalletConnector() {
  return createConnector((config) => ({
    id: TEST_WALLET_ID,
    name: "ToolBond test wallet",
    type: "toolbond-test-wallet",
    icon: TEST_WALLET_ICON,
    async connect() {
      remember(true);
      const accounts = [testWalletAddress()];
      config.emitter.emit("change", { accounts, chainId: STUDIO_NEXT_ID });
      // wagmi's generic return type also covers capability-annotated accounts; this wallet has none
      return { accounts, chainId: STUDIO_NEXT_ID } as never;
    },
    async disconnect() {
      remember(false);
    },
    async getAccounts() {
      return [testWalletAddress()];
    },
    async getChainId() {
      return STUDIO_NEXT_ID;
    },
    async getProvider() {
      return provider();
    },
    async isAuthorized() {
      try {
        return localStorage.getItem(CONNECTED_STORAGE) === "1" && Boolean(localStorage.getItem(KEY_STORAGE));
      } catch {
        return false;
      }
    },
    async switchChain({ chainId }) {
      if (chainId !== STUDIO_NEXT_ID) throw new Error("The test wallet only works on Studio Next");
      return studioNext;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {
      remember(false);
      config.emitter.emit("disconnect");
    },
  }));
}

/** RainbowKit wallet entry for the test wallet. */
export const toolbondTestWallet = (): Wallet => ({
  id: TEST_WALLET_ID,
  name: "ToolBond test wallet",
  iconUrl: TEST_WALLET_ICON,
  iconBackground: "#111110",
  installed: true,
  createConnector: (walletDetails) =>
    createConnector((config) => ({
      ...testWalletConnector()(config),
      ...walletDetails,
    })),
});
