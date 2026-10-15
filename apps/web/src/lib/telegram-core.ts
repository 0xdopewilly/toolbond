// Pure logic for the ToolBond Telegram bot: command parsing, registry diffs and messages.
// No I/O here, so it is tested directly (test/telegram.test.mjs) and reused by the routes.

export interface ServerView {
  sid: string;
  url: string;
  status: string;
  tier: string;
  assurance?: string;
  bond: string;
  root: string;
  open_challenges: number;
  owner_verified?: boolean;
}

export interface ChallengeView {
  cid: string;
  sid: string;
  kind: string;
  stage: string;
  drift: string;
  verdict: string;
  payout?: { hunter?: string; pool?: string; publisher?: string };
}

export interface PinsView {
  known: boolean;
  url: string;
  sid?: string;
  status?: string;
  tier?: string;
  assurance?: string;
  bond?: string;
  owner_verified?: boolean;
  tools?: Record<string, string>;
  verdicts?: Record<string, string>;
  source?: string;
}

export interface Digest {
  servers: Record<string, { status: string; assurance: string; root: string; bond: string; url: string }>;
  challenges: Record<string, { sid: string; kind: string; stage: string; drift: string; verdict: string }>;
}

export interface AlertEvent {
  sid: string;
  /** also sent to hunters who asked for every challenge and new server */
  forHunters: boolean;
  html: string;
}

const STATUS_ICON: Record<string, string> = {
  ACTIVE: "🟢", STALE: "🟠", SLASHED: "🔴", REJECTED: "⛔", PENDING_SNAPSHOT: "⏳", PENDING_REVIEW: "⏳", EXITING: "🚪", EXITED: "🚪",
};

export const escapeHtml = (text: string) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const gen = (wei: string) => {
  const value = BigInt(wei || "0");
  const whole = value / 10n ** 18n;
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 3).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
};

const host = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.host + (parsed.pathname.length > 1 ? parsed.pathname.replace(/\/mcp$/, "") : "");
  } catch {
    return url;
  }
};

/** "/check@ToolBondBot https://x" -> { cmd: "check", arg: "https://x" } */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const match = String(text || "").trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return match ? { cmd: match[1].toLowerCase(), arg: (match[2] || "").trim() } : null;
}

export function normalizeUrl(arg: string): string | null {
  const url = arg.trim().split(/\s+/)[0] || "";
  if (!/^https:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(url) || url.length > 300) return null;
  return url;
}

export function assuranceLabel(view: { assurance?: string; tier?: string; status?: string }): string {
  if (view.status === "SLASHED") return "bond slashed";
  if (view.assurance === "BONDED") return "bonded";
  if (view.assurance === "UNDERCOLLATERALIZED") return "under-collateralized";
  if (view.assurance === "REVIEWED" || view.tier === "REVIEWED") return "reviewed, no bond";
  return (view.tier || "unknown").toLowerCase();
}

export function digest(servers: ServerView[], challenges: ChallengeView[]): Digest {
  const out: Digest = { servers: {}, challenges: {} };
  for (const s of servers) {
    out.servers[s.sid] = { status: s.status, assurance: assuranceLabel(s), root: s.root, bond: s.bond, url: s.url };
  }
  for (const c of challenges) {
    out.challenges[c.cid] = { sid: c.sid, kind: c.kind, stage: c.stage, drift: c.drift, verdict: c.verdict };
  }
  return out;
}

/** What changed between two digests, as messages. A missing previous digest means "first run": no alerts. */
export function diffEvents(prev: Digest | null, next: Digest, site: string): AlertEvent[] {
  if (!prev) return [];
  const events: AlertEvent[] = [];
  const link = (sid: string) => `${site}/server/${sid}`;
  for (const [sid, now] of Object.entries(next.servers)) {
    const was = prev.servers[sid];
    const name = `<a href="${link(sid)}">${escapeHtml(host(now.url))}</a>`;
    if (!was) {
      events.push({ sid, forHunters: true, html: `📥 New server registered: ${name} (${escapeHtml(now.assurance)})` });
      continue;
    }
    if (was.status !== now.status) {
      events.push({ sid, forHunters: now.status === "SLASHED", html: `${STATUS_ICON[now.status] ?? "•"} ${name}: <b>${escapeHtml(was.status)} → ${escapeHtml(now.status)}</b>` });
    }
    if (was.assurance !== now.assurance && now.status !== "SLASHED") {
      events.push({ sid, forHunters: false, html: `💰 ${name}: assurance is now <b>${escapeHtml(now.assurance)}</b> (bond ${gen(now.bond)} GEN)` });
    }
    if (was.root && now.root && was.root !== now.root) {
      events.push({ sid, forHunters: false, html: `📌 ${name} was re-pinned: new root <code>${escapeHtml(now.root.slice(0, 12))}…</code>` });
    }
  }
  for (const [cid, now] of Object.entries(next.challenges)) {
    const was = prev.challenges[cid];
    const server = next.servers[now.sid];
    const name = server ? `<a href="${link(now.sid)}">${escapeHtml(host(server.url))}</a>` : escapeHtml(now.sid);
    if (!was) {
      events.push({ sid: now.sid, forHunters: true, html: `⚔️ ${escapeHtml(now.kind)} challenge <b>${escapeHtml(cid)}</b> filed against ${name}` });
      continue;
    }
    if (was.stage === now.stage) continue;
    if (now.stage === "OBSERVED") {
      events.push({ sid: now.sid, forHunters: now.drift === "DIFFERS", html: `🔎 ${escapeHtml(cid)} on ${name}: validators observed <b>${escapeHtml(now.drift)}</b>` });
    } else if (now.stage === "JUDGED") {
      const icon = now.verdict === "POISONED" ? "☠️" : now.verdict === "SAFE" ? "✅" : "❔";
      events.push({ sid: now.sid, forHunters: true, html: `${icon} ${escapeHtml(cid)} on ${name}: judged <b>${escapeHtml(now.verdict)}</b>` });
    } else if (now.stage === "SETTLED" || now.stage === "EXPIRED") {
      events.push({ sid: now.sid, forHunters: true, html: `🏁 ${escapeHtml(cid)} on ${name}: ${escapeHtml(now.stage.toLowerCase())}` });
    }
  }
  return events;
}

export function formatPins(pins: PinsView, site: string): string {
  if (!pins.known) {
    return `❓ <b>${escapeHtml(pins.url)}</b> is not registered with ToolBond.\nA guard blocks every tool on it. Publish it: ${site}/publish`;
  }
  const tools = Object.keys(pins.tools || {});
  const safe = tools.filter((name) => (pins.verdicts || {})[name] === "SAFE").length;
  const lines = [
    `${STATUS_ICON[pins.status || ""] ?? "•"} <b>${escapeHtml(host(pins.url))}</b>`,
    `Status: <b>${escapeHtml(pins.status || "")}</b> · ${escapeHtml(assuranceLabel(pins))}${pins.bond && pins.bond !== "0" ? ` · bond ${gen(pins.bond)} GEN` : ""}`,
    `Owner: ${pins.owner_verified ? "verified" : "registrant, not verified"}`,
    `Tools: ${safe} of ${tools.length} pinned and judged SAFE`,
    pins.status === "ACTIVE" || pins.status === "STALE"
      ? "A guard allows a tool only while its live text matches the pin."
      : "A guard blocks every tool on this server.",
  ];
  if (pins.source && pins.source !== "contract") lines.push("⚠️ Contract reads failed: this is a stored snapshot, not current state.");
  if (pins.sid) lines.push(`${site}/server/${pins.sid}`);
  return lines.join("\n");
}

export const HELP = [
  "<b>ToolBond</b> pins MCP tools by hash, has GenLayer validators judge them, and slashes bonds that turn malicious.",
  "",
  "/check &lt;url&gt; — status, assurance and verdicts for an MCP server",
  "/watch &lt;url&gt; — alerts when it drifts, is challenged, re-pinned or slashed",
  "/unwatch &lt;url&gt; — stop alerts (or /unwatch all)",
  "/list — what you are watching",
  "/hunt — every new server and challenge, for bounty hunters",
  "/stop — stop everything",
].join("\n");
