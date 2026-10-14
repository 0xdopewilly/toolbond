import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { ChallengeDiagram } from "@/components/docs/diagrams";
import { C, Callout, DocTitle, H2, Table } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Challenges and payouts · Docs" };

export default function Challenges() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Concepts"
        title="Challenges and payouts"
        lede="Anyone can stake that a pinned server misbehaves. Validators establish the facts, the contract applies a fixed payout table, and payments wait in a claimable balance."
      />

      <H2>Two kinds of challenge</H2>
      <Table
        head={["Kind", "Claim", "Stake", "Steps"]}
        rows={[
          [<strong key="d">Drift</strong>, "The live manifest no longer matches the pin", "0.5 GEN", "observe → judge (if DIFFERS) → settle"],
          [<strong key="c">Content</strong>, "A pinned tool is poisoned as it stands", "1 GEN", "judge → settle"],
        ]}
      />
      <p>
        Servers can be challenged while ACTIVE, STALE or EXITING (the exit delay exists so challenges can still land). One open challenge per server
        for drift, and one per tool for content.
      </p>
      <ChallengeDiagram />

      <H2>Drift classes</H2>
      <Table
        head={["Class", "Meaning", "How validators accept it"]}
        rows={[
          [<C key="m">MATCH</C>, "Still the pinned root", "Identical observation"],
          [<C key="k">KNOWN</C>, "The drift an earlier settled challenge already penalised", "Identical observation"],
          [<C key="d">DIFFERS</C>, "Changed, the same way twice in a row", "Identical observation, so the stored changed tools are verified content"],
          [<C key="u">UNSTABLE</C>, "Two different manifests in a row", "Each validator must see it itself"],
          [<C key="p">UNPINNED</C>, "The server answered, but not with a valid manifest", "Each validator must see it itself"],
          [<C key="r">UNREACHABLE</C>, "Network or HTTP failure", "From any leader: it only refunds"],
        ]}
      />
      <p>
        When a drift differs, the changed tools are judged riskiest first (hard flags, then soft flags), at most four per ruling. Flags cover every
        changed tool, so a hard flag anywhere blocks SAFE; when more tools changed than one ruling covers, a SAFE reading becomes UNCLEAR.
      </p>

      <H2>Payout table</H2>
      <Table
        head={["Outcome", "Effect"]}
        rows={[
          ["Content · POISONED", "Whole bond slashed: half to the hunter, half to the protection pool. Stake back. Server SLASHED."],
          ["Content · SAFE", "The hunter's stake goes to the publisher."],
          ["Content · UNCLEAR", "Stake refunded; the server is marked contested."],
          ["Drift · MATCH or KNOWN", "Stake back minus 0.1 GEN to the publisher, so drift spam costs something."],
          ["Drift · DIFFERS → POISONED", "Whole bond slashed, split 50/50. Stake back. Server SLASHED."],
          ["Drift · DIFFERS → SAFE", "5% of the bond to the hunter for spotting an unannounced change. Server STALE until re-pinned."],
          ["Drift · DIFFERS → UNCLEAR", "Stake refunded. Server STALE."],
          ["Drift · UNSTABLE", "Whole bond slashed, split 50/50. Server SLASHED."],
          ["Drift · UNPINNED", "25% of the bond slashed, split 50/50. Server STALE."],
          ["Drift · UNREACHABLE", "Stake refunded; the server's unreachable counter goes up."],
        ]}
      />
      <Callout kind="note" title="Why UNSTABLE is a full slash">
        A pinned manifest already passed exact-equality consensus: every validator fetched it and got the same bytes. Serving different manifests
        in a row afterwards is a choice, and it must never be cheaper than serving poison.
      </Callout>

      <H2>Timeouts and exits</H2>
      <ul className="docs-list">
        <li>A challenge still FILED or OBSERVED after 72 hours can be expired by anyone: the hunter is refunded, minus the spam fee after a MATCH or KNOWN observation.</li>
        <li>A settle never moves a server out of SLASHED, EXITED or REJECTED, so concurrent challenges cannot revive a slashed server.</li>
        <li>A bonded publisher&apos;s exit takes 7 days and needs no open challenge to finalize. A sponsored review can exit only with no open challenge.</li>
      </ul>
      <p>
        Ready to hunt? See <Link href="/docs/hunt">Hunt for poisoned tools</Link>.
      </p>

      <DocFooter slug="challenges" />
    </article>
  );
}
