import type { ReactNode } from "react";
import { revealSegments, statusTone, verdictTone, type Tone } from "@/lib/format";
import type { Registry, Status } from "@/lib/types";

const ICONS: Record<Tone, ReactNode> = {
  good: <path d="M1.5 5.2l2.4 2.3L8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />,
  bad: <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  warn: <path d="M5 1.5v4.5M5 8.2v.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />,
  info: <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />,
  neutral: <circle cx="5" cy="5" r="1.6" fill="currentColor" />,
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge ${tone}`}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        {ICONS[tone]}
      </svg>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status | string }) {
  const { label, tone } = statusTone(status);
  return <Badge tone={tone}>{label}</Badge>;
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const label = verdict ? verdict.charAt(0) + verdict.slice(1).toLowerCase() : "Unreviewed";
  return <Badge tone={verdictTone(verdict)}>{label}</Badge>;
}

/** Text with invisible characters rendered visibly, the way validators reveal them to the judge. */
export function Revealed({ text }: { text: string }) {
  return (
    <>
      {revealSegments(text).map((segment, index) =>
        segment.hidden ? (
          <span key={index} className="hidden-char" title="Invisible characters, decoded">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function DataNotice({ registry }: { registry: Registry }) {
  if (registry.live) return null;
  return (
    <p className="notice" role="status">
      <strong>Not live contract state.</strong>
      <span>
        {registry.as_of
          ? `Contract reads failed for this request, so this page shows a stored snapshot from ${new Date(registry.as_of).toUTCString()}. It is not authoritative: check the transactions on the explorer, or reload.`
          : "Contract reads failed for this request and no snapshot of this contract is stored, so nothing is shown. Reload, or read the contract on the explorer."}
      </span>
    </p>
  );
}
