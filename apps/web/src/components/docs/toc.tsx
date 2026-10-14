"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

/** "On this page": built from the article's headings, with scrollspy and a reading-progress rail. */
export function DocsToc() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".docs-article h2[id], .docs-article h3[id]"));
    setHeadings(nodes.map((node) => ({ id: node.id, text: node.dataset.title || node.textContent || "", level: node.tagName === "H2" ? 2 : 3 })));
    setActive(nodes[0]?.id ?? "");
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive((visible[0].target as HTMLElement).id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    const onScroll = () => {
      const article = document.querySelector<HTMLElement>(".docs-article");
      if (!article) return;
      const rect = article.getBoundingClientRect();
      const total = rect.height - window.innerHeight * 0.6;
      setProgress(Math.min(1, Math.max(0, -rect.top / Math.max(total, 1))));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);

  if (headings.length < 2) return <aside className="docs-toc" aria-hidden="true" />;
  return (
    <aside className="docs-toc" aria-label="On this page">
      <span className="docs-toc-title">On this page</span>
      <div className="docs-toc-rail">
        <span className="docs-toc-progress" style={{ transform: `scaleY(${progress})` }} aria-hidden="true" />
        <ol>
          {headings.map((heading) => (
            <li key={heading.id} className={`${heading.level === 3 ? "sub" : ""}${active === heading.id ? " active" : ""}`}>
              <a href={`#${heading.id}`}>{heading.text}</a>
            </li>
          ))}
        </ol>
      </div>
      <a className="docs-toc-top" href="#top" onClick={(event) => (event.preventDefault(), window.scrollTo({ top: 0, behavior: "smooth" }))}>
        Back to top ↑
      </a>
    </aside>
  );
}
