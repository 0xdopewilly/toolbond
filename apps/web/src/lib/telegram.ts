// Server-side I/O for the ToolBond Telegram bot. Every piece is optional: without its
// environment variables the bot answers "not configured" and does nothing else.
//
//   TELEGRAM_BOT_TOKEN        from @BotFather (secret)
//   TELEGRAM_WEBHOOK_SECRET   any random string; Telegram sends it back on every update (secret)
//   CRON_SECRET               any random string; the alert job requires it as a Bearer token (secret)
//   KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//                             a Redis REST store for watch lists (Upstash, through the Vercel Marketplace)
// Setup steps: docs/TELEGRAM.md.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = process.env.TELEGRAM_API_BASE || "https://api.telegram.org"; // overridable for tests
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const SITE = process.env.TOOLBOND_SITE || "https://toolbond.vercel.app";
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
export const CRON_SECRET = process.env.CRON_SECRET || "";

export function telegramStatus() {
  return { bot: Boolean(TOKEN && WEBHOOK_SECRET), store: Boolean(KV_URL && KV_TOKEN), alerts: Boolean(TOKEN && KV_URL && KV_TOKEN && CRON_SECRET) };
}

export async function tg(method: string, payload: Record<string, unknown>): Promise<unknown> {
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const response = await fetch(`${API}/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = (await response.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!body.ok) throw new Error(`telegram ${method}: ${body.description || response.status}`);
  return body.result;
}

export function sendHtml(chatId: number | string, html: string, buttons?: { text: string; url?: string; web_app?: { url: string } }[]) {
  return tg("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(buttons?.length ? { reply_markup: { inline_keyboard: [buttons] } } : {}),
  });
}

/** One Redis command through the REST API: ["SADD", key, member] -> result. */
export async function redis(command: (string | number)[]): Promise<unknown> {
  if (!KV_URL || !KV_TOKEN) throw new Error("no Redis REST store configured");
  const response = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command.map(String)),
    cache: "no-store",
  });
  const body = (await response.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error("redis: " + body.error);
  return body.result;
}

export const keys = {
  watchers: (sid: string) => `tb:watch:${sid}`,
  chat: (chatId: number | string) => `tb:chat:${chatId}`,
  hunters: "tb:hunters",
  state: "tb:state",
};

/** Constant-time string comparison for shared secrets. */
export function sameSecret(given: string | null, expected: string): boolean {
  if (!expected || !given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
