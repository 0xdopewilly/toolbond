import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { ChallengeDiagram, LifecycleDiagram } from "@/components/docs/diagrams";
import { C, Callout, DocTitle, H2, Table } from "@/components/docs/prose";

export const metadata: Metadata = { title: "How it works · Docs" };

export default function HowItWorks() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Concepts"
        title="How it works"
        lede="Four moves: bond, pin, judge, patrol. Each is a transaction that GenLayer validators decide independently, and the contract keeps the score."
      />

      <H2>The four moves</H2>
      <Table
        head={["Move", "Contract call", "What validators agree on"]}
        rows={[
          ["Bond", <C key="1">register(url, purpose, caps)</C>, "Nothing yet: the bond (at least 10 GEN) and a 0.2 GEN review fee are recorded"],
          ["Pin", <C key="2">snapshot(sid)</C>, "The identical canonical digest of the live manifest, plus code-computed red flags"],
          ["Judge", <C key="3">review(sid)</C>, "A verdict word per batch of 6 tools: SAFE, POISONED or UNCLEAR"],
          ["Patrol", <C key="4">challenge · observe · judge · settle</C>, "Whether the live server still matches the pin, and whether a change is poisoned"],
        ]}
      />

      <H2>Server lifecycle</H2>
      <LifecycleDiagram />
      <p>
        A server is <strong>ACTIVE</strong> once every pinned tool is judged SAFE. A drift that turns out harmless (or unclear) makes it{" "}
        <strong>STALE</strong> until the publisher re-pins; guards keep allowing the pinned tools and block the changed ones. A poisoned tool, or a
        server that serves different manifests in a row, makes it <strong>SLASHED</strong>, and every guard blocks it from then on.
      </p>

      <H2>Challenge lifecycle</H2>
      <ChallengeDiagram />
      <p>
        A <strong>drift</strong> challenge claims the live manifest no longer matches the pin; validators first observe, then judge only the tools
        that changed. A <strong>content</strong> challenge claims a pinned tool was poisoned all along; it goes straight to judging. See{" "}
        <Link href="/docs/challenges">Challenges and payouts</Link> for every outcome.
      </p>

      <H2>Why validators can agree on non-deterministic work</H2>
      <p>
        GenLayer runs each write on a leader and checks it with validators that run their own copy. ToolBond writes the comparison rules so that
        honest validators converge and a dishonest leader cannot win:
      </p>
      <ul className="docs-list">
        <li>
          <strong>Fetching</strong> ends in exact equality: the same canonical text gives the same SHA-256, so a leader cannot invent tools.
        </li>
        <li>
          <strong>Judging</strong> compares only the verdict word, never the model&apos;s wording, and a POISONED claim must quote text that code
          finds in the tool.
        </li>
        <li>
          <strong>Safe harbours</strong> such as UNCLEAR and UNREACHABLE move no money, so when validators are unsure, nobody gets paid by mistake.
        </li>
      </ul>
      <Callout kind="note">
        Rulings follow GenLayer&apos;s Optimistic Democracy: a result can be appealed within the finality window, and a fresh, larger set of
        validators decides again.
      </Callout>

      <DocFooter slug="how-it-works" />
    </article>
  );
}
