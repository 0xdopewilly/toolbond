import { loadPins } from "@/lib/data";
import { SITE, WEBHOOK_SECRET, keys, redis, sameSecret, sendHtml, telegramStatus } from "@/lib/telegram";
import { HELP, escapeHtml, formatPins, normalizeUrl, parseCommand } from "@/lib/telegram-core";

// Telegram webhook for @ToolBondBot. Telegram signs every update with the secret token set in
// setWebhook (docs/TELEGRAM.md); anything without it is refused.

export async function GET() {
  return Response.json({ telegram: telegramStatus() });
}

type Update = { message?: { text?: string; chat?: { id: number } } };

const openApp = { text: "Open ToolBond", web_app: { url: SITE } };

export async function POST(request: Request) {
  if (!telegramStatus().bot) return Response.json({ error: "Telegram is not configured on this deployment" }, { status: 503 });
  if (!sameSecret(request.headers.get("x-telegram-bot-api-secret-token"), WEBHOOK_SECRET)) {
    return Response.json({ error: "bad secret" }, { status: 401 });
  }
  const update = (await request.json().catch(() => ({}))) as Update;
  const chatId = update.message?.chat?.id;
  const command = parseCommand(update.message?.text || "");
  if (!chatId || !command) return Response.json({ ok: true });
  try {
    await handle(chatId, command.cmd, command.arg);
  } catch (error) {
    await sendHtml(chatId, "Something went wrong: " + escapeHtml(String(error).slice(0, 200))).catch(() => {});
  }
  return Response.json({ ok: true });
}

async function handle(chatId: number, cmd: string, arg: string) {
  const store = telegramStatus().store;
  if (cmd === "start" || cmd === "help") {
    return sendHtml(chatId, HELP + (store ? "" : "\n\n<i>Alerts are not switched on yet on this bot.</i>"), [openApp]);
  }
  if (cmd === "check" || cmd === "watch" || cmd === "unwatch") {
    if (cmd === "unwatch" && arg.trim().toLowerCase() === "all") return unwatchAll(chatId);
    const url = normalizeUrl(arg);
    if (!url) return sendHtml(chatId, `Send an MCP server URL: <code>/${cmd} https://mcp.example.com/mcp</code>`);
    const pins = await loadPins(url);
    if (cmd === "check") {
      return sendHtml(chatId, formatPins(pins, SITE), pins.sid ? [{ text: "Server page", url: `${SITE}/server/${pins.sid}` }] : [openApp]);
    }
    if (!store) return sendHtml(chatId, "Alerts are not switched on yet on this bot. /check still works.");
    if (!pins.known || !pins.sid) return sendHtml(chatId, formatPins(pins, SITE));
    if (cmd === "watch") {
      await redis(["SADD", keys.watchers(pins.sid), chatId]);
      await redis(["SADD", keys.chat(chatId), pins.sid]);
      return sendHtml(chatId, `👀 Watching ${escapeHtml(url)}. You will hear about drift, challenges, re-pins, short bonds and slashes.`);
    }
    await redis(["SREM", keys.watchers(pins.sid), chatId]);
    await redis(["SREM", keys.chat(chatId), pins.sid]);
    return sendHtml(chatId, `Stopped watching ${escapeHtml(url)}.`);
  }
  if (cmd === "list") {
    if (!store) return sendHtml(chatId, "Alerts are not switched on yet on this bot.");
    const sids = ((await redis(["SMEMBERS", keys.chat(chatId)])) as string[]) || [];
    const hunting = Number(await redis(["SISMEMBER", keys.hunters, chatId])) === 1;
    const lines = sids.map((sid) => `• ${SITE}/server/${sid}`);
    return sendHtml(chatId, (lines.length ? "Watching:\n" + lines.join("\n") : "Not watching any server.") + (hunting ? "\n\n🏹 Hunting: on" : ""));
  }
  if (cmd === "hunt") {
    if (!store) return sendHtml(chatId, "Alerts are not switched on yet on this bot.");
    await redis(["SADD", keys.hunters, chatId]);
    return sendHtml(chatId, "🏹 You will hear about every new server, challenge, ruling and slash. /stop to end.");
  }
  if (cmd === "stop") {
    if (!store) return sendHtml(chatId, "Nothing to stop.");
    await redis(["SREM", keys.hunters, chatId]);
    return unwatchAll(chatId);
  }
  return sendHtml(chatId, HELP, [openApp]);
}

async function unwatchAll(chatId: number) {
  if (!telegramStatus().store) return sendHtml(chatId, "Nothing to stop.");
  const sids = ((await redis(["SMEMBERS", keys.chat(chatId)])) as string[]) || [];
  for (const sid of sids) await redis(["SREM", keys.watchers(sid), chatId]);
  await redis(["DEL", keys.chat(chatId)]);
  return sendHtml(chatId, `Stopped ${sids.length} watch${sids.length === 1 ? "" : "es"}.`);
}
