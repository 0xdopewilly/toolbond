import type { Metadata } from "next";
import { CopyButton } from "@/components/copy-button";
import { GuardCheck } from "@/components/guard-check";
import { Reveal } from "@/components/motion";

export const metadata: Metadata = { title: "Guard" };

const SITE = "https://toolbond.vercel.app";
const INSTALL =
  "claude mcp add weather -- uvx --from git+https://github.com/0xdopewilly/toolbond \\\n" +
  `    toolbond-guard https://weather.example.com/mcp --pins-url ${SITE}/api/pins`;
const CURSOR = JSON.stringify(
  {
    mcpServers: {
      weather: {
        command: "uvx",
        args: ["--from", "git+https://github.com/0xdopewilly/toolbond", "toolbond-guard", "https://weather.example.com/mcp", "--pins-url", `${SITE}/api/pins`],
      },
    },
  },
  null,
  2,
);

const SESSION: { text: string; tone?: "dim" | "ok" | "no" }[] = [
  { text: "> What's the weather in Lisbon tomorrow?" },
  { text: "  weather.get_forecast { city: \"Lisbon\" }" },
  { text: "  ✓ pinned  sha256 fae70b2b…8cbe  SAFE", tone: "ok" },
  { text: "" },
  { text: "  … 08:14 UTC, the publisher swaps the tool upstream …", tone: "dim" },
  { text: "" },
  { text: "  [toolbond-guard] tools changed upstream", tone: "dim" },
  { text: "  ✗ get_forecast blocked", tone: "no" },
  { text: "    tool changed since it was pinned (live 174e85b4…)", tone: "dim" },
  { text: "  ✓ drift challenge c2 → POISONED → bond slashed", tone: "ok" },
];

export default function GuardPage() {
  return (
    <main className="wrap page">
      <section className="guard-hero">
        <div>
          <span className="overline" style={{ color: "var(--night-accent)" }}>
            toolbond-guard
          </span>
          <h1>Your agent never reads the poisoned text.</h1>
          <p>A local MCP proxy. One line of config, no other dependencies.</p>
          <ol className="steps">
            <li>
              <span className="mono">01</span>
              <span>It sits between your editor and the MCP server.</span>
            </li>
            <li>
              <span className="mono">02</span>
              <span>It hashes every tool the server sends with the same canonical form GenLayer validators use.</span>
            </li>
            <li>
              <span className="mono">03</span>
              <span>
                Anything not pinned and judged SAFE is dropped before the model sees it. A tool that changes mid-session disappears at once, and
                calls are re-checked at call time.
              </span>
            </li>
          </ol>
        </div>
        <div>
          <div className="terminal" aria-label="Example session">
            <div className="terminal-bar">
              <i />
              <i />
              <i />
              <span>claude · weather via toolbond-guard</span>
            </div>
            <pre>
              {SESSION.map((line, index) => (
                <span key={index} className={`line ${line.tone ?? ""}`} style={{ animationDelay: `${300 + index * 260}ms` }}>
                  {line.text || " "}
                </span>
              ))}
              <span className="line" style={{ animationDelay: `${300 + SESSION.length * 260}ms` }}>
                {"> "}
                <span className="cursor" />
              </span>
            </pre>
          </div>
        </div>
      </section>

      <Reveal>
        <GuardCheck />
      </Reveal>

      <div className="split">
        <div className="main">
          <Reveal>
            <section className="panel">
              <div className="panel-head">
                <h2>Claude Code</h2>
                <span className="muted small">
                  Needs <span className="mono">uv</span> (Python 3.10+).
                </span>
              </div>
              <div className="panel-body code-block">
                <pre className="code">{INSTALL}</pre>
                <CopyButton text={INSTALL} />
              </div>
            </section>
          </Reveal>
          <Reveal delay={80}>
            <section className="panel">
              <div className="panel-head">
                <h2>Cursor</h2>
                <span className="muted mono small">~/.cursor/mcp.json</span>
              </div>
              <div className="panel-body code-block">
                <pre className="code">{CURSOR}</pre>
                <CopyButton text={CURSOR} />
              </div>
            </section>
          </Reveal>
        </div>
        <aside className="side">
          <Reveal delay={120}>
            <section className="panel">
              <div className="panel-head">
                <h2>Options</h2>
              </div>
              <dl className="facts" style={{ padding: 18, gridTemplateColumns: "1fr" }}>
                <div>
                  <dt className="mono">--pins-url</dt>
                  <dd>Endpoint returning the contract&apos;s get_pins JSON. This site serves one at /api/pins.</dd>
                </div>
                <div>
                  <dt className="mono">--pins-file</dt>
                  <dd>Offline pins, for air-gapped setups and demos.</dd>
                </div>
                <div>
                  <dt className="mono">--bonded-only</dt>
                  <dd>Only allow servers whose publisher posted a bond.</dd>
                </div>
                <div>
                  <dt className="mono">--poll</dt>
                  <dd>Seconds between manifest checks (default 30). Changes trigger a tool-list refresh in your editor.</dd>
                </div>
                <div>
                  <dt className="mono">toolbond_status</dt>
                  <dd>A tool the guard adds so you can ask your agent what is allowed or blocked, and why.</dd>
                </div>
              </dl>
            </section>
          </Reveal>
        </aside>
      </div>
    </main>
  );
}
