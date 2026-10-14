import type { Metadata } from "next";
import { PublishWizard } from "@/components/publish-wizard";

export const metadata: Metadata = { title: "Publish a server" };

export default function PublishPage() {
  return (
    <main className="wrap page">
      <div className="page-head">
        <div>
          <span className="overline">Publish</span>
          <h1>Bond your MCP server.</h1>
          <p className="lede">
            Preview exactly what validators will hash, declare what the server is for, then register, pin and judge it in one flow.
            Every step is a GenLayer transaction you can follow live.
          </p>
        </div>
      </div>
      <PublishWizard />
    </main>
  );
}
