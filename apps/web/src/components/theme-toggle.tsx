"use client";

import { useEffect, useState } from "react";

const KEY = "toolbond.theme";
type Mode = "light" | "dark";

function current(): Mode {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light or dark. Follows the system until the visitor picks one; the choice is remembered. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    setMode(current());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => {
      if (!document.documentElement.dataset.theme) setMode(current());
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const toggle = () => {
    const next: Mode = current() === "dark" ? "light" : "dark";
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.dataset.theme = next;
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    window.setTimeout(() => root.classList.remove("theme-switching"), 350);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      data-mode={mode}
      onClick={toggle}
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={mode === "dark" ? "Light mode" : "Dark mode"}
    >
      <svg className="sun" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <svg className="moon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13.5 9.6A5.6 5.6 0 016.4 2.5a5.6 5.6 0 107.1 7.1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
