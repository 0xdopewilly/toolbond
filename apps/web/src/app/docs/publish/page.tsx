import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Code, Callout, DocTitle, H2, Step, Steps, Table } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Publish a server · Docs" };

export default function Publish() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Guides"
        title="Publish a server"
        lede="Bond your MCP server so guards can allow it, or sponsor a review of a server you rely on. The Publish page runs every step for you."
      />

      <H2>Choose a tier</H2>
      <Table
        head={["Tier", "Cost", "For", "At stake"]}
        rows={[
          [<strong key="b">Bonded</strong>, "≥ 10 GEN bond + 0.2 GEN review fee", "Your own server", "The bond: hunters claim it if you poison or swap a tool"],
          [<strong key="r">Sponsored review</strong>, "0.2 GEN review fee", "A server you use but do not run", "Nothing: pinned and judged, never slashed"],
        ]}
      />
      <p>
        Guards allow both tiers by default; <C>--bonded-only</C> allows only servers whose bond meets the 10 GEN minimum right now. A drift
        settlement can take a bond below it: the server then reads <strong>under-collateralized</strong>, and you restore it with{" "}
        <C>top_up</C> (the server page offers the exact amount) before you can re-pin. A bonded registration replaces a sponsored review of the
        same URL, as long as no challenge is open on it.
      </p>

      <H2>Prove you operate the server</H2>
      <p>
        Registering a URL does not make you its owner in anyone&apos;s eyes. To show that you run it, add this line to your server&apos;s MCP{" "}
        <C>instructions</C> (the text returned by <C>initialize</C>) before you pin:
      </p>
      <Code lang="text" title="server instructions">{`toolbond-owner:0x<the address you register with>`}</Code>
      <p>
        Validators fetch the instructions when they pin, so the proof is part of the hashed manifest. The registry then shows{" "}
        <strong>owner verified</strong>, and guards running <C>--owner-verified-only</C> accept the server.
      </p>

      <H2>Publish with the wizard</H2>
      <Steps>
        <Step title="Endpoint">
          Paste the Streamable HTTP endpoint. The preview fetches it the way validators will and shows every tool, its hash and the manifest root,
          with hidden characters decoded. Nothing is written yet.
        </Step>
        <Step title="Terms">
          Declare the purpose (up to 280 characters) and the capabilities your tools need: <C>network</C>, <C>filesystem</C>,{" "}
          <C>credentials</C>, <C>shell</C>, <C>payments</C> or <C>none</C>. The judge holds every tool to this purpose.
        </Step>
        <Step title="Publish">
          Three kinds of transaction run in order, each decided by validators: <C>register</C> (or <C>sponsor_review</C>), <C>snapshot</C> and one{" "}
          <C>review</C> per six tools. You see the votes and the verdict as they land.
        </Step>
      </Steps>
      <p>
        <Link href="/publish">Open the Publish page →</Link>
      </p>

      <H2>Outcomes</H2>
      <Table
        head={["Review result", "Status", "What to do"]}
        rows={[
          ["Every batch SAFE", "ACTIVE", "Nothing. Guards now allow your pinned tools."],
          ["A tool POISONED", "REJECTED", "10% of the bond goes to the treasury, the rest is claimable. Fix the server and register again."],
          ["UNCLEAR", "PENDING_REVIEW", "Remove the flagged wording, re-pin and run the review again. UNCLEAR costs nothing."],
        ]}
      />

      <H2>Changing your tools</H2>
      <p>
        Deploy the change, then re-pin straight away with <strong>Announce an update</strong> on your server page (only the publisher can re-pin an
        ACTIVE server). The server goes back to PENDING_REVIEW, which takes it out of reach of challenges until validators review the new version.
      </p>
      <Callout kind="warn" title="Unannounced changes cost money">
        If someone files a drift challenge before you re-pin, a harmless change pays the hunter 5% of your bond and marks the server STALE. A
        poisoned change, or a server that serves different manifests in a row, loses the whole bond.
      </Callout>

      <H2>Leaving</H2>
      <p>
        <C>request_exit</C> starts a 7-day delay: guards stop allowing the server, but challenges can still land. After the delay, with no challenge
        open, <C>finalize_exit</C> makes the bond claimable; <strong>Withdraw</strong> pays it out.
      </p>

      <DocFooter slug="publish" />
    </article>
  );
}
