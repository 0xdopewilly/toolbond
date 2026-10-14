"use client";

import { useEffect, useRef, useState } from "react";
import { hasInjectedWallet } from "@/lib/client";
import { useTxs, useWallet } from "./providers";

export function WalletButton() {
  const wallet = useWallet();
  const { run } = useTxs();
  const [open, setOpen] = useState(false);
  const [claimable, setClaimable] = useState<string | null>(null);
  const [injected, setInjected] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setInjected(hasInjectedWallet()), []);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (!wallet.address) return;
    fetch(`/api/claimable?address=${wallet.address}`)
      .then((r) => r.json())
      .then((body: { claimable?: string }) => setClaimable(body.claimable ?? null))
      .catch(() => setClaimable(null));
  }, [wallet.address]);

  if (!wallet.mode) {
    return (
      <div className="menu-wrap" ref={ref}>
        <button type="button" className="button small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {wallet.connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {open && (
          <div className="menu" role="menu">
            <button type="button" role="menuitem" onClick={() => wallet.connect("burner").then(() => setOpen(false))}>
              <strong>Built-in test wallet</strong>
              <span>Lives in this browser. Best on Studio Next, where wallets show a 0 balance.</span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!injected}
              onClick={() => wallet.connect("injected").then(() => setOpen(false)).catch(() => setOpen(false))}
            >
              <strong>Browser wallet</strong>
              <span>{injected ? "MetaMask, Rabby or any injected wallet. Adds chain 61997." : "No browser wallet detected."}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="button small account" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="dot" aria-hidden="true" />
        <span className="mono">
          {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
        </span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-note">
            {wallet.mode === "burner" ? "Built-in test wallet" : "Browser wallet"} on Studio Next
            {claimable && claimable !== "0" && <span>Claimable from ToolBond: {formatGen(claimable)} GEN</span>}
          </div>
          <button type="button" role="menuitem" onClick={() => wallet.faucet().then(() => setOpen(false))}>
            <strong>Get test GEN</strong>
            <span>25 GEN from the Studio faucet, enough for a bond and a few challenges.</span>
          </button>
          <button type="button" role="menuitem" onClick={() => run("Withdraw claimable GEN", "withdraw", []).then(() => setOpen(false))}>
            <strong>Withdraw</strong>
            <span>Pay out refunds, rewards and hunter shares owed to you.</span>
          </button>
          <button type="button" role="menuitem" onClick={() => navigator.clipboard?.writeText(wallet.address)}>
            <strong>Copy address</strong>
            <span className="mono">{wallet.address}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => (wallet.disconnect(), setOpen(false))}>
            <strong>Disconnect</strong>
          </button>
        </div>
      )}
    </div>
  );
}

function formatGen(wei: string): string {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 3).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}
