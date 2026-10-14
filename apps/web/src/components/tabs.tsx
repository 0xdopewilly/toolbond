"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface TabSpec {
  id: string;
  label: string;
  count?: number;
  alert?: boolean;
  content: ReactNode;
}

/** Accessible tabs; the open tab follows the URL hash so it can be linked to. */
export function Tabs({ tabs, initial }: { tabs: TabSpec[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (tabs.some((tab) => tab.id === fromHash)) setActive(fromHash);
  }, [tabs]);

  const select = (id: string) => {
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  };

  const onKey = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const next = (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    select(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div>
      <div className="tabs" role="tablist">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => onKey(event, index)}
          >
            {tab.label}
            {tab.count !== undefined && <span className={`count num${tab.alert ? " bad" : ""}`}>{tab.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((tab) =>
        tab.id === active ? (
          <div key={tab.id} id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} className="tab-panel">
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  );
}
