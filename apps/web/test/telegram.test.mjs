// node --test test/  (Node 22.18+ runs the TypeScript module directly)
import assert from "node:assert/strict";
import { test } from "node:test";
import { assuranceLabel, diffEvents, digest, escapeHtml, formatPins, normalizeUrl, parseCommand } from "../src/lib/telegram-core.ts";

const SITE = "https://toolbond.vercel.app";
const server = (over = {}) => ({
  sid: "s1", url: "https://weather.example.com/mcp", status: "ACTIVE", tier: "BONDED", assurance: "BONDED",
  bond: "10000000000000000000", root: "aaaa", open_challenges: 0, ...over,
});
const challenge = (over = {}) => ({ cid: "c1", sid: "s1", kind: "DRIFT", stage: "FILED", drift: "", verdict: "", ...over });

test("commands parse with and without the bot name", () => {
  assert.deepEqual(parseCommand("/check https://x.example.com/mcp"), { cmd: "check", arg: "https://x.example.com/mcp" });
  assert.deepEqual(parseCommand("/watch@ToolBondBot  https://x.example.com/mcp "), { cmd: "watch", arg: "https://x.example.com/mcp" });
  assert.deepEqual(parseCommand("/START"), { cmd: "start", arg: "" });
  assert.equal(parseCommand("hello"), null);
});

test("only https URLs on a real host are accepted", () => {
  assert.equal(normalizeUrl("https://mcp.deepwiki.com/mcp extra"), "https://mcp.deepwiki.com/mcp");
  assert.equal(normalizeUrl("http://mcp.deepwiki.com/mcp"), null);
  assert.equal(normalizeUrl("https://localhost"), null);
  assert.equal(normalizeUrl("not a url"), null);
});

test("the first run sets a baseline and alerts nobody", () => {
  assert.deepEqual(diffEvents(null, digest([server()], []), SITE), []);
});

test("status, assurance, re-pin and challenge changes become alerts", () => {
  const before = digest([server()], []);
  const after = digest(
    [server({ status: "STALE", assurance: "UNDERCOLLATERALIZED", bond: "9500000000000000000", root: "bbbb" })],
    [challenge({ stage: "OBSERVED", drift: "DIFFERS" })],
  );
  const events = diffEvents(before, after, SITE);
  const text = events.map((e) => e.html).join("\n");
  assert.match(text, /ACTIVE → STALE/);
  assert.match(text, /under-collateralized/);
  assert.match(text, /9\.5 GEN/);
  assert.match(text, /re-pinned/);
  assert.match(text, /DRIFT challenge <b>c1<\/b> filed/);
  assert.ok(events.find((e) => e.html.includes("filed")).forHunters);
  assert.ok(!events.find((e) => e.html.includes("re-pinned")).forHunters);
});

test("a slash reaches hunters too, and judged verdicts are reported", () => {
  const before = digest([server()], [challenge({ stage: "OBSERVED", drift: "DIFFERS" })]);
  const after = digest([server({ status: "SLASHED", bond: "0", assurance: "UNDERCOLLATERALIZED" })], [challenge({ stage: "JUDGED", drift: "DIFFERS", verdict: "POISONED" })]);
  const events = diffEvents(before, after, SITE);
  assert.ok(events.some((e) => e.forHunters && e.html.includes("SLASHED")));
  assert.ok(events.some((e) => e.html.includes("judged <b>POISONED</b>")));
  assert.ok(!events.some((e) => e.html.includes("assurance is now")));  // a slash is not reported as a short bond
});

test("check replies say what a guard does", () => {
  const known = formatPins({ known: true, url: "https://mcp.deepwiki.com/mcp", sid: "ac86", status: "ACTIVE", tier: "REVIEWED", assurance: "REVIEWED",
    bond: "0", owner_verified: false, tools: { a: "1", b: "2" }, verdicts: { a: "SAFE", b: "UNCLEAR" }, source: "contract" }, SITE);
  assert.match(known, /reviewed, no bond/);
  assert.match(known, /1 of 2 pinned and judged SAFE/);
  assert.match(known, /registrant, not verified/);
  assert.match(known, /server\/ac86/);
  const stored = formatPins({ known: true, url: "https://x.example.com/mcp", status: "SLASHED", tier: "BONDED", bond: "0", tools: {}, verdicts: {}, source: "snapshot" }, SITE);
  assert.match(stored, /stored snapshot/);
  assert.match(stored, /blocks every tool/);
  assert.match(formatPins({ known: false, url: "https://nope.example.com/mcp" }, SITE), /not registered/);
});

test("html is escaped and labels are honest", () => {
  assert.equal(escapeHtml("<b>&"), "&lt;b&gt;&amp;");
  assert.equal(assuranceLabel({ status: "SLASHED", assurance: "UNDERCOLLATERALIZED" }), "bond slashed");
  assert.equal(assuranceLabel({ tier: "REVIEWED" }), "reviewed, no bond");
});
