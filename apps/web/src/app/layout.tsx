import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/nav";
import { CONTRACT } from "@/lib/data";
import { EXPLORER } from "@/lib/format";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "ToolBond — bonded MCP tool manifests",
  description:
    "MCP servers whose tool manifests are pinned and judged by GenLayer validators. Poisoned or silently changed tools get the publisher's bond slashed.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <header className="topbar">
          <div className="wrap topbar-inner">
            <Link href="/" className="brand">
              <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
                <rect x="1" y="1" width="20" height="20" rx="4" fill="#111110" />
                <path d="M6 7.5h10M11 7.5v8M7.5 15.5h7" stroke="#F4F4F1" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              ToolBond
            </Link>
            <Nav />
            <span className="network mono">
              <span className="dot" aria-hidden="true" />
              Studio Next · 61997
            </span>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="wrap footer-inner">
            <span>
              Rulings are settled by GenLayer validators under Optimistic Democracy. Anyone can appeal within the
              finality window.
            </span>
            <a className="mono" href={`${EXPLORER}/address/${CONTRACT}`} target="_blank" rel="noreferrer">
              Contract {CONTRACT.slice(0, 10)}…{CONTRACT.slice(-6)}
            </a>
          </div>
        </footer>
      </body>
    </html>
  );
}
