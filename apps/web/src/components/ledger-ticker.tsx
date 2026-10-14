import { EXPLORER, shortHash } from "@/lib/format";
import { displayName } from "@/lib/names";
import type { Registry } from "@/lib/types";

interface Entry {
  hash: string;
  label: string;
  tone: "good" | "bad" | "warn" | "";
  votes: string[];
}

/** A slow, endless strip of real consensus events from the registry's transaction record. */
export function LedgerTicker({ registry }: { registry: Registry }) {
  const entries: Entry[] = [];
  for (const challenge of registry.challenges) {
    const server = registry.servers.find((s) => s.sid === challenge.sid);
    const name = server ? displayName(server.url) : challenge.sid;
    for (const tx of challenge.txs ?? []) {
      const outcome =
        tx.step === "judge" ? challenge.verdict : tx.step === "observe" ? challenge.drift : tx.step === "settle" ? challenge.stage : "filed";
      const tone = outcome === "POISONED" || outcome === "DIFFERS" ? "bad" : outcome === "SAFE" || outcome === "MATCH" ? "good" : "";
      entries.push({ hash: tx.hash, label: `${challenge.cid} · ${tx.step} · ${outcome || "—"} · ${name}`, tone, votes: tx.votes });
    }
  }
  for (const server of registry.servers) {
    for (const tx of server.txs ?? []) {
      entries.push({ hash: tx.hash, label: `${tx.step} · ${displayName(server.url)}`, tone: tx.step === "review" ? "good" : "", votes: tx.votes });
    }
  }
  if (entries.length < 3) return null;
  const loop = [...entries, ...entries];
  return (
    <div className="ledger" aria-label="Recent consensus transactions">
      <span className="ledger-label mono">
        <span className="live-dot" aria-hidden="true" /> Ledger
      </span>
      <div className="ledger-track">
        <div className="ledger-rail" style={{ animationDuration: `${entries.length * 6}s` }}>
          {loop.map((entry, index) => (
            <a
              key={index}
              className={`ledger-item ${entry.tone}`}
              href={`${EXPLORER}/tx/${entry.hash}`}
              target="_blank"
              rel="noreferrer"
              aria-hidden={index >= entries.length ? "true" : undefined}
              tabIndex={index >= entries.length ? -1 : undefined}
            >
              <span className="ledger-votes" aria-hidden="true">
                {entry.votes.map((vote, i) => (
                  <i key={i} className={vote} />
                ))}
              </span>
              <span>{entry.label}</span>
              <span className="mono ledger-hash">{shortHash(entry.hash, 6, 4)}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
