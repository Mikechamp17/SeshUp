import Link from "next/link";

/** Two letters for the logo tile, from the gym name. "NextLevel" and "Next Level" both give "NL". */
export function initials(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "S";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The dark header with the gym's logo tile and name. The accent colour comes from the --accent variable. */
export function Topbar({ name, sub, href }: { name: string; sub?: string; href?: string }) {
  const body = (
    <>
      <div className="logo" aria-hidden="true">{initials(name)}</div>
      <div className="stack" style={{ gap: 2 }}>
        <span className="gymname">{name}</span>
        {sub ? <span style={{ font: "500 13px/1.2 var(--font-body)", color: "#D8D8DC" }}>{sub}</span> : null}
      </div>
    </>
  );
  return href ? (
    <header className="topbar">
      <Link href={href} style={{ display: "flex", alignItems: "center", gap: 12, color: "inherit", textDecoration: "none" }}>
        {body}
      </Link>
    </header>
  ) : (
    <header className="topbar">{body}</header>
  );
}

/** Spots left as a badge. Every state has a word and a shape, never colour alone. */
export function SpotsBadge({ spotsLeft, bookable }: { spotsLeft: number; bookable: boolean }) {
  if (!bookable) return <span className="badge b-plain">Bookings not open</span>;
  if (spotsLeft <= 0) return <span className="badge b-full">Full</span>;
  if (spotsLeft <= 3) return <span className="badge b-low">Only {spotsLeft} left</span>;
  return <span className="badge b-open">{spotsLeft} spots left</span>;
}

/** Page frame for the signed-in and auth pages: header, then the content column. */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app">
      <Topbar name="SeshUp" />
      <main className="app-body pad">
        <h1 className="t-h1" style={{ marginBottom: 16 }}>{title}</h1>
        <div className="form-stack">{children}</div>
      </main>
    </div>
  );
}

export function Alert({ kind, title, children, role }: { kind?: "ok" | "warn" | "error" | "hold"; title?: string; children: React.ReactNode; role?: "alert" | "status" }) {
  return (
    <div className={`alert${kind ? ` a-${kind}` : ""}`} role={role}>
      <div>
        {title ? <b>{title}</b> : null}
        {children}
      </div>
    </div>
  );
}
