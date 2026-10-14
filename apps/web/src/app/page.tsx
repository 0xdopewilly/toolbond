import Link from "next/link";
import { DataNotice, StatusBadge } from "@/components/ui";
import { loadRegistry } from "@/lib/data";
import { gen, hostPath, relativeTime, shortHash } from "@/lib/format";
import type { Challenge, Server } from "@/lib/types";

export const revalidate = 30;

const FILTERS = [
  { key: "all", label: "All" },
  { key: "bonded", label: "Bonded" },
  { key: "reviewed", label: "Reviewed" },
  { key: "stale", label: "Stale" },
  { key: "slashed", label: "Slashed" },
];

function matches(server: Server, state: string, query: string): boolean {
  const byState =
    state === "all" ||
    (state === "bonded" && server.tier === "BONDED") ||
    (state === "reviewed" && server.tier === "REVIEWED") ||
    (state === "stale" && server.status === "STALE") ||
    (state === "slashed" && server.status === "SLASHED");
  const needle = query.trim().toLowerCase();
  const byQuery =
    !needle || server.url.toLowerCase().includes(needle) || server.tools.some((tool) => tool.name.toLowerCase().includes(needle));
  return byState && byQuery;
}

function displayName(server: Server): string {
  const host = new URL(server.url).hostname.replace(/^(mcp|docs\.mcp|www)\./, "");
  const path = new URL(server.url).pathname.replace(/\/mcp$/, "").replace(/^\//, "");
  return path ? `${host} · ${path}` : host;
}

function ruling(challenge: Challenge, servers: Server[]) {
  const server = servers.find((item) => item.sid === challenge.sid);
  const name = server ? displayName(server) : challenge.sid;
  if (challenge.verdict === "POISONED") return { kicker: "POISONED", tone: "bad", name, text: challenge.quote || challenge.reason };
  if (challenge.drift === "MATCH") return { kicker: "MATCH", tone: "good", name, text: "Every validator re-fetched the server: still the pinned bytes." };
  if (challenge.drift) return { kicker: challenge.drift, tone: "warn", name, text: challenge.reason || "Manifest no longer matches its pin." };
  return { kicker: challenge.stage, tone: "warn", name, text: `${challenge.kind} challenge` };
}

export default async function RegistryPage({ searchParams }: { searchParams: Promise<{ state?: string; q?: string }> }) {
  const { state = "all", q = "" } = await searchParams;
  const registry = await loadRegistry();
  const servers = registry.servers.filter((server) => matches(server, state, q));
  const toolCount = registry.servers.reduce((sum, server) => sum + server.tools.length, 0);

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <h1>Registry</h1>
          <p className="lede">
            MCP servers whose tool manifests are pinned by GenLayer validators. Each validator fetches the server itself and
            must derive the same hashes. A bonded publisher loses the bond if a pinned tool turns out to be poisoned, or
            changes without notice.
          </p>
        </div>
        <div className="actions">
          <Link className="button" href="/guard">
            Install the guard
          </Link>
          <a className="button primary" href="https://github.com/0xdopewilly/toolbond#publish-a-server" target="_blank" rel="noreferrer">
            Publish a server
          </a>
        </div>
      </div>

      <DataNotice registry={registry} />

      <section className="panel totals" aria-label="Totals">
        <div>
          <span className="label">Servers pinned</span>
          <span className="value num">{registry.stats.servers}</span>
        </div>
        <div>
          <span className="label">Tools pinned</span>
          <span className="value num">{toolCount}</span>
        </div>
        <div>
          <span className="label">GEN bonded</span>
          <span className="value num">{gen(registry.stats.bonded)}</span>
        </div>
        <div>
          <span className="label">Slashes</span>
          <span className="value num" style={{ color: registry.stats.slashes ? "var(--bad)" : undefined }}>
            {registry.stats.slashes}
          </span>
        </div>
      </section>

      <div className="split">
        <section className="main" aria-label="Servers">
          <form className="actions" role="search" action="/">
            <label htmlFor="q" className="muted" style={{ position: "absolute", left: -9999 }}>
              Search servers
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search by server, URL or tool"
              className="button"
              style={{ flex: "1 1 280px", fontWeight: 400 }}
            />
            {state !== "all" && <input type="hidden" name="state" value={state} />}
            <div className="actions" role="group" aria-label="Filter by state">
              {FILTERS.map((filter) => (
                <Link
                  key={filter.key}
                  href={{ pathname: "/", query: { ...(q ? { q } : {}), ...(filter.key === "all" ? {} : { state: filter.key }) } }}
                  className={`button${state === filter.key ? " primary" : ""}`}
                  aria-current={state === filter.key ? "true" : undefined}
                  style={{ minHeight: 34, fontSize: 13 }}
                >
                  {filter.label}
                </Link>
              ))}
            </div>
          </form>

          <div className="panel scroll">
            <table style={{ minWidth: 780 }}>
              <thead>
                <tr>
                  <th scope="col">Server</th>
                  <th scope="col">State</th>
                  <th scope="col">Tier</th>
                  <th scope="col" style={{ textAlign: "right" }}>
                    Tools
                  </th>
                  <th scope="col">Pinned root</th>
                  <th scope="col">Last verified</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.sid}>
                    <td>
                      <Link className="cell-server" href={`/server/${server.sid}`}>
                        <span className="name">{displayName(server)}</span>
                        <span className="mono muted" style={{ fontSize: 12 }}>
                          {hostPath(server.url)}
                        </span>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={server.status} />
                    </td>
                    <td>{server.tier === "BONDED" ? `Bonded · ${gen(server.bond)} GEN` : "Reviewed"}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {server.tools.length}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {shortHash(server.root)}
                    </td>
                    <td className="muted">{relativeTime(server.last_verified_at)}</td>
                  </tr>
                ))}
                {servers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No servers match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            Reviewed servers are pinned and checked but carry no bond. Bonded servers can be challenged and slashed.
          </p>
        </section>

        <aside className="side panel" aria-label="Recent rulings">
          <div className="panel-head" style={{ justifyContent: "space-between" }}>
            <h2>Recent rulings</h2>
            <Link href="/challenges" style={{ fontSize: 12, color: "var(--accent)" }}>
              All challenges
            </Link>
          </div>
          <ol className="feed">
            {registry.challenges.slice(0, 5).map((challenge) => {
              const item = ruling(challenge, registry.servers);
              return (
                <li key={challenge.cid}>
                  <span style={{ fontSize: 12 }}>
                    <span className={`kicker ${item.tone}`}>{item.kicker}</span> <span className="muted">{item.name}</span>
                  </span>
                  <span style={{ fontSize: 13 }}>{item.text}</span>
                </li>
              );
            })}
            {registry.servers
              .filter((server) => server.status === "ACTIVE")
              .slice(0, 3)
              .map((server) => (
                <li key={server.sid}>
                  <span style={{ fontSize: 12 }}>
                    <span className="kicker good">PINNED</span> <span className="muted">{displayName(server)}</span>
                  </span>
                  <span style={{ fontSize: 13 }}>{server.tools.length} tools judged SAFE by validator consensus</span>
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {shortHash(server.root)}
                  </span>
                </li>
              ))}
          </ol>
        </aside>
      </div>
    </main>
  );
}
