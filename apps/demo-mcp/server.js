// Local runner for the demo MCP server: node server.js [port]
import { createServer } from "node:http";
import handler from "./api/mcp.js";
import skill from "./api/skill.js";

const port = Number(process.argv[2] || process.env.PORT || 8787);
createServer((req, res) => {
  // on Vercel the rewrite in vercel.json turns /skills/<name>/SKILL.md into /api/skill?name=<name>
  const route = req.url.startsWith("/skills/") || req.url.startsWith("/api/skill") ? skill : handler;
  route(req, res).catch((error) => {
    res.statusCode = 500;
    res.end(String(error));
  });
}).listen(port, () => {
  console.error(`demo MCP server on http://127.0.0.1:${port}/mcp/{honest,poisoned,rugpull,update} and /skills/<name>/SKILL.md`);
});
