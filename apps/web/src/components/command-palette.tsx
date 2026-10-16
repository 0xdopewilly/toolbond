"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOC_LIST, docHref } from "@/app/docs/nav";
import { REPO, SITE } from "@/lib/deployments";
import { startInstall } from "./install-app";
import { useTheme, useWallet } from "./providers";

interface Item {
  id: string;
  group: "Pages" | "Docs" | "Servers" | "Actions";
  title: string;
  hint?: string;
  run: () => void;
}

/** Subsequence match with a bonus for word starts; 0 means no match. */
function score(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let points = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    points += found === 0 || t[found - 1] === " " ? 3 : 1;
    ti = found + 1;
  }
  return points;
}

export function CommandPalette() {
  const router = useRouter();
  const wallet = useWallet();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [servers, setServers] = useState<{ sid: string; url: string; status: string }[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("toolbond:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("toolbond:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    window.setTimeout(() => input.current?.focus(), 10);
    if (!servers.length) {
      fetch("/api/servers")
        .then((r) => r.json())
        .then((body: { servers?: { sid: string; url: string; status: string }[] }) => setServers(body.servers ?? []))
        .catch(() => undefined);
    }
  }, [open, servers.length]);

  const close = useCallback(() => setOpen(false), []);
  const go = useCallback((href: string) => () => (router.push(href), close()), [router, close]);

  const items: Item[] = useMemo(
    () => [
      { id: "p-home", group: "Pages", title: "Registry", hint: "Every server and pin", run: go("/") },
      { id: "p-ch", group: "Pages", title: "Challenges", hint: "Stakes and rulings", run: go("/challenges") },
      { id: "p-hu", group: "Pages", title: "Hunters", hint: "Leaderboard and patrol bot", run: go("/hunters") },
      { id: "p-pu", group: "Pages", title: "Publish a server", hint: "Bond, pin, judge", run: go("/publish") },
      { id: "p-gu", group: "Pages", title: "Guard", hint: "Install and try it in the browser", run: go("/guard") },
      ...DOC_LIST.map((doc) => ({ id: "d-" + doc.slug, group: "Docs" as const, title: doc.title, hint: doc.blurb, run: go(docHref(doc.slug)) })),
      ...servers.map((s) => ({
        id: "s-" + s.sid,
        group: "Servers" as const,
        title: s.url.replace(/^https:\/\//, ""),
        hint: s.status.toLowerCase(),
        run: go(`/server/${s.sid}`),
      })),
      wallet.mode
        ? { id: "a-faucet", group: "Actions", title: "Get 25 test GEN", hint: "Studio faucet", run: () => (wallet.faucet(), close()) }
        : { id: "a-connect", group: "Actions", title: "Connect a wallet", hint: "Test wallet or browser extension", run: () => (wallet.openConnect(), close()) },
      { id: "a-theme", group: "Actions", title: theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode", run: () => (theme.toggle(), close()) },
      {
        id: "a-pins",
        group: "Actions",
        title: "Copy the pins URL for the guard",
        hint: `${SITE}/api/pins`,
        run: () => (navigator.clipboard?.writeText(`${SITE}/api/pins`), close()),
      },
      { id: "a-gh", group: "Actions", title: "Open the source on GitHub", run: () => (window.open(REPO, "_blank", "noreferrer"), close()) },
      { id: "a-install", group: "Actions", title: "Install the app", hint: "Home screen, dock or start menu", run: () => (close(), void startInstall()) },
    ],
    [go, servers, wallet, theme, close],
  );

  const results = useMemo(() => {
    return items
      .map((item) => ({ item, s: Math.max(score(query, item.title), score(query, item.hint ?? "") * 0.6) }))
      .filter((entry) => entry.s > 0)
      .sort((a, b) => (query ? b.s - a.s : 0))
      .slice(0, 40)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowDown") (event.preventDefault(), setActive((i) => Math.min(results.length - 1, i + 1)));
    else if (event.key === "ArrowUp") (event.preventDefault(), setActive((i) => Math.max(0, i - 1)));
    else if (event.key === "Enter") results[active]?.run();
  };

  let lastGroup = "";
  return (
    <div className="palette-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown}>
        <div className="palette-input">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, docs, servers and actions"
            aria-label="Search"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list}>
          {results.map((item, index) => {
            const header = item.group !== lastGroup ? item.group : "";
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  type="button"
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  className={index === active ? "active" : ""}
                  onMouseMove={() => setActive(index)}
                  onClick={item.run}
                >
                  <span className="palette-title">{item.title}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                  <span className="palette-enter" aria-hidden="true">
                    ↵
                  </span>
                </button>
              </div>
            );
          })}
          {results.length === 0 && <p className="palette-empty">Nothing matches “{query}”.</p>}
        </div>
        <div className="palette-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>⌘</kbd> <kbd>K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
