// GenLayer Studio Next as a viem/wagmi chain, so browser wallets can add and switch to it.
import { defineChain } from "viem";

export const STUDIO_NEXT_ID = 61997;
export const STUDIO_RPC = "https://studio-dev.genlayer.com/api";
export const EXPLORER = "https://explorer-studio-dev.genlayer.com";

export const studioNext = defineChain({
  id: STUDIO_NEXT_ID,
  name: "GenLayer Studio Next",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [STUDIO_RPC] } },
  blockExplorers: { default: { name: "GenLayer Explorer", url: EXPLORER } },
  testnet: true,
});
