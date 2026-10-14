import Link from "next/link";
import { docHref, neighbours } from "@/app/docs/nav";
import { REPO } from "@/lib/deployments";

export function DocFooter({ slug }: { slug: string }) {
  const { prev, next } = neighbours(slug);
  const file = slug ? `apps/web/src/app/docs/${slug}/page.tsx` : "apps/web/src/app/docs/page.tsx";
  return (
    <footer className="docs-footer">
      <div className="docs-pager">
        {prev ? (
          <Link href={docHref(prev.slug)} className="docs-pager-link" data-spotlight>
            <span>← Previous</span>
            <strong>{prev.title}</strong>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={docHref(next.slug)} className="docs-pager-link next" data-spotlight>
            <span>Next →</span>
            <strong>{next.title}</strong>
          </Link>
        )}
      </div>
      <a className="docs-edit small" href={`${REPO}/blob/main/${file}`} target="_blank" rel="noreferrer">
        Edit this page on GitHub ↗
      </a>
    </footer>
  );
}
