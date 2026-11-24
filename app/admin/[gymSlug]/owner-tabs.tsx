"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The owner's section tabs. The tab for the section the owner is in is marked, so they always know where they are. */
export function OwnerTabs({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/admin/${slug}`;
  const tabs = [
    { href: base, label: "Timetable", on: path === base || path.startsWith(`${base}/sessions`) },
    { href: `${base}/classes`, label: "Classes", on: path.startsWith(`${base}/classes`) },
    { href: `${base}/coaches`, label: "Coaches", on: path.startsWith(`${base}/coaches`) },
    { href: `/g/${slug}`, label: "Member view", on: false },
  ];
  return (
    <nav className="owner-nav" aria-label="Owner sections">
      <div className="tabs">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={`tab${t.on ? " on" : ""}`} aria-current={t.on ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
