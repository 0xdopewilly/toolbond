import Link from "next/link";
import { Hero } from "@/components/hero";
import { LedgerTicker } from "@/components/ledger-ticker";
import { CountUp, Reveal, RevealWords } from "@/components/motion";
import { RegistryList } from "@/components/registry-list";
import { DataNotice } from "@/components/ui";
import { loadRegistry } from "@/lib/data";
import { EXPLORER, gen, shortHash } from "@/lib/format";
import { displayName } from "@/lib/names";
import { toRow } from "@/lib/rows";
import type { Challenge, Registry, Server } from "@/lib/types";

export const revalidate = 30;

const FLOW = [
  {
    title: "Bond",
    body: "A publisher registers the endpoint, declares its purpose and locks at least 10 GEN behind it.",
    foot: "register(url, purpose, caps)",
    glyph: <path d="M5 9V7a5 5 0 0110 0v2M4 9h12v8H4z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />,
  },
  {
    title: "Pin",
    body: "Every validator fetches tools/list itself and must derive the same SHA-256 root, byte for byte.",
    foot: "snapshot(sid) → root",
    glyph: <path d="M7 3v14M13 3v14M3 7h14M3 13h14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  },
  {
    title: "Judge",
    body: "Each validator reads the tools twice. Only an agreed SAFE pins the server, and quotes must exist verbatim.",
    foot: "review(sid) → SAFE · UNCLEAR · POISONED",
    glyph: <path d="M10 3v14M4 6h12M4 6l-2 6h4zM16 6l-2 6h4zM7 17h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />,
  },
  {
    title: "Patrol",
    body: "Guards block anything off-pin. Hunters stake on drift or poison, and validators settle. The bond pays out.",
    foot: "challenge → observe → judge → settle",
    glyph: <path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z M7 10l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />,
  },
];

function ruling(challenge: Challenge, servers: Server[]) {
  const server = servers.find((item) => item.sid === challenge.sid);
  const name = server ? displayName(server.url) : challenge.sid;
  if (challenge.verdict === "POISONED")
    return { kicker: "SLASHED", tone: "bad", name, text: challenge.quote ? `“${challenge.quote}”` : challenge.reason };
  if (challenge.drift === "MATCH") return { kicker: "MATCH", tone: "good", name, text: "Every validator re-fetched the server: still the pinned bytes." };
  if (challenge.drift) return { kicker: challenge.drift, tone: "warn", name, text: challenge.reason || "The manifest no longer matches its pin." };
  return { kicker: challenge.stage, tone: "warn", name, text: `${challenge.kind.toLowerCase()} challenge` };
}

function clock(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(11, 16);
}

/** The rug pull, told from the contract's own records. */
function Story({ registry }: { registry: Registry }) {
  const slash = registry.challenges.find((c) => c.verdict === "POISONED" && c.kind === "DRIFT");
  if (!slash) return null;
  const server = registry.servers.find((s) => s.sid === slash.sid);
  if (!server) return null;
  const tx = (step: string) => slash.txs?.find((t) => t.step === step)?.hash;
  const review = server.txs?.find((t) => t.step === "review")?.hash;
  // the demo server's URL carries the moment it turns malicious (?at=...)
  const swapAt = (() => {
    try {
      return new URL(server.url).searchParams.get("at") ?? slash.filed_at;
    } catch {
      return slash.filed_at;
    }
  })();
  const seconds = Math.round((Date.parse(slash.updated_at) - Date.parse(swapAt)) / 1000);
  const steps = [
    { time: clock(server.created_at), tone: "good", title: "Bonded and pinned", body: `10 GEN bond. Validators pinned get_forecast and judged it SAFE.`, hash: review },
    { time: clock(swapAt), tone: "warn", title: "The publisher swaps the tool", body: "Same URL, same name. The description now asks for ~/.cursor/mcp.json and hides it from the user." },
    { time: clock(swapAt), tone: "good", title: "The guard blocks it", body: "toolbond-guard hashes the live tool, sees it is off-pin, and drops it before the model reads a word." },
    { time: clock(slash.filed_at), tone: "warn", title: "A patrol bot stakes 0.5 GEN", body: "Drift challenge filed automatically.", hash: tx("challenge") },
    { time: "", tone: "bad", title: "Validators observe DIFFERS, then judge POISONED", body: slash.reason, hash: tx("judge") },
    { time: clock(slash.updated_at), tone: "bad", title: `Bond slashed: ${gen(slash.payout.hunter ?? "0")} GEN to the hunter`, body: `${gen(slash.payout.pool ?? "0")} GEN to the protection pool. The server is marked SLASHED for every guard.`, hash: tx("settle") },
  ];
  return (
    <section className="section" aria-labelledby="story-title">
      <div className="wrap">
        <Reveal>
          <div className="story">
            <div>
              <span className="overline">
                Live on Studio Next · {new Date(swapAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
              </span>
              <h2 id="story-title" className="display">
                A rug pull, caught and paid for in {seconds > 0 && seconds < 600 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : "minutes"}.
              </h2>
              <p style={{ fontSize: 15, maxWidth: 460 }}>
                We bonded a weather server, then made it turn malicious on a timer. Nobody touched anything after that. Every step on the
                right is a real transaction decided by five validators.
              </p>
              <div className="actions" style={{ marginTop: 18 }}>
                <Link className="button on-dark" href={`/server/${server.sid}#changes`}>
                  See the diff validators saw <span className="arrow">→</span>
                </Link>
              </div>
            </div>
            <ol className="story-steps">
              {steps.map((step, index) => (
                <li key={index} className={step.tone}>
                  <time>{step.time}</time>
                  <span className="body">
                    <strong>{step.title}</strong>
                    <span>{step.body}</span>
                    {step.hash && (
                      <a className="mono small" href={`${EXPLORER}/tx/${step.hash}`} target="_blank" rel="noreferrer">
                        {shortHash(step.hash, 10, 4)} ↗
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const registry = await loadRegistry();
  const toolCount = registry.servers.reduce((sum, server) => sum + server.tools.length, 0);
  const slashedGen = registry.challenges.reduce(
    (sum, c) => sum + (c.verdict === "POISONED" ? BigInt(c.payout?.pool ?? "0") * 2n : 0n),
    0n,
  );

  return (
    <main>
      <Hero servers={registry.stats.servers} tools={toolCount} />

      <div className="wrap">
        <section className="stats-strip" aria-label="Registry totals">
          <div className="stat">
            <span className="label">Servers in the registry</span>
            <span className="value">
              <CountUp value={registry.stats.servers} />
            </span>
            <span className="sub">{registry.stats.active} pinned and active</span>
          </div>
          <div className="stat">
            <span className="label">Tools pinned by hash</span>
            <span className="value">
              <CountUp value={toolCount} />
            </span>
            <span className="sub">TBCM-1, agreed by validators</span>
          </div>
          <div className="stat">
            <span className="label">Validator checks</span>
            <span className="value">
              <CountUp value={registry.stats.checks + registry.stats.challenges} />
            </span>
            <span className="sub">re-fetches and challenges</span>
          </div>
          <div className={`stat${registry.stats.slashes ? " bad" : ""}`}>
            <span className="label">Bonds slashed</span>
            <span className="value">
              <CountUp value={registry.stats.slashes} />
            </span>
            <span className="sub">{slashedGen ? `${gen(slashedGen)} GEN taken from publishers` : "none yet"}</span>
          </div>
          <div className="stat">
            <span className="label">Protection pool</span>
            <span className="value">
              <CountUp value={Number(gen(registry.stats.pool))} decimals={Number(gen(registry.stats.pool)) % 1 ? 2 : 0} />
              <small>GEN</small>
            </span>
            <span className="sub">{gen(registry.stats.bonded)} GEN currently bonded</span>
          </div>
        </section>
        <LedgerTicker registry={registry} />
        {!registry.live && (
          <div style={{ marginTop: 16 }}>
            <DataNotice registry={registry} />
          </div>
        )}
      </div>

      <section className="section" aria-labelledby="flow-title">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="overline">How it works</span>
              <RevealWords id="flow-title" text="Tool descriptions are prompts. So we put money behind them." />
              <p>
                An MCP tool&apos;s description goes straight into your model&apos;s context. ToolBond makes the exact bytes accountable,
                with no oracle and no trusted reviewer: just validators who each fetch, hash and judge for themselves.
              </p>
            </div>
          </div>
          <div className="flow">
            {FLOW.map((item, index) => (
              <Reveal key={item.title} delay={index * 90}>
                <article className="flow-card" data-spotlight>
                  <span className="step-no">0{index + 1}</span>
                  <span className="glyph" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 20 20">
                      {item.glyph}
                    </svg>
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <span className="foot">{item.foot}</span>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <Story registry={registry} />

      <section className="section" aria-labelledby="registry-title" id="registry">
        <div className="wrap">
          <div className="section-head">
            <div>
              <span className="overline">Registry</span>
              <RevealWords id="registry-title" text="Every server, every pin" />
              <p>Reviewed servers are pinned and judged but carry no bond. Bonded servers can be challenged and slashed.</p>
            </div>
            <div className="actions">
              <Link className="button" href="/challenges">
                Challenges
              </Link>
              <Link className="button primary" href="/publish">
                Publish a server <span className="arrow">→</span>
              </Link>
            </div>
          </div>
          <div className="split">
            <div className="main">
              <RegistryList servers={registry.servers.map(toRow)} />
            </div>
            <aside className="side">
              <section className="panel sticky" aria-labelledby="rulings-title">
                <div className="panel-head" style={{ justifyContent: "space-between" }}>
                  <h2 id="rulings-title">Recent rulings</h2>
                  <Link href="/challenges" className="small" style={{ color: "var(--accent)" }}>
                    All challenges →
                  </Link>
                </div>
                <ol className="feed">
                  {registry.challenges.slice(0, 4).map((challenge) => {
                    const item = ruling(challenge, registry.servers);
                    return (
                      <li key={challenge.cid}>
                        <span className="small">
                          <span className={`kicker ${item.tone}`}>{item.kicker}</span> <span className="muted">{item.name}</span>
                        </span>
                        <Link href={`/server/${challenge.sid}`} style={{ fontSize: 13 }}>
                          {item.text}
                        </Link>
                      </li>
                    );
                  })}
                  {registry.servers
                    .filter((server) => server.status === "ACTIVE")
                    .slice(0, 3)
                    .map((server) => (
                      <li key={server.sid}>
                        <span className="small">
                          <span className="kicker good">PINNED</span> <span className="muted">{displayName(server.url)}</span>
                        </span>
                        <span style={{ fontSize: 13 }}>{server.tools.length} tools judged SAFE by validator consensus</span>
                        <span className="mono muted small">{shortHash(server.root)}</span>
                      </li>
                    ))}
                </ol>
              </section>
            </aside>
          </div>
        </div>
      </section>

      <section className="section" aria-label="Get started">
        <div className="wrap">
          <Reveal>
            <div className="cta-band">
              <div>
                <h2>Put a guard in front of every MCP server.</h2>
                <p>One line in Claude Code or Cursor. Tools that are off-pin, unjudged or slashed never reach the model.</p>
              </div>
              <div className="actions">
                <Link className="button" href="/hunters">
                  Become a hunter
                </Link>
                <Link className="button primary" href="/guard">
                  Install the guard <span className="arrow">→</span>
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
