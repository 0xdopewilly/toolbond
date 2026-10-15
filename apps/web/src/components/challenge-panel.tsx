"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MIN_BOND_WEI, topUpNeeded, weiToGen } from "@/lib/assurance";
import type { Challenge, Server } from "@/lib/types";
import { useTxs, useWallet } from "./providers";

// Mirrors the contract's rules exactly (docs/CONTRACT_API.md), so no button leads to a refusal.
const CHALLENGEABLE = new Set(["ACTIVE", "STALE", "EXITING"]);
const CHALLENGE_TTL_MS = 72 * 3600 * 1000;

type Kind = "DRIFT" | "CONTENT";
type Action = { method: string; args: (string | number)[]; label: string; hint: string };

function nextAction(challenge: Challenge): Action | null {
  if (challenge.stage === "SETTLED" || challenge.stage === "EXPIRED") return null;
  if (challenge.kind === "DRIFT" && challenge.stage === "FILED") {
    return { method: "observe", args: [challenge.cid, "content"], label: "Observe", hint: "Validators re-fetch the server and compare it with the pin." };
  }
  const judgeable =
    (challenge.kind === "CONTENT" && challenge.stage === "FILED") || (challenge.stage === "OBSERVED" && challenge.drift === "DIFFERS");
  if (judgeable) {
    return { method: "judge", args: [challenge.cid], label: "Judge", hint: "Validators read the verified text twice each and vote on a verdict." };
  }
  return { method: "settle", args: [challenge.cid], label: "Settle", hint: "Apply the payout table and close the challenge." };
}

function canExpire(challenge: Challenge): boolean {
  if (challenge.stage !== "FILED" && challenge.stage !== "OBSERVED") return false;
  const filed = Date.parse(challenge.filed_at);
  return (Number.isFinite(filed) && Date.now() - filed >= CHALLENGE_TTL_MS) || challenge.attempts >= 3;
}

/** File a challenge, push open ones forward, or run the publisher and maintenance actions. */
export function ChallengePanel({ server, challenges }: { server: Server; challenges: Challenge[] }) {
  const wallet = useWallet();
  const { run } = useTxs();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("DRIFT");
  const [tool, setTool] = useState(server.tools[0]?.name ?? "");
  const [busy, setBusy] = useState(false);

  const open = challenges.filter((c) => c.stage !== "SETTLED" && c.stage !== "EXPIRED");
  const openDrift = open.some((c) => c.kind === "DRIFT");
  const openOnTool = open.some((c) => c.kind === "CONTENT" && c.tool === tool);
  const challengeable = CHALLENGEABLE.has(server.status);
  const isPublisher = Boolean(wallet.address) && wallet.address.toLowerCase() === server.publisher.toLowerCase();
  const noOpen = open.length === 0;

  const act = async (label: string, method: string, args: (string | number)[], value = "0") => {
    if (!wallet.mode) {
      // connecting opens the wallet picker; nothing is sent until a deliberate second press
      wallet.openConnect();
      return;
    }
    setBusy(true);
    try {
      const info = await run(label, method, args, value);
      if (info?.success) router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const host = new URL(server.url).hostname;
  const file = () =>
    kind === "DRIFT"
      ? act(`Drift challenge on ${host}`, "challenge", [server.sid, "", "DRIFT"], "0.5")
      : act(`Content challenge on ${tool}`, "challenge", [server.sid, tool, "CONTENT"], "1");

  const blockedReason = !challengeable
    ? `This server is ${server.status.toLowerCase().replace("_", " ")}, so it cannot be challenged.`
    : kind === "DRIFT" && openDrift
      ? "A drift challenge is already open on this server. Push it forward below."
      : kind === "CONTENT" && openOnTool
        ? "A content challenge on this tool is already open."
        : "";

  // maintenance actions, each shown only when the contract would accept it from this wallet
  const shortfall = topUpNeeded(server); // version 3: re-pinning a BONDED server needs the full minimum
  const repin =
    noOpen &&
    shortfall === 0n &&
    (server.status === "PENDING_SNAPSHOT" ||
      (server.status === "STALE" && (server.tier === "REVIEWED" || isPublisher)) ||
      (server.status === "ACTIVE" && isPublisher));
  const canTopUp = isPublisher && server.tier === "BONDED" && ["PENDING_SNAPSHOT", "PENDING_REVIEW", "ACTIVE", "STALE"].includes(server.status);
  const canExit =
    isPublisher && ["PENDING_SNAPSHOT", "PENDING_REVIEW", "ACTIVE", "STALE"].includes(server.status) && (server.tier === "BONDED" || noOpen);

  return (
    <section className="panel raised" aria-labelledby="act-title">
      <div className="panel-head">
        <h2 id="act-title">Challenge this server</h2>
        {server.tier === "REVIEWED" && <span className="badge outline">no bond</span>}
      </div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="action-list" role="radiogroup" aria-label="Challenge kind">
          {(
            [
              ["DRIFT", "Drift", "0.5 GEN stake", "The live manifest no longer matches the pin. A poisoned change costs the publisher the whole bond."],
              ["CONTENT", "Content", "1 GEN stake", "A pinned tool is poisoned as it stands. Validators judge the pinned text again."],
            ] as const
          ).map(([value, title, price, body]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              className={`action-card${kind === value ? " selected" : ""}`}
              onClick={() => setKind(value)}
              style={{ font: "inherit", textAlign: "left", cursor: "pointer", color: "inherit" }}
            >
              <span className="row">
                <span className="radio" aria-hidden="true" />
                <strong>{title}</strong>
                <span className="price">{price}</span>
              </span>
              <p>{body}</p>
            </button>
          ))}
        </div>

        {kind === "CONTENT" && (
          <div className="field">
            <label htmlFor="challenge-tool">Tool</label>
            <select id="challenge-tool" className="input" value={tool} onChange={(event) => setTool(event.target.value)}>
              {server.tools.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {blockedReason ? (
          <p className="muted small" style={{ margin: 0 }}>
            {blockedReason}
          </p>
        ) : (
          <>
            <button type="button" className="button accent" disabled={busy || !server.tools.length} onClick={file}>
              {wallet.mode ? `Stake ${kind === "DRIFT" ? "0.5" : "1"} GEN and file` : "Connect a wallet to file"}
            </button>
            {wallet.mode && (
              <p className="muted small" style={{ margin: 0 }}>
                Empty wallet?{" "}
                <button type="button" className="linklike" onClick={() => wallet.faucet()}>
                  Get 25 test GEN
                </button>{" "}
                from the Studio faucet first.
              </p>
            )}
          </>
        )}

        {open.length > 0 && (
          <div className="panel-section">
            <span className="small muted" style={{ fontWeight: 600 }}>
              Open challenges. Anyone can push them forward.
            </span>
            {open.map((challenge) => {
              const action = nextAction(challenge);
              return (
                <div key={challenge.cid} className="action-card">
                  <span className="row">
                    <strong className="mono">{challenge.cid}</strong>
                    <span className="badge neutral">{challenge.stage.toLowerCase()}</span>
                    {challenge.drift && <span className="badge outline">{challenge.drift}</span>}
                  </span>
                  {action && <p>{action.hint}</p>}
                  <div className="actions">
                    {action && (
                      <button
                        type="button"
                        className="button small primary"
                        disabled={busy}
                        onClick={() => act(`${action.label} ${challenge.cid}`, action.method, action.args)}
                      >
                        {action.label}
                      </button>
                    )}
                    {canExpire(challenge) && (
                      <button type="button" className="button small" disabled={busy} onClick={() => act(`Expire ${challenge.cid}`, "expire", [challenge.cid])}>
                        Expire and refund
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="panel-section">
          <span className="small muted" style={{ fontWeight: 600 }}>
            No stake needed
          </span>
          <div className="actions">
            {(server.status === "ACTIVE" || server.status === "STALE") && (
              <button
                type="button"
                className="button small"
                disabled={busy}
                onClick={() => act(`Re-check ${host}`, "attest", [server.sid])}
                title="Validators fetch the server and record whether it still serves the pinned bytes"
              >
                Ask validators to re-check
              </button>
            )}
            {canTopUp && shortfall > 0n && (
              <button
                type="button"
                className="button small primary"
                disabled={busy}
                onClick={() => act(`Restore the bond (+${weiToGen(shortfall)} GEN)`, "top_up", [server.sid], weiToGen(shortfall))}
              >
                Restore the bond (+{weiToGen(shortfall)} GEN)
              </button>
            )}
            {repin && (
              <button type="button" className="button small" disabled={busy} onClick={() => act("Pin the manifest", "snapshot", [server.sid])}>
                {server.status === "ACTIVE" ? "Announce an update (re-pin)" : "Pin the manifest"}
              </button>
            )}
            {server.status === "PENDING_REVIEW" && (
              <button type="button" className="button small" disabled={busy} onClick={() => act("Judge pinned tools", "review", [server.sid])}>
                Run review
              </button>
            )}
            {canExit && (
              <button type="button" className="button small danger" disabled={busy} onClick={() => act("Request exit", "request_exit", [server.sid])}>
                Request exit
              </button>
            )}
            {server.status === "EXITING" && (
              <button type="button" className="button small" disabled={busy} onClick={() => act("Finalize exit", "finalize_exit", [server.sid])}>
                Finalize exit
              </button>
            )}
          </div>
          {shortfall > 0n && server.status !== "SLASHED" && (
            <p className="muted small" style={{ margin: 0 }}>
              The bond is {weiToGen(BigInt(server.bond))} GEN, below the {weiToGen(MIN_BOND_WEI)} GEN minimum, so this server no longer counts as
              bonded. {isPublisher ? "Restore it to re-pin; " : "Only the publisher can restore it; "}until then guards running --bonded-only block
              it.
            </p>
          )}
          {server.status === "ACTIVE" && isPublisher && (
            <p className="muted small" style={{ margin: 0 }}>
              Changing your tools? Re-pin right after you deploy: the server stays out of reach of challenges until validators review the new version.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
