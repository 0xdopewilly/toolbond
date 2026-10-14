import Link from "next/link";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { docHref, type DocLink } from "@/app/docs/nav";

/* ------------------------------------------------------------------ headings */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function H2({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? slugify(children);
  return (
    <h2 id={anchor} data-title={children} className="docs-h2">
      <a href={`#${anchor}`} className="anchor" aria-label={`Link to ${children}`}>
        #
      </a>
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: string; id?: string }) {
  const anchor = id ?? slugify(children);
  return (
    <h3 id={anchor} data-title={children} className="docs-h3">
      <a href={`#${anchor}`} className="anchor" aria-label={`Link to ${children}`}>
        #
      </a>
      {children}
    </h3>
  );
}

export function DocTitle({ eyebrow, title, lede }: { eyebrow: string; title: string; lede: ReactNode }) {
  return (
    <header className="docs-head">
      <span className="overline">{eyebrow}</span>
      <h1 id="top">{title}</h1>
      <p className="docs-lede">{lede}</p>
    </header>
  );
}

/* ------------------------------------------------------------------ code */

type Lang = "bash" | "json" | "python" | "ts" | "text";

const KEYWORDS: Record<Lang, RegExp | null> = {
  bash: /^(sudo|cd|git|npm|npx|uvx|uv|python3?|node|export|curl|claude|echo)$/,
  python: /^(def|return|import|from|as|if|elif|else|for|in|try|except|raise|class|with|lambda|None|True|False|and|or|not)$/,
  ts: /^(const|let|await|async|import|from|export|return|function|new|type|interface|if|else|true|false|null)$/,
  json: /^(true|false|null)$/,
  text: null,
};

/** A tiny tokenizer: strings, comments, numbers, flags and keywords. Server-rendered, no client JS. */
function highlight(code: string, lang: Lang): ReactNode[] {
  if (lang === "text") return [code];
  const out: ReactNode[] = [];
  const pattern =
    lang === "bash"
      ? /(#[^\n]*)|("(?:\\.|[^"\\])*"|'[^']*')|(\s--?[a-zA-Z][\w-]*)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][\w.-]*)/g
      : lang === "json"
        ? /()("(?:\\.|[^"\\])*")(\s*:)?|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_]\w*)/g
        : /(#[^\n]*|\/\/[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`)|()(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)/g;
  let last = 0;
  let key = 0;
  for (const match of code.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(code.slice(last, index));
    const [whole] = match;
    if (lang === "json") {
      const [, , str, colon, num, word] = match;
      if (str) out.push(<span key={key++} className={colon ? "tk-key" : "tk-str"}>{str}</span>, colon ?? "");
      else if (num) out.push(<span key={key++} className="tk-num">{num}</span>);
      else if (word && KEYWORDS.json?.test(word)) out.push(<span key={key++} className="tk-kw">{word}</span>);
      else out.push(whole);
    } else {
      const [, comment, str, flag, num, word] = match;
      if (comment) out.push(<span key={key++} className="tk-com">{comment}</span>);
      else if (str) out.push(<span key={key++} className="tk-str">{str}</span>);
      else if (flag) out.push(<span key={key++} className="tk-flag">{flag}</span>);
      else if (num) out.push(<span key={key++} className="tk-num">{num}</span>);
      else if (word && KEYWORDS[lang]?.test(word)) out.push(<span key={key++} className="tk-kw">{word}</span>);
      else if (word && lang !== "bash" && code[index + word.length] === "(") out.push(<span key={key++} className="tk-fn">{word}</span>);
      else out.push(whole);
    }
    last = index + whole.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function Code({ children, lang = "text", title }: { children: string; lang?: Lang; title?: string }) {
  const code = children.replace(/^\n+|\s+$/g, "");
  return (
    <figure className="docs-code">
      <figcaption>
        <span className="docs-code-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="docs-code-title">{title ?? (lang === "text" ? "" : lang)}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre>
        <code>{highlight(code, lang)}</code>
      </pre>
    </figure>
  );
}

/* ------------------------------------------------------------------ blocks */

const CALLOUT_ICON = {
  note: <path d="M8 7v4M8 4.6v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
  tip: <path d="M5.5 12h5M6 9.5a3.5 3.5 0 114 0V11H6z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />,
  warn: <path d="M8 4v4.5M8 11v.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />,
};

export function Callout({ kind = "note", title, children }: { kind?: "note" | "tip" | "warn"; title?: string; children: ReactNode }) {
  return (
    <aside className={`callout ${kind}`}>
      <span className="callout-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
          {CALLOUT_ICON[kind]}
        </svg>
      </span>
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </aside>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="docs-steps">{children}</ol>;
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <strong>{title}</strong>
      <div>{children}</div>
    </li>
  );
}

export function Cards({ items }: { items: DocLink[] }) {
  return (
    <div className="docs-cards">
      {items.map((item) => (
        <Link key={item.slug} href={docHref(item.slug)} className="docs-card" data-spotlight>
          <strong>{item.title}</strong>
          <span>{item.blurb}</span>
          <span className="docs-card-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="docs-table">
      <table>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function C({ children }: { children: ReactNode }) {
  return <code className="docs-inline">{children}</code>;
}
