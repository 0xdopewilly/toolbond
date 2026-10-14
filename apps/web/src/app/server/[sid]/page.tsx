import Link from "next/link";
import { notFound } from "next/navigation";
import { DataNotice, Revealed, StatusBadge, VerdictBadge } from "@/components/ui";
import { loadRegistry } from "@/lib/data";
import { EXPLORER, FLAG_LABELS, gen, relativeTime, shortAddress, shortHash } from "@/lib/format";
import type { Challenge } from "@/lib/types";

export const revalidate = 30;

function pretty(canon: string): string {
  try {
    return JSON.stringify(JSON.parse(canon), null, 2);
  } catch {
    return canon;
  }
}

function Timeline({ challenge }: { challenge: Challenge }) {
  const steps = [
    { title: "Filed", body: `${challenge.kind} challenge, stake ${gen(challenge.stake)} GEN by ${shortAddress(challenge.hunter)}`, done: true },
    {
      title: challenge.drift ? `Observed · ${challenge.drift.toLowerCase()}` : "Observed",
      body: challenge.drift ? "Each validator fetched the server itself." : "Waiting for validators to re-fetch.",
      done: Boolean(challenge.drift) || challenge.kind === "CONTENT",
    },
    {
      title: challenge.verdict ? `Judged · ${challenge.verdict.toLowerCase()}` : "Judged",
      body: challenge.verdict ? challenge.reason || "Two independent readings per validator." : "Only needed when the manifest differs.",
      done: Boolean(challenge.verdict),
    },
    {
      title: challenge.stage === "SETTLED" ? "Settled" : challenge.stage === "EXPIRED" ? "Expired" : "Settlement pending",
      body: challenge.payout?.hunter
        ? `Hunter ${gen(challenge.payout.hunter)} GEN · pool ${gen(challenge.payout.pool ?? "0")} GEN · publisher ${gen(challenge.payout.publisher ?? "0")} GEN`
        : "",
      done: challenge.stage === "SETTLED" || challenge.stage === "EXPIRED",
    },
  ];
  return (
    <ol className="feed">
      {steps.map((step) => (
        <li key={step.title} style={{ flexDirection: "row", gap: 12 }}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              marginTop: 6,
              borderRadius: "50%",
              flex: "none",
              background: step.done ? (challenge.verdict === "POISONED" && step.title.startsWith("Judged") ? "var(--bad)" : "var(--ink)") : "var(--line-strong)",
            }}
          />
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <strong style={{ fontWeight: 600 }}>{step.title}</strong>
            {step.body && <span className="muted" style={{ fontSize: 13 }}>{step.body}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default async function ServerPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const registry = await loadRegistry();
  const server = registry.servers.find((item) => item.sid === sid);
  if (!server) notFound();
  const challenges = registry.challenges.filter((challenge) => challenge.sid === sid);
  const changed = challenges.find((challenge) => challenge.changed.length > 0);
  const instructionFlags = server.flags["__instructions__"] ?? [];

  return (
    <main className="wrap page">
      <nav aria-label="Breadcrumb" className="muted" style={{ fontSize: 13, display: "flex", gap: 8 }}>
        <Link href="/">Registry</Link>
        <span aria-hidden="true">/</span>
        <span style={{ color: "var(--ink)" }}>{new URL(server.url).hostname}</span>
      </nav>

      <DataNotice registry={registry} />

      <section className="split" style={{ paddingBottom: 24, borderBottom: "1px solid var(--line)" }}>
        <div className="main" style={{ gap: 10 }}>
          <div className="actions" style={{ alignItems: "center" }}>
            <h1 style={{ margin: 0 }}>{new URL(server.url).hostname}</h1>
            <StatusBadge status={server.status} />
          </div>
          <span className="mono muted" style={{ fontSize: 13, overflowWrap: "anywhere" }}>
            {server.url}
          </span>
          <p style={{ margin: "4px 0 0", fontSize: 15 }}>
            <span className="muted">Declared purpose:</span> {server.purpose}
          </p>
          <div className="chips" aria-label="Declared capabilities">
            {server.caps.split(",").map((cap) => (
              <span key={cap} className="chip mono">
                {cap}
              </span>
            ))}
          </div>
        </div>
        <dl className="side facts">
          <div>
            <dt>Tier</dt>
            <dd>{server.tier === "BONDED" ? `Bonded · ${gen(server.bond)} GEN` : "Reviewed (no bond)"}</dd>
          </div>
          <div>
            <dt>Publisher</dt>
            <dd className="mono">
              <a href={`${EXPLORER}/address/${server.publisher}`} target="_blank" rel="noreferrer">
                {shortAddress(server.publisher)}
              </a>
            </dd>
          </div>
          <div>
            <dt>Pinned root</dt>
            <dd className="mono">{shortHash(server.root, 10, 6)}</dd>
          </div>
          <div>
            <dt>Last verified</dt>
            <dd>{relativeTime(server.last_verified_at)}</dd>
          </div>
          <div>
            <dt>MCP protocol</dt>
            <dd className="mono">{server.protocol || "—"}</dd>
          </div>
          <div>
            <dt>Slashes</dt>
            <dd className="num">{server.slashes}</dd>
          </div>
        </dl>
      </section>

      <div className="split">
        <div className="main">
          {changed && (
            <section className="panel" aria-label="Changed tools">
              <div className="panel-head">
                <h2>Observed change</h2>
                <span className="muted mono" style={{ fontSize: 12, marginLeft: "auto" }}>
                  {shortHash(server.root)} → {shortHash(changed.observed_root)}
                </span>
              </div>
              {changed.changed.map((tool) => (
                <div key={tool.name} className="tool">
                  <div className="tool-head">
                    <strong className="mono">{tool.name}</strong>
                    {(changed.changed_flags[tool.name] ?? []).map((flag) => (
                      <span key={flag} className={`chip mono${flag.startsWith("H") ? " bad" : ""}`} title={FLAG_LABELS[flag]}>
                        {flag}
                      </span>
                    ))}
                  </div>
                  <pre className="code">
                    <Revealed text={pretty(tool.canon)} />
                  </pre>
                </div>
              ))}
            </section>
          )}

          <section className="panel" aria-label="Pinned tools">
            <div className="panel-head">
              <h2>Pinned tools</h2>
              <span className="muted" style={{ fontSize: 12 }}>
                Hashes are SHA-256 of the TBCM-1 canonical text every validator derived.
              </span>
            </div>
            {server.tools.map((tool) => (
              <details key={tool.name} className="tool">
                <summary className="tool-head" style={{ cursor: "pointer", listStyle: "none" }}>
                  <strong className="mono">{tool.name}</strong>
                  <VerdictBadge verdict={tool.verdict} />
                  {(server.flags[tool.name] ?? []).map((flag) => (
                    <span key={flag} className={`chip mono${flag.startsWith("H") ? " bad" : ""}`} title={FLAG_LABELS[flag]}>
                      {flag}
                    </span>
                  ))}
                  <span className="mono muted" style={{ fontSize: 12, marginLeft: "auto" }}>
                    {shortHash(tool.hash, 10, 6)}
                  </span>
                </summary>
                {tool.quote && (
                  <p className="code" style={{ color: "var(--bad)" }}>
                    “{tool.quote}”
                  </p>
                )}
                <pre className="code">
                  <Revealed text={pretty(tool.canon)} />
                </pre>
              </details>
            ))}
          </section>

          {server.instructions && (
            <section className="panel" aria-label="Server instructions">
              <div className="panel-head">
                <h2>Server instructions</h2>
                <span className="muted" style={{ fontSize: 12 }}>
                  Sent to the model on connect, so they are pinned and judged too.
                </span>
                {instructionFlags.map((flag) => (
                  <span key={flag} className="chip mono" title={FLAG_LABELS[flag]}>
                    {flag}
                  </span>
                ))}
              </div>
              <details className="tool">
                <summary style={{ cursor: "pointer" }} className="muted">
                  Show {server.instructions.length.toLocaleString("en")} characters
                </summary>
                <pre className="code">
                  <Revealed text={server.instructions} />
                </pre>
              </details>
            </section>
          )}
        </div>

        <aside className="side" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {challenges.length === 0 ? (
            <section className="panel">
              <div className="panel-head">
                <h2>Challenges</h2>
              </div>
              <p className="muted" style={{ margin: 0, padding: "16px 18px" }}>
                No challenges yet. Anyone can stake on a DRIFT or CONTENT challenge.
              </p>
            </section>
          ) : (
            challenges.map((challenge) => (
              <section key={challenge.cid} className="panel">
                <div className="panel-head">
                  <h2>Challenge {challenge.cid}</h2>
                  <span className="badge warn">{challenge.kind.toLowerCase()}</span>
                  <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>
                    {challenge.stage.toLowerCase()}
                  </span>
                </div>
                <Timeline challenge={challenge} />
              </section>
            ))
          )}
        </aside>
      </div>
    </main>
  );
}
