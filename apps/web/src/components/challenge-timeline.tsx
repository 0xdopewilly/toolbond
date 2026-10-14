import { EXPLORER, gen, shortAddress, shortHash } from "@/lib/format";
import type { Challenge, TxRef } from "@/lib/types";
import { Votes } from "./providers";

type Tone = "" | "good" | "bad" | "current";

interface Step {
  key: string;
  title: string;
  body: string;
  done: boolean;
  tone: Tone;
  tx?: TxRef;
}

function agreeCount(votes: string[]): string {
  const agree = votes.filter((v) => v === "agree").length;
  const disagree = votes.filter((v) => v === "disagree").length;
  return disagree ? `${agree} agree, ${disagree} disagree` : `${agree} agree`;
}

export function challengeSteps(challenge: Challenge): Step[] {
  const tx = (step: string) => challenge.txs?.find((item) => item.step === step);
  const closed = challenge.stage === "SETTLED" || challenge.stage === "EXPIRED";
  const observedDone = Boolean(challenge.drift) || challenge.kind === "CONTENT";
  const needsJudge = challenge.kind === "CONTENT" || challenge.drift === "DIFFERS";
  const steps: Step[] = [
    {
      key: "challenge",
      title: "Filed",
      body: `${challenge.kind === "DRIFT" ? "Drift" : "Content"} challenge${challenge.tool ? ` on ${challenge.tool}` : ""}, ${gen(challenge.stake)} GEN staked by ${shortAddress(challenge.hunter)}`,
      done: true,
      tone: "",
      tx: tx("challenge"),
    },
  ];
  if (challenge.kind === "DRIFT") {
    steps.push({
      key: "observe",
      title: challenge.drift ? `Observed · ${challenge.drift}` : "Observe",
      body: challenge.drift
        ? challenge.drift === "MATCH"
          ? "Every validator fetched the server itself: still the pinned bytes."
          : challenge.drift === "DIFFERS"
            ? `Validators agree the manifest changed: root ${shortHash(challenge.observed_root)}${challenge.changed.length ? `, ${challenge.changed.map((t) => t.name).join(", ")} modified` : ""}.`
            : `Validators agree: ${challenge.drift.toLowerCase()}.`
        : "Validators re-fetch the server and compare it with the pin.",
      done: observedDone,
      tone: challenge.drift === "DIFFERS" ? "bad" : challenge.drift === "MATCH" ? "good" : observedDone ? "" : "current",
      tx: tx("observe"),
    });
  }
  if (needsJudge || challenge.verdict) {
    steps.push({
      key: "judge",
      title: challenge.verdict ? `Judged · ${challenge.verdict}` : "Judge",
      body: challenge.verdict
        ? challenge.reason || "Two independent readings per validator."
        : "Each validator reads the verified text twice and must agree on one verdict word.",
      done: Boolean(challenge.verdict),
      tone: challenge.verdict === "POISONED" ? "bad" : challenge.verdict === "SAFE" ? "good" : observedDone && !challenge.verdict ? "current" : "",
      tx: tx("judge"),
    });
  }
  const payout = challenge.payout ?? {};
  steps.push({
    key: "settle",
    title: challenge.stage === "EXPIRED" ? "Expired · stake refunded" : closed ? "Settled" : "Settle",
    body: closed
      ? `Hunter ${gen(payout.hunter ?? "0")} GEN · pool ${gen(payout.pool ?? "0")} GEN · publisher ${gen(payout.publisher ?? "0")} GEN`
      : "Anyone can settle once the facts are in. The contract applies the payout table.",
    done: closed,
    tone: closed ? (challenge.verdict === "POISONED" ? "bad" : "good") : "",
    tx: tx("settle"),
  });
  return steps;
}

export function ChallengeTimeline({ challenge }: { challenge: Challenge }) {
  const steps = challengeSteps(challenge);
  return (
    <ol className="timeline">
      {steps.map((step) => (
        <li key={step.key} className={[step.done ? "done" : "", step.tone].filter(Boolean).join(" ")}>
          <span className="mark" aria-hidden="true" />
          <span className="step">
            <strong>{step.title}</strong>
            <span>{step.body}</span>
            {step.tx && (
              <span className="tx" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Votes votes={step.tx.votes} />
                <span>{agreeCount(step.tx.votes)}</span>
                <a href={`${EXPLORER}/tx/${step.tx.hash}`} target="_blank" rel="noreferrer">
                  {shortHash(step.tx.hash, 10, 4)} ↗
                </a>
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Four-segment progress bar for cards. */
export function StageBar({ challenge }: { challenge: Challenge }) {
  const order = ["FILED", "OBSERVED", "JUDGED", "SETTLED"];
  const reached = challenge.stage === "EXPIRED" ? 3 : order.indexOf(challenge.stage);
  const closed = challenge.stage === "SETTLED" || challenge.stage === "EXPIRED";
  const tone = challenge.verdict === "POISONED" ? " bad" : closed ? " good" : "";
  return (
    <div className="stagebar" aria-label={`Stage ${challenge.stage.toLowerCase()}`}>
      {order.map((stage, index) => (
        <i
          key={stage}
          className={index <= reached ? `on${tone}` : index === reached + 1 && !closed ? "live" : ""}
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </div>
  );
}
