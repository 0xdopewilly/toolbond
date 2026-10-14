"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DOCS, docHref } from "@/app/docs/nav";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Docs navigation with instant filtering and an active marker that slides between items. */
export function DocsSidebar() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DOCS;
    return DOCS.map((group) => ({
      ...group,
      items: group.items.filter((item) => `${item.title} ${item.blurb} ${item.keywords ?? ""}`.toLowerCase().includes(needle)),
    })).filter((group) => group.items.length);
  }, [query]);

  useIsoLayoutEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!active || !listRef.current) {
      setMarker(null);
      return;
    }
    const box = listRef.current.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    setMarker({ top: rect.top - box.top + listRef.current.scrollTop, height: rect.height });
  }, [pathname, groups]);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <aside className={`docs-sidebar${open ? " open" : ""}`} aria-label="Documentation">
      <button type="button" className="docs-menu-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Docs menu</span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="docs-sidebar-inner">
        <div className="docs-search">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <label htmlFor="docs-filter" className="sr-only">
            Filter docs
          </label>
          <input id="docs-filter" placeholder="Filter pages" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
        </div>
        <div className="docs-nav" ref={listRef}>
          {marker && <span className="docs-marker" style={{ transform: `translateY(${marker.top}px)`, height: marker.height }} aria-hidden="true" />}
          {groups.map((group) => (
            <div key={group.title} className="docs-group">
              <span className="docs-group-title">{group.title}</span>
              {group.items.map((item) => {
                const href = docHref(item.slug);
                const current = pathname === href;
                return (
                  <Link key={href} href={href} aria-current={current ? "page" : undefined}>
                    {item.title}
                  </Link>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && <p className="muted small">No page matches “{query}”.</p>}
        </div>
      </div>
    </aside>
  );
}
