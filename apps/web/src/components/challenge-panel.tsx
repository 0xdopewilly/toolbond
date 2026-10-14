"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Challenge, Server } from "@/lib/types";
import { useTxs, useWallet } from "./providers";

const CLOSED_SERVER = new Set(["SLASHED", "REJECTED", "EXITED", "PENDING_SNAPSHOT"]);
const CHALLENGE_TTL_MS = 72 * 3600 * 1000;

type Kind = "DRIFT" | "CONTENT";

function nextAction(challenge: Challenge): { method: string; args: string[]; label: string; hint: string } | null {
  if (challenge.stage === "SETTLED" || challenge.stage === "EXPIRED") return null;
  if (challenge.stage === "FILED" && challenge.kind === "DRIFT") {
    return { method: "observe", args: [challenge.cid, "content"], label: "Observe", hint: "Validators re-fetch the server and compare it with the pin." };
  }
  if ((challenge.stage === "FILED" && challenge.kind === "CONTENT") || (challenge.stage === "OBSERVED" && challenge.drift === "DIFFERS")) {
    return { method: "judge", args: [challenge.cid], label: "Judge", hint: "Validators read the verified text and vote on a verdict." };
  }
  return { method: "settle", args: [challenge.cid], label: "Settle", hint: "Apply the payout table and close the challenge." };
}

/** File a challenge, push open ones forward, or ask validators to re-check the server. */
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
  const closedServer = CLOSED_SERVER.has(server.status);
  const isPublisher = wallet.address && wallet.address.toLowerCase() === server.publisher.toLowerCase();

  const act = async (label: string, method: string, args: (string | number)[], value = "0") => {
    if (!wallet.mode) {
      // connect first; the next click spends, so nothing is staked without a deliberate second press
      await wallet.connect("burner");
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

  const file = () =>
    kind === "DRIFT"
      ? act(`Drift challenge on ${new URL(server.url).hostname}`, "challenge", [server.sid, "", "DRIFT"], "0.5")
      : act(`Content challenge on ${tool}`, "challenge", [server.sid, tool, "CONTENT"], "1");

  const blockedReason = closedServer
    ? `This server is ${server.status.toLowerCase().replace("_", " ")}; there is nothing left to challenge.`
    : kind === "DRIFT" && openDrift
      ? "A drift challenge is already open on this server. Push it forward below."
      : kind === "CONTENT" && openOnTool
        ? "A content challenge on this tool is already open."
        : "";

  return (
    <section className="panel raised" aria-labelledby="act-title">
      <div className="panel-head">
        <h2 id="act-title">Challenge this server</h2>
        {server.tier === "REVIEWED" && <span className="badge outline">no bond</span>}
      </div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="action-list" role="radiogroup" aria-label="Challenge kind">
          <button
            type="button"
            role="radio"
            aria-checked={kind === "DRIFT"}
            className={`action-card${kind === "DRIFT" ? " selected" : ""}`}
            onClick={() => setKind("DRIFT")}
            style={{ font: "inherit", textAlign: "left", cursor: "pointer", color: "inherit" }}
          >
            <span className="row">
              <span className="radio" aria-hidden="true" />
              <strong>Drift</strong>
              <span className="price">0.5 GEN stake</span>
            </span>
            <p>The live manifest no longer matches the pin. If the change is poisoned, the whole bond is slashed.</p>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={kind === "CONTENT"}
            className={`action-card${kind === "CONTENT" ? " selected" : ""}`}
            onClick={() => setKind("CONTENT")}
            style={{ font: "inherit", textAlign: "left", cursor: "pointer", color: "inherit" }}
          >
            <span className="row">
              <span className="radio" aria-hidden="true" />
              <strong>Content</strong>
              <span className="price">1 GEN stake</span>
            </span>
            <p>A pinned tool is poisoned as it stands. Validators judge the pinned text again.</p>
          </button>
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
              {wallet.mode ? `Stake ${kind === "DRIFT" ? "0.5" : "1"} GEN and file` : "Connect a test wallet"}
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
            <span className="small muted" style={{ fontWeight: 600 }}>
              Open challenges. Anyone can push them forward.
            </span>
            {open.map((challenge) => {
              const action = nextAction(challenge);
              const stale = Date.now() - Date.parse(challenge.filed_at) > CHALLENGE_TTL_MS || challenge.attempts >= 3;
              return (
                <div key={challenge.cid} className="action-card">
                  <span className="row">
                    <strong className="mono">{challenge.cid}</strong>
                    <span className="badge neutral">{challenge.stage.toLowerCase()}</span>
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
                    {stale && (
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

        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
          <span className="small muted" style={{ fontWeight: 600 }}>
            No stake needed
          </span>
          <div className="actions">
            <button
              type="button"
              className="button small"
              disabled={busy || closedServer}
              onClick={() => act(`Re-check ${new URL(server.url).hostname}`, "attest", [server.sid])}
              title="Validators fetch the server and record whether it still serves the pinned bytes"
            >
              Ask validators to re-check
            </button>
            {(server.status === "PENDING_SNAPSHOT" || server.status === "STALE") && (
              <button type="button" className="button small" disabled={busy} onClick={() => act("Pin the manifest", "snapshot", [server.sid])}>
                Re-pin manifest
              </button>
            )}
            {server.status === "PENDING_REVIEW" && (
              <button type="button" className="button small" disabled={busy} onClick={() => act("Judge pinned tools", "review", [server.sid])}>
                Run review
              </button>
            )}
            {isPublisher && (server.status === "ACTIVE" || server.status === "STALE") && (
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
        </div>
      </div>
    </section>
  );
}
