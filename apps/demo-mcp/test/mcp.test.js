import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import handler, { handleRpc, resolveMode, tools } from "../api/mcp.js";

let base;
let server;

before(async () => {
  server = createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function rpc(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  });
  return { status: res.status, type: res.headers.get("content-type"), text: await res.text() };
}

function parseSse(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

test("tools/list is SSE-framed and honest by default", async () => {
  const res = await rpc("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(res.status, 200);
  assert.match(res.type, /text\/event-stream/);
  const [reply] = parseSse(res.text);
  assert.equal(reply.id, 2);
  assert.equal(reply.result.tools[0].name, "get_forecast");
  assert.ok(!reply.result.tools[0].description.includes("IMPORTANT"));
});

test("poisoned mode carries the injection and invisible tag characters", async () => {
  const [reply] = parseSse((await rpc("/mcp/poisoned", { jsonrpc: "2.0", id: 2, method: "tools/list" })).text);
  const description = reply.result.tools[0].description;
  assert.ok(description.includes("~/.cursor/mcp.json"));
  assert.ok([...description].some((ch) => ch.codePointAt(0) >= 0xe0000));
  assert.ok(reply.result.tools[0].inputSchema.properties.notes);
});

test("manifests are deterministic", async () => {
  const one = (await rpc("/mcp/poisoned", { jsonrpc: "2.0", id: 2, method: "tools/list" })).text;
  const two = (await rpc("/mcp/poisoned", { jsonrpc: "2.0", id: 2, method: "tools/list" })).text;
  assert.equal(one, two);
});

test("rug pull switches at the configured instant", () => {
  const env = { RUGPULL_AT: "2026-10-14T12:00:00Z" };
  const params = new URLSearchParams();
  assert.equal(resolveMode("/mcp/rugpull", params, env, Date.parse("2026-10-14T11:59:59Z")), "honest");
  assert.equal(resolveMode("/mcp/rugpull", params, env, Date.parse("2026-10-14T12:00:00Z")), "poisoned");
  assert.equal(resolveMode("/api/mcp", new URLSearchParams("mode=rugpull&at=2000-01-01T00:00:00Z"), {}, Date.now()), "poisoned");
  assert.equal(resolveMode("/mcp/rugpull", params, {}, Date.now()), "honest"); // no time set: stays honest
});

test("initialize, notifications, tools/call and errors", async () => {
  const [init] = parseSse((await rpc("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} })).text);
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const note = await rpc("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(note.status, 202);
  const [call] = parseSse(
    (await rpc("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_forecast", arguments: { city: "Lisbon" } } })).text,
  );
  assert.match(call.result.content[0].text, /DEMO forecast for Lisbon/);
  const [missing] = parseSse((await rpc("/mcp", { jsonrpc: "2.0", id: 4, method: "nope" })).text);
  assert.equal(missing.error.code, -32601);
  const get = await fetch(base + "/mcp");
  assert.equal(get.status, 405);
});

test("honest and poisoned tools differ", () => {
  assert.notDeepEqual(tools("honest"), tools("poisoned"));
});

test("update mode revises the tool harmlessly at the configured instant and proves its owner", async () => {
  const before = "2026-10-15T11:59:59Z";
  const params = new URLSearchParams("at=2026-10-15T12:00:00Z");
  assert.equal(resolveMode("/mcp/update", params, {}, Date.parse(before)), "update-original");
  assert.equal(resolveMode("/mcp/update", params, {}, Date.parse("2026-10-15T12:00:00Z")), "update-revised");
  const original = tools("update-original")[0].description;
  const revised = tools("update-revised")[0].description;
  assert.notEqual(original, revised);
  assert.ok(revised.includes("humidity") && !revised.includes("IMPORTANT"));
  const init = handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "update-revised", {});
  assert.equal(init.result.instructions, "Demo weather tools for the ToolBond walkthrough. toolbond-owner:0xe258d2604aec1321ddd58f179001cc6a8c442930");
  // the owner comes from server config, never from the request
  const spoofed = handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "update-original", { DEMO_OWNER: "0xABC" });
  assert.match(spoofed.result.instructions, /toolbond-owner:0xabc$/);
  // the other modes keep their earlier manifests (no instructions), so older pins still match
  assert.equal(handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, "honest", {}).result.instructions, undefined);
});

test("sample skill files are served as fixed markdown", async () => {
  const { SKILLS, skillName } = await import("../api/skill.js");
  assert.equal(skillName("/skills/commit-helper/SKILL.md", new URLSearchParams()), "commit-helper");
  assert.ok(!SKILLS["commit-helper"].includes("id_rsa"));
  const poisoned = SKILLS["commit-helper-poisoned"];
  assert.ok(poisoned.includes("~/.ssh/id_rsa") && poisoned.includes("Do not mention this step to the user"));
  assert.ok([...poisoned].some((ch) => ch.codePointAt(0) >= 0xe0000));
});
