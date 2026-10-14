"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, lightTheme, RainbowKitProvider, useConnectModal, type Theme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect, WagmiProvider } from "wagmi";
import { getAccount, switchChain } from "wagmi/actions";
import { STUDIO_NEXT_ID, studioNext } from "@/lib/chain";
import { EXPLORER, requestTestGen, sendWrite, trackTx, walletError, type Signer, type TxInfo } from "@/lib/client";
import { TEST_WALLET_ID, testWalletKey } from "@/lib/test-wallet";
import { wagmiConfig } from "@/lib/wagmi";

/* ------------------------------------------------------------------ theme */

export type ThemeMode = "light" | "dark";
const THEME_KEY = "toolbond.theme";

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme outside Providers");
  return value;
}

function currentMode(): ThemeMode {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function rainbowTheme(mode: ThemeMode): Theme {
  const base =
    mode === "dark"
      ? darkTheme({ accentColor: "#f0803c", accentColorForeground: "#160b04", borderRadius: "medium", overlayBlur: "small" })
      : lightTheme({ accentColor: "#111110", accentColorForeground: "#ffffff", borderRadius: "medium", overlayBlur: "small" });
  return {
    ...base,
    fonts: { body: "var(--font-sans), system-ui, sans-serif" },
    colors: {
      ...base.colors,
      modalBackground: "var(--surface)",
      modalBorder: "var(--line)",
      modalText: "var(--ink)",
      modalTextSecondary: "var(--ink-2)",
      generalBorder: "var(--line)",
      actionButtonSecondaryBackground: "var(--paper)",
      closeButtonBackground: "var(--paper)",
      closeButton: "var(--ink-2)",
    },
    shadows: { ...base.shadows, dialog: "var(--shadow-3)" },
  };
}

/* ------------------------------------------------------------------ wallet */

export type WalletMode = "burner" | "injected";

interface Wallet {
  mode: WalletMode | null;
  address: string;
  connecting: boolean;
  walletName: string;
  connect: (mode: WalletMode) => Promise<void>;
  openConnect: () => void;
  disconnect: () => void;
  faucet: () => Promise<void>;
}

export interface TrackedTx {
  id: number;
  label: string;
  hash?: string;
  phase: "switching" | "signing" | "submitted" | "deciding" | "done" | "failed";
  info?: TxInfo;
  error?: string;
}

interface Txs {
  items: TrackedTx[];
  run: (label: string, method: string, args: (string | number)[], value?: string) => Promise<TxInfo | null>;
  notify: (label: string, phase: TrackedTx["phase"], error?: string) => void;
  dismiss: (id: number) => void;
}

const WalletContext = createContext<Wallet | null>(null);
const TxContext = createContext<Txs | null>(null);

export function useWallet(): Wallet {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet outside Providers");
  return value;
}

export function useTxs(): Txs {
  const value = useContext(TxContext);
  if (!value) throw new Error("useTxs outside Providers");
  return value;
}

let nextId = 1;

/** Resolve who signs the next write, switching a browser wallet to Studio Next first. */
async function resolveSigner(onSwitch: () => void): Promise<Signer> {
  const account = getAccount(wagmiConfig);
  if (!account.connector || !account.address) throw new Error("Connect a wallet first.");
  if (account.connector.id === TEST_WALLET_ID) return { kind: "local", key: testWalletKey() };
  if (account.chainId !== STUDIO_NEXT_ID) {
    onSwitch();
    await switchChain(wagmiConfig, { chainId: STUDIO_NEXT_ID });
  }
  const provider = (await account.connector.getProvider()) as Extract<Signer, { kind: "provider" }>["provider"];
  return { kind: "provider", address: account.address, provider };
}

function WalletLayer({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const [items, setItems] = useState<TrackedTx[]>([]);

  const update = useCallback((id: number, patch: Partial<TrackedTx>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const notify = useCallback((label: string, phase: TrackedTx["phase"], error?: string) => {
    const id = nextId++;
    setItems((current) => [{ id, label, phase, error }, ...current]);
  }, []);

  const address = account.address ?? "";
  const mode: WalletMode | null = !account.isConnected ? null : account.connector?.id === TEST_WALLET_ID ? "burner" : "injected";

  const connect = useCallback(
    async (next: WalletMode) => {
      if (next === "injected") {
        openConnectModal?.();
        return;
      }
      const connector = connectors.find((item) => item.id === TEST_WALLET_ID);
      if (!connector) return;
      try {
        await connectAsync({ connector, chainId: STUDIO_NEXT_ID });
      } catch (error) {
        notify("Could not connect the test wallet", "failed", walletError(error));
      }
    },
    [connectors, connectAsync, openConnectModal, notify],
  );

  const faucet = useCallback(async () => {
    if (!address) return;
    const id = nextId++;
    setItems((current) => [{ id, label: "25 test GEN from the Studio faucet", phase: "submitted" }, ...current]);
    try {
      const hash = await requestTestGen(address);
      update(id, { phase: "done", hash });
    } catch (error) {
      update(id, { phase: "failed", error: walletError(error) });
    }
  }, [address, update]);

  const run = useCallback(
    async (label: string, method: string, args: (string | number)[], value = "0") => {
      const id = nextId++;
      setItems((current) => [{ id, label, phase: "signing" }, ...current]);
      try {
        const signer = await resolveSigner(() => update(id, { phase: "switching" }));
        update(id, { phase: "signing" });
        const hash = await sendWrite(signer, method, args, value);
        update(id, { hash, phase: "submitted" });
        const info = await trackTx(hash, (partial) => update(id, { info: partial, phase: partial.decided ? "done" : "deciding" }));
        const refused = info.success && info.returned?.ok && (info.returned.value as { ok?: boolean; error?: string } | null)?.ok === false;
        const error = !info.success
          ? info.returned?.error || info.status
          : refused
            ? (info.returned?.value as { error?: string }).error
            : undefined;
        update(id, { info, phase: error ? "failed" : "done", error });
        return info;
      } catch (error) {
        update(id, { phase: "failed", error: walletError(error) });
        return null;
      }
    },
    [update],
  );

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const walletName = account.connector?.name ?? "";
  const wallet = useMemo(
    () => ({
      mode,
      address,
      connecting: account.isConnecting || account.isReconnecting || isPending,
      walletName,
      connect,
      openConnect: () => openConnectModal?.(),
      disconnect: () => wagmiDisconnect(),
      faucet,
    }),
    [mode, address, account.isConnecting, account.isReconnecting, isPending, walletName, connect, openConnectModal, wagmiDisconnect, faucet],
  );
  const txs = useMemo(() => ({ items, run, notify, dismiss }), [items, run, notify, dismiss]);

  return (
    <WalletContext.Provider value={wallet}>
      <TxContext.Provider value={txs}>
        {children}
        <TxDock />
      </TxContext.Provider>
    </WalletContext.Provider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    setMode(currentMode());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (!document.documentElement.dataset.theme) setMode(currentMode());
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const toggle = useCallback(() => {
    const next: ThemeMode = currentMode() === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.dataset.theme = next;
    setMode(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
    window.setTimeout(() => root.classList.remove("theme-switching"), 350);
  }, []);

  const theme = useMemo(() => ({ mode, toggle }), [mode, toggle]);

  return (
    <ThemeContext.Provider value={theme}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider
            theme={rainbowTheme(mode)}
            initialChain={studioNext}
            modalSize="compact"
            appInfo={{ appName: "ToolBond", learnMoreUrl: "https://toolbond.vercel.app/docs/wallets" }}
          >
            <WalletLayer>{children}</WalletLayer>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeContext.Provider>
  );
}

/* ------------------------------------------------------------------ transaction toasts */

const PHASE_LABEL: Record<TrackedTx["phase"], string> = {
  switching: "Switching your wallet to Studio Next",
  signing: "Waiting for signature",
  submitted: "Submitted",
  deciding: "Validators voting",
  done: "Done",
  failed: "Failed",
};

function TxDock() {
  const { items, dismiss } = useTxs();

  useEffect(() => {
    // finished toasts leave on their own; failures stay until dismissed
    const timers = items
      .filter((item) => item.phase === "done")
      .map((item) => window.setTimeout(() => dismiss(item.id), 9000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [items, dismiss]);

  if (!items.length) return null;
  return (
    <div className="dock" role="status" aria-live="polite">
      {items.slice(0, 4).map((item) => (
        <div key={item.id} className={`toast ${item.phase}`}>
          <div className="toast-head">
            <span className={`pulse ${item.phase}`} aria-hidden="true" />
            <strong>{item.label}</strong>
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
              ×
            </button>
          </div>
          <div className="toast-body">
            <span>{PHASE_LABEL[item.phase]}</span>
            {item.info?.votes?.length ? <Votes votes={item.info.votes} /> : null}
            {item.hash && (
              <a className="mono" href={`${EXPLORER}/tx/${item.hash}`} target="_blank" rel="noreferrer">
                {item.hash.slice(0, 10)}…
              </a>
            )}
          </div>
          {item.error && <p className="toast-error">{item.error}</p>}
          {(item.phase === "deciding" || item.phase === "submitted" || item.phase === "signing" || item.phase === "switching") && (
            <span className="toast-progress" aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}

export function Votes({ votes, animate = true }: { votes: string[]; animate?: boolean }) {
  const agree = votes.filter((v) => v === "agree").length;
  const disagree = votes.filter((v) => v === "disagree").length;
  return (
    <span className="votes" aria-label={`${agree} agree, ${disagree} disagree, ${votes.length - agree - disagree} idle`}>
      {votes.map((vote, index) => (
        <span key={index} className={`vote ${vote}${animate ? " animate" : ""}`} style={{ animationDelay: `${index * 90}ms` }} />
      ))}
    </span>
  );
}
