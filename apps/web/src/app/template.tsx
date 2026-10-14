import type { ReactNode } from "react";

// Re-mounted on every navigation, so each page enters with the same soft rise.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
