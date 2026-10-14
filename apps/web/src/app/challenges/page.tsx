import type { Metadata } from "next";
import Link from "next/link";
import { StageBar } from "@/components/challenge-timeline";
import { Reveal } from "@/components/motion";
import { Votes } from "@/components/providers";
import { DataNotice, VerdictBadge } from "@/components/ui";
import { loadRegistry } from "@/lib/data";
import { gen, relativeTime, shortAddress } from "@/lib/format";
import { displayName } from "@/lib/names";

export const revalidate = 30;
export const metadata: Metadata = { title: "Challenges" };

const PAYOUTS = [
  ["Content · POISONED", "Whole bond slashed: half to the hunter, half to the pool. Stake back. Server SLASHED."],
  ["Drift · DIFFERS → POISONED", "Whole bond slashed, split 50/50. Stake back. Server SLASHED."],
  ["Drift · DIFFERS → SAFE", "5% of the bond to the hunter for spotting an unannounced change. Server STALE until re-pinned."],
  ["Drift · UNSTABLE or UNPINNED", "25% of the bond slashed. The server served different bytes to different validators."],
  ["Drift · MATCH", "Stake back minus 0.1 GEN to the publisher, so drift spam costs something."],
  ["Content · SAFE", "The hunter's stake goes to the publisher."],
  ["UNCLEAR or UNREACHABLE", "Stake refunded. Nobody is punished on an uncertain ruling."],
];

export default async function ChallengesPage() {
  const registry = await loadRegistry();
  const servers = new Map(registry.servers.map((server) => [server.sid, server]));
  const open = registry.challenges.filter((c) => c.stage !== "SETTLED" && c.stage !== "EXPIRED").length;

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <span className="overline">Challenges</span>
          <h1>Stake on the truth. Validators settle it.</h1>
          <p className="lede">
            Anyone can stake that a pinned tool is poisoned (content) or that a server no longer serves the pinned bytes (drift).
            Validators re-fetch, judge only text every one of them verified, and the contract pays out.
          </p>
        </div>
        <div className="actions">
          <span className="badge outline num">{registry.challenges.length} filed</span>
          <span className={`badge ${open ? "warn" : "good"} num`}>{open} open</span>
        </div>
      </div>

      <DataNotice registry={registry} />

      <div className="challenge-grid">
        {registry.challenges.map((challenge, index) => {
          const server = servers.get(challenge.sid);
          const lastVotes = challenge.txs?.[challenge.txs.length - 1]?.votes;
          return (
            <Reveal key={challenge.cid} delay={index * 70}>
              <Link href={`/server/${challenge.sid}#challenges`} className={`challenge-card${challenge.verdict === "POISONED" ? " bad" : ""}`} style={{ color: "inherit" }} data-spotlight>
                <div className="top">
                  <span className="cid">{challenge.cid}</span>
                  <span className="badge outline">{challenge.kind.toLowerCase()}</span>
                  {challenge.drift && <span className={`badge ${challenge.drift === "MATCH" ? "good" : "warn"}`}>{challenge.drift}</span>}
                  {challenge.verdict && <VerdictBadge verdict={challenge.verdict} />}
                  <span className="muted small" style={{ marginLeft: "auto" }}>
                    {relativeTime(challenge.updated_at)}
                  </span>
                </div>
                <h3>{server ? displayName(server.url) : challenge.sid}</h3>
                {challenge.quote ? (
                  <p className="quote" style={{ fontSize: 12 }}>
                    “{challenge.quote}”
                  </p>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    {challenge.drift === "MATCH"
                      ? "Every validator re-fetched the server and found the pinned bytes."
                      : challenge.reason || `${challenge.kind.toLowerCase()} challenge, ${challenge.stage.toLowerCase()}`}
                  </p>
                )}
                <StageBar challenge={challenge} />
                <div className="meta num">
                  <div>
                    <span>Hunter</span>
                    <b className="mono">{shortAddress(challenge.hunter)}</b>
                  </div>
                  <div>
                    <span>Stake</span>
                    <b>{gen(challenge.stake)} GEN</b>
                  </div>
                  <div>
                    <span>Paid to hunter</span>
                    <b style={{ color: challenge.verdict === "POISONED" ? "var(--good)" : undefined }}>
                      {challenge.payout?.hunter ? `${gen(challenge.payout.hunter)} GEN` : "—"}
                    </b>
                  </div>
                </div>
                {lastVotes?.length ? (
                  <span className="small muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Votes votes={lastVotes} animate={false} /> final vote
                  </span>
                ) : null}
              </Link>
            </Reveal>
          );
        })}
        {registry.challenges.length === 0 && <div className="empty">No challenges yet.</div>}
      </div>

      <section className="panel" aria-labelledby="payout-title">
        <div className="panel-head">
          <h2 id="payout-title">Payout table</h2>
          <span className="muted small">Applied by settle(). Payments are pulled with withdraw(), never pushed.</span>
        </div>
        <div className="scroll">
          <table className="verdict-table" style={{ minWidth: 560 }}>
            <tbody>
              {PAYOUTS.map(([when, what]) => (
                <tr key={when}>
                  <td style={{ whiteSpace: "nowrap" }}>{when}</td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
