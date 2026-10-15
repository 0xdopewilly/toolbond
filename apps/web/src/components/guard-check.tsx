"use client";

import { useState } from "react";
import { ASSURANCE_LABEL, assuranceOf } from "@/lib/assurance";
import { shortHash } from "@/lib/format";

// The guard's client rules (docs/CONTRACT_API.md), run in the browser against the live manifest.
// Approvals reach the browser through this site's /api/pins relay, so the result says where they
// came from; the CLI guard reads the contract itself.
const ALLOWED_STATUSES = new Set(["ACTIVE", "STALE"]);

interface Decision {
  name: string;
  live: string;
  pinned: string;
  verdict: string;
  allowed: boolean;
  why: string;
}

interface Pins {
  known: boolean;
  status?: string;
  tier?: string;
  assurance?: string;
  bond?: string;
  owner_verified?: boolean;
  tools?: Record<string, string>;
  verdicts?: Record<string, string>;
  source?: string;
  authoritative?: boolean;
  as_of?: string;
}

function evaluate(live: { name: string; hash: string }[], pins: Pins, bondedOnly: boolean): Decision[] {
  return live.map(({ name, hash }) => {
    const decision: Decision = { name, live: hash, pinned: "", verdict: "", allowed: false, why: "" };
    if (!pins.known) decision.why = "server is not registered with ToolBond";
    else if (!ALLOWED_STATUSES.has(pins.status ?? "")) decision.why = `server status is ${pins.status}`;
    else if (pins.source !== "contract") decision.why = "approval is a stored snapshot, not a contract read (refused by default)";
    else if (bondedOnly && assuranceOf(pins) !== "BONDED") decision.why = `assurance is ${ASSURANCE_LABEL[assuranceOf(pins)].toLowerCase()}, not bonded (--bonded-only)`;
    else {
      decision.pinned = pins.tools?.[name] ?? "";
      decision.verdict = pins.verdicts?.[name] ?? "";
      if (!decision.pinned) decision.why = "tool is not pinned";
      else if (decision.pinned !== hash) decision.why = "tool changed since it was pinned";
      else if (decision.verdict !== "SAFE") decision.why = `verdict is ${decision.verdict || "missing"}`;
      else {
        decision.allowed = true;
        decision.why = "pinned and judged SAFE";
      }
    }
    return decision;
  });
}

const PRESETS = [
  { label: "DeepWiki", url: "https://mcp.deepwiki.com/mcp" },
  { label: "Rug-pulled demo", url: "https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=2026-10-15T11:40:00Z" },
  { label: "Bonded, updated", url: "https://toolbond-demo-mcp.vercel.app/mcp/update?at=2026-10-15T12:00:00Z" },
  { label: "Unregistered, poisoned", url: "https://toolbond-demo-mcp.vercel.app/mcp/poisoned" },
];

export function GuardCheck() {
  const [url, setUrl] = useState(PRESETS[0].url);
  const [bondedOnly, setBondedOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ decisions: Decision[]; pins: Pins } | null>(null);

  const check = async (target = url) => {
    const clean = target.trim();
    setUrl(clean);
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const [manifest, pins] = await Promise.all([
        fetch(`/api/preview?url=${encodeURIComponent(clean)}`).then((r) => r.json()),
        fetch(`/api/pins?url=${encodeURIComponent(clean)}`).then((r) => r.json()),
      ]);
      if (!manifest.ok) throw new Error(manifest.error || "could not read the manifest");
      setResult({ decisions: evaluate(manifest.tools, pins, bondedOnly), pins });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const allowed = result?.decisions.filter((d) => d.allowed).length ?? 0;
  const blocked = (result?.decisions.length ?? 0) - allowed;

  return (
    <section className="panel raised" aria-labelledby="guard-check-title">
      <div className="panel-head">
        <h2 id="guard-check-title">Run the guard in your browser</h2>
        <span className="muted small">Same rules, same hashes, against the live server right now.</span>
      </div>
      <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <form
          className="actions"
          onSubmit={(event) => {
            event.preventDefault();
            check();
          }}
        >
          <label htmlFor="guard-url" className="sr-only">
            MCP server URL
          </label>
          <input id="guard-url" className="input mono" style={{ flex: "1 1 320px" }} value={url} onChange={(event) => setUrl(event.target.value)} />
          <button type="submit" className="button primary" disabled={loading}>
            {loading ? "Checking…" : "Check"}
          </button>
        </form>
        <div className="actions small muted">
          {PRESETS.map((preset) => (
            <button key={preset.url} type="button" className="linklike" onClick={() => check(preset.url)}>
              {preset.label}
            </button>
          ))}
          <label style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={bondedOnly} onChange={(event) => setBondedOnly(event.target.checked)} />
            <span className="mono">--bonded-only</span>
          </label>
        </div>
      </div>
      {error && (
        <div className="verdict-banner bad">
          <strong>Unreachable</strong>
          <span>{error}</span>
        </div>
      )}
      {result && (
        <>
          <div className={`verdict-banner ${blocked ? "bad" : "good"}`}>
            <strong>{blocked ? (allowed ? `${blocked} blocked, ${allowed} allowed` : "Every tool blocked") : "Every tool allowed"}</strong>
            <span>
              {result.pins.known
                ? `${result.pins.status?.toLowerCase()} · ${ASSURANCE_LABEL[assuranceOf(result.pins)].toLowerCase()}${result.pins.owner_verified ? " · owner verified" : ""}`
                : "not registered"}
              {result.pins.source === "contract" ? " · contract read, relayed by this site" : " · stored snapshot, not authoritative"}
            </span>
          </div>
          <div>
            {result.decisions.map((decision, index) => (
              <div key={decision.name} className="decision" style={{ animationDelay: `${index * 40}ms` }}>
                <span className={`badge ${decision.allowed ? "good" : "bad"}`}>{decision.allowed ? "allow" : "block"}</span>
                <strong className="mono">{decision.name}</strong>
                <span className="mono muted small" title={`live ${decision.live}`}>
                  {shortHash(decision.live, 8, 4)}
                </span>
                <span className="why">{decision.why}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
