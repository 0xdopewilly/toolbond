import type { Metadata } from "next";
import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { CountUp, Reveal } from "@/components/motion";
import { DataNotice } from "@/components/ui";
import { loadRegistry } from "@/lib/data";
import { EXPLORER, gen, shortAddress } from "@/lib/format";
import { displayName } from "@/lib/names";

export const revalidate = 30;
export const metadata: Metadata = { title: "Hunters" };

interface Hunter {
  address: string;
  filed: number;
  won: number;
  slashes: number;
  staked: bigint;
  paid: bigint;
}

/** A deterministic 5×5 mirrored identicon from the address bytes. */
function Identicon({ address }: { address: string }) {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0");
  const hue = parseInt(hex.slice(0, 3), 16) % 360;
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const mirror = col < 3 ? col : 4 - col;
      cells.push(parseInt(hex[row * 3 + mirror + 3], 16) % 2 === 0);
    }
  }
  return (
    <span className="identicon" aria-hidden="true">
      {cells.map((on, index) => (
        <i key={index} style={{ background: on ? `hsl(${hue} 45% 38%)` : "transparent" }} />
      ))}
    </span>
  );
}

const PATROL =
  "git clone https://github.com/0xdopewilly/toolbond && cd toolbond && ./scripts/setup.sh\n" +
  ".venv/bin/python bot/patrol.py --contract 0x299Cf258f16ACd91A80ACa23fA39695b7eF88F8A \\\n" +
  "  --pins-url https://toolbond.vercel.app/api/pins --servers servers.txt";

export default async function HuntersPage() {
  const registry = await loadRegistry();
  const byAddress = new Map<string, Hunter>();
  for (const challenge of registry.challenges) {
    const key = challenge.hunter.toLowerCase();
    const hunter = byAddress.get(key) ?? { address: challenge.hunter, filed: 0, won: 0, slashes: 0, staked: 0n, paid: 0n };
    const paid = BigInt(challenge.payout?.hunter ?? "0");
    hunter.filed += 1;
    hunter.staked += BigInt(challenge.stake);
    hunter.paid += paid;
    if (paid > BigInt(challenge.stake)) hunter.won += 1;
    if (challenge.verdict === "POISONED") hunter.slashes += 1;
    byAddress.set(key, hunter);
  }
  const hunters = [...byAddress.values()].sort((a, b) => (b.paid - b.staked > a.paid - a.staked ? 1 : -1));
  const bounty = registry.servers
    .filter((s) => s.tier === "BONDED" && (s.status === "ACTIVE" || s.status === "STALE"))
    .reduce((sum, s) => sum + BigInt(s.bond), 0n);
  const earned = hunters.reduce((sum, h) => sum + (h.paid > h.staked ? h.paid - h.staked : 0n), 0n);
  const slashes = registry.challenges.filter((c) => c.verdict === "POISONED");

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <span className="overline">Hunters</span>
          <h1>Get paid to catch poisoned tools.</h1>
          <p className="lede">
            Every bond is a standing bounty. Run the patrol bot or hunt by hand: when validators agree a tool is poisoned, half the
            publisher&apos;s bond is yours.
          </p>
        </div>
      </div>

      <DataNotice registry={registry} />

      <section className="stats-strip" style={{ marginTop: 0, gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }} aria-label="Hunting totals">
        <div className="stat">
          <span className="label">Bounty on offer now</span>
          <span className="value">
            <CountUp value={Number(gen(bounty))} />
            <small>GEN</small>
          </span>
          <span className="sub">bonds on active servers</span>
        </div>
        <div className="stat">
          <span className="label">Earned by hunters</span>
          <span className="value">
            <CountUp value={Number(gen(earned))} decimals={Number(gen(earned)) % 1 ? 1 : 0} />
            <small>GEN</small>
          </span>
          <span className="sub">net of stakes</span>
        </div>
        <div className="stat">
          <span className="label">Challenges filed</span>
          <span className="value">
            <CountUp value={registry.challenges.length} />
          </span>
          <span className="sub">{hunters.length} hunter{hunters.length === 1 ? "" : "s"}</span>
        </div>
        <div className={`stat${slashes.length ? " bad" : ""}`}>
          <span className="label">Publishers slashed</span>
          <span className="value">
            <CountUp value={slashes.length} />
          </span>
          <span className="sub">{slashes.length ? displayName(registry.servers.find((s) => s.sid === slashes[0].sid)?.url ?? "") : "none yet"}</span>
        </div>
      </section>

      <section aria-labelledby="board-title" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 id="board-title" className="display" style={{ fontSize: 24 }}>
          Leaderboard
        </h2>
        <div className="podium">
          {hunters.slice(0, 3).map((hunter, index) => (
            <Reveal key={hunter.address} delay={index * 90}>
              <article className={`podium-card${index === 0 ? " first" : ""}`} data-spotlight>
                <span className="rank">#{index + 1}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Identicon address={hunter.address} />
                  <a className="mono" href={`${EXPLORER}/address/${hunter.address}`} target="_blank" rel="noreferrer">
                    {shortAddress(hunter.address)} ↗
                  </a>
                </span>
                <strong style={{ fontSize: 26, letterSpacing: "-0.02em" }} className="num">
                  {gen(hunter.paid > hunter.staked ? hunter.paid - hunter.staked : 0n)} GEN
                </strong>
                <span className="muted small">
                  net earned · {hunter.filed} filed · {hunter.won} won · {hunter.slashes} slash{hunter.slashes === 1 ? "" : "es"}
                </span>
              </article>
            </Reveal>
          ))}
          {hunters.length === 0 && <div className="empty">No hunters yet. The first slash is still on the table.</div>}
        </div>
        {hunters.length > 3 && (
          <section className="panel scroll">
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Hunter</th>
                  <th>Filed</th>
                  <th>Won</th>
                  <th style={{ textAlign: "right" }}>Net earned</th>
                </tr>
              </thead>
              <tbody>
                {hunters.slice(3).map((hunter, index) => (
                  <tr key={hunter.address}>
                    <td className="num">{index + 4}</td>
                    <td className="mono">{shortAddress(hunter.address)}</td>
                    <td className="num">{hunter.filed}</td>
                    <td className="num">{hunter.won}</td>
                    <td className="num" style={{ textAlign: "right" }}>
                      {gen(hunter.paid > hunter.staked ? hunter.paid - hunter.staked : 0n)} GEN
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </section>

      <div className="split">
        <section className="main panel" aria-labelledby="bot-title">
          <div className="panel-head">
            <h2 id="bot-title">Run the patrol bot</h2>
            <span className="muted small">It caught today&apos;s rug pull and drove it to a slash in under two minutes.</span>
          </div>
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0 }} className="muted">
              The bot hashes each listed server with TBCM-1 on a timer. On a mismatch it stakes a drift challenge, then drives observe, judge and
              settle until the contract pays out. It logs one JSON line per event.
            </p>
            <div className="code-block">
              <pre className="code">{PATROL}</pre>
              <CopyButton text={PATROL} />
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Put one MCP URL per line in servers.txt and your testnet key in .env.local as DEV_PRIVATE_KEY. Never use a key that holds real funds.
            </p>
          </div>
        </section>
        <aside className="side panel" aria-labelledby="manual-title">
          <div className="panel-head">
            <h2 id="manual-title">Or hunt by hand</h2>
          </div>
          <ol className="feed">
            <li>
              <strong>Find a bonded server</strong>
              <span className="muted small">Open it from the registry and read its pinned tools, decoded.</span>
            </li>
            <li>
              <strong>Stake a challenge</strong>
              <span className="muted small">Drift for 0.5 GEN, content for 1 GEN, straight from the server page with a built-in test wallet.</span>
            </li>
            <li>
              <strong>Push it to settlement</strong>
              <span className="muted small">Observe, judge, settle. Anyone can press each button, so nothing stalls.</span>
            </li>
            <li>
              <strong>Withdraw</strong>
              <span className="muted small">Your share sits in the contract until you pull it from the wallet menu.</span>
            </li>
          </ol>
          <div className="panel-body" style={{ paddingTop: 0 }}>
            <Link className="button primary" href="/#registry" style={{ width: "100%" }}>
              Browse bonded servers <span className="arrow">→</span>
            </Link>
          </div>
        </aside>
      </div>
    </main>
  );
}
