// View shapes from docs/CONTRACT_API.md.

export type Status =
  | "PENDING_SNAPSHOT"
  | "PENDING_REVIEW"
  | "ACTIVE"
  | "STALE"
  | "REJECTED"
  | "SLASHED"
  | "EXITING"
  | "EXITED";

export type Verdict = "UNREVIEWED" | "SAFE" | "UNCLEAR" | "POISONED";

export interface ToolRow {
  name: string;
  hash: string;
  canon: string;
  verdict: Verdict;
  reason: string;
  quote: string;
}

export interface Server {
  found: true;
  sid: string;
  url: string;
  publisher: string;
  tier: "BONDED" | "REVIEWED";
  status: Status;
  purpose: string;
  caps: string;
  bond: string;
  root: string;
  protocol: string;
  instructions: string;
  instructions_hash: string;
  flags: Record<string, string[]>;
  tools: ToolRow[];
  reviewed: number;
  slashes: number;
  unreachable: number;
  contested: boolean;
  open_challenges: number;
  last_attest: string;
  created_at: string;
  updated_at: string;
  last_verified_at: string;
}

export interface ChangedTool {
  name: string;
  hash: string;
  canon: string;
}

export interface Challenge {
  found: true;
  cid: string;
  sid: string;
  tool: string;
  kind: "CONTENT" | "DRIFT";
  hunter: string;
  stake: string;
  stage: "FILED" | "OBSERVED" | "JUDGED" | "SETTLED" | "EXPIRED";
  drift: string;
  observed_root: string;
  changed: ChangedTool[];
  changed_flags: Record<string, string[]>;
  instructions_changed: boolean;
  verdict: string;
  offending: string;
  quote: string;
  reason: string;
  attempts: number;
  filed_at: string;
  updated_at: string;
  payout: { hunter?: string; pool?: string; publisher?: string };
}

export interface Stats {
  servers: number;
  active: number;
  slashed: number;
  bonded: string;
  pool: string;
  challenges: number;
  open_challenges: number;
  pins: number;
  checks: number;
  slashes: number;
}

export interface Pins {
  known: boolean;
  sid?: string;
  url: string;
  status?: Status;
  tier?: string;
  root?: string;
  tools?: Record<string, string>;
  verdicts?: Record<string, Verdict>;
  open_challenges?: number;
  updated_at?: string;
}

export interface Registry {
  live: boolean;
  as_of: string;
  contract: string;
  servers: Server[];
  challenges: Challenge[];
  stats: Stats;
}
