// wagmi + RainbowKit configuration. Browser extensions announced through EIP-6963 (MetaMask,
// Rabby, Phantom, Brave, ...) appear automatically; WalletConnect wallets need a project id.
import { connectorsForWallets, type WalletList } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { STUDIO_RPC, studioNext } from "./chain";
import { toolbondTestWallet } from "./test-wallet";

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

const groups: WalletList = [{ groupName: "Instant, no extension", wallets: [toolbondTestWallet] }];
if (PROJECT_ID) {
  groups.push({ groupName: "Popular", wallets: [metaMaskWallet, rabbyWallet, rainbowWallet, coinbaseWallet, walletConnectWallet] });
} else {
  // without a WalletConnect project id, offer only wallets that live in this browser
  groups.push({ groupName: "Browser wallet", wallets: [injectedWallet] });
}

const connectors = connectorsForWallets(groups, {
  appName: "ToolBond",
  appDescription: "Bonded MCP tool manifests, adjudicated by GenLayer validators",
  appUrl: "https://toolbond.vercel.app",
  appIcon: "https://toolbond.vercel.app/icon.png",
  // only read when a WalletConnect-based wallet is configured above
  projectId: PROJECT_ID || "unused",
});

export const wagmiConfig = createConfig({
  chains: [studioNext],
  connectors,
  transports: { [studioNext.id]: http(STUDIO_RPC) },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});
