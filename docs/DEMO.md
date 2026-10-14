# Demo: a rug-pulled MCP tool, caught and slashed

Everything below happened on GenLayer Studio Next against public URLs, and every step
can be replayed. Transactions are listed in [DEPLOYMENTS.md](DEPLOYMENTS.md).

## The 90-second video

| Time | On screen | Say |
|---|---|---|
| 0–10 s | The poisoned description on https://toolbond.vercel.app (server page, hidden characters revealed) | "Agents obey tool descriptions. One edited sentence, plus text you can't even see, can exfiltrate your keys." |
| 10–25 s | Registry: the weather server, Bonded · 10 GEN, Pinned | "This publisher bonded 10 GEN behind the exact bytes of its tool. Five GenLayer validators fetched the server themselves, derived the same hash, and two model readings each judged it SAFE." |
| 25–35 s | Terminal: `claude mcp add weather -- uvx … toolbond-guard <url> --pins-url https://toolbond.vercel.app/api/pins`, then ask for the weather in Lisbon | "With the guard installed, the agent sees the tool and it works." |
| 35–50 s | Same terminal after the rug-pull time: the tool disappears, `toolbond_status` shows "tool changed since it was pinned" | "The publisher swaps in a poisoned description. The guard hashes what it receives, sees it no longer matches the pin, and drops it before the model reads a word." |
| 50–75 s | Patrol bot log (JSON lines): drift_detected → challenge_filed → observed DIFFERS → judged POISONED → settled; then the explorer | "The patrol bot stakes 0.5 GEN on a DRIFT challenge. Validators re-fetch and agree the manifest changed, judge the verified new text POISONED with the exact quote, and the contract slashes the bond: half to the hunter, half to the protection pool." |
| 75–90 s | Registry: Slashed badge; the real servers (DeepWiki, Cloudflare Docs, gitmcp, Internet Court) Pinned | "Real MCP servers are already pinned and judged SAFE by validator consensus. Bond your tools. Guard your agents." |

## Commands

```bash
# the guard, before and after the rug pull (prints MCP JSON-RPC replies)
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  python lib/toolbond_guard.py "https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=<ISO time>" \
  --pins-url https://toolbond.vercel.app/api/pins --poll 0

# the patrol bot, one round, driving the challenge on-chain
echo "https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=<ISO time>" > servers.txt
python bot/patrol.py --contract 0x299Cf258f16ACd91A80ACa23fA39695b7eF88F8A \
  --pins-url https://toolbond.vercel.app/api/pins --servers servers.txt --once
```

## Run your own rug pull

1. Pick a time ~20 minutes ahead and register
   `https://toolbond-demo-mcp.vercel.app/mcp/rugpull?at=<that time>` with
   `node scripts/tx.mjs write <toolbond> register --value 10.2 <url> "Weather forecasts for a city." network`.
2. `snapshot` and `review` it (`scripts/live_review.sh` shows the pattern). It is judged SAFE while honest.
3. Add it to `scripts/snapshot_state.py` so `/api/pins` serves it while Studio Next reads are down.
4. After the chosen time, run the guard and the patrol bot as above.
