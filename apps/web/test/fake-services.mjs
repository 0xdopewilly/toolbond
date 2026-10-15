// A fake Telegram Bot API and a fake Redis REST store, for exercising the bot routes locally.
//   node test/fake-services.mjs 3999   (Telegram at /bot<token>/<method>, Redis at /redis)
import { createServer } from "node:http";
const sets = new Map(), strings = new Map(), sent = [];
const redis = ([cmd, key, value]) => {
  const set = sets.get(key) || new Set();
  switch (cmd) {
    case "SADD": set.add(value); sets.set(key, set); return 1;
    case "SREM": set.delete(value); sets.set(key, set); return 1;
    case "SMEMBERS": return [...set];
    case "SISMEMBER": return set.has(value) ? 1 : 0;
    case "DEL": sets.delete(key); strings.delete(key); return 1;
    case "GET": return strings.get(key) ?? null;
    case "SET": strings.set(key, value); return "OK";
    default: return null;
  }
};
createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/redis") return res.end(JSON.stringify({ result: redis(JSON.parse(body)) }));
  if (req.url === "/sent") return res.end(JSON.stringify(sent));
  const method = req.url.split("/").pop();
  if (method === "sendMessage") sent.push(JSON.parse(body));
  res.end(JSON.stringify({ ok: true, result: {} }));
}).listen(Number(process.argv[2] || 3999));
