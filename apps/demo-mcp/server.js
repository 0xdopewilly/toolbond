// Local runner for the demo MCP server: node server.js [port]
import { createServer } from "node:http";
import handler from "./api/mcp.js";

const port = Number(process.argv[2] || process.env.PORT || 8787);
createServer((req, res) => {
  handler(req, res).catch((error) => {
    res.statusCode = 500;
    res.end(String(error));
  });
}).listen(port, () => {
  console.error(`demo MCP server on http://127.0.0.1:${port}/mcp/{honest,poisoned,rugpull}`);
});
