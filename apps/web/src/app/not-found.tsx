import Link from "next/link";

export default function NotFound() {
  return (
    <main className="wrap not-found">
      <div>
        <div className="big">404</div>
        <h1 style={{ fontSize: 26 }}>Nothing pinned at this address.</h1>
        <p className="muted">The server or page you asked for is not in the registry.</p>
        <div className="actions" style={{ justifyContent: "center", marginTop: 16 }}>
          <Link className="button primary" href="/">
            Back to the registry
          </Link>
          <Link className="button" href="/publish">
            Publish a server
          </Link>
        </div>
      </div>
    </main>
  );
}
