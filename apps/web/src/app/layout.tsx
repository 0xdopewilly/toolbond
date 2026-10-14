import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
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
  themeColor: "#111110",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>
          <Topbar />
          {children}
          <footer className="footer">
            <div className="wrap footer-inner">
              <span>
                Rulings are settled by GenLayer validators under Optimistic Democracy. Anyone can appeal within the finality
                window.
              </span>
              <span className="footer-links">
                <Link href="/guard">Guard</Link>
                <a href="https://github.com/0xdopewilly/toolbond/blob/main/docs/CONTRACT_API.md" target="_blank" rel="noreferrer">
                  Contract API
                </a>
                <a href="https://github.com/0xdopewilly/toolbond/blob/main/docs/TBCM-1.md" target="_blank" rel="noreferrer">
                  TBCM-1
                </a>
                <a className="mono" href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
                  {CONTRACT.slice(0, 8)}…{CONTRACT.slice(-6)} ↗
                </a>
              </span>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
