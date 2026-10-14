"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Site-wide motion that needs no markup from pages:
 * - a top progress bar from the moment an internal link is clicked until the new route renders;
 * - a soft spotlight that follows the cursor over any element with [data-spotlight].
 */
export function Ambient() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      setState("loading");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    setState((current) => (current === "loading" ? "done" : current));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 500);
  }, [pathname]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const target = (event.target as HTMLElement)?.closest?.<HTMLElement>("[data-spotlight]");
      if (!target) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        target.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
        target.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  return <div className={`route-progress ${state}`} aria-hidden="true" />;
}

/** Live network status: block height and RPC round-trip, refreshed every 15 seconds. */
export function NetworkStatus() {
  const [status, setStatus] = useState<{ ok: boolean; ms: number; block: number } | null>(null);

  useEffect(() => {
    let stopped = false;
    const ping = async () => {
      const started = performance.now();
      try {
        const response = await fetch("https://studio-dev.genlayer.com/api", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
        });
        const body = (await response.json()) as { result?: string };
        if (!stopped) setStatus({ ok: Boolean(body.result), ms: Math.round(performance.now() - started), block: parseInt(body.result ?? "0", 16) });
      } catch {
        if (!stopped) setStatus({ ok: false, ms: 0, block: 0 });
      }
    };
    ping();
    const id = window.setInterval(ping, 15000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, []);

  const title = status
    ? status.ok
      ? `GenLayer Studio Next · chain 61997 · block ${status.block.toLocaleString("en")} · ${status.ms} ms`
      : "GenLayer Studio Next is not answering"
    : "Checking GenLayer Studio Next";
  return (
    <span className={`network mono${status && !status.ok ? " down" : ""}`} title={title}>
      <span className="dot" aria-hidden="true" />
      Studio Next
      <span className="network-ms num">{status?.ok ? `${status.ms} ms` : status ? "offline" : "…"}</span>
    </span>
  );
}
