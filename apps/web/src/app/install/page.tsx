import type { Metadata } from "next";
import { InstallPanel } from "@/components/install-app";

export const metadata: Metadata = {
  title: "Install the app",
  description: "Put ToolBond on your phone, tablet or computer: it installs from the browser and opens full screen, like an app.",
};

export default function InstallPage() {
  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <span className="overline">App</span>
          <h1>ToolBond on your home screen.</h1>
          <p className="lede">
            It installs straight from the browser: no app store, no download, no sign-up. It opens full screen with its own icon and the
            same live registry, checks and challenges as this site.
          </p>
        </div>
      </div>

      <InstallPanel />

      <section className="install-perks" aria-label="What you get">
        <div>
          <strong>Full screen</strong>
          <p>Opens from its icon without the browser&apos;s address bar, and sits next to your other apps.</p>
        </div>
        <div>
          <strong>Shortcuts</strong>
          <p>Press and hold the icon on Android, or right-click it in Chrome or Edge on a computer, to jump to Check a server, Publish or Challenges.</p>
        </div>
        <div>
          <strong>Phone wallets</strong>
          <p>Connect MetaMask, Rainbow, Coinbase Wallet or any WalletConnect wallet, or use the built-in test wallet.</p>
        </div>
        <div>
          <strong>Always current</strong>
          <p>The app is the website, so every update reaches it as soon as it ships. There is nothing to update by hand.</p>
        </div>
      </section>
    </main>
  );
}
