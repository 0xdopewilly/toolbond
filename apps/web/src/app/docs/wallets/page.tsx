import type { Metadata } from "next";
import { DocFooter } from "@/components/docs/doc-footer";
import { C, Callout, DocTitle, H2, Step, Steps, Table } from "@/components/docs/prose";
import { EXPLORER, STUDIO_RPC } from "@/lib/chain";

export const metadata: Metadata = { title: "Wallets and test GEN · Docs" };

export default function Wallets() {
  return (
    <article className="docs-article">
      <DocTitle
        eyebrow="Getting started"
        title="Wallets and test GEN"
        lede="ToolBond runs on GenLayer Studio Next. Connect any browser wallet, or use the built-in test wallet, and fund it from the faucet in one click."
      />

      <H2>Choose a wallet</H2>
      <Table
        head={["Wallet", "Best for", "How it signs"]}
        rows={[
          [<strong key="t">ToolBond test wallet</strong>, "Trying everything in seconds, no extension", "A key kept in this browser's local storage, signed locally"],
          [<strong key="b">Browser wallet</strong>, "MetaMask, Rabby, Brave, Phantom and other extensions", "Your extension, found automatically (EIP-6963)"],
        ]}
      />
      <p>
        Click <strong>Connect wallet</strong> in the header. The test wallet sits at the top of the list. Browser wallets appear as soon as their
        extension announces itself; with several installed, each one is listed separately.
      </p>
      <Callout kind="warn" title="The test wallet is for test GEN only">
        Its private key lives in this browser&apos;s storage. Clearing site data loses it, and anything with access to the page could read it.
        Never send it real funds.
      </Callout>

      <H2>Add Studio Next to your wallet</H2>
      <p>The site asks your wallet to add and switch to the network before the first transaction. To add it by hand:</p>
      <Table
        head={["Field", "Value"]}
        rows={[
          ["Network name", "GenLayer Studio Next"],
          ["RPC URL", <C key="r">{STUDIO_RPC}</C>],
          ["Chain ID", <C key="c">61997</C>],
          ["Currency symbol", <C key="s">GEN</C>],
          ["Block explorer", <C key="e">{EXPLORER}</C>],
        ]}
      />

      <H2>Get test GEN</H2>
      <Steps>
        <Step title="Connect">Pick a wallet from the header.</Step>
        <Step title="Open the wallet menu">Click your address in the header.</Step>
        <Step title="Get test GEN">25 GEN arrives in a few seconds, enough for a bond and several challenges. One request per minute per address.</Step>
      </Steps>
      <p>
        The menu also shows your <strong>claimable</strong> balance: refunds, rewards and hunter shares the contract owes you. ToolBond never pushes
        payments; <strong>Withdraw</strong> pulls them to your wallet.
      </p>

      <H2>What a transaction looks like</H2>
      <p>
        Every write estimates its fees first, then you sign. A toast follows it: waiting for signature, submitted, validators voting, done. The
        squares in the toast are the validators&apos; votes as they arrive. Writes that fetch the web or call a model take tens of seconds.
      </p>

      <DocFooter slug="wallets" />
    </article>
  );
}
