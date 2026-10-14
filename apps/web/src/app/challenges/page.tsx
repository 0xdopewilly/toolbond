import Link from "next/link";
import { DataNotice } from "@/components/ui";
import { loadRegistry } from "@/lib/data";
import { gen, shortAddress } from "@/lib/format";

export const revalidate = 30;

export default async function ChallengesPage() {
  const registry = await loadRegistry();
  const hosts = new Map(registry.servers.map((server) => [server.sid, new URL(server.url).hostname]));

  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <h1>Challenges</h1>
          <p className="lede">
            Anyone can stake that a pinned tool is poisoned (CONTENT) or that a server no longer serves the pinned bytes
            (DRIFT). Validators re-fetch, judge only content every one of them verified, and the contract settles the
            stakes.
          </p>
        </div>
      </div>
      <DataNotice registry={registry} />
      <div className="panel scroll">
        <table style={{ minWidth: 760 }}>
          <thead>
            <tr>
              <th scope="col">Challenge</th>
              <th scope="col">Server</th>
              <th scope="col">Kind</th>
              <th scope="col">Hunter</th>
              <th scope="col">Stage</th>
              <th scope="col">Drift</th>
              <th scope="col">Verdict</th>
              <th scope="col" style={{ textAlign: "right" }}>
                Hunter payout
              </th>
            </tr>
          </thead>
          <tbody>
            {registry.challenges.map((challenge) => (
              <tr key={challenge.cid}>
                <td className="mono">{challenge.cid}</td>
                <td>
                  <Link href={`/server/${challenge.sid}`}>{hosts.get(challenge.sid) ?? challenge.sid}</Link>
                </td>
                <td>{challenge.kind}</td>
                <td className="mono">{shortAddress(challenge.hunter)}</td>
                <td>{challenge.stage}</td>
                <td>{challenge.drift || "—"}</td>
                <td>{challenge.verdict || "—"}</td>
                <td className="num" style={{ textAlign: "right" }}>
                  {challenge.payout?.hunter ? `${gen(challenge.payout.hunter)} GEN` : "—"}
                </td>
              </tr>
            ))}
            {registry.challenges.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No challenges yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
