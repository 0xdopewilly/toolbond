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
        lede="ToolBond protects manifest integrity: the tool text an agent reads is the exact text validators fetched, pinned and judged. This page says what that guarantees, what it does not, and what each label in the registry means."
      />

      <H2>What it guarantees</H2>
      <ul className="docs-list">
        <li>
          A guarded client only shows the model tool text whose exact bytes validators pinned and judged SAFE, according to a contract read made
          on that refresh. Unverifiable approvals block tools by default.
        </li>
        <li>Pins are what validators fetched themselves; no uploader, oracle or single reviewer is trusted.</li>
        <li>Prompt injection in tool text cannot produce SAFE: hard red flags are computed in code, and quotes must exist in the text.</li>
        <li>
          A server labelled BONDED has at least 10 GEN at stake right now. When a drift settlement takes it below that, it reads
          UNDERCOLLATERALIZED and cannot return to ACTIVE until the publisher tops it up.
        </li>
        <li>
          Value is conserved: <C>get_accounting</C> shows that the balance equals bonds, pool, claimable balances and open stakes, and the tests
          check it after every payout row.
        </li>
      </ul>

      <H2>What it does not guarantee</H2>
      <Table
        head={["Limit", "Why", "What to do"]}
        rows={[
          ["Tool behaviour", "ToolBond judges what a tool says, not what its code does when called or what it returns.", "Keep your client's sandboxing and permission prompts; declared capabilities set the expected scope."],
          ["Server ownership", "Anyone can register any URL. A registrant is not the operator unless the pinned instructions say so.", "Look for owner verified, or run the guard with --owner-verified-only."],
          ["Reviewed servers", "A sponsored review pins and judges a server but puts no money behind it: nothing is slashed if it changes.", "The guard still blocks any change; use --bonded-only to require a bond."],
          ["Cloaking", "A server could show validators one manifest and other clients another.", "The guard hashes what your client receives, so cloaked tools are blocked locally even if no one is slashed."],
          ["Model judgment", "A subtle poisoning might read as UNCLEAR.", "UNCLEAR never grants SAFE: the tool stays blocked until it is clarified."],
          ["The RPC you read through", "A contract read is as honest as the node that answers it. Studio Next is a hosted preview network that can reset.", "Point --rpc at a node you trust; a public-testnet port is planned."],
        ]}
      />

      <H2>What the labels mean</H2>
      <Table
        head={["Label", "Meaning"]}
        rows={[
          ["Bonded", "The registrant staked GEN and the bond meets the 10 GEN minimum now. It is slashed for poisoned or unannounced changes."],
          ["Under-collateralized", "Registered with a bond, but drift settlements took it below the minimum. Not counted as bonded until topped up."],
          ["Reviewed, no bond", "Someone paid validators to pin and judge a third-party server. Nothing is at stake."],
          ["Owner verified", "The pinned MCP instructions contain toolbond-owner:<registrant address>, which validators fetched themselves."],
          ["Registrant", "Whoever registered the URL. Without owner verification, this says nothing about who runs the server."],
          ["Contract read / stored snapshot", "Live pages read the contract for each request. If that fails, a stored copy of the views may be shown, labelled, and never as current state."],
        ]}
      />

      <H2>Findings from the version 2 review, fixed in version 3</H2>
      <Table
        head={["Finding", "Fix"]}
        rows={[
          [
            "A BONDED server could keep advertising bonded assurance after drift rewards took its bond below 10 GEN, and re-pin back to ACTIVE",
            "get_pins reports assurance; below the minimum it reads UNDERCOLLATERALIZED, snapshot and review refuse to reactivate it, and top_up restores it",
          ],
          [
            "The guard trusted unauthenticated relay answers and old snapshots like contract state",
            "The guard reads the contract with gen_call by default and fails closed; relays, caches and snapshots are opt-in and labelled",
          ],
          [
            "Registrants and reviews could read as verified owners and bonded assurance",
            "owner_verified needs an owner proof in the pinned instructions; REVIEWED and UNDERCOLLATERALIZED are shown as such everywhere",
          ],
          [
            "Accounting could not be checked from outside",
            "get_accounting returns every bucket and whether it reconciles with the balance",
          ],
        ]}
      />

      <H2>Findings from the version 1 audit, fixed in version 2</H2>
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
          ["The patrol bot could get stuck on a step someone else took", "It recognises taken and closed steps and moves on"],
        ]}
      />
      <Callout kind="note">
        Versions 1 and 2 stay deployed with their history, including the first live rug pulls. Version 3 is the live contract; every version is
        listed on the FAQ page and in docs/DEPLOYMENTS.md.
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
