# ToolBond on Telegram

`@ToolBondBot` (any name you give it) answers `/check <url>` for any MCP server, sends alerts to
people who `/watch` a server (drift, challenges, rulings, re-pins, short bonds, slashes), sends
every new server and challenge to people who `/hunt`, and opens the ToolBond site as a Telegram
Mini App from its menu button.

The code ships switched off. Each part turns on when its secrets are present:

| Part | Needs |
|---|---|
| `/check`, `/help`, the Mini App button | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` |
| `/watch`, `/list`, `/hunt`, `/stop` | the above plus a Redis REST store (`KV_REST_API_URL` and `KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*` pair) |
| Alerts | all of the above plus `CRON_SECRET`, and a scheduler that calls `/api/telegram/cron` |

`GET /api/telegram` reports which parts are on, without revealing anything.

## Turning it on

1. In Telegram, message **@BotFather**, send `/newbot`, and follow the prompts. Copy the token.
   It is a secret: never paste it in a chat, an issue or the repository.
2. In the Vercel dashboard, open the `toolbond` project, then Settings, then Environment Variables,
   and add these as **Sensitive**, for Production:
   - `TELEGRAM_BOT_TOKEN`: the token from BotFather
   - `TELEGRAM_WEBHOOK_SECRET`: a random string, for example from `openssl rand -hex 24`
   - `CRON_SECRET`: another random string
3. In the Vercel dashboard, open Storage (or the Marketplace), add **Upstash for Redis** (the free
   plan is enough) and connect it to the `toolbond` project. It adds the `KV_REST_API_*` variables.
4. Redeploy the site so the new variables take effect.
5. Register the webhook, commands and Mini App button, from `apps/web` with the same two values:
   `TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-setup.mjs`
6. In the GitHub repository, open Settings, then Secrets and variables, then Actions, and add
   `TOOLBOND_CRON_SECRET` with the same value as `CRON_SECRET`. The workflow
   `.github/workflows/telegram-alerts.yml` then runs the alert job every 10 minutes.
7. Open the bot and send `/start`.

## How alerts work

The alert job reads the registry through the site's cached contract reads (one read at most every
20 seconds, whatever the number of users), compares it with the state it stored last time, and
sends each change to the people watching that server. The first run only stores a baseline. It
never alerts from a stored snapshot: when contract reads fail, it skips that run.

Messages come from `apps/web/src/lib/telegram-core.ts`, which is covered by
`apps/web/test/telegram.test.mjs` (`node --test test/telegram.test.mjs`).
