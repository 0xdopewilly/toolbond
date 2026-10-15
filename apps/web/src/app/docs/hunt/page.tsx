import type { Metadata } from "next";
import Link from "next/link";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, Code, DocTitle, H2, Step, Steps, Table } from "@/components/docs/prose";
import { REPO, TOOLBOND_ADDRESS } from "@/lib/deployments";

export const metadata: Metadata = { title: "Hunt for poisoned tools · Docs" };

export default function Hunt() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Guides"
        title="Hunt for poisoned tools"
        lede="Every bond is a standing bounty. Catch a poisoned or rug-pulled tool and half the publisher's bond is yours, decided by validators, not by anyone's opinion."
      />

      <H2>By hand</H2>
      <Steps>
        <Step title="Find a target">
          Open a bonded server from the <Link href="/#registry">registry</Link> and read its pinned tools, decoded. Run the{" "}
          <Link href="/guard">browser guard check</Link> on it: a blocked tool means the live server differs from its pin.
        </Step>
        <Step title="Stake">
          On the server page choose <strong>Drift</strong> (0.5 GEN, the live manifest changed) or <strong>Content</strong> (1 GEN, a pinned tool is
          poisoned) and file.
        </Step>
        <Step title="Push it through">
          Press <strong>Observe</strong>, <strong>Judge</strong> and <strong>Settle</strong> as each becomes available. Anyone can press them, so
          nothing stalls on one person.
        </Step>
        <Step title="Withdraw">Your share lands in your claimable balance; withdraw it from the wallet menu.</Step>
      </Steps>
      <Callout kind="tip">
        A drift challenge on an unchanged server costs you the 0.1 GEN spam fee. Check first: the browser guard check and the patrol bot both tell
        you whether the live root differs from the pin.
      </Callout>

      <H2>With the patrol bot</H2>
      <p>
        The bot hashes each server you list on a timer. On a confirmed mismatch it files a drift challenge with its own stake and drives it to the
        end. When a server still matches, it sends an <C>attest</C> heartbeat at most every few hours. Every step is saved, so a restart resumes
        instead of filing twice.
      </p>
      <Code lang="bash" title="run the patrol bot">{`
git clone ${REPO} && cd toolbond && ./scripts/setup.sh
echo "DEV_PRIVATE_KEY=0x<testnet key>" > .env.local
.venv/bin/python bot/patrol.py --contract ${TOOLBOND_ADDRESS} --servers servers.txt
`}</Code>
      <Table
        head={["Option", "Default", "Meaning"]}
        rows={[
          [<C key="1">--contract</C>, "required", "ToolBond contract address"],
          [<C key="2">--rpc</C>, "Studio Next", "Where pins are read from: the contract, through this RPC"],
          [<C key="9">--pins-url / --pins-file</C>, "", "Opt-in alternatives to contract reads (the get_pins JSON shape)"],
          [<C key="3">--servers</C>, "keys of the pins file", "One MCP URL per line"],
          [<C key="4">--interval</C>, "600", "Seconds between rounds"],
          [<C key="5">--once</C>, "off", "Run one round and exit"],
          [<C key="6">--dry-run</C>, "off", "Log what it would send, send nothing"],
          [<C key="7">--attest-hours</C>, "6", "Minimum hours between heartbeats per server"],
          [<C key="8">--state</C>, ".patrol-state.json", "Where progress is saved"],
        ]}
      />
      <p>
        It writes one JSON line per event (<C>drift_detected</C>, <C>challenge_filed</C>, <C>observed</C>, <C>judged</C>, <C>settled</C>,{" "}
        <C>attested</C>), drives its own challenges whatever the server&apos;s status becomes, skips a drift that was already penalised, and moves on
        when someone else has already taken a step.
      </p>
      <Callout kind="warn">Use a key that holds only test GEN. Never put a key with real funds in a file.</Callout>

      <DocFooter slug="hunt" />
    </article>
  );
}
