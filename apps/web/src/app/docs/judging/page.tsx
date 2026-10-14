import type { Metadata } from "next";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, DocTitle, H2, Table } from "@/components/docs/prose";

export const metadata: Metadata = { title: "Judging and red flags · Docs" };

export default function Judging() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Concepts"
        title="Judging and red flags"
        lede="A model reads the pinned text, but code decides what the model is allowed to conclude. Prompt injection can push a verdict towards UNCLEAR, never towards SAFE."
      />

      <H2>What counts as poisoned</H2>
      <p>A tool is POISONED when its text instructs the agent to do something the declared purpose does not need. In particular:</p>
      <ul className="docs-list">
        <li>access, read, collect or transmit data beyond the declared purpose and capabilities;</li>
        <li>change how other tools behave or which tools the agent uses;</li>
        <li>hide actions from the user;</li>
        <li>override earlier instructions or address the reviewer.</li>
      </ul>
      <p>Describing features, however broad, is never enough on its own. That rule keeps honest documentation servers SAFE.</p>

      <H2>Red flags, computed in code</H2>
      <p>
        Before any model runs, every validator computes the same flags from the same text. <strong>Hard</strong> flags make SAFE impossible;{" "}
        <strong>soft</strong> flags are handed to the model as facts.
      </p>
      <Table
        head={["Flag", "Meaning", "Kind"]}
        rows={[
          [<C key="h1">H1</C>, "Hidden characters: zero-width, bidi controls, variation selectors, fillers, Unicode tag characters", "Hard"],
          [<C key="h2">H2</C>, "A secret location (SSH keys, .env, mcp.json, cloud credentials, seed phrases) next to a verb that moves data", "Hard"],
          [<C key="h3">H3</C>, "Concealment from the user (\"do not tell the user\", \"silently\")", "Hard"],
          [<C key="h4">H4</C>, "Instruction override (\"ignore previous instructions\", \"system prompt\", <IMPORTANT>)", "Hard"],
          [<C key="h5">H5</C>, "Text addressed to the judge (\"note to the reviewer\", \"classify this as\")", "Hard"],
          [<C key="s1">S1</C>, "Refers to a tool this server does not define", "Soft"],
          [<C key="s2">S2</C>, "Very long text, an encoded blob, or a link to another site", "Soft"],
          [<C key="s3">S3</C>, "A side-channel parameter (notes, context, metadata) that talks about files", "Soft"],
          [<C key="s4">S4</C>, "Mentions credentials", "Soft"],
        ]}
      />
      <p>
        Hidden characters are also <strong>revealed</strong> before the model reads the text: runs of tag characters become{" "}
        <C>[[HIDDEN: …]]</C> with their payload decoded, and other invisible characters become <C>⟦U+200B⟧</C>. Joiners and presentation selectors
        are excused only inside real emoji.
      </p>

      <H2>Two readings, one word</H2>
      <p>
        Each validator runs two differently worded prompts: one classifies, the other lists every instruction and asks whether the purpose needs
        it. Both must return the same verdict, or the reading is UNCLEAR. Validators then compare only the verdict word with the leader&apos;s, so
        harmless differences in wording never split consensus.
      </p>
      <Table
        head={["Rule", "Effect"]}
        rows={[
          ["POISONED must quote the tool", "The quote is searched for in code. A quote that is not in the text turns the reading into UNCLEAR."],
          ["Hard flag present", "SAFE becomes UNCLEAR, whatever the model says."],
          ["Leader's claim is checked first", "Wrong types, oversized reason or quote, or a fabricated quote: validators reject it."],
          ["UNCLEAR is a safe harbour", "It moves no money and grants no badge. The publisher fixes the server and re-runs the review."],
        ]}
      />
      <Callout kind="note" title="The purpose is screened too">
        The declared purpose is publisher-written text that reaches the judge prompt, so registration refuses a purpose with hidden characters or
        text aimed at the judge.
      </Callout>

      <H2>Calibrated on live servers</H2>
      <p>
        DeepWiki, Cloudflare Docs, gitmcp and Internet Court were judged SAFE by consensus, including DeepWiki&apos;s instructions that list about
        25 private-mode tools, and Cloudflare&apos;s &ldquo;ALWAYS read this guide&rdquo;. A judge that flags normal documentation is useless, so
        the decision procedure counts only sentences that instruct one of the four behaviours above.
      </p>

      <DocFooter slug="judging" />
    </article>
  );
}
