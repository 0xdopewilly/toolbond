// TBCM-1 canonical hashing and a minimal MCP client, ported from lib/gl_mcp.py for the publish
// preview. Validators always use the Python reference; tests/vectors/tbcm1.json keeps the two
// in step (scripts: apps/web/scripts/check-vectors.mjs). JSON.parse is lossy for integers above
// 2^53, so a preview of such a manifest may differ from the chain; the chain wins.
import { createHash } from "node:crypto";

export const PROTOCOL_VERSION = "2025-06-18";
const MAX_TOOLS = 24;
const MAX_PAGES = 3;

export class McpError extends Error {}

/** Python's repr() of a float: shortest digits, scientific below 1e-4 and from 1e16. */
export function pyFloat(x: number): string {
  if (!Number.isFinite(x)) throw new McpError("[EXTERNAL] non-finite number in manifest");
  if (Number.isInteger(x)) return BigInt(x).toString();
  const [mantissa, expPart] = x.toExponential().split("e");
  const exp = Number(expPart);
  const negative = mantissa.startsWith("-");
  const digits = mantissa.replace("-", "").replace(".", "");
  let body: string;
  if (exp >= -5 && exp < 16) {
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, "0");
      const frac = digits.slice(exp + 1);
      body = frac ? `${intPart}.${frac}` : `${intPart}.0`;
    } else {
      body = `0.${"0".repeat(-exp - 1)}${digits}`;
    }
    if (exp === -5) body = "";
  } else {
    body = "";
  }
  if (!body) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    body = `${m}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return negative ? `-${body}` : body;
}

function codePointCompare(a: string, b: string): number {
  const ca = Array.from(a);
  const cb = Array.from(b);
  for (let i = 0; i < Math.min(ca.length, cb.length); i += 1) {
    const d = (ca[i].codePointAt(0) ?? 0) - (cb[i].codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return ca.length - cb.length;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** The hashed part of a tool: everything but its own top-level _meta (nested _meta keys stay). */
export function toolObject(tool: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(tool).filter(([key]) => key !== "_meta"));
}

export function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return pyFloat(value);
  if (typeof value === "string") {
    if (LONE_SURROGATE.test(value)) throw new McpError("[EXTERNAL] invalid unicode in manifest");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => codePointCompare(a, b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function manifestRoot(instructionsHash: string, toolHashes: string[]): string {
  return sha256Hex(canonical({ i: instructionsHash, t: [...toolHashes].sort() }));
}

export interface Digest {
  root: string;
  instructionsHash: string;
  instructions: string;
  protocol: string;
  tools: { name: string; hash: string; canon: string; raw: Record<string, unknown> }[];
}

export function digestManifest(manifest: { protocol: string; instructions: string; tools: Record<string, unknown>[] }): Digest {
  const seen = new Set<string>();
  const tools = manifest.tools.map((tool) => {
    const name = tool?.name;
    if (typeof name !== "string" || !name) throw new McpError("[EXTERNAL] tool without a name");
    if (seen.has(name)) throw new McpError("[EXTERNAL] duplicate tool name");
    seen.add(name);
    const canon = canonical(toolObject(tool));
    return { name, hash: sha256Hex(canon), canon, raw: tool };
  });
  tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const instructionsHash = sha256Hex(manifest.instructions);
  return {
    root: manifestRoot(instructionsHash, tools.map((t) => t.hash)),
    instructionsHash,
    instructions: manifest.instructions,
    protocol: manifest.protocol,
    tools,
  };
}

function ssePayloads(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  // SSE line ends are CRLF, LF or CR; U+2028 inside JSON strings is not a line end
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.startsWith("data:")) current.push(line.slice(5).replace(/^ /, ""));
    else if (line === "" && current.length) {
      out.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length) out.push(current.join("\n"));
  return out;
}

export function parseRpc(body: string, id: number): Record<string, unknown> {
  const trimmed = body.trimStart();
  const candidates = trimmed.startsWith("{") || trimmed.startsWith("[") ? [trimmed] : ssePayloads(body);
  for (const raw of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      const m = message as Record<string, unknown>;
      if (!m || String(m.id) !== String(id)) continue;
      if (m.error) throw new McpError(`[EXTERNAL] rpc error ${(m.error as { code?: number }).code ?? ""}`.trim());
      if (!m.result || typeof m.result !== "object") throw new McpError("[EXTERNAL] malformed rpc result");
      return m.result as Record<string, unknown>;
    }
  }
  throw new McpError(`[EXTERNAL] no rpc response for id ${id}`);
}

const MAX_RESPONSE_CHARS = 2_000_000;

async function post(url: string, body: unknown, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new McpError("[EXTERNAL] the server redirects; use the final endpoint URL");
  }
  if (response.status >= 500 || response.status === 429) throw new McpError(`[TRANSIENT] http ${response.status}`);
  if (response.status >= 400) throw new McpError(`[EXTERNAL] http ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARS) throw new McpError("[EXTERNAL] response too large");
  return { headers: response.headers, text };
}

export async function fetchManifest(url: string) {
  let headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    "User-Agent": "toolbond-web/0.1",
  };
  const init = await post(
    url,
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "toolbond-web", version: "0.1" } } },
    headers,
  );
  const info = parseRpc(init.text, 1);
  const session = init.headers.get("mcp-session-id");
  if (session) headers = { ...headers, "Mcp-Session-Id": session };
  await post(url, { jsonrpc: "2.0", method: "notifications/initialized" }, headers).catch(() => undefined);
  const tools: Record<string, unknown>[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const id = 2 + page;
    const res = await post(url, { jsonrpc: "2.0", id, method: "tools/list", params: cursor ? { cursor } : {} }, headers);
    const result = parseRpc(res.text, id);
    if (!Array.isArray(result.tools)) throw new McpError("[EXTERNAL] tools/list returned no tool list");
    tools.push(...(result.tools as Record<string, unknown>[]));
    if (tools.length > MAX_TOOLS) throw new McpError(`[EXTERNAL] manifest has more than ${MAX_TOOLS} tools`);
    cursor = typeof result.nextCursor === "string" ? result.nextCursor : "";
    if (!cursor) break;
  }
  return {
    protocol: String(info.protocolVersion ?? ""),
    instructions: typeof info.instructions === "string" ? info.instructions : "",
    tools,
  };
}
