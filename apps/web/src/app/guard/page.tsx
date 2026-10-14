export default function GuardPage() {
  const install =
    "claude mcp add weather -- uvx --from git+https://github.com/0xdopewilly/toolbond \\\n" +
    "    toolbond-guard https://weather.example.com/mcp --pins-url https://<this-site>/api/pins";
  const cursor = JSON.stringify(
    {
      mcpServers: {
        weather: {
          command: "uvx",
          args: [
            "--from",
            "git+https://github.com/0xdopewilly/toolbond",
            "toolbond-guard",
            "https://weather.example.com/mcp",
            "--pins-url",
            "https://<this-site>/api/pins",
          ],
        },
      },
    },
    null,
    2,
  );

  return (
    <main className="wrap page">
      <div className="split" style={{ alignItems: "center" }}>
        <section className="main">
          <span className="kicker muted">MCP-GUARD</span>
          <h1>Your agent never reads the poisoned text.</h1>
          <ol className="steps">
            <li>
              <span className="mono muted">01</span>
              <span>The guard sits between your editor and the MCP server.</span>
            </li>
            <li>
              <span className="mono muted">02</span>
              <span>It hashes every tool the server sends with the same canonical form GenLayer validators use.</span>
            </li>
            <li>
              <span className="mono muted">03</span>
              <span>
                Anything not pinned and judged SAFE is dropped before the model sees it, and a tool that changes mid-session
                disappears at once. The publisher&apos;s bond pays for the clean-up.
              </span>
            </li>
          </ol>
        </section>
        <section className="side">
          <pre className="terminal" aria-label="Example session">
            <span className="dim">&gt;</span> What&apos;s the weather in Lisbon tomorrow?{"\n"}
            {"  "}weather.get_forecast {"{ city: \"Lisbon\" }"}{"\n"}
            {"  "}
            <span style={{ color: "#7cc39a" }}>✓ pinned</span> <span className="dim">sha256 99224815…</span>
            {"\n\n"}
            <span className="dim">  … the publisher edits the tool upstream …</span>
            {"\n\n"}
            {"  "}toolbond-guard tools changed upstream{"\n"}
            {"  "}
            <span style={{ color: "#f2877b" }}>✗ get_forecast blocked</span>
            {"\n"}
            <span className="dim">{"    "}tool changed since it was pinned</span>
          </pre>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Claude Code</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            Needs <span className="mono">uv</span> (Python 3.10+). No other dependencies.
          </span>
        </div>
        <pre className="code" style={{ margin: 18 }}>
          {install}
        </pre>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Cursor</h2>
          <span className="muted mono" style={{ fontSize: 12 }}>
            ~/.cursor/mcp.json
          </span>
        </div>
        <pre className="code" style={{ margin: 18 }}>
          {cursor}
        </pre>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Options</h2>
        </div>
        <dl className="facts" style={{ padding: 18 }}>
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
        </dl>
      </section>
    </main>
  );
}
