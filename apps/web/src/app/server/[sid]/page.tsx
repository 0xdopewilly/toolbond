import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChallengePanel } from "@/components/challenge-panel";
import { ChallengeTimeline } from "@/components/challenge-timeline";
import { CopyButton } from "@/components/copy-button";
import { DiffView } from "@/components/diff-view";
import { Votes } from "@/components/providers";
import { Tabs, type TabSpec } from "@/components/tabs";
import { DataNotice, Revealed, StatusBadge, VerdictBadge } from "@/components/ui";
import { loadRegistry } from "@/lib/data";
import { EXPLORER, FLAG_LABELS, gen, relativeTime, shortAddress, shortHash } from "@/lib/format";
import { displayName } from "@/lib/names";
import type { Challenge, Server } from "@/lib/types";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: Promise<{ sid: string }> }): Promise<Metadata> {
  const { sid } = await params;
  const registry = await loadRegistry();
  const server = registry.servers.find((item) => item.sid === sid);
  return { title: server ? displayName(server.url) : "Server" };
}

function pretty(canon: string): string {
  try {
    return JSON.stringify(JSON.parse(canon), null, 2);
  } catch {
    return canon;
  }
}

function Flags({ flags }: { flags: string[] }) {
  return (
    <>
      {flags.map((flag) => (
        <span key={flag} className={`chip mono${flag.startsWith("H") ? " bad" : ""}`} title={FLAG_LABELS[flag]}>
          {flag} · {FLAG_LABELS[flag] ?? "flag"}
        </span>
      ))}
    </>
  );
}

function ToolsTab({ server }: { server: Server }) {
  return (
    <section className="panel" aria-label="Pinned tools">
      <div className="panel-head">
        <h2>Pinned tools</h2>
        <span className="muted small">SHA-256 of the TBCM-1 canonical text every validator derived. Hidden characters are shown decoded.</span>
      </div>
      {server.tools.map((tool, index) => (
        <details key={tool.name} className="tool" open={server.tools.length <= 2 || index === 0}>
          <summary>
            <svg className="caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M4 2.5L7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <strong className="mono">{tool.name}</strong>
            <VerdictBadge verdict={tool.verdict} />
            {(server.flags[tool.name] ?? []).map((flag) => (
              <span key={flag} className={`chip mono${flag.startsWith("H") ? " bad" : ""}`} title={FLAG_LABELS[flag]}>
                {flag}
              </span>
            ))}
            <span className="hash">{shortHash(tool.hash, 10, 6)}</span>
          </summary>
          <div className="tool-body">
            {tool.quote && <p className="quote">“{tool.quote}”</p>}
            {tool.reason && <p className="muted small" style={{ margin: 0 }}>{tool.reason}</p>}
            <pre className="code">
              <Revealed text={pretty(tool.canon)} />
            </pre>
            <span className="actions small muted">
              <span className="mono">{tool.hash}</span>
              <CopyButton text={tool.hash} label="Copy hash" />
            </span>
          </div>
        </details>
      ))}
    </section>
  );
}

function ChangesTab({ server, changed }: { server: Server; changed: Challenge }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="panel" aria-label="What changed">
        <div className="panel-head">
          <h2>What validators observed</h2>
          <span className="mono muted small" style={{ marginLeft: "auto" }}>
            pinned {shortHash(server.root)} → live {shortHash(changed.observed_root)}
          </span>
        </div>
        <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {changed.changed.map((tool) => {
            const pinned = server.tools.find((item) => item.name === tool.name);
            return (
              <div key={tool.name} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="tool-head">
                  <strong className="mono">{tool.name}</strong>
                  {changed.offending === tool.name && changed.verdict && <VerdictBadge verdict={changed.verdict} />}
                  <span className="hash">
                    {shortHash(pinned?.hash ?? "", 8, 4)} → {shortHash(tool.hash, 8, 4)}
                  </span>
                </div>
                <div className="chips">
                  <Flags flags={changed.changed_flags[tool.name] ?? []} />
                </div>
                {pinned ? <DiffView before={pinned.canon} after={tool.canon} /> : <pre className="code"><Revealed text={pretty(tool.canon)} /></pre>}
                <div className="diff-legend">
                  <span>
                    <i style={{ background: "var(--bad-bg)", boxShadow: "inset 0 -1px 0 var(--bad-line)" }} />
                    added after pinning
                  </span>
                  <span>
                    <i style={{ background: "var(--paper-2)" }} />
                    removed
                  </span>
                  <span>
                    <i style={{ border: "1px dashed var(--bad)" }} />
                    invisible characters, decoded
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {changed.quote && (
        <section className="panel" aria-label="Judge ruling">
          <div className="panel-head">
            <h2>Agreed ruling</h2>
            <VerdictBadge verdict={changed.verdict} />
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p className="quote">“{changed.quote}”</p>
            <p style={{ margin: 0 }}>{changed.reason}</p>
            <p className="muted small" style={{ margin: 0 }}>
              The quote is checked in code: it must appear verbatim in the text every validator fetched, or the reading is discarded.
            </p>
          </div>
        </section>
      )}
    </div>
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
  const slashed = server.status === "SLASHED";
  const hardFlags = Object.values(server.flags).flat().filter((f) => f.startsWith("H")).length;
  // a full slash splits the bond 50/50 between hunter and pool, so the pool share doubled is what was taken
  const slashedWei = challenges.reduce((sum, c) => sum + (c.verdict === "POISONED" ? BigInt(c.payout?.pool ?? "0") * 2n : 0n), 0n);

  const tabs: TabSpec[] = [];
  if (changed) tabs.push({ id: "changes", label: "What changed", alert: true, count: changed.changed.length, content: <ChangesTab server={server} changed={changed} /> });
  tabs.push({ id: "tools", label: "Pinned tools", count: server.tools.length, content: <ToolsTab server={server} /> });
  tabs.push({
    id: "challenges",
    label: "Challenges",
    count: challenges.length,
    content: challenges.length ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {challenges.map((challenge) => (
          <section key={challenge.cid} className="panel">
            <div className="panel-head">
              <h2 className="mono">{challenge.cid}</h2>
              <span className="badge outline">{challenge.kind.toLowerCase()}</span>
              {challenge.verdict && <VerdictBadge verdict={challenge.verdict} />}
              <span className="muted small" style={{ marginLeft: "auto" }}>
                {challenge.stage.toLowerCase()} · {relativeTime(challenge.updated_at)}
              </span>
            </div>
            <ChallengeTimeline challenge={challenge} />
          </section>
        ))}
      </div>
    ) : (
      <div className="empty">No challenges yet. Anyone can stake on a drift or content challenge.</div>
    ),
  });
  if (server.instructions) {
    tabs.push({
      id: "instructions",
      label: "Server instructions",
      content: (
        <section className="panel">
          <div className="panel-head">
            <h2>Sent to the model on connect, so they are pinned and judged too</h2>
            <Flags flags={instructionFlags} />
          </div>
          <div className="panel-body">
            <pre className="code" style={{ maxHeight: 520, overflow: "auto" }}>
              <Revealed text={server.instructions} />
            </pre>
          </div>
        </section>
      ),
    });
  }
  if (server.txs?.length) {
    tabs.push({
      id: "history",
      label: "Transactions",
      count: server.txs.length + challenges.reduce((sum, c) => sum + (c.txs?.length ?? 0), 0),
      content: (
        <section className="panel scroll">
          <table style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th scope="col">Call</th>
                <th scope="col">Validators</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {[...server.txs.map((t) => ({ ...t, scope: "" })), ...challenges.flatMap((c) => (c.txs ?? []).map((t) => ({ ...t, scope: c.cid })))].map((tx) => (
                <tr key={tx.hash}>
                  <td className="mono">
                    {tx.step}
                    {tx.scope && <span className="muted"> · {tx.scope}</span>}
                  </td>
                  <td>
                    <Votes votes={tx.votes} animate={false} />
                  </td>
                  <td className="mono small">
                    <a href={`${EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
                      {shortHash(tx.hash, 12, 6)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ),
    });
  }

  return (
    <main className="wrap page">
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link href="/">Registry</Link>
        <span aria-hidden="true">/</span>
        <span style={{ color: "var(--ink)" }}>{displayName(server.url)}</span>
      </nav>

      <DataNotice registry={registry} />

      <section className={`server-hero${slashed ? " slashed" : ""}`}>
        <div className="main-col">
          <div className="title-row">
            <h1>{displayName(server.url)}</h1>
            <StatusBadge status={server.status} />
            <span className="badge outline">{server.tier === "BONDED" ? "Bonded" : "Reviewed"}</span>
          </div>
          <span className="url-pill mono">
            <span>{server.url}</span>
            <CopyButton text={server.url} />
          </span>
          <p style={{ margin: "4px 0 0", fontSize: 16 }}>
            <span className="muted">Declared purpose:</span> {server.purpose}
          </p>
          <div className="chips" aria-label="Declared capabilities">
            {server.caps.split(",").map((cap) => (
              <span key={cap} className="chip mono">
                {cap}
              </span>
            ))}
            {hardFlags > 0 && <span className="chip bad">{hardFlags} hard flag{hardFlags > 1 ? "s" : ""} on pinned text</span>}
          </div>
          {slashed && changed?.quote && (
            <p className="quote" style={{ marginTop: 6 }}>
              Slashed for: “{changed.quote}”
            </p>
          )}
        </div>
        <dl className="side-col facts">
          <div>
            <dt>Bond</dt>
            <dd className="num">
              {server.tier === "BONDED" ? `${gen(server.bond)} GEN` : "none"}
              {slashedWei > 0n && <span className="muted"> · {gen(slashedWei)} GEN slashed</span>}
            </dd>
          </div>
          <div>
            <dt>Publisher</dt>
            <dd className="mono">
              <a href={`${EXPLORER}/address/${server.publisher}`} target="_blank" rel="noreferrer">
                {shortAddress(server.publisher)} ↗
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
            <dd className="num" style={{ color: server.slashes ? "var(--bad)" : undefined }}>
              {server.slashes}
            </dd>
          </div>
        </dl>
      </section>

      <div className="split">
        <div className="main">
          <Tabs tabs={tabs} />
        </div>
        <aside className="side">
          <div className="sticky" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <ChallengePanel server={server} challenges={challenges} />
            <section className="panel">
              <div className="panel-head">
                <h2>Guard this server</h2>
              </div>
              <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p className="muted small" style={{ margin: 0 }}>
                  {slashed
                    ? "Guards already block every tool on this server."
                    : "Guards allow these tools only while the live bytes match the pins above."}
                </p>
                <pre className="code" style={{ fontSize: 11.5 }}>
                  {`uvx --from git+https://github.com/0xdopewilly/toolbond \\\n  toolbond-guard ${server.url} \\\n  --pins-url https://toolbond.vercel.app/api/pins`}
                </pre>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}
