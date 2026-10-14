"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useRef, useState } from "react";
import { EXPLORER } from "@/lib/chain";
import { TEST_WALLET_ICON } from "@/lib/test-wallet";
import { useTxs, useWallet } from "./providers";

function formatGen(wei: string): string {
  const value = BigInt(wei);
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 3).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function AccountMenu({ displayName, displayBalance, openAccountModal }: { displayName: string; displayBalance?: string; openAccountModal: () => void }) {
  const wallet = useWallet();
  const { run } = useTxs();
  const [open, setOpen] = useState(false);
  const [claimable, setClaimable] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  useEffect(() => {
    if (!open || !wallet.address) return;
    fetch(`/api/claimable?address=${wallet.address}`)
      .then((r) => r.json())
      .then((body: { claimable?: string | null }) => setClaimable(body.claimable ?? null))
      .catch(() => setClaimable(null));
  }, [open, wallet.address]);

  const item = (fn: () => unknown) => () => {
    fn();
    setOpen(false);
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="button small account" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <span className="dot" aria-hidden="true" />
        <span className="mono">{displayName}</span>
        {displayBalance && <span className="balance num">{displayBalance}</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            {wallet.mode === "burner" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={TEST_WALLET_ICON} alt="" width={30} height={30} />
            ) : (
              <span className="menu-avatar" aria-hidden="true" />
            )}
            <span>
              <strong>{wallet.mode === "burner" ? "ToolBond test wallet" : wallet.walletName || "Browser wallet"}</strong>
              <span className="mono">{wallet.address.slice(0, 10)}…{wallet.address.slice(-6)}</span>
            </span>
          </div>
          <div className="menu-stats">
            <span>
              <small>Balance</small>
              <b className="num">{displayBalance ?? "—"}</b>
            </span>
            <span>
              <small>Claimable</small>
              <b className="num">{claimable === null ? "—" : `${formatGen(claimable)} GEN`}</b>
            </span>
          </div>
          <button type="button" role="menuitem" onClick={item(() => wallet.faucet())}>
            <strong>Get test GEN</strong>
            <span>25 GEN from the Studio faucet: enough for a bond and a few challenges.</span>
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={claimable === "0"}
            onClick={item(() => run("Withdraw claimable GEN", "withdraw", []))}
          >
            <strong>Withdraw</strong>
            <span>{claimable === "0" ? "Nothing to withdraw yet." : "Pay out refunds, rewards and hunter shares the contract owes you."}</span>
          </button>
          <div className="menu-row">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                navigator.clipboard?.writeText(wallet.address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              <strong>{copied ? "Copied" : "Copy address"}</strong>
            </button>
            <a role="menuitem" href={`${EXPLORER}/address/${wallet.address}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              <strong>Explorer ↗</strong>
            </a>
            {wallet.mode === "injected" && (
              <button type="button" role="menuitem" onClick={item(openAccountModal)}>
                <strong>Details</strong>
              </button>
            )}
          </div>
          <button type="button" role="menuitem" className="menu-danger" onClick={item(() => wallet.disconnect())}>
            <strong>Disconnect</strong>
          </button>
        </div>
      )}
    </div>
  );
}

export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openChainModal, openAccountModal, mounted }) => {
        if (!mounted) {
          return (
            <button type="button" className="button small" aria-hidden="true" tabIndex={-1} style={{ visibility: "hidden" }}>
              Connect wallet
            </button>
          );
        }
        if (!account) {
          return (
            <button type="button" className="button small connect" onClick={openConnectModal}>
              <span className="connect-glow" aria-hidden="true" />
              Connect wallet
            </button>
          );
        }
        if (chain?.unsupported) {
          return (
            <button type="button" className="button small danger" onClick={openChainModal}>
              Switch to Studio Next
            </button>
          );
        }
        return <AccountMenu displayName={account.displayName} displayBalance={account.displayBalance} openAccountModal={openAccountModal} />;
      }}
    </ConnectButton.Custom>
  );
}
