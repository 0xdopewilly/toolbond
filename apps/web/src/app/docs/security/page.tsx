import type { Metadata } from "next";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, DocTitle, H2, Table } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Security model · Docs" };

export default function Security() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Reference"
        title="Security model"
        lede="What ToolBond guarantees, what it cannot, and what an independent audit of v1 found and v2 fixed."
      />

      <H2>What it guarantees</H2>
      <ul className="docs-list">
        <li>A guarded client only ever shows the model tool text whose exact bytes validators pinned and judged SAFE.</li>
        <li>Pins are what validators fetched themselves; no uploader, oracle or single reviewer is trusted.</li>
        <li>Prompt injection in tool text cannot produce SAFE: hard red flags are computed in code, and quotes must exist in the text.</li>
        <li>Money only moves on outcomes validators agreed on; uncertain outcomes refund.</li>
        <li>Payments are pull-based, and payable methods never revert, so a bad request cannot trap value.</li>
      </ul>

      <H2>What it cannot do</H2>
      <Table
        head={["Limit", "Why", "Mitigation"]}
        rows={[
          ["Cloaking", "A server could serve validators one manifest and other clients another.", "The guard hashes what your client receives, so cloaked tools are blocked locally even if no one is slashed."],
          ["Tool behaviour", "ToolBond judges descriptions, not what a tool's code does when called.", "Declared capabilities set the scope; pair it with sandboxing."],
          ["Model judgment", "A subtle poisoning might read as UNCLEAR.", "UNCLEAR never grants SAFE: the tool stays blocked until it is clarified."],
          ["Preview network", "Studio Next can reset, and its contract reads are currently failing.", "Every result is also recorded in transaction data; a public-testnet port is planned."],
        ]}
      />

      <H2>Audit findings fixed in v2</H2>
      <p>An independent review of v1 reproduced each issue below with tests before it was fixed. Every fix has a regression test.</p>
      <Table
        head={["Finding", "Fix"]}
        rows={[
          ["Nested _meta keys were left out of the hash, so a poisoned parameter could hide in them", "Only a tool's own top-level _meta is dropped; the guard forwards the hashed object"],
          ["observe(presence) let anyone turn a rug pull into a 25% slash", "observe is content-only; presence checks are attest"],
          ["Validators accepted a leader's UNSTABLE while seeing DIFFERS", "UNSTABLE and UNPINNED must be observed by each validator; UNSTABLE is a full slash"],
          ["A drift settle could revive a SLASHED server", "Settles never move SLASHED, EXITED or REJECTED servers"],
          ["One benign change could be slashed repeatedly while STALE", "The penalised drift is remembered (drift_root) and observes as KNOWN"],
          ["Only the first 4 changed tools were judged", "Riskiest first, flags across all, overflow cannot be SAFE"],
          ["A tool named __instructions__ erased its own red flags", "The name is reserved"],
          ["A sponsored review could exit with open challenges, or squat a URL", "Exit needs no open challenge; bonding replaces a review"],
          ["Some invisible characters were not flagged", "Variation selectors, fillers and more; emoji joiners excused only in place"],
          ["SSE parsing split on Unicode line separators", "Only CR, LF and CRLF end a line"],
          ["The manifest preview could be pointed at private addresses", "Public hosts only, DNS checked, no redirects, rate limited"],
          ["The guard trusted old snapshot pins and caches", "Snapshot pins expire after 7 days; the cache after 24 h"],
          ["The patrol bot could get stuck on a step someone else took", "It recognises taken and closed steps and moves on"],
        ]}
      />
      <Callout kind="note">
        Version 1 stays deployed with its history, including the first live rug pull. Version 2 is the live contract; both are listed on the FAQ
        page.
      </Callout>

      <H2>Reporting a problem</H2>
      <p>
        Open an issue on GitHub, or for anything sensitive, contact the maintainer privately first. Please include a reproduction: a direct-mode
        test in <C>tests/direct/</C> is the fastest way to show a contract bug.
      </p>

      <DocFooter slug="security" />
    </article>
  );
}
