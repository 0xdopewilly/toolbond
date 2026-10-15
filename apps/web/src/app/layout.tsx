import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Ambient } from "@/components/ambient";
import { CommandPalette } from "@/components/command-palette";
import { Providers } from "@/components/providers";
import { TabBar } from "@/components/tabbar";
import { Topbar } from "@/components/topbar";
import { CONTRACT } from "@/lib/data";
import { EXPLORER } from "@/lib/format";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: { default: "ToolBond: bonded MCP tool manifests", template: "%s · ToolBond" },
  description:
    "MCP servers whose tool manifests are pinned and judged by GenLayer validators. Poisoned or silently changed tools get the publisher's bond slashed.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0b" },
  ],
};

// Applies a saved theme before first paint, so a dark-mode visitor never sees a light flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem("toolbond.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <Ambient />
          <Topbar />
          {children}
          <CommandPalette />
          <TabBar />
          <footer className="footer">
            <div className="wrap footer-grid">
              <div className="footer-brand">
                <Link href="/" className="brand">
                  ToolBond
                </Link>
                <p>
                  Bonded MCP tool manifests, adjudicated by GenLayer validators. Rulings follow Optimistic Democracy: anyone can appeal within
                  the finality window.
                </p>
              </div>
              <nav aria-label="Product">
                <strong>Product</strong>
                <Link href="/">Registry</Link>
                <Link href="/publish">Publish</Link>
                <Link href="/challenges">Challenges</Link>
                <Link href="/hunters">Hunters</Link>
              </nav>
              <nav aria-label="Developers">
                <strong>Developers</strong>
                <Link href="/docs">Docs</Link>
                <Link href="/docs/quickstart">Quickstart</Link>
                <Link href="/docs/contract">Contract API</Link>
                <Link href="/guard">Guard</Link>
              </nav>
              <nav aria-label="Source">
                <strong>Source</strong>
                <a href="https://github.com/0xdopewilly/toolbond" target="_blank" rel="noreferrer">
                  ToolBond ↗
                </a>
                <a href="https://github.com/0xdopewilly/pinnedfetch" target="_blank" rel="noreferrer">
                  PinnedFetch ↗
                </a>
                <a className="mono" href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
                  {CONTRACT.slice(0, 8)}…{CONTRACT.slice(-6)} ↗
                </a>
              </nav>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
