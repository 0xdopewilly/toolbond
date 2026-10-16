"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { InstallSheetItem } from "./install-app";

// Bottom tab bar for phones (CSS shows it under 760px, where the top nav hides).
// Four destinations plus a "More" sheet, the way native apps keep a thumb's reach.

const icon = {
  registry: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  challenges: <path d="M12 3l8 4v5c0 4.4-3.4 8.3-8 9-4.6-.7-8-4.6-8-9V7zM9 12l2 2 4-4" />,
  publish: <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />,
  guard: <path d="M12 3l8 4v5c0 4.4-3.4 8.3-8 9-4.6-.7-8-4.6-8-9V7zM12 8v5M12 16h.01" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" />,
};

const TABS = [
  { href: "/", label: "Registry", icon: icon.registry, match: (p: string) => p === "/" || p.startsWith("/server") },
  { href: "/challenges", label: "Challenges", icon: icon.challenges, match: (p: string) => p.startsWith("/challenges") },
  { href: "/publish", label: "Publish", icon: icon.publish, match: (p: string) => p.startsWith("/publish") },
  { href: "/guard", label: "Guard", icon: icon.guard, match: (p: string) => p.startsWith("/guard") },
];

const MORE = [
  { href: "/hunters", label: "Hunters", note: "Bounties and the leaderboard" },
  { href: "/docs", label: "Docs", note: "How ToolBond works, the guard, the contract" },
  { href: "https://github.com/0xdopewilly/toolbond", label: "GitHub", note: "Source, tests and evidence", external: true },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function TabBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = MORE.some((item) => !item.external && pathname.startsWith(item.href));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  return (
    <>
      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-label="More" onClick={(event) => event.stopPropagation()}>
            <span className="sheet-grip" aria-hidden="true" />
            <InstallSheetItem onBeforeOpen={() => setOpen(false)} />
            {MORE.map((item) =>
              item.external ? (
                <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className="sheet-item">
                  <strong>{item.label} ↗</strong>
                  <span>{item.note}</span>
                </a>
              ) : (
                <Link key={item.href} href={item.href} className="sheet-item" aria-current={pathname.startsWith(item.href) ? "page" : undefined}>
                  <strong>{item.label}</strong>
                  <span>{item.note}</span>
                </Link>
              ),
            )}
          </div>
        </div>
      )}
      <nav className="tabbar" aria-label="Primary">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className="tab" aria-current={tab.match(pathname) ? "page" : undefined}>
            <Icon>{tab.icon}</Icon>
            <span>{tab.label}</span>
          </Link>
        ))}
        <button type="button" className="tab" aria-expanded={open} aria-current={moreActive ? "page" : undefined} onClick={() => setOpen((v) => !v)}>
          <Icon>{icon.more}</Icon>
          <span>More</span>
        </button>
      </nav>
    </>
  );
}
