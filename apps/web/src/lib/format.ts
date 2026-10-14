import type { Status, Verdict } from "./types";

const WEI = 10n ** 18n;

/** Wei (decimal string) to a short GEN amount, e.g. "10", "0.5", "0.0001". */
export function gen(wei: string | number | bigint): string {
  const value = BigInt(wei);
  const whole = value / WEI;
  const fraction = (value % WEI).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 4);
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function shortHash(hash: string, head = 8, tail = 4): string {
  return hash && hash.length > head + tail + 1 ? `${hash.slice(0, head)}…${hash.slice(-tail)}` : hash || "—";
}

export function shortAddress(address: string): string {
  return shortHash(address, 6, 4);
}

export function hostPath(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const TAG_FIRST = 0xe0000;
const TAG_LAST = 0xe007f;
const HIDDEN = new Set([0x00ad, 0x180e, 0xfeff]);
for (const [a, b] of [[0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069]]) {
  for (let c = a; c <= b; c += 1) HIDDEN.add(c);
}

export type Segment = { text: string; hidden: boolean };

/** Same rules as lib/redflags.reveal: tag runs become [[HIDDEN: …]], other invisibles ⟦U+XXXX⟧. */
export function revealSegments(text: string): Segment[] {
  const out: Segment[] = [];
  const chars = Array.from(text);
  let run = "";
  const flush = () => {
    if (run) out.push({ text: `[[HIDDEN: ${run}]]`, hidden: true });
    run = "";
  };
  chars.forEach((ch, index) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= TAG_FIRST && code <= TAG_LAST) {
      if (code >= 0xe0020 && code <= 0xe007e) run += String.fromCodePoint(code - TAG_FIRST);
      return;
    }
    flush();
    const joiner =
      code === 0x200d && index > 0 && index < chars.length - 1 &&
      (chars[index - 1].codePointAt(0) ?? 0) > 0x2000 && (chars[index + 1].codePointAt(0) ?? 0) > 0x2000;
    if (HIDDEN.has(code) && !joiner) {
      out.push({ text: `⟦U+${code.toString(16).toUpperCase().padStart(4, "0")}⟧`, hidden: true });
    } else if (out.length && !out[out.length - 1].hidden) {
      out[out.length - 1].text += ch;
    } else {
      out.push({ text: ch, hidden: false });
    }
  });
  flush();
  return out;
}

export type Tone = "good" | "warn" | "bad" | "info" | "neutral";

export function statusTone(status: Status | string): { label: string; tone: Tone } {
  switch (status) {
    case "ACTIVE":
      return { label: "Pinned", tone: "good" };
    case "STALE":
      return { label: "Stale", tone: "warn" };
    case "SLASHED":
      return { label: "Slashed", tone: "bad" };
    case "REJECTED":
      return { label: "Rejected", tone: "bad" };
    case "EXITING":
      return { label: "Exiting", tone: "neutral" };
    case "EXITED":
      return { label: "Exited", tone: "neutral" };
    case "PENDING_REVIEW":
      return { label: "In review", tone: "info" };
    default:
      return { label: "Pending", tone: "neutral" };
  }
}

export function verdictTone(verdict: Verdict | string): Tone {
  if (verdict === "SAFE") return "good";
  if (verdict === "POISONED") return "bad";
  if (verdict === "UNCLEAR") return "warn";
  return "neutral";
}

export const FLAG_LABELS: Record<string, string> = {
  H1: "Hidden characters",
  H2: "Secret location next to a send verb",
  H3: "Concealment from the user",
  H4: "Instruction override",
  H5: "Text addressed to the judge",
  S1: "Refers to a tool this server does not define",
  S2: "Long text, encoded blob or foreign link",
  S3: "Side-channel parameter that mentions files",
  S4: "Mentions credentials",
};

export const EXPLORER = "https://explorer-studio-dev.genlayer.com";
