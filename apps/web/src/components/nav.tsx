"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Registry" },
  { href: "/challenges", label: "Challenges" },
  { href: "/guard", label: "Guard" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Primary">
      {LINKS.map((link) => {
        const current = link.href === "/" ? pathname === "/" || pathname.startsWith("/server") : pathname.startsWith(link.href);
        return (
          <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined}>
            {link.label}
          </Link>
        );
      })}
      <a href="https://github.com/0xdopewilly/toolbond" target="_blank" rel="noreferrer">
        GitHub
      </a>
    </nav>
  );
}
