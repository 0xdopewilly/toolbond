// One-time setup for @ToolBondBot after its token is in place (docs/TELEGRAM.md).
//
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs
//
// Points the bot's webhook at this site with the shared secret, publishes the command menu,
// and adds a menu button that opens ToolBond as a Telegram Mini App.
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const site = process.env.TOOLBOND_SITE || "https://toolbond.vercel.app";
if (!token || !secret) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET first (the same values as in Vercel).");
  process.exit(2);
}

async function call(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`${method}: ${body.description}`);
  return body.result;
}

const me = await call("getMe");
console.log(`bot: @${me.username}`);
await call("setWebhook", { url: `${site}/api/telegram`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true });
await call("setMyCommands", {
  commands: [
    { command: "check", description: "Status, assurance and verdicts for an MCP server" },
    { command: "watch", description: "Alerts when a server drifts, is challenged or slashed" },
    { command: "unwatch", description: "Stop alerts for a server (or: all)" },
    { command: "list", description: "What you are watching" },
    { command: "hunt", description: "Every new server and challenge, for hunters" },
    { command: "stop", description: "Stop all alerts" },
    { command: "help", description: "How ToolBond works" },
  ],
});
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "ToolBond", web_app: { url: site } } });
await call("setMyShortDescription", { short_description: "Check MCP servers and get alerts when tools drift or get slashed. Judged by GenLayer validators." });
await call("setMyDescription", {
  description:
    "ToolBond pins MCP tool descriptions by hash, has GenLayer validators judge them, and slashes the publisher's bond when a tool turns malicious. /check any server, /watch it for alerts, or /hunt for bounties.",
});
const info = await call("getWebhookInfo");
console.log(`webhook: ${info.url} (pending ${info.pending_update_count}, last error: ${info.last_error_message || "none"})`);
console.log("done: open the bot in Telegram and send /start");
