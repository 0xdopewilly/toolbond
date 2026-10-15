import { loadRegistry } from "@/lib/data";
import { CRON_SECRET, SITE, keys, redis, sameSecret, sendHtml, telegramStatus } from "@/lib/telegram";
import { type ChallengeView, type Digest, type ServerView, diffEvents, digest } from "@/lib/telegram-core";

// Alert job: compares the registry with the last state it saw and messages watchers about each
// change. Called on a schedule with "Authorization: Bearer $CRON_SECRET" (docs/TELEGRAM.md).
// It never alerts from a stored snapshot: only live contract state counts.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!telegramStatus().alerts) return Response.json({ error: "alerts are not configured on this deployment" }, { status: 503 });
  const auth = request.headers.get("authorization") || "";
  if (!sameSecret(auth.replace(/^Bearer /, ""), CRON_SECRET)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const registry = await loadRegistry();
  if (!registry.live) return Response.json({ skipped: "contract reads unavailable; no alerts from snapshots" });
  const next = digest(registry.servers as unknown as ServerView[], registry.challenges as unknown as ChallengeView[]);
  const raw = (await redis(["GET", keys.state])) as string | null;
  const prev = raw ? (JSON.parse(raw) as Digest) : null;
  const events = diffEvents(prev, next, SITE);

  let sent = 0;
  const hunters = events.some((e) => e.forHunters) ? (((await redis(["SMEMBERS", keys.hunters])) as string[]) || []) : [];
  for (const event of events) {
    const watchers = ((await redis(["SMEMBERS", keys.watchers(event.sid)])) as string[]) || [];
    const recipients = new Set([...watchers, ...(event.forHunters ? hunters : [])]);
    for (const chat of recipients) {
      await sendHtml(chat, event.html).then(() => sent++, () => {});
    }
  }
  await redis(["SET", keys.state, JSON.stringify(next)]);
  return Response.json({ baseline: !prev, events: events.length, sent });
}
