import type { ReactNode } from "react";
import { DocsSidebar } from "@/components/docs/sidebar";
import { DocsToc } from "@/components/docs/toc";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <main className="wrap docs-shell">
      <DocsSidebar />
      <div className="docs-main">{children}</div>
      <DocsToc />
    </main>
  );
}
