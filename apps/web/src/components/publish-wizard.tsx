"use client";

import Link from "next/link";
import { useState } from "react";
import { sidOf, type TxInfo } from "@/lib/client";
import { revealSegments, shortHash } from "@/lib/format";
import { urlProblem } from "@/lib/names";
import { useTxs, useWallet, Votes } from "./providers";

interface PreviewTool {
  name: string;
  hash: string;
  canon: string;
  description: string;
  hidden: boolean;
}

interface Preview {
  ok: boolean;
  url: string;
  error?: string;
  protocol?: string;
  root?: string;
  instructions?: string;
  tools?: PreviewTool[];
}

type RunState = "idle" | "active" | "ok" | "err";

interface RunStep {
  key: string;
  title: string;
  detail: string;
  state: RunState;
  votes?: string[];
}

const CAPS = ["network", "filesystem", "credentials", "shell", "payments", "none"];
const STEPS = ["Endpoint", "Terms", "Publish"];
const REVIEW_BATCH = 6;
const EXAMPLES = [
  { label: "Demo weather server (honest)", url: "https://toolbond-demo-mcp.vercel.app/mcp/honest" },
  { label: "Demo weather server (poisoned)", url: "https://toolbond-demo-mcp.vercel.app/mcp/poisoned" },
];

function pretty(canon: string): string {
  try {
    return JSON.stringify(JSON.parse(canon), null, 2);
  } catch {
    return canon;
  }
}

function output(info: TxInfo | null): Record<string, unknown> | null {
  const first = info?.outputs?.find((item) => item && item.ok);
  return first && first.ok && first.value && typeof first.value === "object" ? (first.value as Record<string, unknown>) : null;
}

export function PublishWizard() {
  const wallet = useWallet();
  const { run } = useTxs();
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [known, setKnown] = useState<{ sid: string; status: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [caps, setCaps] = useState<string[]>(["network"]);
  const [tier, setTier] = useState<"BONDED" | "REVIEWED">("BONDED");
  const [bond, setBond] = useState("10");
  const [runSteps, setRunSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState<{ sid: string; verdict: string } | null>(null);

  const problem = urlProblem(url);
  const bondNumber = Number(bond);
  const bondOk = tier === "REVIEWED" || (Number.isFinite(bondNumber) && bondNumber >= 10);
  const purposeOk = purpose.trim().length > 0 && purpose.trim().length <= 280;
  const total = tier === "BONDED" ? (bondOk ? bondNumber + 0.2 : 0) : 0.2;

  const loadPreview = async (target = url) => {
    const clean = target.trim();
    setUrl(clean);
    if (urlProblem(clean)) return;
    setLoading(true);
    setPreview(null);
    setKnown(null);
    try {
      const [manifest, pins] = await Promise.all([
        fetch(`/api/preview?url=${encodeURIComponent(clean)}`).then((r) => r.json() as Promise<Preview>),
        fetch(`/api/pins?url=${encodeURIComponent(clean)}`).then((r) => r.json() as Promise<{ known?: boolean; sid?: string; status?: string }>),
      ]);
      setPreview(manifest);
      if (pins.known && pins.sid) setKnown({ sid: pins.sid, status: pins.status ?? "" });
    } catch (error) {
      setPreview({ ok: false, url: clean, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  const toggleCap = (cap: string) =>
    setCaps((current) => {
      if (cap === "none") return ["none"];
      const next = current.filter((item) => item !== "none");
      return next.includes(cap) ? next.filter((item) => item !== cap) : [...next, cap];
    });

  const patch = (key: string, change: Partial<RunStep>) =>
    setRunSteps((current) => current.map((item) => (item.key === key ? { ...item, ...change } : item)));

  const publish = async () => {
    if (!wallet.mode || !preview?.tools) return;
    const clean = url.trim();
    const sid = await sidOf(clean);
    const batches = Math.max(1, Math.ceil(preview.tools.length / REVIEW_BATCH));
    const plan: RunStep[] = [
      {
        key: "open",
        title: tier === "BONDED" ? `Register and bond ${bondNumber} GEN` : "Sponsor a review",
        detail: tier === "BONDED" ? `${total} GEN: the bond plus a 0.2 GEN review fee.` : "0.2 GEN review fee. No bond, never slashed.",
        state: "idle",
      },
      { key: "snapshot", title: "Pin the manifest", detail: "Every validator fetches tools/list itself and must derive the same root.", state: "idle" },
      ...Array.from({ length: batches }, (_, index) => ({
        key: `review-${index}`,
        title: batches > 1 ? `Judge tools, batch ${index + 1} of ${batches}` : "Judge the tools",
        detail: "Two independent readings per validator. Only SAFE pins a server.",
        state: "idle" as RunState,
      })),
    ];
    setRunSteps(plan);
    setRunning(true);
    setFinished(null);

    const go = async (key: string, label: string, method: string, args: (string | number)[], value = "0") => {
      patch(key, { state: "active" });
      const info = await run(label, method, args, value);
      patch(key, { votes: info?.votes });
      return info;
    };

    try {
      const opened = await go("open", plan[0].title, tier === "BONDED" ? "register" : "sponsor_review", [clean, purpose.trim(), caps.join(",")], tier === "BONDED" ? String(total) : "0.2");
      const result = opened?.returned?.ok ? (opened.returned.value as { ok?: boolean; error?: string } | null) : null;
      if (!opened?.success || !result?.ok) {
        patch("open", { state: "err", detail: result?.error || opened?.returned?.error || opened?.status || "The transaction did not go through." });
        return;
      }
      patch("open", { state: "ok", detail: `Server id ${sid}. Refusals are refunded to your claimable balance.` });

      const pinned = await go("snapshot", "Pin the manifest", "snapshot", [sid]);
      if (!pinned?.success) {
        patch("snapshot", { state: "err", detail: pinned?.returned?.error || pinned?.status || "Validators could not agree on the manifest." });
        return;
      }
      const digest = output(pinned)?.digest as { root?: string } | undefined;
      patch("snapshot", { state: "ok", detail: digest?.root ? `Agreed root ${shortHash(digest.root, 10, 6)}` : "Manifest pinned." });

      let verdict = "SAFE";
      for (let index = 0; index < batches; index += 1) {
        const key = `review-${index}`;
        const judged = await go(key, plan[2 + index].title, "review", [sid]);
        if (!judged?.success) {
          patch(key, { state: "err", detail: judged?.returned?.error || judged?.status || "Review failed. You can re-run it from the server page." });
          return;
        }
        const out = output(judged) as { verdict?: string; reason?: string } | null;
        if (out?.verdict && out.verdict !== "SAFE") verdict = out.verdict;
        patch(key, { state: out?.verdict === "POISONED" ? "err" : "ok", detail: out?.verdict ? `${out.verdict}. ${out.reason ?? ""}` : "Judged." });
        if (out?.verdict === "POISONED") break;
      }
      setFinished({ sid, verdict });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="wizard">
      <ol className="wizard-steps" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "current" : index < step ? "done" : ""} aria-current={index === step ? "step" : undefined}>
            <span className="no">{index < step ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="wizard-body">
        {step === 0 && (
          <div className="wizard-card" key="s0">
            <div>
              <h2>Which MCP endpoint?</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                We fetch it the way validators will: initialize, then tools/list, hashed with TBCM-1. Nothing is written yet.
              </p>
            </div>
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();
                loadPreview();
              }}
            >
              <div className="field">
                <label htmlFor="publish-url">Streamable HTTP endpoint</label>
                <input
                  id="publish-url"
                  className="input mono"
                  placeholder="https://mcp.example.com/mcp"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  aria-invalid={Boolean(url) && Boolean(problem)}
                />
              </div>
              <button type="submit" className="button primary" disabled={Boolean(problem) || loading}>
                {loading ? "Fetching…" : "Preview manifest"}
              </button>
            </form>
            {url && problem && <p className="small" style={{ margin: 0, color: "var(--bad)" }}>{problem}</p>}
            <div className="actions small muted">
              Try:
              {EXAMPLES.map((example) => (
                <button key={example.url} type="button" className="linklike" onClick={() => loadPreview(example.url)}>
                  {example.label}
                </button>
              ))}
            </div>

            {preview && !preview.ok && (
              <p className="notice" role="alert">
                <strong>Could not read the manifest.</strong>
                <span>{preview.error}</span>
              </p>
            )}

            {preview?.ok && preview.tools && (
              <>
                <div className="preview-root mono">
                  <span>
                    <span className="muted">root</span> {shortHash(preview.root ?? "", 12, 8)}
                  </span>
                  <span>
                    <span className="muted">protocol</span> {preview.protocol || "—"}
                  </span>
                  <span>
                    <span className="muted">tools</span> {preview.tools.length}
                  </span>
                  {preview.instructions ? (
                    <span>
                      <span className="muted">instructions</span> {preview.instructions.length} chars
                    </span>
                  ) : null}
                </div>
                {preview.tools.some((tool) => tool.hidden) && (
                  <p className="notice" role="alert" style={{ borderLeftColor: "var(--bad)" }}>
                    <strong>Hidden characters found.</strong>
                    <span>Validators will see them decoded, and they trip a hard flag that blocks a SAFE verdict.</span>
                  </p>
                )}
                <div className="preview-tools">
                  {preview.tools.map((tool) => (
                    <details key={tool.name} className="tool">
                      <summary>
                        <svg className="caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M4 2.5L7.5 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                        <strong className="mono">{tool.name}</strong>
                        {tool.hidden && <span className="chip bad mono">H1</span>}
                        <span className="hash">{shortHash(tool.hash, 10, 6)}</span>
                      </summary>
                      <div className="tool-body">
                        <pre className="code">
                          {revealSegments(pretty(tool.canon)).map((segment, index) =>
                            segment.hidden ? (
                              <span key={index} className="hidden-char">
                                {segment.text}
                              </span>
                            ) : (
                              <span key={index}>{segment.text}</span>
                            ),
                          )}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
                {known ? (
                  <p className="notice">
                    <strong>Already in the registry.</strong>
                    <span>
                      This exact URL is registered ({known.status.toLowerCase()}).{" "}
                      <Link href={`/server/${known.sid}`} style={{ color: "var(--accent)" }}>
                        Open its page
                      </Link>
                    </span>
                  </p>
                ) : (
                  <div className="actions" style={{ justifyContent: "flex-end" }}>
                    <button type="button" className="button primary" disabled={!preview.tools.length} onClick={() => setStep(1)}>
                      Continue <span className="arrow">→</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="wizard-card" key="s1">
            <div>
              <h2>Declare what it is for</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                The judge holds every tool to this purpose. Anything that steers the model beyond it is poison.
              </p>
            </div>
            <div className="field">
              <label htmlFor="purpose">Declared purpose</label>
              <textarea
                id="purpose"
                className="textarea"
                maxLength={280}
                placeholder="Weather forecasts for a city."
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
              />
              <span className="hint num">{purpose.trim().length} / 280</span>
            </div>
            <div className="field">
              <span className="label">Capabilities the tools need</span>
              <div className="cap-chips">
                {CAPS.map((cap) => (
                  <button key={cap} type="button" aria-pressed={caps.includes(cap)} onClick={() => toggleCap(cap)}>
                    {cap}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">Tier</span>
              <div className="tier-pick" role="radiogroup">
                <button type="button" role="radio" aria-checked={tier === "BONDED"} className={`action-card${tier === "BONDED" ? " selected" : ""}`} onClick={() => setTier("BONDED")}>
                  <span className="row">
                    <span className="radio" aria-hidden="true" />
                    <strong>Bonded</strong>
                    <span className="price">≥ 10 GEN</span>
                  </span>
                  <p>For your own server. Guards can require a bond, and hunters can claim it if you poison or swap a tool.</p>
                </button>
                <button type="button" role="radio" aria-checked={tier === "REVIEWED"} className={`action-card${tier === "REVIEWED" ? " selected" : ""}`} onClick={() => setTier("REVIEWED")}>
                  <span className="row">
                    <span className="radio" aria-hidden="true" />
                    <strong>Sponsored review</strong>
                    <span className="price">0.2 GEN</span>
                  </span>
                  <p>For a server you use but do not run. Pinned and judged, with no bond at stake.</p>
                </button>
              </div>
            </div>
            {tier === "BONDED" && (
              <div className="field" style={{ maxWidth: 240 }}>
                <label htmlFor="bond">Bond (GEN)</label>
                <input id="bond" className="input num" inputMode="decimal" value={bond} onChange={(event) => setBond(event.target.value)} aria-invalid={!bondOk} />
                {!bondOk && <span className="hint" style={{ color: "var(--bad)" }}>The minimum bond is 10 GEN.</span>}
              </div>
            )}
            <div className="cost num">
              {tier === "BONDED" && (
                <div>
                  <span>Bond, returned when you exit</span>
                  <span>{bondOk ? bondNumber : "—"} GEN</span>
                </div>
              )}
              <div>
                <span>Review fee</span>
                <span>0.2 GEN</span>
              </div>
              <div className="total">
                <span>Sent with the transaction</span>
                <span>{total ? `${Math.round(total * 1e4) / 1e4} GEN` : "—"}</span>
              </div>
            </div>
            <div className="actions" style={{ justifyContent: "space-between" }}>
              <button type="button" className="button" onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="button primary" disabled={!purposeOk || !caps.length || !bondOk} onClick={() => setStep(2)}>
                Review and publish <span className="arrow">→</span>
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-card" key="s2">
            <div>
              <h2>Publish on GenLayer</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Up to {2 + Math.max(1, Math.ceil((preview?.tools?.length ?? 1) / REVIEW_BATCH))} transactions. Each is decided by five validators, about a
                minute apiece.
              </p>
            </div>
            <dl className="facts">
              <div>
                <dt>Endpoint</dt>
                <dd className="mono">{url}</dd>
              </div>
              <div>
                <dt>Root to be pinned</dt>
                <dd className="mono">{shortHash(preview?.root ?? "", 10, 6)}</dd>
              </div>
              <div>
                <dt>Purpose</dt>
                <dd>{purpose}</dd>
              </div>
              <div>
                <dt>Capabilities · tier</dt>
                <dd>
                  {caps.join(", ")} · {tier === "BONDED" ? `bonded ${bondNumber} GEN` : "sponsored review"}
                </dd>
              </div>
            </dl>

            {!wallet.mode ? (
              <div className="actions">
                <button type="button" className="button primary" onClick={() => wallet.connect("burner")}>
                  Use a built-in test wallet
                </button>
                <button type="button" className="button" onClick={() => wallet.connect("injected").catch(() => undefined)}>
                  Browser wallet
                </button>
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Paying from <span className="mono">{wallet.address.slice(0, 8)}…{wallet.address.slice(-4)}</span>.{" "}
                <button type="button" className="linklike" onClick={() => wallet.faucet()}>
                  Get 25 test GEN
                </button>{" "}
                if it is empty. Studio Next balances live in the Studio ledger, so wallets show 0.
              </p>
            )}

            {runSteps.length > 0 && (
              <ol className="run-steps">
                {runSteps.map((item) => (
                  <li key={item.key} className={item.state === "idle" ? "" : item.state}>
                    <span className="state" aria-hidden="true">
                      {item.state === "ok" ? "✓" : item.state === "err" ? "!" : ""}
                    </span>
                    <span className="what">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </span>
                    {item.votes?.length ? <Votes votes={item.votes} /> : null}
                  </li>
                ))}
              </ol>
            )}

            {finished && (
              <div className="success-burst" style={finished.verdict === "SAFE" ? undefined : { background: "var(--bad-bg)", color: "var(--bad)" }}>
                <strong style={{ fontSize: 17 }}>
                  {finished.verdict === "SAFE"
                    ? "Pinned. Your tools are judged SAFE by validator consensus."
                    : finished.verdict === "POISONED"
                      ? "Rejected. Validators found a poisoned tool, so the server was not pinned."
                      : "Not pinned yet. The judges were unsure; fix the flagged text, re-pin and re-run the review."}
                </strong>
                <Link className="button small" href={`/server/${finished.sid}`}>
                  Open the server page <span className="arrow">→</span>
                </Link>
              </div>
            )}

            <div className="actions" style={{ justifyContent: "space-between" }}>
              <button type="button" className="button" onClick={() => setStep(1)} disabled={running}>
                Back
              </button>
              <button type="button" className="button accent" disabled={!wallet.mode || running || Boolean(finished)} onClick={publish}>
                {running ? "Publishing…" : `Publish · ${Math.round(total * 1e4) / 1e4} GEN`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
