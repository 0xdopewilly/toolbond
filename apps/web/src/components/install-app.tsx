"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { type InstallPlatform, browserName, inAppBrowser, installPlatform } from "@/lib/install-core";
import { SITE } from "@/lib/deployments";
import { CopyButton } from "./copy-button";
import { Tabs } from "./tabs";

// "Install the app": Chrome, Edge and Samsung Internet hand over their own install prompt
// (caught early by INSTALL_SCRIPT in layout.tsx), iPhone and iPad get the Add to Home Screen
// steps, and an app's built-in browser is told to open the page in a real browser first.

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

declare global {
  interface Window {
    __tbInstall?: PromptEvent | null;
    __tbInstalled?: boolean;
  }
}

export interface InstallState {
  ready: boolean;
  platform: InstallPlatform;
  browser: string;
  inApp: string | null;
  /** already running from the home screen */
  standalone: boolean;
  /** the browser offered its own install prompt */
  canPrompt: boolean;
  installed: boolean;
}

const SERVER_STATE: InstallState = { ready: false, platform: "desktop", browser: "", inApp: null, standalone: false, canPrompt: false, installed: false };
const STANDALONE = "(display-mode: standalone)";
let snapshot: InstallState | null = null;

function read(): InstallState {
  const ua = navigator.userAgent;
  return {
    ready: true,
    platform: installPlatform(ua, navigator.maxTouchPoints),
    browser: browserName(ua),
    inApp: inAppBrowser(ua),
    standalone: window.matchMedia(STANDALONE).matches || (navigator as { standalone?: boolean }).standalone === true,
    canPrompt: Boolean(window.__tbInstall),
    installed: Boolean(window.__tbInstalled),
  };
}

function subscribe(changed: () => void) {
  const update = () => {
    snapshot = null;
    changed();
  };
  const media = window.matchMedia(STANDALONE);
  window.addEventListener("toolbond:install", update);
  media.addEventListener("change", update);
  return () => {
    window.removeEventListener("toolbond:install", update);
    media.removeEventListener("change", update);
  };
}

export function useInstall(): InstallState {
  return useSyncExternalStore(subscribe, () => (snapshot ??= read()), () => SERVER_STATE);
}

/** The browser's own prompt when it offered one; otherwise the steps sheet. */
export async function startInstall() {
  const event = window.__tbInstall;
  if (event) {
    window.__tbInstall = null; // a prompt can be shown once
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === "accepted") window.__tbInstalled = true;
    window.dispatchEvent(new Event("toolbond:install"));
    return;
  }
  window.dispatchEvent(new Event("toolbond:install-open"));
}

function ShareIcon() {
  return (
    <svg className="inline-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" />
    </svg>
  );
}

/** Numbered steps, or bullets when the items are alternatives rather than a sequence. */
function Steps({ items, alternatives = false }: { items: ReactNode[]; alternatives?: boolean }) {
  const List = alternatives ? "ul" : "ol";
  return (
    <List className="install-steps">
      {items.map((item, index) => (
        <li key={index}>
          <span className={`install-step-n num${alternatives ? " dot" : ""}`} aria-hidden={alternatives || undefined}>
            {alternatives ? "" : index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </List>
  );
}

function OpenInBrowser({ app, platform }: { app: string; platform: InstallPlatform }) {
  const browser = platform === "ios" ? "Safari" : "Chrome";
  return (
    <div className="install-note warn">
      <p>
        You are in {app === "an app" ? "an app's" : `${app}'s`} built-in browser, which cannot install apps. Open this page in {browser} first: tap{" "}
        <b>•••</b> or <b>⋮</b> and choose <b>Open in {browser}</b> (or <b>Open in browser</b>), or copy the link and paste it there.
      </p>
      <CopyButton text={`${SITE}/install`} label="Copy link" />
    </div>
  );
}

export function IosSteps({ browser }: { browser: string }) {
  return (
    <Steps
      items={[
        browser === "Safari" || browser === "your browser" ? (
          <>
            Tap <b>Share</b> <ShareIcon />. If it is not in the toolbar, tap <b>•••</b> first.
          </>
        ) : (
          <>
            Tap <b>Share</b> <ShareIcon /> in {browser}&apos;s address bar or menu.
          </>
        ),
        <>
          Tap <b>Add to Home Screen</b>. Not in the list? Scroll down or tap <b>More</b>.
        </>,
        <>
          Keep <b>Open as Web App</b> on if you see it, then tap <b>Add</b>.
        </>,
      ]}
    />
  );
}

export function AndroidSteps({ browser }: { browser: string }) {
  return (
    <Steps
      items={[
        browser === "Samsung Internet" ? (
          <>
            Tap the menu <b>≡</b> at the bottom right.
          </>
        ) : (
          <>
            Tap the menu <b>⋮</b> at the top right of {browser === "your browser" ? "the browser" : browser}.
          </>
        ),
        <>
          Tap <b>Install app</b> or <b>Add to Home screen</b> (Samsung Internet: <b>Add page to</b> → <b>Home screen</b>).
        </>,
        <>
          Confirm with <b>Install</b>. ToolBond appears with your other apps.
        </>,
      ]}
    />
  );
}

export function DesktopSteps() {
  return (
    <Steps
      alternatives
      items={[
        <>
          <b>Chrome</b>: click the install icon at the right end of the address bar, or <b>⋮</b> → <b>Cast, save and share</b> →{" "}
          <b>Install page as app</b>.
        </>,
        <>
          <b>Edge</b>: <b>···</b> → <b>Apps</b> → <b>Install this site as an app</b>.
        </>,
        <>
          <b>Safari on a Mac</b>: <b>File</b> → <b>Add to Dock</b>.
        </>,
      ]}
    />
  );
}

function StepsFor({ state }: { state: InstallState }) {
  if (state.platform === "ios") return <IosSteps browser={state.browser} />;
  if (state.platform === "android") return <AndroidSteps browser={state.browser} />;
  return <DesktopSteps />;
}

/** Bottom sheet with the steps for this device. Mounted once in layout.tsx; startInstall() opens it. */
export function InstallSheet() {
  const state = useInstall();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("toolbond:install-open", show);
    return () => window.removeEventListener("toolbond:install-open", show);
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);

  if (!open) return null;
  return (
    <div className="sheet-backdrop install-backdrop" onClick={() => setOpen(false)}>
      <div className="sheet install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-sheet-title" onClick={(event) => event.stopPropagation()}>
        <span className="sheet-grip" aria-hidden="true" />
        <div className="install-sheet-head">
          <img src="/icons/icon-192.png" alt="" width={44} height={44} />
          <div>
            <h2 id="install-sheet-title">Add ToolBond to your {state.platform === "desktop" ? "computer" : "home screen"}</h2>
            <p>It opens full screen, like an app. No app store, no download.</p>
          </div>
        </div>
        {state.inApp && <OpenInBrowser app={state.inApp} platform={state.platform} />}
        <StepsFor state={state} />
        <div className="install-sheet-foot">
          <Link href="/install" className="linklike">
            Other devices and a QR code →
          </Link>
          <button type="button" className="button small" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Install app" row for the phone More sheet. Hidden inside the installed app. */
export function InstallSheetItem({ onBeforeOpen }: { onBeforeOpen: () => void }) {
  const state = useInstall();
  if (!state.ready || state.standalone) return null;
  return (
    <button
      type="button"
      className="sheet-item install-item"
      onClick={() => {
        onBeforeOpen();
        void startInstall();
      }}
    >
      <strong>{state.installed ? "Installed ✓" : "Install the app"}</strong>
      <span>{state.installed ? "Open ToolBond from your home screen" : "Add ToolBond to your home screen"}</span>
    </button>
  );
}

/** Small call to action under the hero, on phones and tablets only. */
export function InstallChip() {
  const state = useInstall();
  if (!state.ready || state.standalone || state.platform === "desktop" || state.installed) return null;
  return (
    <button type="button" className="install-chip" onClick={() => void startInstall()}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M12 7v7M9 11.5l3 3 3-3" />
      </svg>
      Get the app on your home screen
    </button>
  );
}

/** The /install page body: one button where the browser offers a prompt, steps for every device, and a QR code. */
export function InstallPanel() {
  const state = useInstall();
  if (!state.ready) return <div className="panel install-panel" style={{ minHeight: 280 }} aria-busy="true" />;

  const tabs = [
    { id: "iphone", label: "iPhone & iPad", content: <IosSteps browser={state.platform === "ios" ? state.browser : "Safari"} /> },
    { id: "android", label: "Android", content: <AndroidSteps browser={state.platform === "android" ? state.browser : "Chrome"} /> },
    { id: "computer", label: "Computer", content: <DesktopSteps /> },
  ];
  const initial = state.platform === "ios" ? "iphone" : state.platform === "android" ? "android" : "computer";

  return (
    <div className="install-layout">
      <section className="panel install-panel" aria-labelledby="install-how">
        <div className="panel-body">
          {state.standalone ? (
            <div className="install-note good">
              <p>
                <b>You are in the app.</b> ToolBond is already on this device.
              </p>
            </div>
          ) : state.installed ? (
            <div className="install-note good">
              <p>
                <b>Installed.</b> Open ToolBond from your {state.platform === "desktop" ? "apps" : "home screen"}.
              </p>
            </div>
          ) : state.canPrompt ? (
            <div className="install-cta">
              <button type="button" className="button primary" onClick={() => void startInstall()}>
                Install ToolBond
              </button>
              <span className="muted small">{state.browser} will ask you to confirm.</span>
            </div>
          ) : null}
          {state.inApp && !state.standalone && <OpenInBrowser app={state.inApp} platform={state.platform} />}
          <h2 id="install-how" className="install-h">
            {state.canPrompt ? "Or do it by hand" : "How to install"}
          </h2>
          <Tabs tabs={tabs} initial={initial} />
        </div>
      </section>

      <aside className="panel install-qr" aria-labelledby="install-qr-title">
        <div className="panel-body">
          <h2 id="install-qr-title" className="install-h">
            On a computer?
          </h2>
          <p className="muted small">Point your phone&apos;s camera at the code to open this page there, then follow the steps.</p>
          <img src="/install-qr.svg" alt={`QR code for ${SITE}/install`} width={176} height={176} />
          <span className="mono small muted">{SITE.replace("https://", "")}/install</span>
        </div>
      </aside>
    </div>
  );
}
