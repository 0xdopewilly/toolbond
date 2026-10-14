import { revealSegments } from "@/lib/format";

// Word-level diff of two tool definitions, after hidden characters are made visible, so a
// smuggled instruction shows up as inserted text exactly where the model would have read it.

const TOKEN = /\[\[HIDDEN: [\s\S]*?\]\]|⟦U\+[0-9A-F]+⟧|\s+|[^\s]+/g;
const MAX_TOKENS = 4000;

type Op = { kind: "same" | "ins" | "del"; text: string };

function pretty(canon: string): string {
  try {
    return JSON.stringify(JSON.parse(canon), null, 2);
  } catch {
    return canon;
  }
}

function revealed(text: string): string {
  return revealSegments(text)
    .map((segment) => segment.text)
    .join("");
}

function tokens(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

function diff(a: string[], b: string[]): Op[] {
  if (a.length * b.length > MAX_TOKENS * MAX_TOKENS / 4) {
    return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "ins" as const, text }))];
  }
  // longest common subsequence, then walk it
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      ops.push({ kind: "del", text: a[i] });
      i += 1;
    } else {
      ops.push({ kind: "ins", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) ops.push({ kind: "del", text: a[i++] });
  while (j < b.length) ops.push({ kind: "ins", text: b[j++] });
  // merge neighbours of the same kind so highlights read as phrases
  return ops.reduce<Op[]>((merged, op) => {
    const last = merged[merged.length - 1];
    if (last && last.kind === op.kind) last.text += op.text;
    else merged.push({ ...op });
    return merged;
  }, []);
}

function Piece({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\[\[HIDDEN: [\s\S]*?\]\]|⟦U\+[0-9A-F]+⟧)/).map((part, index) =>
        /^(\[\[HIDDEN|⟦U\+)/.test(part) ? (
          <span key={index} className="hidden-char" title="Invisible characters, decoded">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function DiffView({ before, after }: { before: string; after: string }) {
  const ops = diff(tokens(revealed(pretty(before))), tokens(revealed(pretty(after))));
  return (
    <pre className="diff" aria-label="Changes between the pinned and the observed tool">
      {ops.map((op, index) =>
        op.kind === "same" ? (
          <Piece key={index} text={op.text} />
        ) : op.kind === "ins" ? (
          <ins key={index}>
            <Piece text={op.text} />
          </ins>
        ) : (
          <del key={index}>
            <Piece text={op.text} />
          </del>
        ),
      )}
    </pre>
  );
}
