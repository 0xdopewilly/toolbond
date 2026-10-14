"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { gen, hostPath, relativeTime, shortHash, statusTone } from "@/lib/format";
import { displayName, initial } from "@/lib/names";
import type { ServerRow } from "@/lib/rows";
import { StatusBadge } from "./ui";

const FILTERS = [
  { key: "all", label: "All", test: () => true },
  { key: "bonded", label: "Bonded", test: (s: ServerRow) => s.tier === "BONDED" },
  { key: "reviewed", label: "Reviewed", test: (s: ServerRow) => s.tier === "REVIEWED" },
  { key: "pinned", label: "Pinned", test: (s: ServerRow) => s.status === "ACTIVE" },
  { key: "stale", label: "Stale", test: (s: ServerRow) => s.status === "STALE" },
  { key: "slashed", label: "Slashed", test: (s: ServerRow) => s.status === "SLASHED" || s.status === "REJECTED" },
];

export function RegistryList({ servers }: { servers: ServerRow[] }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !/input|textarea|select/i.test(target.tagName)) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, servers.filter(f.test).length])), [servers]);
  const shown = useMemo(() => {
    const test = FILTERS.find((f) => f.key === filter)?.test ?? (() => true);
    const needle = query.trim().toLowerCase();
    return servers.filter(
      (server) =>
        test(server) &&
        (!needle ||
          server.url.toLowerCase().includes(needle) ||
          server.purpose.toLowerCase().includes(needle) ||
          server.tools.some((tool) => tool.name.toLowerCase().includes(needle))),
    );
  }, [servers, filter, query]);

  return (
    <div>
      <div className="registry-tools">
        <div className="search">
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <label htmlFor="registry-search" className="sr-only">
            Search servers
          </label>
          <input
            id="registry-search"
            ref={input}
            className="input"
            type="search"
            placeholder="Search servers, purposes or tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          {!query && <kbd aria-hidden="true">/</kbd>}
        </div>
        <div className="segmented" role="group" aria-label="Filter by state">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              <span className="count num">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="list-head" aria-hidden="true">
        <span>Server</span>
        <span>State</span>
        <span>Tier</span>
        <span style={{ textAlign: "right" }}>Tools</span>
        <span>Pinned root</span>
        <span />
      </div>
      <div className="server-list">
        {shown.map((server, index) => (
          <Link
            key={server.sid}
            href={`/server/${server.sid}`}
            className={`server-row ${statusTone(server.status).tone}`}
            style={{ animationDelay: `${index * 45}ms` }}
          >
            <span className="id">
              <span className="favicon" aria-hidden="true">
                {initial(server.url)}
              </span>
              <span className="names">
                <span className="name">{displayName(server.url)}</span>
                <span className="url mono">{hostPath(server.url)}</span>
              </span>
            </span>
            <span>
              <span className="cell-label">State</span>
              <StatusBadge status={server.status} />
            </span>
            <span className="tier">
              <span className="cell-label">Tier</span>
              {server.tier === "BONDED" ? (
                <>
                  Bonded <span className="muted num">· {gen(server.bond)} GEN</span>
                </>
              ) : (
                "Reviewed"
              )}
            </span>
            <span className="num" style={{ textAlign: "right" }}>
              <span className="cell-label">Tools</span>
              {server.tools.length}
            </span>
            <span className="mono small" title={`Last verified ${relativeTime(server.last_verified_at)}`}>
              <span className="cell-label">Pinned root</span>
              {shortHash(server.root)}
            </span>
            <svg className="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        ))}
        {shown.length === 0 && (
          <div className="empty">
            <strong>No servers match.</strong>
            <p style={{ margin: "6px 0 0" }}>
              <button type="button" className="button small" onClick={() => (setQuery(""), setFilter("all"))}>
                Clear search and filters
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
