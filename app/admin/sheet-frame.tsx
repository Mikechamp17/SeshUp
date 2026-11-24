import Link from "next/link";
import type { ReactNode } from "react";

/** The bottom sheet used by every owner confirmation: scrim, handle, heading, content, and a way back. */
export function SheetFrame({
  eyebrow,
  title,
  subtitle,
  ariaLabel,
  closeHref,
  closeLabel = "Close",
  scrimLabel = "Close and go back",
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  ariaLabel: string;
  closeHref: string;
  closeLabel?: string;
  scrimLabel?: string;
  children: ReactNode;
}) {
  return (
    <>
      <Link className="scrim" scroll={false} href={closeHref} aria-label={scrimLabel} />
      <div className="sheet" role="dialog" aria-label={ariaLabel}>
        <div className="grab" />
        <div className="stack" style={{ gap: 4 }}>
          <span className="t-eyebrow">{eyebrow}</span>
          <h2 className="t-h1">{title}</h2>
          {subtitle ? <p style={{ fontWeight: 700 }}>{subtitle}</p> : null}
        </div>
        {children}
        <Link className="btn btn-block" scroll={false} href={closeHref}>{closeLabel}</Link>
      </div>
    </>
  );
}
