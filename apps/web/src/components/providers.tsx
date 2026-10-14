"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  burnerAddress,
  connectInjected,
  EXPLORER,
  requestTestGen,
  sendWrite,
  trackTx,
  type TxInfo,
  type WalletMode,
} from "@/lib/client";

interface Wallet {
  mode: WalletMode | null;
  address: string;
  connecting: boolean;
  connect: (mode: WalletMode) => Promise<void>;
  disconnect: () => void;
  faucet: () => Promise<void>;
}

export interface TrackedTx {
  id: number;
  label: string;
  hash?: string;
  phase: "signing" | "submitted" | "deciding" | "done" | "failed";
  info?: TxInfo;
  error?: string;
}

interface Txs {
  items: TrackedTx[];
  run: (label: string, method: string, args: (string | number)[], value?: string) => Promise<TxInfo | null>;
  dismiss: (id: number) => void;
}

const WalletContext = createContext<Wallet | null>(null);
const TxContext = createContext<Txs | null>(null);
const MODE_KEY = "toolbond.wallet.mode";

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

export function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<WalletMode | null>(null);
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [items, setItems] = useState<TrackedTx[]>([]);

  const connect = useCallback(async (next: WalletMode) => {
    setConnecting(true);
    try {
      const addr = next === "burner" ? burnerAddress() : await connectInjected();
      setMode(next);
      setAddress(addr);
      try {
        localStorage.setItem(MODE_KEY, next);
      } catch {}
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_KEY) === "burner") {
        setMode("burner");
        setAddress(burnerAddress());
      }
    } catch {}
  }, []);

  const disconnect = useCallback(() => {
    setMode(null);
    setAddress("");
    try {
      localStorage.removeItem(MODE_KEY);
    } catch {}
  }, []);

  const update = useCallback((id: number, patch: Partial<TrackedTx>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const faucet = useCallback(async () => {
    if (!address) return;
    const id = nextId++;
    setItems((current) => [{ id, label: "Test GEN from the Studio faucet", phase: "submitted" }, ...current]);
    try {
      const hash = await requestTestGen(address);
      update(id, { phase: "done", hash });
    } catch (error) {
      update(id, { phase: "failed", error: error instanceof Error ? error.message : String(error) });
    }
  }, [address, update]);

  const run = useCallback(
    async (label: string, method: string, args: (string | number)[], value = "0") => {
      if (!mode) throw new Error("Connect a wallet first");
      const id = nextId++;
      setItems((current) => [{ id, label, phase: "signing" }, ...current]);
      try {
        const hash = await sendWrite(mode, address, method, args, value);
        update(id, { hash, phase: "submitted" });
        const info = await trackTx(hash, (partial) => update(id, { info: partial, phase: partial.decided ? "done" : "deciding" }));
        update(id, { info, phase: info.success ? "done" : "failed", error: info.success ? undefined : info.returned?.error || info.status });
        return info;
      } catch (error) {
        update(id, { phase: "failed", error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
        return null;
      }
    },
    [mode, address, update],
  );

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  const wallet = useMemo(() => ({ mode, address, connecting, connect, disconnect, faucet }), [mode, address, connecting, connect, disconnect, faucet]);
  const txs = useMemo(() => ({ items, run, dismiss }), [items, run, dismiss]);

  return (
    <WalletContext.Provider value={wallet}>
      <TxContext.Provider value={txs}>
        {children}
        <TxDock />
      </TxContext.Provider>
    </WalletContext.Provider>
  );
}

const PHASE_LABEL: Record<TrackedTx["phase"], string> = {
  signing: "Signing",
  submitted: "Submitted",
  deciding: "Validators voting",
  done: "Done",
  failed: "Failed",
};

function TxDock() {
  const { items, dismiss } = useTxs();
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
