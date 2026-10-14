import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, DocTitle, H2, Table } from "@/components/docs/prose";
import { EXPLORER } from "@/lib/chain";
import { PINNEDFETCH_ADDRESS, PINNEDFETCH_V1_ADDRESS, TOOLBOND_ADDRESS, TOOLBOND_V1_ADDRESS } from "@/lib/deployments";

export const metadata: Metadata = { title: "FAQ · Docs" };

const addr = (a: string) => (
  <a href={`${EXPLORER}/address/${a}`} className="mono">
    {a.slice(0, 10)}…{a.slice(-6)}
  </a>
);

export default function Faq() {
  return (
    <article className="docs-article">
      <DocTitle eyebrow="Reference" title="FAQ" lede="Short answers to the questions people ask first." />

      <H2>Which network is this?</H2>
      <p>
        GenLayer Studio Next (chain 61997), the hosted developer network that runs GenLayer&apos;s newest consensus. It is not one of the public
        testnets (Asimov, Bradbury); a port to Bradbury is planned. Studio Next can be reset, so every deployment is recorded with its transactions.
      </p>
      <Table
        head={["Contract", "Live (v2)", "First version (v1)"]}
        rows={[
          ["ToolBond", addr(TOOLBOND_ADDRESS), addr(TOOLBOND_V1_ADDRESS)],
          ["PinnedFetch", addr(PINNEDFETCH_ADDRESS), addr(PINNEDFETCH_V1_ADDRESS)],
        ]}
      />

      <H2>Why does my wallet show a different GEN balance?</H2>
      <p>
        Studio Next keeps its own ledger. The faucet credits it, and it pays fees and stakes. Use <strong>Get test GEN</strong> in the wallet menu;
        GEN on the public testnets is a different chain.
      </p>

      <H2>What does it cost?</H2>
      <Table
        head={["Action", "Cost"]}
        rows={[
          ["Bond a server", "At least 10 GEN (returned when you exit) + 0.2 GEN review fee"],
          ["Sponsor a review", "0.2 GEN"],
          ["Drift challenge", "0.5 GEN stake (0.1 GEN kept if nothing changed)"],
          ["Content challenge", "1 GEN stake"],
          ["Any write", "A small fee deposit; unused budget is refunded"],
        ]}
      />

      <H2>Why are pages showing a snapshot?</H2>
      <p>
        Studio Next&apos;s contract reads (<C>gen_call</C>) have been failing for every contract on the network. Writes and consensus work, so the
        site reads results from transaction data and a published snapshot, and labels it clearly.
      </p>

      <H2>Does the guard slow my agent down?</H2>
      <p>
        It fetches the manifest when your client lists tools and before each call, plus a background check every 30 seconds by default. Calls go
        straight to the upstream server once allowed.
      </p>

      <H2>Can a publisher just change the description back?</H2>
      <p>
        A challenge is settled on what validators observe. Once they have observed the change, reverting does not undo it. Reverting before
        they look makes the server match again, and the guard blocked the changed tool in the meantime anyway. Flipping between manifests
        while validators watch is UNSTABLE: a full slash.
      </p>

      <H2>Where do I start?</H2>
      <p>
        <Link href="/docs/quickstart">Install the guard</Link>, <Link href="/publish">publish a server</Link>, or{" "}
        <Link href="/docs/hunt">go hunting</Link>.
      </p>

      <DocFooter slug="faq" />
    </article>
  );
}
