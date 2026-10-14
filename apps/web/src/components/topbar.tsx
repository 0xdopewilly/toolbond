"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NetworkStatus } from "./ambient";
import { ThemeToggle } from "./theme-toggle";
import { WalletButton } from "./wallet-button";

const LINKS = [
  { href: "/", label: "Registry", match: (p: string) => p === "/" || p.startsWith("/server") },
  { href: "/challenges", label: "Challenges", match: (p: string) => p.startsWith("/challenges") },
  { href: "/hunters", label: "Hunters", match: (p: string) => p.startsWith("/hunters") },
  { href: "/publish", label: "Publish", match: (p: string) => p.startsWith("/publish") },
  { href: "/guard", label: "Guard", match: (p: string) => p.startsWith("/guard") },
  { href: "/docs", label: "Docs", match: (p: string) => p.startsWith("/docs") },
];

export function Topbar() {
  const pathname = usePathname();
  const [overHero, setOverHero] = useState(pathname === "/");

  useEffect(() => {
    if (pathname !== "/") {
      setOverHero(false);
      return;
    }
    const update = () => setOverHero(window.scrollY < 420);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [pathname]);

  return (
    <header className={`topbar${overHero ? " on-night" : ""}`}>
      <div className="wrap topbar-inner">
        <Link href="/" className="brand">
          <svg className="brand-mark" width="24" height="24" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="1" width="20" height="20" rx="5" />
            <path d="M6 7.5h10M11 7.5v8M7.5 15.5h7" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          ToolBond
        </Link>
        <nav className="nav" aria-label="Primary">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} aria-current={link.match(pathname) ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
          <a href="https://github.com/0xdopewilly/toolbond" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <div className="topbar-right">
          <button
            type="button"
            className="palette-trigger"
            onClick={() => window.dispatchEvent(new Event("toolbond:palette"))}
            aria-label="Search (Ctrl+K)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <NetworkStatus />
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
